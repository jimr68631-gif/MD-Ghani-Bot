/* ============================================================
 *  MD-Ghani-Bot — Logger
 * ============================================================ */
import pino from "pino";

export const log = pino({ level: "info" });

export const pair = {
  ready: () => console.log("✅ Pairing socket ready"),
  got: (n) => console.log(`🌐 Pairing request received from web panel (${n})`),
  req: (n) => console.log(`📱 Requesting pairing code for number ending ${String(n).slice(-4)}`),
  ok: (c) => console.log(`✅ Pairing code generated successfully: ${c}`),
  fail: (e) => console.log(`❌ Pairing request failed: ${e?.message || e}`),
  err: (e) => console.log(`❌ Exact error: ${e?.stack || e}`),
};