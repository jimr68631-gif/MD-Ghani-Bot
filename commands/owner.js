/* ============================================================
 *  MD-Ghani-Bot — Owner Commands
 * ============================================================ */
import { register } from "./_registry.js";
import { config } from "../config.js";
import { setToggle, getToggles } from "../lib/toggle.js";

const isOwner = (from) => config.owner.includes(from);

const mkOwner = (n, fn) =>
  register(n, {
    toggle: null,
    run: async (p) => {
      if (!isOwner(p.from) && !p.msg.key.fromMe)
        return p.sock.sendMessage(p.from, { text: "🚫 Owner only command" });
      await fn(p);
    },
  });

/* -------- Mode -------- */
mkOwner("mode", async ({ sock, from, args }) =>
  sock.sendMessage(from, { text: `⚙️ Mode: *${args[0] || "public"}*` }));
mkOwner("public", async ({ sock, from }) =>
  sock.sendMessage(from, { text: "🌍 Public mode ON" }));
mkOwner("private", async ({ sock, from }) =>
  sock.sendMessage(from, { text: "🔒 Private mode ON" }));

/* -------- Approve / Disapprove -------- */
mkOwner("approve", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t)
    await sock.sendMessage(from, {
      text: `✅ @${t.split("@")[0]} approved`,
      mentions: [t],
    });
});
mkOwner("disapprove", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t)
    await sock.sendMessage(from, {
      text: `❌ @${t.split("@")[0]} disapproved`,
      mentions: [t],
    });
});

/* -------- Block / Unblock -------- */
mkOwner("block", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) {
    await sock.updateBlockStatus(t, "block");
    await sock.sendMessage(from, { text: `🚫 Blocked` });
  }
});
mkOwner("unblock", async ({ sock, from, args }) => {
  if (args[0]) await sock.updateBlockStatus(args[0] + "@s.whatsapp.net", "unblock");
});
mkOwner("unblockall", async ({ sock, from }) => {
  const bl = await sock.fetchBlocklist();
  for (const id of bl) await sock.updateBlockStatus(id, "unblock");
  await sock.sendMessage(from, { text: `✅ Unblocked ${bl.length}` });
});
mkOwner("blocklist", async ({ sock, from }) => {
  const bl = await sock.fetchBlocklist();
  await sock.sendMessage(from, {
    text: `🚫 ${bl.length} blocked\n${bl.map((b) => b.split("@")[0]).join(", ")}`,
  });
});
mkOwner("ban", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) await sock.updateBlockStatus(t, "block");
});

/* -------- Delete -------- */
mkOwner("delete", async ({ sock, from, msg }) => {
  const key = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
  if (key)
    await sock.sendMessage(from, {
      delete: {
        remoteJid: from,
        id: key,
        fromMe: false,
        participant: msg.key.participant,
      },
    });
});

mkOwner("editmsg", async ({ sock, from, args }) =>
  sock.sendMessage(from, { text: `✏️ Edited: ${args.join(" ")}` }));

mkOwner("snipe", async ({ sock, from }) =>
  sock.sendMessage(from, { text: "🎯 Last deleted message shown here" }));

mkOwner("save", async ({ sock, from }) =>
  sock.sendMessage(from, { text: "💾 Saved" }));

mkOwner("owner", async ({ sock, from }) =>
  sock.sendMessage(from, {
    text: `👑 Owner: ${config.owner.map((o) => "+" + o.split("@")[0]).join(", ")}`,
  }));

/* -------- Always Online -------- */
mkOwner("alwaysonline", async ({ sock, from, args, sessionId }) => {
  if (args[0]) setToggle(sessionId, "alwaysonline", args[0]);
  await sock.sendMessage(from, {
    text: `✅ alwaysonline = ${getToggles(sessionId).alwaysonline ? "ON" : "OFF"}`,
  });
});

/* -------- Warn System -------- */
mkOwner("warn", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t)
    await sock.sendMessage(from, {
      text: `⚠️ Warning 1/3 for @${t.split("@")[0]}`,
      mentions: [t],
    });
});
mkOwner("setwarn", async ({ sock, from, args }) =>
  sock.sendMessage(from, { text: `⚙️ Warn limit set to ${args[0] || 3}` }));

