/* ============================================================
 *  MD-Ghani-Bot — Pairing Web Server (Final)
 * ============================================================ */

import "./index.js"; // ← Root index.js ko bhi start karo

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { startSession, sessions } from "./lib/store.js";
import { pair, log } from "./lib/logger.js";
import { config } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/pair", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ ok: false, error: "phone required" });

    const sessionId = String(phone).replace(/\D/g, "");
    if (sessionId.length < 10)
      return res.status(400).json({ ok: false, error: "Invalid phone number" });

    pair.got(sessionId);
    const out = await startSession(sessionId, sessionId);

    if (out.ok && out.code) return res.json({ ok: true, code: out.code, sessionId });
    if (out.ok) return res.json({ ok: true, code: "ALREADY_CONNECTED", sessionId });

    pair.fail(out.error);
    res.status(500).json({ ok: false, error: out.error });
  } catch (e) {
    pair.fail(e);
    pair.err(e);
    res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
});

app.get("/status/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  res.json({ sessionId: req.params.id, connected: !!s?.sock?.user, wired: !!s?.wired });
});

app.get("/sessions", (req, res) => {
  const list = [];
  for (const [id, s] of sessions.entries())
    list.push({ sessionId: id, connected: !!s?.sock?.user, wired: !!s?.wired });
  res.json({ total: list.length, sessions: list });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, botName: config.botName, sessions: sessions.size, uptime: process.uptime() });
});

const PORT = config.port || 3000;
app.listen(PORT, () => {
  log.info(`🌐 Pairing panel ready: http://localhost:${PORT}`);
  log.info(`📢 Channel: ${config.channelLink}`);
});