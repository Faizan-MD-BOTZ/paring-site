import express from "express";
import fs from "fs";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { upload } from "./mega.js";

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error("Error removing file:", e);
    }
}

function getMegaFileId(url) {
    try {
        const match = url.match(/\/file\/([^#]+#[^\/]+)/);
        return match ? match[1] : null;
    } catch (error) {
        return null;
    }
}

router.get("/", async (req, res) => {
    const sessionId =
        Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync("./qr_sessions")) {
        fs.mkdirSync("./qr_sessions", { recursive: true });
    }

    await removeFile(dirs);

    let sock = null;
    let connectionCompleted = false;

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            let responseSent = false;

            sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" }).child({ level: "fatal" }),
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows("Chrome"),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline, qr } =
                    update;

                if (qr && !responseSent) {
                    console.log("\ud83d\udfe2 QR Code Generated!");

                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: "M",
                            type: "image/png",
                            quality: 0.92,
                            margin: 1,
                            color: {
                                dark: "#000000",
                                light: "#FFFFFF",
                            },
                        });

                        if (!responseSent) {
                            responseSent = true;
                            res.send({
                                qr: qrDataURL,
                                message: "QR Code Generated! Scan it with your WhatsApp app.",
                                instructions: [
                                    "1. Open WhatsApp on your phone",
                                    "2. Go to Settings > Linked Devices",
                                    '3. Tap \"Link a Device\"',
                                    "4. Scan the QR code above",
                                ],
                            });
                        }
                    } catch (qrError) {
                        console.error("Error generating QR code:", qrError);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({ code: "Failed to generate QR code" });
                        }
                    }
                }

                if (connection === "open" && !connectionCompleted) {
                    connectionCompleted = true;
                    console.log("\u2705 Connected successfully via QR!");

                    try {
                        const credsPath = dirs + "/creds.json";
                        
                        // Wait for creds to be fully saved
                        await delay(3000);
                        
                        let megaUrl;
                        try {
                            megaUrl = await upload(credsPath, `creds_qr_${sessionId}.json`);
                        } catch(uploadErr) {
                            console.error("\u274c MEGA upload failed:", uploadErr.message);
                            // Fallback: send creds directly as base64
                            const credsData = fs.readFileSync(credsPath, 'utf-8');
                            const base64Creds = Buffer.from(credsData).toString('base64');
                            const userJid = jidNormalizedUser(sock.authState.creds.me?.id || "");
                            if (userJid) {
                                await sock.sendMessage(userJid, {
                                    text: `FAIZAN-MD~${base64Creds}`
                                });
                                console.log("\ud83d\udcc4 Session sent as base64 fallback");
                            }
                            
                            await delay(2000);
                            try { sock.end(); } catch(e) {}
                            removeFile(dirs);
                            return;
                        }

                        const megaFileId = getMegaFileId(megaUrl);

                        if (megaFileId) {
                            console.log("\u2705 Session uploaded to MEGA");

                            const userJid = jidNormalizedUser(sock.authState.creds.me?.id || "");
                            if (userJid) {
                                await sock.sendMessage(userJid, { text: `${megaFileId}` });
                                console.log("\ud83d\udcc4 MEGA file ID sent successfully");
                            }
                        }

                        // Cleanup gracefully - DO NOT call process.exit()
                        await delay(2000);
                        try { sock.end(); } catch(e) {}
                        removeFile(dirs);
                        console.log("\u2705 QR session completed successfully");
                        
                    } catch (error) {
                        console.error("\u274c Error in QR session:", error);
                        try { sock.end(); } catch(e) {}
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("\ud83d\udd10 New login via QR code");
                }

                if (connection === "close" && !connectionCompleted) {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("\u274c Logged out. Need new QR code.");
                        removeFile(dirs);
                    } else {
                        console.log("\ud83d\udd01 Connection closed \u2014 restarting...");
                        initiateSession();
                    }
                } else if (connection === "close" && connectionCompleted) {
                    // Already done, just cleanup
                    removeFile(dirs);
                }
            });

            sock.ev.on("creds.update", saveCreds);

            // Timeout safety
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    if (!res.headersSent) {
                        res.status(408).send({ code: "QR generation timeout" });
                    }
                    try { if (sock) sock.end(); } catch(e) {}
                    removeFile(dirs);
                }
            }, 30000);

            // Full session timeout
            setTimeout(() => {
                if (!connectionCompleted) {
                    try { if (sock) sock.end(); } catch(e) {}
                    removeFile(dirs);
                }
            }, 120000);

        } catch (err) {
            console.error("Error initializing session:", err);
            if (!res.headersSent) {
                res.status(503).send({ code: "Service Unavailable" });
            }
            removeFile(dirs);
        }
    }

    await initiateSession();
});

process.on("uncaughtException", (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored") || e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515") || e.includes("statusCode: 503")) return;
    console.log("Caught exception: ", err);
});

export default router;
