import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";

import pairRouter from "./pair.js";
import qrRouter from "./qr.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

import("events").then((events) => {
    events.EventEmitter.defaultMaxListeners = 500;
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "pair.html"));
});

app.use("/pair", pairRouter);
app.use("/qr", qrRouter);

app.listen(PORT, () => {
    console.log(`\u2705 Server running on http://localhost:${PORT}`);
});

export default app;
