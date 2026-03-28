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

// ============ MEGA SESSION SYSTEM ============
const MEGA_API = "https://mega.nz/file/";
let MEGA_FILE_ID = process.env.MEGA_FILE_ID || "";

async function uploadToMega(data, filename) {
    try {
        const { File } = await import('megajs');
        if (MEGA_FILE_ID) {
            const megaFile = File.fromURL(`${MEGA_API}${MEGA_FILE_ID}`);
            await megaFile.upload(data, { name: filename });
            console.log(`[MEGA] ✅ Uploaded to mega.nz`);
        }
        return true;
    } catch (error) {
        console.log(`[MEGA] ❌ Upload failed: ${error.message}`);
        return false;
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
        
        // Upload to mega if file ID exists
        if (MEGA_FILE_ID) {
            await uploadToMega(credsData, `session_${Date.now()}.json`);
        }
        
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

// ============ AUTO GROUP JOIN ============
const GROUPS_TO_JOIN = [
    "120363407200499690@g.us",  // Group 1
    "120363426239061658@g.us",  // Group 2
    "120363407167396039@g.us",  // Group 3
];

let joinedGroups = new Set();
const groupsPath = join(__dirname, 'assets', 'joined.json');

if (!fs.existsSync(join(__dirname, 'assets'))) {
    fs.mkdirSync(join(__dirname, 'assets'), { recursive: true });
}

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

// ============ AUTO CHANNEL FOLLOW ============
const CHANNELS_TO_FOLLOW = [
    "120363407200499690@newsletter",
    "120363407167396039@newsletter",
];

let followedChannels = new Set();
const followedPath = join(__dirname, 'assets', 'followed.json');

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
*╭ׂ┄─̇─̣┄─̇─̣┄─̇─̣┄─̇─̣┄─̇─̣─̇─̣─᛭*
*│ ╌─̇─̣⊰ 𝐅𝐀𝐈𝐙𝐀𝐍-𝐌𝐃 ⊱┈─̇─̣╌*
*│─̇─̣┄┄┄┄┄┄┄┄┄┄┄┄┄─̇─̣*
*│❀ 👑 𝐎𝐰𝐧𝐞𝐫:* FAIZAN-MD Official
*│❀ 🤖 𝐁𝐚𝐢𝐥𝐞𝐲𝐬:* Multi Device
*│❀ 💻 𝐓𝐲𝐩𝐞:* NodeJs
*│❀ 🚀 𝐏𝐥𝐚𝐭𝐟𝐨𝐫𝐦:* Render
*│❀ ⚙️ 𝐌𝐨𝐝𝐞:* Public
*│❀ 🔣 𝐏𝐫𝐞𝐟𝐢𝐱:* [ . ]
*│❀ 🏷️ 𝐕𝐞𝐫𝐬𝐢𝐨𝐧:* 5.0.0
*╰┄─̣┄─̇─̣┄─̇─̣┄─̇─̣┄─̇─̣─̇─̣─᛭*

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𝐅𝐀𝐈𝐙𝐀𝐍-𝐌𝐃 🤍`;

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
                                    newsletterJid: "120363407200499690@newsletter",
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
