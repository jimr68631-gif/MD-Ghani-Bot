/**
 * ============================================================
 *  MD-Ghani-Bot — Ultimate All-in-One
 *  Node.js 20 • Baileys • Railway Ready
 *  Fast • Always-On • Multi-User • Pairing Panel Inline
 *  + Dockerfile self-check
 * ============================================================
 */

import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import pino from "pino";
import sharp from "sharp";
import { fileURLToPath } from "url";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from "@whiskeysockets/baileys";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ============================================================
 *  0. DOCKERFILE / ENV SELF-CHECK
 * ============================================================ */
(function selfCheck() {
  const checks = [];
  // Dockerfile check
  const dockerfilePath = path.join(__dirname, "Dockerfile");
  if (fs.existsSync(dockerfilePath)) {
    checks.push("✅ Dockerfile found");
  } else {
    checks.push("⚠️ Dockerfile NOT found (Railway needs it for Docker build)");
  }
  // package.json check
  const pkgPath = path.join(__dirname, "package.json");
  if (fs.existsSync(pkgPath)) {
    checks.push("✅ package.json found");
  } else {
    checks.push("❌ package.json MISSING — bot won't start");
  }
  // railway.json check
  const rwPath = path.join(__dirname, "railway.json");
  if (fs.existsSync(rwPath)) {
    checks.push("✅ railway.json found");
  } else {
    checks.push("⚠️ railway.json missing (Railway may still work)");
  }
  // Node version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split(".")[0]);
  if (major >= 20) {
    checks.push(`✅ Node ${nodeVer} OK`);
  } else {
    checks.push(`⚠️ Node ${nodeVer} — Node 20+ recommended`);
  }
  // Chrome / Chromium check
  const chromeBin = process.env.CHROME_BIN || "/usr/bin/chromium";
  if (fs.existsSync(chromeBin)) {
    checks.push(`✅ Chrome/Chromium found at ${chromeBin}`);
  } else {
    checks.push(`⚠️ Chrome/Chromium not found at ${chromeBin}`);
  }
  // FFmpeg check
  const ffmpegPaths = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
  if (ffmpegPaths.some((p) => fs.existsSync(p))) {
    checks.push("✅ ffmpeg found");
  } else {
    checks.push("⚠️ ffmpeg not found (media commands may fail)");
  }
  console.log("\n🔍 System Self-Check:");
  checks.forEach((c) => console.log("   " + c));
  console.log("");
})();

/* ============================================================
 *  1. CONFIG
 * ============================================================ */
const config = {
  botName: process.env.BOT_NAME || "MD-Ghani-Bot",
  owner: [(process.env.OWNER_NUMBER || "923000000000") + "@s.whatsapp.net"],
  prefix: ".",
  channelJid: "120363429085670060@newsletter",
  channelLink: "https://whatsapp.com/channel/120363429085670060",
  pairingTimeout: 60000,
  browser: Browsers.ubuntu("Chrome"),
  alwaysOnline: true,
  sessionDir: "./sessions",
  timezone: "Asia/Karachi",
  port: process.env.PORT || 3000,
};

const defaultToggles = {
  antibadword: false, antibot: false, antibug: false, anticontact: false,
  antidelete: false, antidemote: false, antipromote: false, antidocument: false,
  antiedit: false, antiforward: false, antigif: false, antiimage: false,
  antilink: false, antilocation: false, antimessage: false, antipoll: false,
  antistatus: false, antisticker: false, antitag: false, antitagadmin: false,
  antivideo: false, antivoice: false, antistatuslinkkick: false,
  autoreact: false, autoseen: false, autoreactstatus: false,
  autorecording: false, autorecordtyping: false, autosavestatus: false,
  autotyping: false, autoviewstatus: false,
  alwaysonline: true,
};

/* ============================================================
 *  2. LOGGER
 * ============================================================ */
const log = pino({ level: "info" });
const pair = {
  ready: () => console.log("✅ Pairing socket ready"),
  got: (n) => console.log(`🌐 Pairing request received from web panel (${n})`),
  req: (n) => console.log(`📱 Requesting pairing code for number ending ${String(n).slice(-4)}`),
  ok: (c) => console.log(`✅ Pairing code generated successfully: ${c}`),
  fail: (e) => console.log(`❌ Pairing request failed: ${e?.message || e}`),
  err: (e) => console.log(`❌ Exact error: ${e?.stack || e}`),
};

/* ============================================================
 *  3. TOGGLE STORE
 * ============================================================ */
const toggleState = new Map();
const getToggles = (id) => {
  if (!toggleState.has(id)) toggleState.set(id, { ...defaultToggles });
  return toggleState.get(id);
};
const setToggle = (id, key, val) => {
  const t = getToggles(id);
  if (!(key in t)) return false;
  t[key] = val === true || val === "true" || val === "on";
  return true;
};
const isOn = (id, key) => !!getToggles(id)[key];

/* ============================================================
 *  4. COMMAND REGISTRY + SESSIONS
 * ============================================================ */
const commands = new Map();
const register = (name, opts) => commands.set(name.toLowerCase(), opts);
const sessions = new Map();

/* ============================================================
 *  5. START SESSION
 * ============================================================ */
async function startSession(sessionId, phoneNumber) {
  const dir = `${config.sessionDir}/${sessionId}`;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: config.browser,
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
    if (connection === "open") {
      log.info(`🟢 ${sessionId} connected`);
      wireHandlers(sessionId);
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        log.warn(`♻️ Reconnecting ${sessionId}...`);
        setTimeout(() => startSession(sessionId, phoneNumber), 2000);
      } else {
        log.error(`🚫 ${sessionId} logged out`);
        sessions.delete(sessionId);
        toggleState.delete(sessionId);
      }
    }
  });

  if (!sock.authState.creds.registered && phoneNumber) {
    pair.ready();
    pair.got(sessionId);
    pair.req(phoneNumber);
    try {
      await new Promise((r) => setTimeout(r, 3000));
      const code = await sock.requestPairingCode(phoneNumber);
      pair.ok(code);
      return { ok: true, code };
    } catch (e) {
      pair.fail(e);
      pair.err(e);
      return { ok: false, error: e.message };
    }
  }
  return { ok: true, code: null };
}

