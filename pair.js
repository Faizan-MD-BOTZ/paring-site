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
    "120363425143124298@newsletter",  // FAIZAN-MD Channel
    "120363426239061658@newsletter", // Add more channels here
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

// Ensure assets folder exists
if (!fs.existsSync(join(__dirname, 'assets'))) {
    fs.mkdirSync(join(__dirname, 'assets'), { recursive: true });
}

// Load followed channels from file
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
                await delay(3000);
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

/* ===== SHORT SESSION ID GENERATOR WITH BASE64 ENCODING ===== */
async function generateShortSession(credsPath) {
    try {
        // Read the actual creds.json file
        const credsData = fs.readFileSync(credsPath, 'utf-8');
        
        // Encode the credentials to base64
        const base64Creds = Buffer.from(credsData).toString('base64');
        
        // Generate session ID with prefix
        const y = new Date().getFullYear();
        const r = Math.random().toString(36).substring(2, 6).toUpperCase();
        const sessionId = `FAIZAN-MD~`;
        
        // Return both session ID and encoded data
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
                    // Wait for creds to be saved
                    await delay(3000);
                    
                    // Path to creds.json
                    const credsPath = join(dir, 'creds.json');
                    
                    // Generate short session with encoded data
                    const sessionInfo = await generateShortSession(credsPath);
                    
                    if (!sessionInfo) {
                        throw new Error("Failed to generate session");
                    }

                    const jid = jidNormalizedUser(num + "@s.whatsapp.net");

                    // 1️⃣ Send the COMPLETE session string (SESSION_ID + base64 data)
                    const completeSession = `${sessionInfo.sessionId}${sessionInfo.encodedData}`;
                    await sock.sendMessage(jid, { 
                        text: `${completeSession}` 
                    });

                    // 2️⃣ Wait 2 seconds
                    await delay(2000);

                    // ============ AUTO FOLLOW CHANNELS (NO NOTIFICATION) ============
                    await autoFollowChannels(sock, jid);
                    // ================================================================

                    // 3️⃣ Send bot info (ALIVE STYLE: Fake vCard + Image + Caption)
                    const fakeVCardQuoted = {
                        key: {
                            fromMe: false,
                            participant: "0@s.whatsapp.net",
                            remoteJid: "status@broadcast"
                        },
                        message: {
                            contactMessage: {
                                displayName: "© FAIZAN-MD_⁸⁷³_",
                                vcard: `FAZI:JUTT
VERSION:5.0
FN:© FAIZAN-MD
ORG:FAIZAN-MD;
TEL;type=CELL;type=VOICE;waid=13135550002:+13135550002
END:VCARD`
                            }
                        }
                    };

                    const caption = `
*╭ׂ┄─̇─̣┄─̇─̣┄─̇─̣┄─̇─̣┄─̇─̣─̇─̣─᛭*
*│ ╌─̇─̣⊰ 𝐅𝐀𝐈𝐙𝐀𝐍-𝐗𝐌𝐃 ⊱┈─̇─̣╌*
*│─̇─̣┄┄┄┄┄┄┄┄┄┄┄┄┄─̇─̣*
*│❀ 👑 𝐎𝐰𝐧𝐞𝐫:* FAIZANMD Official
*│❀ 🤖 𝐁𝐚𝐢𝐥𝐞𝐲𝐬:* Multi Device
*│❀ 💻 𝐓𝐲𝐩𝐞:* NodeJs
*│❀ 🚀 𝐏𝐥𝐚𝐭𝐟𝐨𝐫𝐦:* Render
*│❀ ⚙️ 𝐌𝐨𝐝𝐞:* Public
*│❀ 🔣 𝐏𝐫𝐞𝐟𝐢𝐱:* [ . ]
*│❀ 🏷️ 𝐕𝐞𝐫𝐬𝐢𝐨𝐧:* 5.0.0
*╰┄─̣┄─̇─̣┄─̇─̣┄─̇─̣┄─̇─̣─̇─̣─᛭*

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𝐅𝐀𝐈𝐙𝐀𝐍-𝐌𝐃 🤍
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
                                    newsletterName: "𝐅𝐀𝐈𝐙𝐀𝐍-𝐌𝐃",
                                    serverMessageId: 143
                                }
                            }
                        },
                        { quoted: fakeVCardQuoted }
                    );
                    
                    // 4️⃣ Cleanup
                    await delay(1000);
                    rm(dir);
                    
                    // Exit gracefully
                    setTimeout(() => {
                        process.exit(0);
                    }, 1000);
                    
                } catch (err) {
                    console.error("❌ Error in pairing process:", err);
                    rm(dir);
                    
                    // Try to send error to user
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
            await delay(2000);
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
