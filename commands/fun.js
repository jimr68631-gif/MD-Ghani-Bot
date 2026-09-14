/* ============================================================
 *  MD-Ghani-Bot — Fun Commands
 * ============================================================ */
import { register } from "./_registry.js";

const mk = (n, fn) => register(n, { toggle: null, run: fn });

/* -------- Reaction Menu -------- */
const REACTIONS = {
  cuddle: "🤗", hug: "🤝", kick: "🦵", kiss: "💋", pat: "🫳",
  poke: "👉", slap: "👋", kill: "💀", shoot: "🔫", smile: "😊",
  wink: "😉", danger: "⚠️", shy: "😳",
};

for (const [name, emoji] of Object.entries(REACTIONS)) {
  mk(name, async ({ sock, from, msg }) => {
    const t = msg.message?.extendedTextMessage?.contextInfo?.participant || from;
    await sock.sendMessage(from, {
      text: `${emoji} *${name.toUpperCase()}*\n@${t.split("@")[0]} ➜ @${from.split("@")[0]}`,
      mentions: [t, from],
    });
  });
}

mk("reactionmenu", async ({ sock, from }) => {
  const list = Object.entries(REACTIONS).map(([n, e]) => `${e} .${n}`).join("\n");
  await sock.sendMessage(from, { text: `🎭 *Reaction Menu*\n\n${list}` });
});

/* -------- Time / Date / Ping -------- */
mk("time", async ({ sock, from }) =>
  sock.sendMessage(from, {
    text: `🕐 ${new Date().toLocaleString("en-PK", { timeZone: "Asia/Karachi" })}`,
  }));

mk("date", async ({ sock, from }) =>
  sock.sendMessage(from, { text: `📅 ${new Date().toDateString()}` }));

mk("ping", async ({ sock, from }) => {
  const t = Date.now();
  const m = await sock.sendMessage(from, { text: "🏓 Pinging..." });
  await sock.sendMessage(from, {
    text: `🏓 Pong! *${Date.now() - t}ms*`,
    edit: m.key,
  });
});

mk("uptime", async ({ sock, from }) => {
  const u = process.uptime();
  const h = Math.floor(u / 3600), m = Math.floor((u % 3600) / 60), s = Math.floor(u % 60);
  await sock.sendMessage(from, { text: `⏱️ Uptime: *${h}h ${m}m ${s}s*` });
});

mk("runtime", async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("uptime").run(p);
});

mk("owner", async ({ sock, from }) => {
  const { config } = await import("../config.js");
  await sock.sendMessage(from, {
    text: `👑 Owner: ${config.owner.map((o) => "+" + o.split("@")[0]).join(", ")}`,
  });
});

/* -------- Audio Style -------- */
mk("bass", async ({ sock, from }) => sock.sendMessage(from, { text: "🎵 Bass effect applied" }));
mk("blown", async ({ sock, from }) => sock.sendMessage(from, { text: "🎵 Blown effect applied" }));
mk("loop", async ({ sock, from }) => sock.sendMessage(from, { text: "🔁 Loop enabled" }));
mk("nowplaying", async ({ sock, from }) => sock.sendMessage(from, { text: "🎶 Now Playing: MD-Ghani-Bot Radio" }));
mk("pause", async ({ sock, from }) => sock.sendMessage(from, { text: "⏸️ Paused" }));
mk("resume", async ({ sock, from }) => sock.sendMessage(from, { text: "▶️ Resumed" }));
mk("shuffle", async ({ sock, from }) => sock.sendMessage(from, { text: "🔀 Shuffled" }));
mk("skip", async ({ sock, from }) => sock.sendMessage(from, { text: "⏭️ Skipped" }));
mk("stop", async ({ sock, from }) => sock.sendMessage(from, { text: "⏹️ Stopped" }));
mk("volume", async ({ sock, from, args }) =>
  sock.sendMessage(from, { text: `🔊 Volume: ${args[0] || 50}%` }));

/* -------- Info -------- */
mk("device", async ({ sock, from }) =>
  sock.sendMessage(from, { text: `📱 Device: Ubuntu + Chrome 20.0.04` }));
mk("fakeinfo", async ({ sock, from }) =>
  sock.sendMessage(from, { text: `📋 Fake report generated for demo.` }));
mk("link", async ({ sock, from }) => {
  const { config } = await import("../config.js");
  await sock.sendMessage(from, { text: `🔗 ${config.channelLink}` });
});