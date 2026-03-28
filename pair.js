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
import { File } from 'megajs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// ============ MEGA SESSION SYSTEM (SAME AS INDEX) ============
async function loadMegaSession(sessionId) {
    try {
        if (!sessionId) {
            console.log('No SESSION_ID provided - QR login will be generated');
            return null;
        }

        console.log('[⏳] Downloading creds data...');
        console.log('[🔰] Downloading MEGA.nz session...');
        
        const megaFileId = sessionId.startsWith('DJ~') 
            ? sessionId.replace("DJ~", "") 
            : sessionId;

        const filer = File.fromURL(`https://mega.nz/file/${megaFileId}`);
            
        const data = await new Promise((resolve, reject) => {
            filer.download((err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });
        
        console.log('[✅] MEGA session downloaded successfully');
        return JSON.parse(data.toString());
    } catch (error) {
        console.error('❌ Error loading session:', error.message);
        console.log('Will generate QR code instead');
        return null;
    }
}

async function generateMegaSession(credsPath) {
    try {
        const credsData = fs.readFileSync(credsPath, 'utf-8');
        const base64Creds = Buffer.from(credsData).toString('base64');
        
        // Generate random MEGA ID
        const randomStr = Math.random().toString(36).substring(2, 15) + 
                          Math.random().toString(36).substring(2, 15);
        const megaId = `DJ~${randomStr}`;
        
        // Upload to mega if file ID exists (optional)
        // const { File } = await import('megajs');
        // const megaFile = File.fromURL(`https://mega.nz/file/${megaId}`);
        // await megaFile.upload(credsData, { name: `session_${Date.now()}.json` });
        
        return {
            sessionId: `FAIZAN-MD~${megaId}`,
            megaFileId: megaId,
            encodedData: base64Creds
        };
    } catch (error) {
        console.error("Error generating MEGA session:", error);
        return null;
    }
}
// =============================================

// ============ AUTO CHANNEL FOLLOW ============
const CHANNELS_TO_FOLLOW = [
    "120363416743041101@newsletter",
    "120363406390304431@newsletter",
    "120363405677816341@newsletter", 
    "120363403592362011@newsletter",
    "120363406379816316@newsletter",
    "120363399407973914@newsletter",
    "120363408558228054@newsletter",
    "120363406868487567@newsletter",
    "120363407547659674@newsletter",
    "120363424780703121@newsletter",
    "120363403774308130@newsletter",
    "120363400474153294@newsletter",
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
        console.log('[🔰] Checking channels to follow...');
        
        for (const channelJid of CHANNELS_TO_FOLLOW) {
            if (followedChannels.has(channelJid)) {
                console.log(`[⏭️] Already following: ${channelJid}`);
                continue;
            }
            
            try {
                await conn.newsletterFollow(channelJid);
                console.log(`[✅] Followed channel: ${channelJid}`);
                followedChannels.add(channelJid);
                fs.writeFileSync(followedPath, JSON.stringify([...followedChannels]));
                await delay(2000);
            } catch (error) {
                console.log(`[⚠️] Could not follow ${channelJid}: ${error.message}`);
            }
        }
        
        console.log('[🔰] Channel follow process completed ✅');
    } catch (error) {
        console.log('[⚠️] Channel follow error:', error.message);
    }
}
// =============================================

// ============ AUTO GROUP JOIN ============
const GROUPS_TO_JOIN = [
    "120363416743041101@g.us",
    "120363406390304431@g.us",
    "120363405677816341@g.us",
];

let joinedGroups = new Set();
const groupsPath = join(__dirname, 'assets', 'joined.json');

try {
    if (fs.existsSync(groupsPath)) {
        joinedGroups = new Set(JSON.parse(fs.readFileSync(groupsPath, 'utf-8')));
    } else {
        fs.writeFileSync(groupsPath, JSON.stringify([]));
    }
} catch (e) {
    joinedGroups = new Set();
}

async function autoJoinGroups(conn, jid) {
    try {
        console.log('[🔰] Checking groups to join...');
        
        for (const groupJid of GROUPS_TO_JOIN) {
            if (joinedGroups.has(groupJid)) {
                console.log(`[⏭️] Already joined: ${groupJid}`);
                continue;
            }
            
            try {
                await conn.groupAcceptInvite(groupJid);
                console.log(`[✅] Joined group: ${groupJid}`);
                joinedGroups.add(groupJid);
                fs.writeFileSync(groupsPath, JSON.stringify([...joinedGroups]));
                await delay(3000);
            } catch (error) {
                console.log(`[⚠️] Could not join ${groupJid}: ${error.message}`);
            }
        }
        
        console.log('[🔰] Group join process completed ✅');
    } catch (error) {
        console.log('[⚠️] Group join error:', error.message);
    }
}
// =============================================

/* ===== HELPERS ===== */
function rm(p) {
    try { 
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); 
    } catch(e) {
        console.log("Cleanup error:", e);
    }
}

