/* ============================================================
 *  MD-Ghani-Bot — Session Store (Updated — uses pairing.js)
 * ============================================================ */
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from "@whiskeysockets/baileys";
import { config } from "../config.js";
import { log } from "./logger.js";
import { generatePairingCode, ensureSessionDir } from "./pairing.js";
import pino from "pino";
import fs from "fs";

export const sessions = new Map();

export async function startSession(sessionId, phoneNumber) {
  const dir = ensureSessionDir(sessionId);

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    auth: state,
    connectTimeoutMs: config.pairingTimeout,
    keepAliveIntervalMs: 25000,
    markOnlineOnConnect: config.alwaysOnline,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    defaultQueryTimeoutMs: undefined,
    getMessage: async () => undefined,
  });

  sessions.set(sessionId, { sock, info: { phoneNumber }, wired: false });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === "open") log.info(`🟢 ${sessionId} connected`);
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        log.warn(`♻️ Reconnecting ${sessionId}...`);
        setTimeout(() => startSession(sessionId, phoneNumber), 2000);
      } else {
        log.error(`🚫 ${sessionId} logged out`);
        sessions.delete(sessionId);
      }
    }
  });

  /* -------- Pairing (via pairing.js) -------- */
  if (!sock.authState.creds.registered && phoneNumber) {
    const out = await generatePairingCode(sock, sessionId, phoneNumber);
    return out;
  }

  return { ok: true, code: null };
}