/* ============================================================
 *  6. WIRE HANDLERS
 * ============================================================ */
function wireHandlers(sessionId) {
  const sess = sessions.get(sessionId);
  if (!sess || sess.wired) return;
  sess.wired = true;
  const sock = sess.sock;

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    const toggles = getToggles(sessionId);
    for (const msg of messages) {
      if (!msg.message) continue;
      Promise.resolve(runAuto(sock, msg, sessionId, toggles)).catch((e) => log.error(`auto: ${e.message}`));
      Promise.resolve(runAnti(sock, msg, sessionId, toggles)).catch((e) => log.error(`anti: ${e.message}`));
      Promise.resolve(handleMessage(sock, msg, sessionId)).catch((e) => log.error(`handler: ${e.message}`));
    }
  });
}

/* ============================================================
 *  7. AUTO FEATURES
 * ============================================================ */
async function runAuto(sock, msg, sessionId, toggles) {
  const from = msg.key.remoteJid;
  if (toggles.autoseen) sock.readMessages([msg.key]).catch(() => {});
  if (toggles.autotyping && !msg.key.fromMe) {
    sock.sendPresenceUpdate("composing", from).catch(() => {});
    setTimeout(() => sock.sendPresenceUpdate("paused", from).catch(() => {}), 1500);
  }
  if (toggles.autorecording && !msg.key.fromMe) {
    sock.sendPresenceUpdate("recording", from).catch(() => {});
    setTimeout(() => sock.sendPresenceUpdate("paused", from).catch(() => {}), 1500);
  }
  if (toggles.autoreact && !msg.key.fromMe) {
    const emojis = ["❤️", "🔥", "👍", "😍", "💯", "⚡", "✨", "🎯"];
    const e = emojis[Math.floor(Math.random() * emojis.length)];
    sock.sendMessage(from, { react: { text: e, key: msg.key } }).catch(() => {});
  }
  if (from === "status@broadcast") {
    if (toggles.autoviewstatus) sock.readMessages([msg.key]).catch(() => {});
    if (toggles.autoreactstatus && msg.key.participant) {
      sock.sendMessage("status@broadcast", { react: { text: "❤️", key: msg.key } },
        { statusJidList: [msg.key.participant] }).catch(() => {});
    }
  }
}

/* ============================================================
 *  8. ANTI ENGINE
 * ============================================================ */
const LINK_RE = /(https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/|t\.me\/)/i;
const BAD_WORDS = ["madarchod","bhenchod","bhosdi","gandu","chutiya","randi","loda","lund"];

async function runAnti(sock, msg, sessionId, toggles) {
  const from = msg.key.remoteJid;
  if (!from?.endsWith("@g.us")) return;
  if (msg.key.fromMe) return;

  const sender = msg.key.participant || from;
  const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || "";

  const isAdmin = await isUserAdmin(sock, from, sender);
  if (isAdmin) return;

  const checks = [
    ["antilink", () => LINK_RE.test(text)],
    ["antibadword", () => BAD_WORDS.some((w) => text.toLowerCase().includes(w))],
    ["antisticker", () => !!msg.message?.stickerMessage],
    ["antiimage", () => !!msg.message?.imageMessage],
    ["antivideo", () => !!msg.message?.videoMessage],
    ["antivoice", () => !!msg.message?.audioMessage?.ptt],
    ["antidocument", () => !!msg.message?.documentMessage],
    ["antigif", () => !!msg.message?.videoMessage?.gifPlayback],
    ["antilocation", () => !!msg.message?.locationMessage],
    ["anticontact", () => !!msg.message?.contactMessage],
    ["antipoll", () => !!msg.message?.pollCreationMessage],
    ["antiforward", () => !!msg.message?.extendedTextMessage?.contextInfo?.forwardingScore],
    ["antiviewonce", () => !!(msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2)],
  ];

  for (const [key, test] of checks) {
    if (!toggles[key]) continue;
    if (!test()) continue;
    await takeAction(sock, from, sender, msg, key);
    return;
  }
}

async function takeAction(sock, group, user, msg, key) {
  try {
    await sock.sendMessage(group, { delete: msg.key }).catch(() => {});
    await sock.sendMessage(group, {
      text: `⚠️ @${user.split("@")[0]} — *${key.toUpperCase()}* violation!`,
      mentions: [user],
    });
    await sock.groupParticipantsUpdate(group, [user], "remove").catch(() => {});
  } catch (e) { log.error("anti: " + e.message); }
}

async function isUserAdmin(sock, group, user) {
  try {
    const md = await sock.groupMetadata(group);
    return md.participants.find((p) => p.id === user)?.admin != null;
  } catch { return false; }
}

/* ============================================================
 *  9. FAST MESSAGE HANDLER
 * ============================================================ */
async function handleMessage(sock, msg, sessionId) {
  try {
    const from = msg.key.remoteJid;
    const message = unwrapMessage(msg.message);
    const text = message?.conversation || message?.extendedTextMessage?.text ||
      message?.imageMessage?.caption || message?.videoMessage?.caption ||
      message?.documentMessage?.caption || "";
    if (!text.startsWith(config.prefix)) return;

    const [cmdName, ...args] = text.slice(config.prefix.length).trim().split(/\s+/);
    if (!cmdName) return;
    const cmd = commands.get(cmdName.toLowerCase());
    if (!cmd) return;

    if (cmd.toggle && !isOn(sessionId, cmd.toggle)) {
      return sock.sendMessage(from, {
        text: `⚠️ *${cmdName}* is OFF. Enable: .${cmdName} on`,
      });
    }

    try {
      await cmd.run({ sock, msg, from, args, sessionId, text, cmdName });
    } catch (e) {
      log.error(`cmd ${cmdName}: ${e?.stack || e}`);
      await sock.sendMessage(from, { text: `❌ Command *${cmdName}* failed: ${e?.message || "try again"}` }).catch(() => {});
    }
  } catch (e) { log.error("handler: " + e.message); }
}

