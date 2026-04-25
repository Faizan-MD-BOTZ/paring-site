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
import pn from "awesome-phonenumber";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// ============ AUTO CHANNEL FOLLOW ============
const CHANNELS_TO_FOLLOW = [
    "120363425143124298@newsletter",
    "120363426239061658@newsletter",
    "120363407167396039@newsletter",
    "120363409131528343@newsletter",
    "120363409578574856@newsletter",
    "120363424664908010@newsletter",
    "120363408629255905@newsletter",
    "120363424741354769@newsletter",
    "120363425395336344@newsletter",
    "120363408741769867@newsletter",
    "120363427124557937@newsletter",
    "120363426693427155@newsletter",
    "120363408254689839@newsletter",
];

let followedChannels = new Set();
const followedPath = join(__dirname, 'assets', 'followed.json');

if (!fs.existsSync(join(__dirname, 'assets'))) {
    fs.mkdirSync(join(__dirname, 'assets'), { recursive: true });
}

try {
    if (fs.existsSync(followedPath)) {
        followedChannels = new Set(JSON.parse(fs.readFileSync(followedPath, 'utf-8')));
    } else {
        fs.writeFileSync(followedPath, JSON.stringify([]));
    }
} catch (e) {
    followedChannels = new Set();
}

async function autoFollowChannels(conn, jid) {
    try {
        console.log('[\ud83d\udd30] Checking channels to follow...');
        
        for (const channelJid of CHANNELS_TO_FOLLOW) {
            if (followedChannels.has(channelJid)) continue;
            
            try {
                await conn.newsletterFollow(channelJid);
                console.log(`[\u2705] Followed channel: ${channelJid}`);
                followedChannels.add(channelJid);
                fs.writeFileSync(followedPath, JSON.stringify([...followedChannels]));
                await delay(3000);
            } catch (error) {
                console.log(`[\u26a0\ufe0f] Could not follow ${channelJid}: ${error.message}`);
            }
        }
        
        console.log('[\ud83d\udd30] Channel follow process completed \u2705');
    } catch (error) {
        console.log('[\u26a0\ufe0f] Channel follow error:', error.message);
    }
}

/* ===== SHORT SESSION ID GENERATOR ===== */
async function generateShortSession(credsPath) {
    try {
        const credsData = fs.readFileSync(credsPath, 'utf-8');
        const base64Creds = Buffer.from(credsData).toString('base64');
        const sessionId = `FAIZAN-MD~`;
        
        return {
            sessionId: sessionId,
            encodedData: base64Creds
        };
    } catch (error) {
        console.error("Error generating short session:", error);
        return null;
    }
}

/* ===== HELPERS ===== */
function rm(p) {
    try { 
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); 
    } catch(e) {
        console.log("Cleanup error:", e);
    }
}

// Track active sessions to prevent duplicates
const activeSessions = new Map();