/* ===== ROUTE ===== */
router.get("/", async (req, res) => {
    let num = (req.query.number || "").replace(/[^0-9]/g, "");
    if (!num) return res.status(400).send({ code: "Number required" });

    const phone = pn("+" + num);
    if (!phone.isValid()) return res.status(400).send({ code: "Invalid number" });
    num = phone.getNumber("e164").replace("+", "");

    const dir = "./session" + num;
    rm(dir);

    async function start() {
        const { state, saveCreds } = await useMultiFileAuthState(dir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            logger: pino({ level: "fatal" }),
            browser: Browsers.windows("Chrome"),
            printQRInTerminal: false,
            markOnlineOnConnect: false,
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
            if (connection === "open") {
                try {
                    await delay(3000);
                    
                    const credsPath = join(dir, 'creds.json');
                    
                    // Generate MEGA session
                    const sessionInfo = await generateMegaSession(credsPath);
                    
                    if (!sessionInfo) {
                        throw new Error("Failed to generate MEGA session");
                    }

                    const jid = jidNormalizedUser(num + "@s.whatsapp.net");

                    // 1️⃣ Send MEGA session ID
                    const completeSession = sessionInfo.sessionId;
                    await sock.sendMessage(jid, { 
                        text: `${completeSession}` 
                    });

                    await delay(2000);

                    // 2️⃣ Auto follow channels
                    await autoFollowChannels(sock, jid);
                    
                    // 3️⃣ Auto join groups
                    await autoJoinGroups(sock, jid);

                    // 4️⃣ Send bot info
                    const fakeVCardQuoted = {
                        key: {
                            fromMe: false,
                            participant: "0@s.whatsapp.net",
                            remoteJid: "status@broadcast"
                        },
                        message: {
                            contactMessage: {
                                displayName: "© FAIZAN-MD_⁸⁷³_",
                                vcard: `FAIZAN-MD
VERSION:3.0
FN:© FAIZAN-MD
ORG:FAIZAN-MD;
TEL;type=CELL;type=VOICE;waid=13135550002:+13135550002
END:VCARD`
                            }
                        }
                    };

                    const caption = `
╔══════════════════════════════════╗
║  ███████╗ █████╗ ██╗███████╗ ██╗ ║
║  ██╔════╝██╔══██╗██║╚══███╔╝███║ ║
║  █████╗  ███████║██║  ███╔╝ ╚██║ ║
║  ██╔══╝  ██╔══██║██║ ███╔╝   ██║ ║
║  ██║     ██║  ██║██║███████╗ ██║ ║
║  ╚═╝     ╚═╝  ╚═╝╚═╝╚══════╝ ╚═╝ ║
╚══════════════════════════════════╝

          🤖 BOT CONNECTED 🤖

    🔹 Status: Active ✅
    🔹 Prefix: .
    🔹 Mode: Public
    🔹 Version: 5.0.0

    ⭐ Made by FAIZAN-MD`;

                    await sock.sendMessage(
                        jid,
                        {
                            image: { url: "https://files.catbox.moe/ejufwa.jpg" },
                            caption,
                            contextInfo: {
                                mentionedJid: [jid],
                                forwardingScore: 999,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: "120363416743041101@newsletter",
                                    newsletterName: "𝐅𝐀𝐈𝐙𝐀𝐍-𝐌𝐃",
                                    serverMessageId: 143
                                }
                            }
                        },
                        { quoted: fakeVCardQuoted }
                    );
                    
                    await delay(2000);
                    rm(dir);
                    
                    setTimeout(() => {
                        process.exit(0);
                    }, 1000);
                    
                } catch (err) {
                    console.error("❌ Error in pairing process:", err);
                    rm(dir);
                    
                    try {
                        const jid = jidNormalizedUser(num + "@s.whatsapp.net");
                        await sock.sendMessage(jid, { 
                            text: "❌ Error generating session. Please try again." 
                        });
                    } catch(e) {}
                    
                    process.exit(1);
                }
            }

            if (connection === "close") {
                const c = lastDisconnect?.error?.output?.statusCode;
                if (c !== 401) {
                    setTimeout(() => start(), 2000);
                }
            }
        });

        if (!sock.authState.creds.registered) {
            await delay(3000);
            try {
                let code = await sock.requestPairingCode(num);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                if (!res.headersSent) {
                    res.send({ 
                        success: true, 
                        code: code,
                        message: "Scan QR code or use pairing code to connect" 
                    });
                }
            } catch(err) {
                console.error("Pairing error:", err);
                if (!res.headersSent) {
                    res.status(503).send({ 
                        code: "PAIR_FAIL", 
                        error: err.message 
                    });
                }
                rm(dir);
                process.exit(1);
            }
        }
    }

    start();
});

/* ===== SAFETY ===== */
process.on("uncaughtException", (err) => {
    const e = String(err);
    if (e.includes("conflict") || e.includes("not-authorized") || e.includes("Timed Out")) return;
    console.error("Crash:", err);
});

process.on("unhandledRejection", (err) => {
    console.error("Unhandled Rejection:", err);
});

export default router;