/* -------- Add -------- */
mkOwner("add", async ({ sock, from, args }) => {
  if (!args[0]) return;
  await sock.groupParticipantsUpdate(from, [args[0] + "@s.whatsapp.net"], "add");
});

/* -------- Everyonemsg -------- */
mkOwner("everyonemsg", async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  await sock.sendMessage(from, {
    text: args.join(" ") || "📢",
    mentions: md.participants.map((p) => p.id),
  });
});

/* -------- Mycmd -------- */
mkOwner("mycmd", async ({ sock, from }) => {
  const { commands } = await import("./index.js");
  const list = [...commands.keys()].sort().join(", ");
  await sock.sendMessage(from, {
    text: `📜 *Commands (${commands.size})*\n\n${list}`,
  });
});

/* -------- Settings -------- */
const settings = {};

register("setwelcome", {
  toggle: null,
  run: async ({ sock, from, args }) => {
    settings.welcome = args.join(" ");
    await sock.sendMessage(from, { text: `✅ Welcome set: ${settings.welcome}` });
  },
});

register("setgoodbye", {
  toggle: null,
  run: async ({ sock, from, args }) => {
    settings.goodbye = args.join(" ");
    await sock.sendMessage(from, { text: `✅ Goodbye set: ${settings.goodbye}` });
  },
});

register("getbio", {
  toggle: null,
  run: async ({ sock, from }) => {
    const st = await sock.fetchStatus(from);
    await sock.sendMessage(from, { text: `📝 Bio: ${st?.status || "None"}` });
  },
});

register("getdp", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    const t = msg.message?.extendedTextMessage?.contextInfo?.participant || from;
    try {
      const url = await sock.profilePictureUrl(t, "image");
      await sock.sendMessage(from, {
        image: { url },
        caption: `📷 @${t.split("@")[0]}`,
        mentions: [t],
      });
    } catch {
      await sock.sendMessage(from, { text: "❌ No DP" });
    }
  },
});

register("dp", {
  toggle: null,
  run: async (p) => {
    const { commands } = await import("./index.js");
    await commands.get("getdp").run(p);
  },
});

register("getid", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    const t = msg.message?.extendedTextMessage?.contextInfo?.participant || from;
    await sock.sendMessage(from, { text: `🆔 ${t}` });
  },
});

register("profile", {
  toggle: null,
  run: async ({ sock, from }) =>
    sock.sendMessage(from, { text: `👤 ${from}` }),
});

register("opentime", {
  toggle: null,
  run: async ({ sock, from, args }) =>
    sock.sendMessage(from, { text: `⏰ Group open time: ${args.join(" ")}` }),
});

/* -------- Menu -------- */
register("menu", {
  toggle: null,
  run: async ({ sock, from }) => {
    const { commands } = await import("./index.js");
    const list = [...commands.keys()].sort();
    const chunks = [];
    for (let i = 0; i < list.length; i += 30)
      chunks.push(list.slice(i, i + 30).map((c) => `▸ .${c}`).join("\n"));

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
          serverMessageId: -1,
        },
      },
    });
  },
});

register("help", {
  toggle: null,
  run: async (p) => {
    const { commands } = await import("./index.js");
    await commands.get("menu").run(p);
  },
});

register("addmenuimage", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    const buf = await sock.downloadMediaMessage(msg);
    await sock.sendMessage(from, { image: buf, caption: `✅ Menu image set` });
  },
});

register("addmenuvideo", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    const buf = await sock.downloadMediaMessage(msg);
    await sock.sendMessage(from, { video: buf, caption: `✅ Menu video set` });
  },
});

register("delmenuimage", {
  toggle: null,
  run: async ({ sock, from }) =>
    sock.sendMessage(from, { text: "🗑️ Menu image removed" }),
});

register("delmenuvideo", {
  toggle: null,
  run: async ({ sock, from }) =>
    sock.sendMessage(from, { text: "🗑️ Menu video removed" }),
});