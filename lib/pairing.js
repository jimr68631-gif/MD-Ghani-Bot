/* ============================================================
 *  MD-Ghani-Bot — Pairing Logic (Clean & Reusable)
 *  Ye file pairing code generate karti hai, logs deti hai,
 *  aur errors ko properly handle karti hai.
 *
 *  Isse lib/store.js aur server.js dono use karte hain —
 *  code duplicate nahi hota.
 * ============================================================ */

import { pair, log } from "./logger.js";
import { config } from "../config.js";
import fs from "fs";

/* ============================================================
 *  Validate Phone Number
 * ============================================================ */
export function validatePhone(phone) {
  if (!phone) return { ok: false, error: "Phone number required" };

  const cleaned = String(phone).replace(/\D/g, "");

  if (cleaned.length < 10) {
    return {
      ok: false,
      error: "Phone number too short (country code ke saath daalo)",
    };
  }
  if (cleaned.length > 15) {
    return { ok: false, error: "Phone number too long" };
  }
  if (!/^\d+$/.test(cleaned)) {
    return { ok: false, error: "Phone number must contain only digits" };
  }

  return { ok: true, sessionId: cleaned };
}

/* ============================================================
 *  Ensure Session Directory Exists
 * ============================================================ */
export function ensureSessionDir(sessionId) {
  const dir = `${config.sessionDir}/${sessionId}`;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log.info(`📁 Created session dir: ${dir}`);
  }
  return dir;
}

/* ============================================================
 *  Generate Pairing Code (Core Logic)
 *  @param {object} sock       - Baileys socket
 *  @param {string} sessionId  - Session ID (phone number)
 *  @param {string} phoneNumber - Phone number
 *  @returns {Promise<{ok, code?, error?}>}
 * ============================================================ */
export async function generatePairingCode(sock, sessionId, phoneNumber) {
  /* -------- Validation -------- */
  const v = validatePhone(phoneNumber);
  if (!v.ok) {
    pair.fail(v.error);
    return { ok: false, error: v.error };
  }

  /* -------- Already Registered? -------- */
  if (sock?.authState?.creds?.registered) {
    log.info(`ℹ️  ${sessionId} already registered`);
    return { ok: true, code: "ALREADY_CONNECTED" };
  }

  /* -------- Pairing Flow Logs -------- */
  pair.ready();
  pair.got(sessionId);
  pair.req(phoneNumber);

  try {
    /* -------- Wait 3 seconds (Baileys best practice) -------- */
    await new Promise((r) => setTimeout(r, 3000));

    /* -------- Request Pairing Code -------- */
    const code = await sock.requestPairingCode(phoneNumber);

    if (!code) {
      throw new Error("Empty pairing code received");
    }

    pair.ok(code);
    return { ok: true, code };
  } catch (e) {
    pair.fail(e);
    pair.err(e);
    return { ok: false, error: e?.message || "Pairing failed" };
  }
}

/* ============================================================
 *  Pairing Status Helper
 * ============================================================ */
export function pairingStatus(sock) {
  if (!sock) return "no-socket";
  if (sock?.authState?.creds?.registered) return "registered";
  if (sock?.authState?.creds?.me?.id) return "connecting";
  return "unregistered";
}

/* ============================================================
 *  Wait for Connection (Promise based)
 *  Pairing ke baad connection open hone tak wait karo
 * ============================================================ */
export function waitForConnection(sock, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (sock?.user) return resolve({ ok: true, user: sock.user });

    const timer = setTimeout(() => {
      reject(new Error("Connection timeout"));
    }, timeoutMs);

    const onUpdate = (u) => {
      if (u?.connection === "open") {
        clearTimeout(timer);
        sock.ev.off("connection.update", onUpdate);
        resolve({ ok: true, user: sock.user });
      }
      if (u?.connection === "close") {
        clearTimeout(timer);
        sock.ev.off("connection.update", onUpdate);
        reject(new Error("Connection closed during wait"));
      }
    };

    sock.ev.on("connection.update", onUpdate);
  });
}

/* ============================================================
 *  Full Pairing Flow (One Function — Sab Kuch)
 *  Ye function validate karta hai, dir banata hai, aur
 *  pairing code generate karta hai — sab in one call.
 * ============================================================ */
export async function fullPairingFlow(startSessionFn, phoneNumber) {
  /* -------- Validate -------- */
  const v = validatePhone(phoneNumber);
  if (!v.ok) return { ok: false, error: v.error };

  const sessionId = v.sessionId;

  /* -------- Ensure Dir -------- */
  ensureSessionDir(sessionId);

  /* -------- Start Session (from store.js) -------- */
  try {
    const out = await startSessionFn(sessionId, sessionId);

    if (!out.ok) {
      return { ok: false, error: out.error };
    }

    return {
      ok: true,
      code: out.code,
      sessionId,
      alreadyConnected: out.code === "ALREADY_CONNECTED" || out.code === null,
    };
  } catch (e) {
    pair.fail(e);
    pair.err(e);
    return { ok: false, error: e?.message || "Pairing flow failed" };
  }
}

/* ============================================================
 *  Cleanup Session (Logout)
 * ============================================================ */
export function cleanupSession(sessionId) {
  const dir = `${config.sessionDir}/${sessionId}`;
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      log.info(`🗑️  Cleaned session: ${sessionId}`);
      return { ok: true };
    }
    return { ok: false, error: "Session dir not found" };
  } catch (e) {
    log.error(`Cleanup error for ${sessionId}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/* ============================================================
 *  Exports Summary
 * ============================================================ */
export default {
  validatePhone,
  ensureSessionDir,
  generatePairingCode,
  pairingStatus,
  waitForConnection,
  fullPairingFlow,
  cleanupSession,
};