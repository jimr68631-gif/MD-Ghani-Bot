/* ============================================================
 *  MD-Ghani-Bot — Fast Message Handler
 * ============================================================ */
import { commands } from "../commands/index.js";
import { isOn } from "./toggle.js";
import { config } from "../config.js";
import { log } from "./logger.js";

export async function handleMessage(sock, msg, sessionId) {
  try {
    const from = msg.key.remoteJid;
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      "";
    if (!text.startsWith(config.prefix)) return;

    const [cmdName, ...args] = text.slice(config.prefix.length).trim().split(/\s+/);
    const cmd = commands.get(cmdName.toLowerCase());
    if (!cmd) return;

    if (cmd.toggle && !isOn(sessionId, cmd.toggle)) {
      return sock.sendMessage(from, {
        text: `⚠️ *${cmdName}* is OFF. Enable: .${cmdName} on`,
      });
    }

    Promise.resolve(
      cmd.run({ sock, msg, from, args, sessionId, text, cmdName })
    ).catch((e) => log.error(`cmd ${cmdName}: ${e.message}`));
  } catch (e) {
    log.error("handler: " + e.message);
  }
}