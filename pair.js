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
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const router = express.Router();

/* ===== SESSION GENERATOR ===== */
async function generateShortSession(credsPath) {
  const credsData = fs.readFileSync(credsPath, "utf-8");
  const base64Creds = Buffer.from(credsData).toString("base64");
  return {
    sessionId: "FAIZAN-MD~",
    encodedData: base64Creds,
  };
}

function rm(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

/* ===== ROUTE ===== */
router.get("/", async (req, res) => {
  let num = (req.query.number || "").replace(/[^0-9]/g, "");
  if (!num) return res.status(400).send({ error: "Number required" });

  const phone = pn("+" + num);
  if (!phone.isValid()) return res.status(400).send({ error: "Invalid number" });
  num = phone.getNumber("e164").replace("+", "");

  const dir = "./session_" + num;
  rm(dir);

  const start = async () => {
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          pino({ level: "fatal" })
        ),
      },
      logger: pino({ level: "fatal" }),
      browser: Browsers.windows("Chrome"),
      markOnlineOnConnect: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        try {
          await delay(3000);
          const credsPath = join(dir, "creds.json");
          const sessionInfo = await generateShortSession(credsPath);

          const jid = jidNormalizedUser(num + "@s.whatsapp.net");
          const fullSession =
            sessionInfo.sessionId + sessionInfo.encodedData;

          await sock.sendMessage(jid, { text: fullSession });
          await delay(2000);

          await sock.sendMessage(jid, {
            image: { url: "https://files.catbox.moe/jftrh0.jpg" },
            caption:
              `🤖 BOT DETAILS\n\n` +
              `• Name: ARSLAN-XMD\n` +
              `• Version: 8.0.0\n` +
              `• Session ID: ${sessionInfo.sessionId}\n` +
              `• Owner: ArslanMD Official\n\n` +
              `Paste session in config & restart bot.`,
          });

          await delay(2000);
          rm(dir);
          process.exit(0);
        } catch (e) {
          rm(dir);
          process.exit(1);
        }
      }

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code !== 401) setTimeout(start, 2000);
      }
    });

    if (!sock.authState.creds.registered) {
      await delay(3000);
      const code = await sock.requestPairingCode(num);
      if (!res.headersSent)
        res.send({ success: true, code: code.match(/.{1,4}/g).join("-") });
    }
  };

  start();
});

/* ===== SAFETY ===== */
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});

export default router;