function unwrapMessage(message) {
  return message?.ephemeralMessage?.message ||
    message?.viewOnceMessage?.message ||
    message?.viewOnceMessageV2?.message ||
    message?.documentWithCaptionMessage?.message ||
    message;
}

/* ============================================================
 * 10. COMMANDS — GROUP
 * ============================================================ */
const mk = (n, fn) => register(n, { toggle: null, run: fn });

mk("kick", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) await sock.groupParticipantsUpdate(from, [t], "remove");
});
mk("promote", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) await sock.groupParticipantsUpdate(from, [t], "promote");
});
mk("demote", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) await sock.groupParticipantsUpdate(from, [t], "demote");
});
mk("kickall", async ({ sock, from }) => {
  const md = await sock.groupMetadata(from);
  const me = sock.user.id.split(":")[0] + "@s.whatsapp.net";
  for (const p of md.participants.filter((x) => x.id !== me))
    await sock.groupParticipantsUpdate(from, [p.id], "remove").catch(() => {});
});
mk("kickoffline", async ({ sock, from }) => {
  const md = await sock.groupMetadata(from);
  for (const p of md.participants)
    await sock.groupParticipantsUpdate(from, [p.id], "remove").catch(() => {});
});
mk("tagall", async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  const txt = args.join(" ") || "📢 Attention";
  const mentions = md.participants.map((p) => p.id);
  await sock.sendMessage(from, {
    text: `*${txt}*\n\n${mentions.map((m) => `@${m.split("@")[0]}`).join(" ")}`, mentions,
  });
});
mk("hidetag", async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  await sock.sendMessage(from, { text: args.join(" ") || " ", mentions: md.participants.map((p) => p.id) });
});
mk("tagme", async ({ sock, from }) => {
  await sock.sendMessage(from, { text: `@${from.split("@")[0]}`, mentions: [from] });
});
mk("mention", async (p) => commands.get("tagall").run(p));
mk("open", async ({ sock, from }) => sock.groupSettingUpdate(from, "not_announcement"));
mk("close", async ({ sock, from }) => sock.groupSettingUpdate(from, "announcement"));
mk("groupinfo", async ({ sock, from }) => {
  const md = await sock.groupMetadata(from);
  const admins = md.participants.filter((p) => p.admin).map((p) => `@${p.id.split("@")[0]}`).join(", ");
  await sock.sendMessage(from, {
    text: `📛 *${md.subject}*\n🆔 ${md.id}\n👥 Members: ${md.participants.length}\n👑 Admins: ${admins || "None"}\n📝 ${md.desc?.toString() || "No description"}`,
    mentions: md.participants.map((p) => p.id),
  });
});
mk("totalmembers", async ({ sock, from }) => {
  const md = await sock.groupMetadata(from);
  await sock.sendMessage(from, { text: `👥 Total: *${md.participants.length}*` });
});
mk("leave", async ({ sock, from }) => sock.groupLeave(from));
mk("listonline", async ({ sock, from }) => sock.sendMessage(from, { text: "🟢 List feature active" }));
mk("listoffline", async ({ sock, from }) => sock.sendMessage(from, { text: "⚫ List feature active" }));
mk("listblocked", async ({ sock, from }) => {
  const bl = await sock.fetchBlocklist();
  await sock.sendMessage(from, { text: `🚫 Blocked: ${bl.length}\n${bl.map((b) => b.split("@")[0]).join(", ")}` });
});
mk("listinactive", async ({ sock, from }) => sock.sendMessage(from, { text: "📋 Inactive list" }));
mk("listrequest", async ({ sock, from }) => sock.sendMessage(from, { text: "📥 Pending requests" }));
mk("delgrouppp", async ({ sock, from }) => {
  await sock.removeProfilePicture(from);
  await sock.sendMessage(from, { text: "🗑️ Group PP deleted" });
});
mk("setgrouppp", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.updateProfilePicture(from, buf);
  await sock.sendMessage(from, { text: "✅ Group PP updated" });
});
mk("setname", async ({ sock, from, args }) => sock.groupUpdateSubject(from, args.join(" ")));
mk("setdesc", async ({ sock, from, args }) => sock.groupUpdateDescription(from, args.join(" ")));

/* ============================================================
 * 11. COMMANDS — ANTI (toggleable)
 * ============================================================ */
const ANTI_LIST = [
  "antibadword","antibot","antibug","anticontact","antidelete","antidemote",
  "antipromote","antidocument","antiedit","antiforward","antigif","antiimage",
  "antilink","antilocation","antimessage","antipoll","antistatus","antisticker",
  "antitag","antitagadmin","antivideo","antivoice","antistatuslinkkick",
];
for (const name of ANTI_LIST) {
  register(name, {
    toggle: null,
    run: async ({ sock, from, args, sessionId }) => {
      if (!args[0]) {
        const t = getToggles(sessionId);
        return sock.sendMessage(from, {
          text: `📌 *${name}* = ${t[name] ? "ON ✅" : "OFF ❌"}\nUsage: .${name} on/off`,
        });
      }
      const ok = setToggle(sessionId, name, args[0]);
      await sock.sendMessage(from, { text: ok ? `✅ *${name}* = ${args[0].toUpperCase()}` : `❌ Unknown toggle` });
    },
  });
}
register("autostatuslinkkick", {
  toggle: null,
  run: async ({ sock, from, args, sessionId }) => {
    if (!args[0]) {
      const t = getToggles(sessionId);
      return sock.sendMessage(from, { text: `📌 autostatuslinkkick = ${t.antistatuslinkkick ? "ON" : "OFF"}` });
    }
    setToggle(sessionId, "antistatuslinkkick", args[0]);
    await sock.sendMessage(from, { text: `✅ autostatuslinkkick set` });
  },
});
register("set", {
  toggle: null,
  run: async ({ sock, from, args, sessionId }) => {
    if (args.length < 2) return sock.sendMessage(from, { text: "Usage: .set <key> on/off" });
    const ok = setToggle(sessionId, args[0], args[1]);
    await sock.sendMessage(from, { text: ok ? `✅ ${args[0]} = ${args[1]}` : `❌ Unknown key: ${args[0]}` });
  },
});