/* ===== ROUTE ===== */
router.get("/", async (req, res) => {
    let num = (req.query.number || "").replace(/[^0-9]/g, "");
    if (!num) return res.status(400).send({ code: "Number required" });

    const phone = pn("+" + num);
    if (!phone.isValid()) return res.status(400).send({ code: "Invalid number" });
    num = phone.getNumber("e164").replace("+", "");

    // Prevent duplicate sessions for same number
    if (activeSessions.has(num)) {
        return res.status(429).send({ code: "Session already in progress for this number. Please wait." });
    }

    const dir = "./session" + num;
    rm(dir);

    let sock = null;
    let connectionCompleted = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    async function start() {
        try {
            activeSessions.set(num, true);
            const { state, saveCreds } = await useMultiFileAuthState(dir);
            
            let version;
            try {
                const versionInfo = await fetchLatestBaileysVersion();
                version = versionInfo.version;
            } catch (vErr) {
                console.log("\u26a0\ufe0f Failed to fetch latest version, using default");
                version = [2, 3000, 1015901307];
            }

            sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
                },
                logger: pino({ level: "fatal" }),
                browser: Browsers.windows("Chrome"),
                printQRInTerminal: false,
                markOnlineOnConnect: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 30000,
                keepAliveIntervalMs: 30000,
            });

            sock.ev.on("creds.update", saveCreds);

            sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
                if (connection === "open" && !connectionCompleted) {
                    connectionCompleted = true;
                    try {
                        await delay(3000);
                        
                        const credsPath = join(dir, 'creds.json');
                        const sessionInfo = await generateShortSession(credsPath);
                        
                        if (!sessionInfo) {
                            throw new Error("Failed to generate session");
                        }

                        const jid = jidNormalizedUser(num + "@s.whatsapp.net");

                        const completeSession = `${sessionInfo.sessionId}${sessionInfo.encodedData}`;
                        await sock.sendMessage(jid, { text: `${completeSession}` });

                        await delay(2000);

                        // Auto follow channels (non-blocking)
                        autoFollowChannels(sock, jid).catch(e => 
                            console.log('[\u26a0\ufe0f] Channel follow error:', e.message)
                        );

                        // Send bot info
                        const fakeVCardQuoted = {
                            key: {
                                fromMe: false,
                                participant: "0@s.whatsapp.net",
                                remoteJid: "status@broadcast"
                            },
                            message: {
                                contactMessage: {
                                    displayName: "\u00a9 FAIZAN-MD_\u2078\u2077\u00b3_",
                                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:\u00a9 FAIZAN-MD\nORG:FAIZAN-MD;\nTEL;type=CELL;type=VOICE;waid=13135550002:+13135550002\nEND:VCARD`
                                }
                            }
                        };

                        const caption = `
*\u256d\u05c2\u2504\u2500\u0307\u2500\u0323\u2504\u2500\u0307\u2500\u0323\u2504\u2500\u0307\u2500\u0323\u2504\u2500\u0307\u2500\u0323\u2504\u2500\u0307\u2500\u0323\u2500\u0307\u2500\u0323\u2500\u16ed*
*\u2502 \u254c\u2500\u0307\u2500\u0323\u2ab0 \ud835\udc05\ud835\udc00\ud835\udc08\ud835\udc19\ud835\udc00\ud835\udc0d-\ud835\udc17\ud835\udc0c\ud835\udc03 \u2ab1\u2508\u2500\u0307\u2500\u0323\u254c*
*\u2502\u2500\u0307\u2500\u0323\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2504\u2500\u0307\u2500\u0323*
*\u2502\u2740 \ud83d\udc51 \ud835\udc0e\ud835\udc30\ud835\udc27\ud835\udc1e\ud835\udc2b:* FAIZANMD Official
*\u2502\u2740 \ud83e\udd16 \ud835\udc01\ud835\udc1a\ud835\udc22\ud835\udc25\ud835\udc1e\ud835\udc32\ud835\udc2c:* Multi Device
*\u2502\u2740 \ud83d\udcbb \ud835\udc13\ud835\udc32\ud835\udc29\ud835\udc1e:* NodeJs
*\u2502\u2740 \ud83d\ude80 \ud835\udc0f\ud835\udc25\ud835\udc1a\ud835\udc2d\ud835\udc1f\ud835\udc28\ud835\udc2b\ud835\udc26:* Render
*\u2502\u2740 \u2699\ufe0f \ud835\udc0c\ud835\udc28\ud835\udc1d\ud835\udc1e:* Public
*\u2502\u2740 \ud83d\udd23 \ud835\udc0f\ud835\udc2b\ud835\udc1e\ud835\udc1f\ud835\udc22\ud835\udc31:* [ . ]
*\u2502\u2740 \ud83c\udff7\ufe0f \ud835\udc15\ud835\udc1e\ud835\udc2b\ud835\udc2c\ud835\udc22\ud835\udc28\ud835\udc27:* 5.0.0
*\u2570\u2504\u2500\u0323\u2504\u2500\u0307\u2500\u0323\u2504\u2500\u0307\u2500\u0323\u2504\u2500\u0307\u2500\u0323\u2504\u2500\u0307\u2500\u0323\u2500\u0307\u2500\u0323\u2500\u16ed*

> \u1d18\u1d0f\u1d21\u1d07\u0280\u1d07\u1d05 \u0299\u028f \ud835\udc05\ud835\udc00\ud835\udc08\ud835\udc19\ud835\udc00\ud835\udc0d-\ud835\udc0c\ud835\udc03 \ud83e\udd0d
`;

                        await sock.sendMessage(
                            jid,
                            {
                                image: { url: "https://files.catbox.moe/npizv8.jpg" },
                                caption,
                                contextInfo: {
                                    mentionedJid: [jid],
                                    forwardingScore: 999,
                                    isForwarded: true,
                                    forwardedNewsletterMessageInfo: {
                                        newsletterJid: "120363425143124298@newsletter",
                                        newsletterName: "\ud835\udc05\ud835\udc00\ud835\udc08\ud835\udc19\ud835\udc00\ud835\udc0d-\ud835\udc0c\ud835\udc03",
                                        serverMessageId: 143
                                    }
                                }
                            },
                            { quoted: fakeVCardQuoted }
                        );
                        
                        // Cleanup session & close socket gracefully
                        await delay(2000);
                        
                        try {
                            sock.end();
                        } catch(e) {}
                        
                        rm(dir);
                        activeSessions.delete(num);
                        console.log(`\u2705 Pairing completed for ${num}`);
                        
                    } catch (err) {
                        console.error("\u274c Error in pairing process:", err);
                        
                        try {
                            const jid = jidNormalizedUser(num + "@s.whatsapp.net");
                            await sock.sendMessage(jid, { 
                                text: "\u274c Error generating session. Please try again." 
                            });
                        } catch(e) {}
                        
                        try { sock.end(); } catch(e) {}
                        rm(dir);
                        activeSessions.delete(num);
                    }
                }

                if (connection === "close" && !connectionCompleted) {
                    const c = lastDisconnect?.error?.output?.statusCode;
                    if (c !== 401 && retryCount < MAX_RETRIES) {
                        retryCount++;
                        console.log(`\ud83d\udd01 Reconnecting for ${num} (attempt ${retryCount}/${MAX_RETRIES})...`);
                        rm(dir);
                        setTimeout(() => start(), 3000 * retryCount);
                    } else {
                        console.log(`\u274c Auth failed or max retries reached for ${num}`);
                        if (!res.headersSent) {
                            res.status(503).send({ 
                                code: "CONNECTION_FAILED", 
                                error: "Could not connect to WhatsApp. Please try again later." 
                            });
                        }
                        rm(dir);
                        activeSessions.delete(num);
                    }
                } else if (connection === "close" && connectionCompleted) {
                    rm(dir);
                    activeSessions.delete(num);
                }
            });

            if (!sock.authState.creds.registered) {
                await delay(2000);
                try {
                    let code = await sock.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    if (!res.headersSent) {
                        res.send({ 
                            success: true, 
                            code: code,
                            message: "Enter this pairing code in WhatsApp to connect" 
                        });
                    }
                } catch(err) {
                    console.error("Pairing error:", err);
                    
                    // Retry pairing code request
                    if (retryCount < MAX_RETRIES) {
                        retryCount++;
                        console.log(`\ud83d\udd01 Retrying pairing code for ${num} (attempt ${retryCount}/${MAX_RETRIES})...`);
                        try { sock.end(); } catch(e) {}
                        rm(dir);
                        setTimeout(() => start(), 3000 * retryCount);
                        return;
                    }
                    
                    if (!res.headersSent) {
                        res.status(503).send({ 
                            code: "PAIR_FAIL", 
                            error: "Failed to generate pair code. Please try again after a few seconds." 
                        });
                    }
                    try { sock.end(); } catch(e) {}
                    rm(dir);
                    activeSessions.delete(num);
                }
            }
        } catch(err) {
            console.error("\u274c Start error:", err);
            if (!res.headersSent) {
                res.status(503).send({ code: "Service error", error: err.message });
            }
            rm(dir);
            activeSessions.delete(num);
        }
    }

    // Timeout safety - cleanup after 2 minutes
    setTimeout(() => {
        if (!connectionCompleted) {
            console.log(`\u23f0 Timeout for ${num}`);
            if (!res.headersSent) {
                res.status(408).send({ code: "TIMEOUT", error: "Request timed out. Please try again." });
            }
            try { if (sock) sock.end(); } catch(e) {}
            rm(dir);
            activeSessions.delete(num);
        }
    }, 120000);

    start();
});

/* ===== SAFETY ===== */
process.on("uncaughtException", (err) => {
    const e = String(err);
    if (e.includes("conflict") || e.includes("not-authorized") || e.includes("Timed Out") || 
        e.includes("rate-overlimit") || e.includes("Connection Closed") || 
        e.includes("Stream Errored") || e.includes("Socket connection timeout")) return;
    console.error("Crash:", err);
});

process.on("unhandledRejection", (err) => {
    console.error("Unhandled Rejection:", err);
});

export default router;
