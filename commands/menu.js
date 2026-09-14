import { register } from "./_registry.js";
import { config } from "../config.js";

register("menu", {
  toggle: null,
  run: async ({ sock, from, sessionId }) => {
    const { commands } = await import("./index.js");
    const { getToggles } = await import("../lib/toggle.js");
    const t = getToggles(sessionId);

    const list = [...commands.keys()].sort();
    const chunks = [];
    for (let i = 0; i < list.length; i += 30) {
      chunks.push(list.slice(i, i + 30).map(c => `▸ .${c}`).join("\n"));
    }

    const header = `╭━━━❰ *${config.botName}* ❱━━━╮
┃ 🤖 Prefix: *${config.prefix}*
┃ 📦 Total: *${commands.size}* commands
┃ ⚡ Status: *ONLINE*
╰━━━━━━━━━━━━━━━━╯\n\n`;

    const footer = `\n\n╭━━━❰ *Official Channel* ❱━━━╮
┃ 📢 Join: ${config.channelLink}
╰━━━━━━━━━━━━━━━━╯

> 💫 *${config.botName}* — Always Fast ⚡`;

    const body = chunks.slice(0, 3).join("\n\n");
    await sock.sendMessage(from, {
      text: header + body + footer,
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: config.channelJid,
          newsletterName: config.botName,
          serverMessageId: -1
        }
      }
    });
  }
});

register("help", { toggle: null, run: async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("menu").run(p);
}});

register("addmenuimage", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    const buf = await sock.downloadMediaMessage(msg);
    await sock.sendMessage(from, { image: buf, caption: `✅ Menu image set` });
  }
});

register("addmenuvideo", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    const buf = await sock.downloadMediaMessage(msg);
    await sock.sendMessage(from, { video: buf, caption: `✅ Menu video set` });
  }
});

register("delmenuimage", { toggle: null, run: async ({ sock, from }) =>
  sock.sendMessage(from, { text: "🗑️ Menu image removed" })});

register("delmenuvideo", { toggle: null, run: async ({ sock, from }) =>
  sock.sendMessage(from, { text: "🗑️ Menu video removed" })});