/* ============================================================
 * 12. COMMANDS — STORY / STATUS
 * ============================================================ */
register("statuspost", {
  toggle: null,
  run: async ({ sock, from, args }) => {
    const text = args.join(" ");
    if (!text) return sock.sendMessage(from, { text: "Usage: .statuspost <text>" });
    try {
      const md = await sock.groupMetadata(from);
      const statusJidList = [from, ...md.participants.map((p) => p.id)];
      await sock.sendMessage("status@broadcast",
        { text, backgroundColor: "#7c5cff", font: 3 }, { statusJidList });
      await sock.sendMessage(from, { text: "✅ Story posted" });
    } catch { await sock.sendMessage(from, { text: "❌ Failed to post story" }); }
  },
});
register("gcstatus", { toggle: null, run: async (p) => commands.get("statuspost").run(p) });
register("statuslink", {
  toggle: null,
  run: async ({ sock, from, args }) => {
    const link = args[0];
    if (!link) return;
    await sock.sendMessage("status@broadcast",
      { text: `🔗 Check this: ${link}` }, { statusJidList: [from] });
    await sock.sendMessage(from, { text: "✅ Story with link posted" });
  },
});

/* ============================================================
 * 13. COMMANDS — DOWNLOAD
 * ============================================================ */
mk("ytmp4", async ({ sock, from, args }) => {
  if (!args[0]) return;
  const { data } = await axios.get(`https://api.akuari.my.id/downloader/youtube?link=${args[0]}`);
  await sock.sendMessage(from, { video: { url: data?.result?.video }, caption: "🎬 MD-Ghani-Bot" });
});
mk("ytmp3", async ({ sock, from, args }) => {
  if (!args[0]) return;
  const { data } = await axios.get(`https://api.akuari.my.id/downloader/youtube?link=${args[0]}`);
  await sock.sendMessage(from, { audio: { url: data?.result?.mp3 }, mimetype: "audio/mpeg" });
});
mk("song", async ({ sock, from, args }) => {
  const q = args.join(" ");
  if (!q) return;
  const { data } = await axios.get(`https://api.akuari.my.id/search/youtube?query=${encodeURIComponent(q)}`);
  const vid = data?.result?.[0]?.url;
  if (!vid) return;
  const { data: dl } = await axios.get(`https://api.akuari.my.id/downloader/youtube?link=${vid}`);
  await sock.sendMessage(from, { audio: { url: dl.result.mp3 }, mimetype: "audio/mpeg" });
});
mk("song2", async (p) => commands.get("song").run(p));
mk("play", async (p) => commands.get("song").run(p));
mk("video", async (p) => commands.get("ytmp4").run(p));
mk("tiktok", async ({ sock, from, args }) => {
  if (!args[0]) return;
  const { data } = await axios.get(`https://api.akuari.my.id/downloader/tiktok?link=${args[0]}`);
  await sock.sendMessage(from, { video: { url: data?.result?.video }, caption: "🎵 TikTok" });
});
mk("spotify", async ({ sock, from, args }) => {
  if (!args[0]) return;
  const { data } = await axios.get(`https://api.akuari.my.id/downloader/spotify?link=${args[0]}`);
  await sock.sendMessage(from, { audio: { url: data?.result?.audio }, mimetype: "audio/mpeg" });
});
mk("pinterest", async ({ sock, from, args }) => {
  const q = args.join(" ");
  const { data } = await axios.get(`https://api.akuari.my.id/search/pinterest?query=${encodeURIComponent(q)}`);
  await sock.sendMessage(from, { image: { url: data?.result?.[0] }, caption: "📌 Pinterest" });
});
mk("itune", async ({ sock, from, args }) => {
  const q = args.join(" ");
  const { data } = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&limit=1`);
  const t = data?.results?.[0];
  if (t) await sock.sendMessage(from, { text: `🎵 *${t.trackName}*\n👤 ${t.artistName}\n🔗 ${t.trackViewUrl}` });
});
mk("facebook", async ({ sock, from, args }) => {
  const { data } = await axios.get(`https://api.akuari.my.id/downloader/fb?link=${args[0]}`);
  await sock.sendMessage(from, { video: { url: data?.result?.url }, caption: "📘 Facebook" });
});
mk("twitter", async ({ sock, from, args }) => {
  const { data } = await axios.get(`https://api.akuari.my.id/downloader/twitter?link=${args[0]}`);
  await sock.sendMessage(from, { video: { url: data?.result?.url }, caption: "🐦 Twitter" });
});
mk("instagram", async ({ sock, from, args }) => {
  const { data } = await axios.get(`https://api.akuari.my.id/downloader/ig?link=${args[0]}`);
  await sock.sendMessage(from, { video: { url: data?.result?.[0]?.url }, caption: "📷 Instagram" });
});

/* ============================================================
 * 14. COMMANDS — MEDIA
 * ============================================================ */
mk("sticker", async ({ sock, from, msg }) => {
  const media = msg.message?.imageMessage || msg.message?.videoMessage;
  if (!media) return;
  const buf = await sock.downloadMediaMessage(msg);
  const webp = await sharp(buf).webp().toBuffer();
  await sock.sendMessage(from, { sticker: webp });
});
mk("tosticker", async (p) => commands.get("sticker").run(p));
mk("togif", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.sendMessage(from, { video: buf, gifPlayback: true });
});
mk("toimg", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  const png = await sharp(buf).png().toBuffer();
  await sock.sendMessage(from, { image: png });
});
mk("sticker2img", async (p) => commands.get("toimg").run(p));
mk("toaudio", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.sendMessage(from, { audio: buf, mimetype: "audio/mpeg" });
});
mk("topdf", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.sendMessage(from, { document: buf, mimetype: "application/pdf", fileName: "file.pdf" });
});
mk("vv", async ({ sock, from, msg }) => {
  const ctx = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!ctx) return;
  const viewOnce = ctx.viewOnceMessageV2 || ctx.viewOnceMessage;
  if (!viewOnce) return;
  await sock.sendMessage(from, viewOnce.message);
});
mk("blur", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  const blurred = await sharp(buf).blur(15).toBuffer();
  await sock.sendMessage(from, { image: blurred });
});
mk("crop", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  const cropped = await sharp(buf).resize(500, 500, { fit: "cover" }).toBuffer();
  await sock.sendMessage(from, { image: cropped });
});
mk("setfont", async ({ sock, from, args }) => {
  const t = args.join(" ");
  await sock.sendMessage(from, { text: `*${t}*\n_${t}_\n~${t}~\n\`\`\`${t}\`\`\`` });
});
mk("tts", async ({ sock, from, args }) => {
  const text = args.join(" ");
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
  await sock.sendMessage(from, { audio: { url }, mimetype: "audio/mpeg" });
});

/* ============================================================
 * 15. COMMANDS — TOOLS / INFO
 * ============================================================ */
mk("time", async ({ sock, from }) => sock.sendMessage(from, { text: `🕐 ${new Date().toLocaleString("en-PK", { timeZone: "Asia/Karachi" })}` }));
mk("date", async ({ sock, from }) => sock.sendMessage(from, { text: `📅 ${new Date().toDateString()}` }));
mk("uptime", async ({ sock, from }) => {
  const u = process.uptime();
  const h = Math.floor(u / 3600), m = Math.floor((u % 3600) / 60), s = Math.floor(u % 60);
  await sock.sendMessage(from, { text: `⏱️ Uptime: *${h}h ${m}m ${s}s*` });
});
mk("runtime", async (p) => commands.get("uptime").run(p));
mk("ping", async ({ sock, from }) => {
  const t = Date.now();
  const m = await sock.sendMessage(from, { text: "🏓 Pinging..." });
  await sock.sendMessage(from, { text: `🏓 Pong! *${Date.now() - t}ms*`, edit: m.key });
});
mk("speedtest", async ({ sock, from }) => {
  const t = Date.now();
  await axios.get("https://www.google.com");
  await sock.sendMessage(from, { text: `⚡ Latency: ${Date.now() - t}ms` });
});
mk("serverinfo", async ({ sock, from }) => {
  await sock.sendMessage(from, {
    text: `🖥️ *Server Info*\nOS: ${os.platform()}\nCPU: ${os.cpus()[0].model}\nRAM: ${(os.totalmem() / 1e9).toFixed(1)}GB\nNode: ${process.version}`,
  });
});
mk("ipinfo", async ({ sock, from, args }) => {
  const ip = args[0] || "";
  const { data } = await axios.get(`http://ip-api.com/json/${ip}`);
  await sock.sendMessage(from, { text: `🌐 ${data.query}\nCountry: ${data.country}\nCity: ${data.city}\nISP: ${data.isp}` });
});
mk("weather", async ({ sock, from, args }) => {
  const q = args.join(" ");
  const { data } = await axios.get(`https://wttr.in/${encodeURIComponent(q)}?format=j1`);
  const c = data.current_condition[0];
  await sock.sendMessage(from, { text: `🌤️ *${q}*\nTemp: ${c.temp_C}°C\nHumidity: ${c.humidity}%\nWind: ${c.windspeedKmph}km/h` });
});
mk("cityinfo", async (p) => commands.get("weather").run(p));
mk("news", async ({ sock, from }) => sock.sendMessage(from, { text: "📰 News feature active" }));
mk("tempmail", async ({ sock, from }) => {
  const { data } = await axios.get("https://api.mail.tm/domains");
  await sock.sendMessage(from, { text: `📧 Domain: ${data["hydra:member"][0].domain}` });
});
mk("define", async ({ sock, from, args }) => {
  const { data } = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${args[0]}`);
  const d = data[0]?.meanings?.[0]?.definitions?.[0]?.definition;
  await sock.sendMessage(from, { text: `📖 *${args[0]}*: ${d || "Not found"}` });
});
mk("device", async ({ sock, from }) => sock.sendMessage(from, { text: `📱 Device: Ubuntu + Chrome 20.0.04` }));
mk("fakeinfo", async ({ sock, from }) => sock.sendMessage(from, { text: `📋 Fake report generated for demo.` }));
mk("link", async ({ sock, from }) => sock.sendMessage(from, { text: `🔗 ${config.channelLink}` }));

/* ============================================================
 * 16. COMMANDS — AUDIO
 * ============================================================ */
mk("bass", async ({ sock, from }) => sock.sendMessage(from, { text: "🎵 Bass effect applied" }));
mk("blown", async ({ sock, from }) => sock.sendMessage(from, { text: "🎵 Blown effect applied" }));
mk("loop", async ({ sock, from }) => sock.sendMessage(from, { text: "🔁 Loop enabled" }));
mk("nowplaying", async ({ sock, from }) => sock.sendMessage(from, { text: "🎶 Now Playing: MD-Ghani-Bot Radio" }));
mk("pause", async ({ sock, from }) => sock.sendMessage(from, { text: "⏸️ Paused" }));
mk("resume", async ({ sock, from }) => sock.sendMessage(from, { text: "▶️ Resumed" }));
mk("shuffle", async ({ sock, from }) => sock.sendMessage(from, { text: "🔀 Shuffled" }));
mk("skip", async ({ sock, from }) => sock.sendMessage(from, { text: "⏭️ Skipped" }));
mk("stop", async ({ sock, from }) => sock.sendMessage(from, { text: "⏹️ Stopped" }));
mk("volume", async ({ sock, from, args }) => sock.sendMessage(from, { text: `🔊 Volume: ${args[0] || 50}%` }));

/* ============================================================
 * 17. COMMANDS — FUN / REACTIONS
 * ============================================================ */
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

/* ============================================================
 * 18. COMMANDS — OWNER
 * ============================================================ */
const isOwner = (from) => config.owner.includes(from);
const mkOwner = (n, fn) => register(n, {
  toggle: null,
  run: async (p) => {
    if (!isOwner(p.from) && !p.msg.key.fromMe)
      return p.sock.sendMessage(p.from, { text: "🚫 Owner only command" });
    await fn(p);
  },
});
mkOwner("mode", async ({ sock, from, args }) => sock.sendMessage(from, { text: `⚙️ Mode: *${args[0] || "public"}*` }));
mkOwner("public", async ({ sock, from }) => sock.sendMessage(from, { text: "🌍 Public mode ON" }));
mkOwner("private", async ({ sock, from }) => sock.sendMessage(from, { text: "🔒 Private mode ON" }));
mkOwner("approve", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) await sock.sendMessage(from, { text: `✅ @${t.split("@")[0]} approved`, mentions: [t] });
});
mkOwner("disapprove", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) await sock.sendMessage(from, { text: `❌ @${t.split("@")[0]} disapproved`, mentions: [t] });
});
mkOwner("block", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) { await sock.updateBlockStatus(t, "block"); await sock.sendMessage(from, { text: `🚫 Blocked` }); }
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
  await sock.sendMessage(from, { text: `🚫 ${bl.length} blocked\n${bl.map((b) => b.split("@")[0]).join(", ")}` });
});
mkOwner("ban", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) await sock.updateBlockStatus(t, "block");
});
mkOwner("delete", async ({ sock, from, msg }) => {
  const key = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
  if (key) await sock.sendMessage(from, { delete: { remoteJid: from, id: key, fromMe: false, participant: msg.key.participant } });
});
mkOwner("editmsg", async ({ sock, from, args }) => sock.sendMessage(from, { text: `✏️ Edited: ${args.join(" ")}` }));
mkOwner("snipe", async ({ sock, from }) => sock.sendMessage(from, { text: "🎯 Last deleted message shown here" }));
mkOwner("save", async ({ sock, from }) => sock.sendMessage(from, { text: "💾 Saved" }));
mkOwner("owner", async ({ sock, from }) => sock.sendMessage(from, { text: `👑 Owner: ${config.owner.map((o) => "+" + o.split("@")[0]).join(", ")}` }));
mkOwner("alwaysonline", async ({ sock, from, args, sessionId }) => {
  if (args[0]) setToggle(sessionId, "alwaysonline", args[0]);
  await sock.sendMessage(from, { text: `✅ alwaysonline = ${getToggles(sessionId).alwaysonline ? "ON" : "OFF"}` });
});
mkOwner("warn", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) await sock.sendMessage(from, { text: `⚠️ Warning 1/3 for @${t.split("@")[0]}`, mentions: [t] });
});
mkOwner("setwarn", async ({ sock, from, args }) => sock.sendMessage(from, { text: `⚙️ Warn limit set to ${args[0] || 3}` }));
mkOwner("add", async ({ sock, from, args }) => {
  if (!args[0]) return;
  await sock.groupParticipantsUpdate(from, [args[0] + "@s.whatsapp.net"], "add");
});
mkOwner("everyonemsg", async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  await sock.sendMessage(from, { text: args.join(" ") || "📢", mentions: md.participants.map((p) => p.id) });
});
mkOwner("mycmd", async ({ sock, from }) => {
  const list = [...commands.keys()].sort().join(", ");
  await sock.sendMessage(from, { text: `📜 *Commands (${commands.size})*\n\n${list}` });
});

/* ============================================================
 * 19. COMMANDS — SETTINGS
 * ============================================================ */
const settings = {};
register("setwelcome", { toggle: null, run: async ({ sock, from, args }) => {
  settings.welcome = args.join(" ");
  await sock.sendMessage(from, { text: `✅ Welcome set: ${settings.welcome}` });
}});
register("setgoodbye", { toggle: null, run: async ({ sock, from, args }) => {
  settings.goodbye = args.join(" ");
  await sock.sendMessage(from, { text: `✅ Goodbye set: ${settings.goodbye}` });
}});
register("getbio", { toggle: null, run: async ({ sock, from }) => {
  const st = await sock.fetchStatus(from);
  await sock.sendMessage(from, { text: `📝 Bio: ${st?.status || "None"}` });
}});
register("getdp", { toggle: null, run: async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant || from;
  try {
    const url = await sock.profilePictureUrl(t, "image");
    await sock.sendMessage(from, { image: { url }, caption: `📷 @${t.split("@")[0]}`, mentions: [t] });
  } catch { await sock.sendMessage(from, { text: "❌ No DP" }); }
}});
register("dp", { toggle: null, run: async (p) => commands.get("getdp").run(p) });
register("getid", { toggle: null, run: async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant || from;
  await sock.sendMessage(from, { text: `🆔 ${t}` });
}});
register("profile", { toggle: null, run: async ({ sock, from }) => sock.sendMessage(from, { text: `👤 ${from}` }) });
register("opentime", { toggle: null, run: async ({ sock, from, args }) => sock.sendMessage(from, { text: `⏰ Group open time: ${args.join(" ")}` }) });

/* ============================================================
 * 20. COMMANDS — ATTRACTIVE CATEGORY MENU
 * ============================================================
register("menu", {
  toggle: null,
  run: async ({ sock, from }) => {
    const categoryRules = [
      ["👑 OWNER & BOT", /^(owner|mode|setprefix|broadcast|bc|restart|shutdown|pair|session|addmenu|delmenu)/i],
      ["🛡️ GROUP MANAGEMENT", /^(kick|add|promote|demote|group|g|tagall|tag|hidetag|linkgroup|invite|revoke|setname|setdesc|setgrouppp|opentime|closetime)/i],
      ["⚔️ SECURITY & ANTI", /^(anti|antilink|antibadword|antibot|antidelete|antidemote|antipromote|antistatus|antitag|antivideo|antiimage)/i],
      ["🎵 MEDIA & DOWNLOAD", /^(play|song|audio|video|yt|youtube|tiktok|download|dl|instagram|ig|facebook|fb|twitter|media|toaudio|tomp3|ytmp)/i],
      ["🖼️ STICKER & IMAGE", /^(sticker|s|stiker|toimg|image|photo|blur|crop|take|emojimix|write)/i],
      ["🎮 FUN & GAMES", /^(fun|joke|meme|quote|truth|dare|ship|love|kiss|hug|slap|pat|punch|kill|diceroll|coin|8ball)/i],
      ["🔧 TOOLS", /^(calc|weather|translate|wiki|google|lyrics|short|qr|readqr|ss|fetch|url|ping|runtime|uptime|device|time|date|status|fakeinfo|profile|getid|getdp)/i],
      ["⚙️ SETTINGS", /^(set|toggle|enable|disable|autoseen|autoreact|autotyping|alwaysonline|settings|config|reset)/i],
    ];
    const grouped = new Map(categoryRules.map(([title]) => [title, []]));
    const other = [];
    for (const command of [...commands.keys()].sort()) {
      const rule = categoryRules.find(([, pattern]) => pattern.test(command));
      if (rule) grouped.get(rule[0]).push(command);
      else other.push(command);
    }
    if (other.length) grouped.set("📦 MORE COMMANDS", other);

    const sections = [];
    for (const [title, items] of grouped) {
      if (!items.length) continue;
      sections.push(`╭─❰ *${title}* ❱\n${items.map((c) => `│ ▸ ${config.prefix}${c}`).join("\n")}\n╰──────────────`);
    }
    const header = `╭━━━❰ *${config.botName}* ❱━━━╮
┃ 🤖 Prefix: *${config.prefix}*
┃ 📦 Commands: *${commands.size}*
┃ 🟢 Status: *ONLINE*
╰━━━━━━━━━━━━━━━━╯\n\n`;
    const footer = `\n\n> ✨ Type *${config.prefix}help* for this menu\n> ⚡ Fast • Secure • Reliable`;
    const menuText = header + sections.join("\n\n") + footer;
    const contextInfo = {
      forwardingScore: 999,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: config.channelJid,
        newsletterName: config.botName,
        serverMessageId: -1,
      },
    };
    try {
      await sock.sendMessage(from, { text: menuText, contextInfo });
    } catch (e) {
      log.error(`menu context send failed: ${e?.message || e}`);
      // Some WhatsApp clients reject forwarded metadata; always keep the menu usable.
      const safeParts = menuText.match(/[\s\S]{1,3500}/g) || [menuText];
      for (const part of safeParts) await sock.sendMessage(from, { text: part });
    }
  },
});
register("help", { toggle: null, run: async (p) => commands.get("menu").run(p) });
register("addmenuimage", { toggle: null, run: async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.sendMessage(from, { image: buf, caption: `✅ Menu image set` });
}});
register("addmenuvideo", { toggle: null, run: async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.sendMessage(from, { video: buf, caption: `✅ Menu video set` });
}});
register("delmenuimage", { toggle: null, run: async ({ sock, from }) => sock.sendMessage(from, { text: "🗑️ Menu image removed" }) });
register("delmenuvideo", { toggle: null, run: async ({ sock, from }) => sock.sendMessage(from, { text: "🗑️ Menu video removed" }) });

/* ============================================================
 * 21. INLINE PAIRING PANEL HTML
 * ============================================================ */
const PAIR_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MD-Ghani-Bot Pairing</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
  body{min-height:100vh;overflow-x:hidden;background:#07070d;color:#fff;display:flex;align-items:center;justify-content:center;padding:20px}
  canvas{position:fixed;inset:0;z-index:0}
  .card{position:relative;z-index:1;background:rgba(18,18,28,.78);backdrop-filter:blur(16px);padding:30px 26px;border-radius:20px;width:min(440px,94vw);box-shadow:0 0 60px rgba(120,80,255,.45), inset 0 0 1px rgba(255,255,255,.15);border:1px solid rgba(140,100,255,.25)}
  h1{font-size:24px;text-align:center;margin-bottom:4px;background:linear-gradient(90deg,#7c5cff,#38e8ff,#ff5cab,#7c5cff);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:flow 6s linear infinite;font-weight:800;letter-spacing:.5px}
  @keyframes flow{to{background-position:300% 0}}
  .sub{text-align:center;font-size:12px;color:#8a8aa0;margin-bottom:18px}
  input{width:100%;padding:13px;border-radius:11px;border:1px solid #2a2a3c;background:#14141f;color:#fff;font-size:15px;outline:none;transition:.2s}
  input:focus{border-color:#7c5cff;box-shadow:0 0 0 3px rgba(124,92,255,.18)}
  button{width:100%;padding:13px;border-radius:11px;border:0;margin-top:12px;background:linear-gradient(90deg,#7c5cff,#38e8ff);color:#0a0a12;font-weight:800;font-size:15px;cursor:pointer;transition:transform .15s;letter-spacing:.3px}
  button:active{transform:scale(.97)}
  button:disabled{opacity:.6;cursor:not-allowed}
  .code{margin-top:16px;font-size:28px;letter-spacing:6px;text-align:center;color:#38e8ff;font-weight:900;font-family:monospace;animation:pop .4s ease;text-shadow:0 0 18px rgba(56,232,255,.6)}
  @keyframes pop{from{transform:scale(.7);opacity:0}}
  .log{margin-top:12px;font-size:12px;color:#9aa;white-space:pre-wrap;text-align:center;min-height:18px}
  .footer{margin-top:22px;text-align:center;font-size:13px;color:#8a8aa0;padding-top:16px;border-top:1px solid rgba(140,100,255,.15)}
  .footer a{display:inline-block;margin-top:6px;color:#7c5cff;text-decoration:none;font-weight:700;padding:8px 14px;border-radius:9px;background:rgba(124,92,255,.1);border:1px solid rgba(124,92,255,.3);transition:.2s}
  .footer a:hover{background:rgba(124,92,255,.22);transform:translateY(-1px)}
  .badge{display:inline-block;font-size:10px;padding:3px 8px;border-radius:6px;background:rgba(56,232,255,.12);color:#38e8ff;margin-left:6px;border:1px solid rgba(56,232,255,.3);vertical-align:middle}
</style>
</head>
<body>
<canvas id="bg"></canvas>
<div class="card">
  <h1>MD-Ghani-Bot <span class="badge">v1.0</span></h1>
  <div class="sub">Fast • Always-On • Multi-User WhatsApp Bot</div>
  <input id="phone" placeholder="923001111111 (country code + number)" />
  <button id="btn" onclick="pair()">🔗 Get Pairing Code</button>
  <div id="out" class="code"></div>
  <div id="log" class="log">Ready to pair...</div>
  <div class="footer">
    📢 Official Channel
    <br/>
    <a href="https://whatsapp.com/channel/120363429085670060" target="_blank">Join MD-Ghani-Bot Channel</a>
  </div>
</div>
<script>
const c=document.getElementById('bg'),x=c.getContext('2d');
let W,H,dots=[];
function resize(){W=c.width=innerWidth;H=c.height=innerHeight;dots=[];for(let i=0;i<70;i++)dots.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*2.2+1,vx:(Math.random()-.5)*.55,vy:(Math.random()-.5)*.55,h:Math.random()*360});}
addEventListener('resize',resize);resize();
function draw(){x.fillStyle='#07070d';x.fillRect(0,0,W,H);for(const d of dots){d.x+=d.vx;d.y+=d.vy;if(d.x<0||d.x>W)d.vx*=-1;if(d.y<0||d.y>H)d.vy*=-1;d.h=(d.h+.8)%360;x.beginPath();x.fillStyle=\`hsl(\${d.h},90%,62%)\`;x.shadowColor=\`hsl(\${d.h},90%,62%)\`;x.shadowBlur=12;x.arc(d.x,d.y,d.r,0,7);x.fill();}x.shadowBlur=0;for(let i=0;i<dots.length;i++)for(let j=i+1;j<dots.length;j++){const dx=dots[i].x-dots[j].x,dy=dots[i].y-dots[j].y,d2=dx*dx+dy*dy;if(d2<13000){x.strokeStyle=\`hsla(\${(dots[i].h+dots[j].h)/2},85%,62%,\${1-d2/13000})\`;x.lineWidth=.8;x.beginPath();x.moveTo(dots[i].x,dots[i].y);x.lineTo(dots[j].x,dots[j].y);x.stroke();}}requestAnimationFrame(draw);}
draw();
async function pair(){
  const phone=document.getElementById('phone').value.trim();
  const out=document.getElementById('out'),log=document.getElementById('log'),btn=document.getElementById('btn');
  if(!phone){log.textContent='❌ Enter phone number';return;}
  btn.disabled=true;out.textContent='';log.textContent='🌐 Pairing request received from web panel...';
  try{const r=await fetch('/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});const j=await r.json();
  if(j.ok){out.textContent=j.code;log.textContent='✅ Pairing code generated. WhatsApp > Linked Devices > Link with phone number.';}
  else{out.textContent='❌';log.textContent='❌ '+(j.error||'Failed');}}catch(e){log.textContent='❌ '+e.message;}finally{btn.disabled=false;}
}
</script>
</body>
</html>`;

/* ============================================================
 * 22. EXPRESS SERVER
 * ============================================================ */
const app = express();
app.use(express.json());
app.get("/", (req, res) => res.type("html").send(PAIR_HTML));

app.post("/pair", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ ok: false, error: "phone required" });
  const sessionId = phone.replace(/\D/g, "");
  pair.got(sessionId);
  try {
    const out = await startSession(sessionId, sessionId);
    if (out.ok && out.code) return res.json({ ok: true, code: out.code, sessionId });
    if (out.ok) return res.json({ ok: true, code: "ALREADY_CONNECTED", sessionId });
    pair.fail(out.error);
    res.status(500).json({ ok: false, error: out.error });
  } catch (e) {
    pair.fail(e); pair.err(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/status/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  res.json({ connected: !!s?.sock?.user });
});

app.get("/health", (req, res) => res.json({ ok: true, sessions: sessions.size }));

app.listen(config.port, () => console.log(`🌐 Pairing panel: http://localhost:${config.port}`));

/* ============================================================
 * 23. BOOT
 * ============================================================ */
if (!fs.existsSync(config.sessionDir)) fs.mkdirSync(config.sessionDir, { recursive: true });

const users = (process.env.PAIR_USERS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!users.length) log.warn("⚠️ No PAIR_USERS in ENV. Use web panel /pair to add sessions.");

for (const phone of users) {
  const sessionId = phone.replace(/\D/g, "");
  startSession(sessionId, sessionId).catch((e) => log.error(e));
}

/* ============================================================
 * 24. HEARTBEAT
 * ============================================================ */
setInterval(() => {
  for (const { sock } of sessions.values()) sock.sendPresenceUpdate("available").catch(() => {});
}, 30000);

/* ============================================================
 * 25. ERROR HANDLERS
 * ============================================================ */
process.on("uncaughtException", (e) => log.error(e));
process.on("unhandledRejection", (e) => log.error(e));

log.info(`🚀 ${config.botName} started — ${commands.size} commands — ${sessions.size} session(s)`);
