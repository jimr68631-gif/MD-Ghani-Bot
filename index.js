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
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
import pino from "pino";
import sharp from "sharp";
import ytSearch from "yt-search";
import ytdl from "@distube/ytdl-core";
import { fileURLToPath } from "url";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  downloadContentFromMessage,
} from "@whiskeysockets/baileys";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
async function downloadMedia(sock, message) {
  const content = unwrapMessage(message?.message || message);
  const entry = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"]
    .map((key) => [key, content?.[key]])
    .find(([, value]) => value);
  if (!entry) throw new Error("No downloadable media found");
  const [kind, media] = entry;
  const type = kind.replace("Message", "");
  const stream = await downloadContentFromMessage(media, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

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
  channelLink: "https://whatsapp.com/channel/0029Vb8vvB1Fcow4AY0NeC1p",
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
  antilinkAction: "delete",
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
const groupMessageSettings = new Map();
const antiWarningCounts = new Map();
const antiWarningStyles = [
  (user, key) => `⚠️ *WARNING (1/3)*\n@${user} — *${key}* is not allowed in this group.\nPlease do not repeat it.`,
  (user, key) => `╭━━━❰ ⚠️ WARNING 2/3 ❱━━━╮\n┃ @${user}\n┃ *${key}* is not allowed here.\n┃ Next violation will remove you.\n╰━━━━━━━━━━━━━━━━━━━━╯`,
  (user, key) => `🚨 *FINAL WARNING (3/3)* 🚨\n@${user} — *${key}* is still not allowed in this group.\n🚫 You are being removed now.`,
];
const BOT_ADMIN_OPTIONAL_COMMANDS = new Set([
  "song", "play", "song2", "video", "tagall", "tag", "movie",
  "welcome", "goodbye", "setwelcome", "setgoodbye",
]);
const getGroupMessageSettings = (group) => {
  if (!groupMessageSettings.has(group)) {
    groupMessageSettings.set(group, {
      welcome: "🎉 Welcome {user} to {group}. You are member #{count}.",
      goodbye: "👋 Goodbye {user} from {group}. You are member #{count}.",
      welcomeEnabled: false,
      goodbyeEnabled: false,
    });
  }
  return groupMessageSettings.get(group);
};
const formatGroupMessage = (template, groupName, user, count) => String(template)
  .replaceAll("{group}", groupName)
  .replaceAll("{user}", `@${user.split("@")[0]}`)
  .replaceAll("{count}", String(count));
async function resolveOriginalJid(sock, jid) {
  if (!jid || !String(jid).endsWith("@lid")) return jid;
  const mappings = [
    sock?.signalRepository?.lidMapping,
    sock?.authState?.keys?.lidMapping,
    sock?.lidMapping,
  ].filter(Boolean);
  for (const mapping of mappings) {
    for (const method of ["getPNForLID", "getPnForLid"]) {
      if (typeof mapping?.[method] !== "function") continue;
      try {
        const value = await mapping[method](jid);
        if (value) return String(value).includes("@") ? value : `${String(value).replace(/\D/g, "")}@s.whatsapp.net`;
      } catch {}
    }
  }
  for (const method of ["getPNForLID", "getPnForLid", "getPhoneNumberForLID"]) {
    if (typeof sock?.[method] !== "function") continue;
    try {
      const result = await sock[method](jid);
      const value = typeof result === "string" ? result : result?.jid || result?.phoneNumber;
      if (value) return String(value).includes("@") ? value : `${String(value).replace(/\D/g, "")}@s.whatsapp.net`;
    } catch {}
  }
  return jid;
}
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
const styledToggleReply = (name, enabled, detail = "") => `╭━━━❰ *${String(name).toUpperCase()}* ❱━━━╮
┃ ${enabled ? "🟢 Status: ON ✅" : "🔴 Status: OFF ❌"}
${detail ? `┃ 📝 ${detail}\n` : ""}╰━━━━━━━━━━━━━━━━━━━━╯`;

/* ============================================================
 *  4. COMMAND REGISTRY + SESSIONS
 * ============================================================ */
const commands = new Map();
const register = (name, opts) => commands.set(String(name).trim().toLowerCase(), opts);
const sessions = new Map();
let shuttingDown = false;
const deletedMessageCache = new Map();
const warningState = new Map();
let baileysVersionPromise;

function getBaileysVersion() {
  if (!baileysVersionPromise) {
    const fallbackVersion = [2, 3000, 1015901307];
    const timeout = new Promise((resolve) => setTimeout(() => resolve(fallbackVersion), 2500));
    baileysVersionPromise = Promise.race([
      fetchLatestBaileysVersion().then(({ version }) => version),
      timeout,
    ])
      .catch((error) => {
        log.warn(`Baileys version lookup failed; using fallback: ${error?.message || error}`);
        return fallbackVersion;
      });
  }
  return baileysVersionPromise;
}

/* ============================================================
 *  5. START SESSION
 * ============================================================ */
async function startSession(sessionId, phoneNumber) {
  if (shuttingDown) return { ok: false, error: "Bot is shutting down" };
  const existing = sessions.get(sessionId);
  if (existing?.starting) return { ok: true, code: null };
  if (existing?.sock) return { ok: true, code: null };
  sessions.set(sessionId, { starting: true, reconnectTimer: null });
  const dir = `${config.sessionDir}/${sessionId}`;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let state;
  let saveCreds;
  let version;
  try {
    ({ state, saveCreds } = await useMultiFileAuthState(dir));
    version = await getBaileysVersion();
  } catch (error) {
    sessions.delete(sessionId);
    throw error;
  }

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
    getMessage: async (key) => {
      const cached = deletedMessageCache.get(`${key?.remoteJid}:${key?.id}`);
      return cached?.message;
    },
  });

  sessions.set(sessionId, { sock, info: { phoneNumber }, wired: false, starting: false, reconnectTimer: null });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === "open") {
      log.info(`🟢 ${sessionId} connected`);
      wireHandlers(sessionId);
      const connectedJid = `${String(sessionId).replace(/\D/g, "")}@s.whatsapp.net`;
      if (connectedJid) {
        sock.sendMessage(connectedJid, {
          text: `✅ *${config.botName} Connected*\n\n📱 Session: ${sessionId}\n🟢 Status: Online\n\nType *${config.prefix}menu* to open the command menu.`,
        }).catch((e) => log.error(`connect notice: ${e?.message || e}`));
      }
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut && !shuttingDown) {
        log.warn(`♻️ Reconnecting ${sessionId}...`);
        const current = sessions.get(sessionId);
        if (current && !current.reconnectTimer) {
          current.reconnectTimer = setTimeout(() => {
            current.reconnectTimer = null;
            if (sessions.get(sessionId)?.sock === sock) sessions.delete(sessionId);
            startSession(sessionId, phoneNumber).catch((e) => log.error(`reconnect ${sessionId}: ${e?.message || e}`));
          }, 5000);
        }
      } else {
        if (sessions.get(sessionId)?.reconnectTimer) clearTimeout(sessions.get(sessionId).reconnectTimer);
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
      deletedMessageCache.set(`${msg.key.remoteJid}:${msg.key.id}`, msg);
      if (deletedMessageCache.size > 1000) deletedMessageCache.delete(deletedMessageCache.keys().next().value);
      Promise.resolve(runAuto(sock, msg, sessionId, toggles)).catch((e) => log.error(`auto: ${e.message}`));
      Promise.resolve(runAnti(sock, msg, sessionId, toggles)).catch((e) => log.error(`anti: ${e.message}`));
      Promise.resolve(handleMessage(sock, msg, sessionId)).catch((e) => log.error(`handler: ${e.message}`));
    }
  });
  sock.ev.on("group-participants.update", async ({ id, participants, action }) => {
    if (!id?.endsWith("@g.us") || !["add", "remove", "leave"].includes(action)) return;
    try {
      groupMetadataCache.delete(id);
      const md = await sock.groupMetadata(id);
      const settings = getGroupMessageSettings(id);
      if (action === "add" && !settings.welcomeEnabled) return;
      if (action !== "add" && !settings.goodbyeEnabled) return;
      const template = action === "add" ? settings.welcome : settings.goodbye;
      const groupName = md.subject || "Group";
      const count = md.participants.length;
      for (const user of participants || []) {
        const text = formatGroupMessage(template, groupName, user, count);
        await sock.sendMessage(id, { text, mentions: [user] });
      }
    } catch (e) {
      log.warn(`welcome/goodbye message failed: ${e?.message || e}`);
    }
  });
  sock.ev.on("messages.update", async (updates) => {
    const botInbox = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
    for (const item of updates || []) {
      const revoke = item.update?.message?.protocolMessage?.type === 0;
      const deletedKey = item.update?.message?.protocolMessage?.key || item.key;
      const deletedChat = deletedKey?.remoteJid;
      const deletedId = deletedKey?.id;
      if ((revoke || !item.update?.message) && deletedChat && deletedId && getToggles(deletedChat.endsWith("@g.us") ? deletedChat : sessionId).antidelete) {
        const old = deletedMessageCache.get(`${deletedChat}:${deletedId}`);
        if (!old) continue;
        deletedMessageCache.delete(`${deletedChat}:${deletedId}`);
        const oldMessage = unwrapMessage(old.message);
        const source = deletedChat;
        const originalSender = await resolveOriginalJid(sock, old.key?.participantAlt || old.key?.participant || old.key?.remoteJid || "Unknown");
        const deletedBy = await resolveOriginalJid(sock, item.key?.participantAlt || item.key?.participant || item.key?.remoteJid || "Unknown");
        const clean = (jid) => String(jid).split("@")[0].split(":")[0];
        const isGroup = source.endsWith("@g.us");
        const isChannel = source.endsWith("@newsletter") || source === "status@broadcast";
        const cachedGroup = isGroup ? groupMetadataCache.get(source) : null;
        const participants = cachedGroup?.data?.participants || [];
        const findParticipant = (jid) => participants.find((p) => p.id === jid || p.jid === jid || p.id === old.key?.participant || p.jid === old.key?.participant);
        const senderName = old.pushName || findParticipant(originalSender)?.name || findParticipant(originalSender)?.notify || "Unknown user";
        const deletedByName = item.pushName || findParticipant(deletedBy)?.name || findParticipant(deletedBy)?.notify || "Unknown user";
        const sourceName = cachedGroup?.expires > Date.now() && cachedGroup.data?.subject
          ? cachedGroup.data.subject
          : (isChannel ? "WhatsApp Channel/Status" : (isGroup ? "WhatsApp Group" : "Personal Inbox"));
        const type = source === "status@broadcast" || source.endsWith("@newsletter") ? "STATUS" :
          oldMessage?.conversation || oldMessage?.extendedTextMessage?.text ? "Text" :
          oldMessage?.imageMessage ? "Photo" : oldMessage?.videoMessage ? "Video" :
          oldMessage?.audioMessage ? "Voice/Audio" : oldMessage?.documentMessage ? "Document" : "Media/Other";
        const rawText = oldMessage?.conversation || oldMessage?.extendedTextMessage?.text || "";
        const text = rawText.replace(/https?:\/\/[^\s]+|wa\.me\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|t\.me\/[^\s]+/gi, "").trim() || "[No text content in this message]";
        const deletedAt = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" });
        const report = `╭━━━❰ *ANTIDELETE REPORT* ❱━━━╮
┃ 🗑️ *Message Deleted & Recovered*
╰━━━━━━━━━━━━━━━━━━━━╯

📌 *Source Chat:* ${sourceName}
🆔 *Chat ID:* ${source}
👤 *Sent By:* ${senderName} (+${clean(originalSender)})
🗑️ *Deleted By:* ${deletedByName} (+${clean(deletedBy)})
📂 *Message Type:* ${type}
🕒 *Detected At:* ${deletedAt}

💬 *Message Content:*
${text}`;
        await sock.sendMessage(botInbox, { text: report }).catch(() => {});
        const mediaCaption = `📌 Source: ${sourceName}\n👤 Sent by: +${clean(originalSender)}\n🗑️ Deleted by: +${clean(deletedBy)}`;
        try {
          const fake = { key: old.key, message: old.message };
          if (oldMessage?.stickerMessage) {
            const media = await downloadMedia(sock, fake);
            await sock.sendMessage(botInbox, { sticker: media });
          } else if (oldMessage?.imageMessage) {
            const media = await downloadMedia(sock, fake);
            await sock.sendMessage(botInbox, { image: media, caption: mediaCaption });
          } else if (oldMessage?.videoMessage) {
            const media = await downloadMedia(sock, fake);
            await sock.sendMessage(botInbox, { video: media, caption: mediaCaption });
          } else if (oldMessage?.audioMessage) {
            const media = await downloadMedia(sock, fake);
            await sock.sendMessage(botInbox, { audio: media, mimetype: oldMessage.audioMessage.mimetype || "audio/mpeg", ptt: !!oldMessage.audioMessage.ptt });
          } else if (oldMessage?.documentMessage) {
            const media = await downloadMedia(sock, fake);
            await sock.sendMessage(botInbox, { document: media, mimetype: oldMessage.documentMessage.mimetype || "application/octet-stream", fileName: oldMessage.documentMessage.fileName || "recovered-file", caption: mediaCaption });
          }
          const linkText = oldMessage?.conversation || oldMessage?.extendedTextMessage?.text || oldMessage?.imageMessage?.caption || oldMessage?.videoMessage?.caption || "";
          const links = linkText.match(/https?:\/\/[^\s]+|wa\.me\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|t\.me\/[^\s]+/gi);
          if (links?.length) await sock.sendMessage(botInbox, { text: `🔗 *Recovered Link(s)*\n${links.join("\n")}\n\n${mediaCaption}` });
        } catch (mediaError) {
          log.warn(`antidelete media recovery failed: ${mediaError?.message || mediaError}`);
        }
      }
    }
  });
}

/* ============================================================
 *  7. AUTO FEATURES
 * ============================================================ */
async function runAuto(sock, msg, sessionId, toggles) {
  const from = msg.key?.remoteJid;
  if (!from) return;
  if (from.endsWith("@g.us") && !(await isBotAdmin(sock, from))) return;
  toggles = from.endsWith("@g.us") ? getToggles(from) : getToggles(sessionId);
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
  if (toggles.autoreacttyping && !msg.key.fromMe) {
    sock.sendPresenceUpdate("composing", from).catch(() => {});
  }
  if (toggles.autorecordtyping && !msg.key.fromMe) {
    sock.sendPresenceUpdate("recording", from).catch(() => {});
  }
  if (from === "status@broadcast") {
    if (toggles.autosavestatus) {
      const statusMessage = unwrapMessage(msg.message);
      const statusText = statusMessage?.conversation || statusMessage?.extendedTextMessage?.text || statusMessage?.imageMessage?.caption || statusMessage?.videoMessage?.caption || "[Status media]";
      const inbox = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
      sock.sendMessage(inbox, { text: `💾 *Status Saved*\n👤 From: ${msg.key.participant || "Unknown"}\n\n${statusText}` }).catch(() => {});
    }
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
const antilinkActionState = new Map();

async function runAnti(sock, msg, sessionId, toggles) {
  const from = msg.key.remoteJid;
  if (!from?.endsWith("@g.us")) return;
  if (msg.key.fromMe) return;
  if (!(await isBotAdmin(sock, from))) return;
  toggles = getToggles(from);

  const antiKeys = ["antilink", "antibadword", "antisticker", "antiimage", "antivideo", "antivoice", "antidocument", "antigif", "antilocation", "anticontact", "antipoll", "antiforward", "antiviewonce"];
  if (!antiKeys.some((key) => toggles[key])) return;

  const sender = msg.key.participant || from;
  const message = unwrapMessage(msg.message);
  const text = message?.conversation || message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption || message?.videoMessage?.caption || "";

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
    const warningKey = `${group}:${user}:${key}`;
    const warningNumber = Math.min(3, (antiWarningCounts.get(warningKey) || 0) + 1);
    antiWarningCounts.set(warningKey, warningNumber);
    await sock.sendMessage(group, { delete: msg.key }).catch(() => {});
    const shouldRemove = warningNumber >= 3;
    const warningText = antiWarningStyles[warningNumber - 1](user.split("@")[0], key.toUpperCase());
    await sock.sendMessage(group, {
      text: warningText,
      mentions: [user],
    });
    if (shouldRemove || (key === "antilink" && antilinkActionState.get(group) === "kick")) {
      await sock.groupParticipantsUpdate(group, [user], "remove").catch(() => {});
    }
  } catch (e) { log.error("anti: " + e.message); }
}

const groupMetadataCache = new Map();
async function isUserAdmin(sock, group, user) {
  try {
    const cached = groupMetadataCache.get(group);
    const md = cached && cached.expires > Date.now() ? cached.data : await sock.groupMetadata(group);
    groupMetadataCache.set(group, { data: md, expires: Date.now() + 30000 });
    const clean = String(user || "").split(":")[0];
    const participant = md.participants.find((p) => p.id === user || p.jid === user || String(p.id).split(":")[0] === clean || String(p.jid || "").split(":")[0] === clean);
    return !!(participant?.admin || participant?.isAdmin || participant?.role === "admin" || participant?.role === "superadmin");
  } catch { return false; }
}

async function requireGroupAdmin(sock, from, msg, botMustBeAdmin = true) {
  if (!from?.endsWith("@g.us")) {
    await sock.sendMessage(from, { text: "❌ This command works only in groups." });
    return false;
  }
  const sender = msg?.key?.participant || from;
  if (!(await isUserAdmin(sock, from, sender))) {
    await sock.sendMessage(from, { text: "❌ Only group admins can use this command." });
    return false;
  }
  if (botMustBeAdmin && !(await isBotAdmin(sock, from))) return false;
  return true;
}

async function isBotAdmin(sock, from) {
  if (!from?.endsWith("@g.us")) return false;
  const phone = sock.user?.id?.split(":")[0];
  const botIds = [sock.user?.id, sock.user?.lid, phone ? `${phone}@s.whatsapp.net` : null].filter(Boolean);
  return (await Promise.all(botIds.map((id) => isUserAdmin(sock, from, id))).catch(() => [])).some(Boolean);
}

function isController(sock, from, msg, sessionId) {
  const sender = msg?.key?.participant || from;
  const values = [sender, sock.user?.id, sock.user?.lid].filter(Boolean).map((v) => String(v).split(":")[0].split("@")[0]);
  const owners = config.owner.map((v) => String(v).split("@")[0]);
  const connected = String(sessionId).replace(/\D/g, "");
  return values.some((v) => owners.includes(v) || (connected && v === connected));
}

async function requireBotAdminOnly(sock, from) {
  const ok = await isBotAdmin(sock, from);
  if (!ok) await sock.sendMessage(from, { text: "❌ Bot must be a group admin first." });
  return ok;
}

/* ============================================================
 *  9. FAST MESSAGE HANDLER
 * ============================================================ */
async function handleMessage(sock, msg, sessionId) {
  try {
    const from = msg.key?.remoteJid;
    if (!from) return;
    const message = unwrapMessage(msg.message);
    const text = message?.conversation || message?.extendedTextMessage?.text ||
      message?.imageMessage?.caption || message?.videoMessage?.caption ||
      message?.documentMessage?.caption || message?.buttonsResponseMessage?.selectedButtonId ||
      message?.listResponseMessage?.singleSelectReply?.selectedRowId || "";
    const commandText = String(text).replace(/^\s+/, "").trim();
    if (!commandText.startsWith(config.prefix)) return;

    const [cmdName, ...args] = commandText.slice(config.prefix.length).trim().split(/\s+/);
    if (!cmdName) return;
    const normalizedCommand = String(cmdName).trim().toLowerCase();
    const groupChat = from.endsWith("@g.us");
    const controller = isController(sock, from, msg, sessionId);
    const botAdmin = groupChat ? await isBotAdmin(sock, from) : false;
    if (groupChat && !botAdmin && (!controller || !BOT_ADMIN_OPTIONAL_COMMANDS.has(normalizedCommand))) return;
    let cmd = commands.get(normalizedCommand);
    log.info(`📨 Command received: ${normalizedCommand} from ${from}`);
    if (!cmd && (normalizedCommand === "menu" || normalizedCommand === "help")) {
      cmd = {
        toggle: null,
        run: async ({ sock: targetSock, from: targetFrom }) => {
          const groups = [
            ["👑 OWNER & BOT", /^(owner|mode|setprefix|broadcast|bc|restart|shutdown|pair|session|addmenu|delmenu)/i],
            ["🛡️ GROUP MANAGEMENT", /^(kick|add|promote|demote|group|g|tagall|tag|hidetag|linkgroup|invite|revoke|setname|setdesc|setgrouppp|opentime|closetime)/i],
            ["⚔️ SECURITY & ANTI", /^(anti|antilink|antibadword|antibot|antidelete|antidemote|antipromote|antistatus|antitag|antivideo|antiimage)/i],
            ["🎵 MEDIA & DOWNLOAD", /^(play|song|song2|audio|video|yt|youtube|tiktok|download|dl|instagram|ig|facebook|fb|twitter|media|toaudio|tomp3|ytmp)/i],
            ["🖼️ STICKER & IMAGE", /^(sticker|s|stiker|toimg|image|photo|blur|crop|take|emojimix|write)/i],
            ["🎮 FUN & GAMES", /^(fun|joke|meme|quote|truth|dare|ship|love|kiss|hug|slap|pat|punch|kill|diceroll|coin|8ball)/i],
            ["🔧 TOOLS", /^(calc|weather|translate|wiki|google|lyrics|short|qr|readqr|ss|fetch|url|ping|runtime|uptime|device|time|date|status|fakeinfo|profile|getid|getdp)/i],
            ["⚙️ SETTINGS & AUTO", /^(set|toggle|autoseen|autoreact|autotyping|autorecording|autorecordtyping|autoreacttyping|autoviewstatus|autoreactstatus|autosavestatus|alwaysonline|settings|config|reset)/i],
          ];
          const names = [...commands.keys()];
          const grouped = groups.map(([title, rule]) => [title, names.filter((name) => rule.test(name))]);
          const used = new Set(grouped.flatMap(([, list]) => list));
          const other = names.filter((name) => !used.has(name));
          if (other.length) grouped.push(["📦 MORE COMMANDS", other]);
          const body = grouped.filter(([, list]) => list.length).map(([title, list]) => `╭─❰ *${title}* ❱\n${list.sort().map((name) => `│ ▸ ${config.prefix}${name}`).join("\n")}\n╰──────────────`).join("\n\n");
          const text = `╭━━━❰ *${config.botName}* ❱━━━╮\n┃ 🤖 Prefix: *${config.prefix}*\n┃ 📦 Commands: *${commands.size}*\n┃ 🟢 Status: *ONLINE*\n╰━━━━━━━━━━━━━━━━╯\n\n${body}\n\n> ⚡ Fast • Secure • Reliable`;
          const parts = text.match(/[\s\S]{1,3500}/g) || [text];
          const contextInfo = { forwardingScore: 999, isForwarded: true, forwardedNewsletterMessageInfo: { newsletterJid: config.channelJid, newsletterName: config.botName, serverMessageId: -1 } };
          try { await targetSock.sendMessage(targetFrom, { text: parts[0], contextInfo }); }
          catch { await targetSock.sendMessage(targetFrom, { text: parts[0] }); }
          for (const part of parts.slice(1)) await targetSock.sendMessage(targetFrom, { text: part });
        },
      };
    }
    if (!cmd) {
      await sock.sendMessage(from, { text: `╭━━━❰ *COMMAND NOT FOUND* ❱━━━╮\n┃ ❌ Command: *${cmdName}*\n┃ 💡 Use: *${config.prefix}menu*\n╰━━━━━━━━━━━━━━━━━━━━╯` }).catch(() => {});
      return;
    }

    const inGroup = from.endsWith("@g.us");
    const ownerCommand = cmd.owner === true;
    if (!inGroup) {
      if (!isController(sock, from, msg, sessionId)) {
        return sock.sendMessage(from, { text: "🚫 This bot accepts commands only from its connected owner." });
      }
    } else if (ownerCommand) {
      if (!isController(sock, from, msg, sessionId)) {
        return sock.sendMessage(from, { text: "🚫 Owner-only command." });
      }
      if (!(await requireBotAdminOnly(sock, from))) return;
    } else if (normalizedCommand !== "menu" && normalizedCommand !== "help") {
      const ownerSpecial = controller && !botAdmin && BOT_ADMIN_OPTIONAL_COMMANDS.has(normalizedCommand);
      if (!ownerSpecial && !(await requireGroupAdmin(sock, from, msg, !BOT_ADMIN_OPTIONAL_COMMANDS.has(normalizedCommand)))) return;
    }

    if (cmd.toggle && !isOn(sessionId, cmd.toggle)) {
      return sock.sendMessage(from, {
        text: styledToggleReply(cmdName, false, `Enable with .${cmdName} on`),
      });
    }

    try {
      await cmd.run({ sock, msg, from, args, sessionId, text: commandText, cmdName });
    } catch (e) {
      log.error(`cmd ${cmdName}: ${e?.stack || e}`);
      await sock.sendMessage(from, { text: `╭━━━❰ *COMMAND ERROR* ❱━━━╮\n┃ ❌ Command: *${cmdName}*\n┃ 📝 ${e?.message || "Please try again"}\n╰━━━━━━━━━━━━━━━━━━━━╯` }).catch(() => {});
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
function getTargetJid(msg, args = [], fallback = null) {
  const message = unwrapMessage(msg?.message);
  const ctx = message?.extendedTextMessage?.contextInfo ||
    message?.imageMessage?.contextInfo ||
    message?.videoMessage?.contextInfo || {};
  const target = ctx.participantAlt || ctx.participant || ctx.mentionedJid?.[0];
  if (target) return target;
  const number = String(args[0] || "").replace(/\D/g, "");
  return number ? `${number}@s.whatsapp.net` : fallback;
}

mk("kick", async ({ sock, from, msg }) => {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const t = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!t) return sock.sendMessage(from, { text: "❌ Reply to or mention the member you want to kick." });
  const result = await sock.groupParticipantsUpdate(from, [t], "remove");
  if (result?.[0]?.status && result[0].status !== "200") throw new Error(`WhatsApp rejected the kick (${result[0].status})`);
  await sock.sendMessage(from, { text: `✅ @${t.split("@")[0]} was removed from the group.`, mentions: [t] });
});
mk("promote", async ({ sock, from, msg }) => {
  const t = getTargetJid(msg);
  if (!t) return sock.sendMessage(from, { text: "❌ Reply to or mention the member to promote." });
  await sock.groupParticipantsUpdate(from, [t], "promote");
  await sock.sendMessage(from, { text: `✅ @${t.split("@")[0]} promoted to admin.`, mentions: [t] });
});
mk("demote", async ({ sock, from, msg }) => {
  const t = getTargetJid(msg);
  if (!t) return sock.sendMessage(from, { text: "❌ Reply to or mention the admin to demote." });
  await sock.groupParticipantsUpdate(from, [t], "demote");
  await sock.sendMessage(from, { text: `✅ @${t.split("@")[0]} demoted.`, mentions: [t] });
});
mk("kickall", async ({ sock, from, msg }) => {
  const md = await sock.groupMetadata(from);
  const me = `${sock.user?.id?.split(":")[0]}@s.whatsapp.net`;
  const caller = msg?.key?.participant || from;
  const protectedIds = new Set([me, sock.user?.id, sock.user?.lid, caller].filter(Boolean).map((id) => String(id).split(":")[0]));
  const participants = md.participants.filter((p) => !protectedIds.has(String(p.id).split(":")[0]));
  await sock.sendMessage(from, { text: "🤫 𝘚𝘪𝘭𝘦𝘯𝘵_𝘚𝘵𝘰𝘳𝘮 🌪️\nNa peshi hogi, na gawah hoga,\nAb jo bhi humse uljhega, bas tabah hoga." });
  await sock.groupUpdateSubject(from, "🤫 𝘚𝘪𝘭𝘦𝘯𝘵_𝘚𝘵𝘰𝘳𝘮 🌪️").catch(() => {});
  const hue = Math.floor(Math.random() * 360);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue},80%,20%)"/><stop offset="1" stop-color="hsl(${(hue + 55) % 360},90%,55%)"/></linearGradient></defs><rect width="720" height="720" fill="url(#g)"/><text x="360" y="330" fill="white" font-size="62" font-family="sans-serif" text-anchor="middle" font-weight="bold">SILENT</text><text x="360" y="410" fill="white" font-size="62" font-family="sans-serif" text-anchor="middle" font-weight="bold">STORM 🌪️</text></svg>`;
  await sock.updateProfilePicture(from, await sharp(Buffer.from(svg)).jpeg().toBuffer()).catch(() => {});
  const admins = participants.filter((p) => p.admin);
  for (const p of admins) await sock.groupParticipantsUpdate(from, [p.id], "demote").catch(() => {});
  for (const p of participants) await sock.groupParticipantsUpdate(from, [p.id], "remove").catch(() => {});
  await sock.sendMessage(from, { text: `✅ Kickall complete. Removed ${participants.length} member(s).` }).catch(() => {});
});
mk("kickoffline", async ({ sock, from }) => {
  const md = await sock.groupMetadata(from);
  for (const p of md.participants)
    await sock.groupParticipantsUpdate(from, [p.id], "remove").catch(() => {});
});
mk("tagall", async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  const txt = args.join(" ") || "Attention Everyone ⚠️";
  const mentions = md.participants.map((p) => p.id);
  const emojis = ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😎", "🤩", "🥳", "😋", "🤔", "🤨", "😐", "😑", "😶", "🙄", "😏", "😣", "😥", "😮", "🤐", "😯", "😪", "😫", "🥱", "😴", "😌", "🤓", "😛", "😜", "🤪", "😝", "🤗", "🤭", "🫡", "🤫", "🤔", "🫠", "🔥", "⚡", "💫", "🌟", "🚀", "🎉", "💥", "✨", "🤯", "🎯", "💯", "❤️"];
  const tagEmoji = emojis[Math.floor(Math.random() * emojis.length)];
  const lines = mentions.map((m, i) => `${i + 1}. ${tagEmoji} @${m.split("@")[0]}`);
  const heading = `❏ Group : ${md.subject || "Group"}
❏ Members: ${mentions.length}
❏ Message: ${txt}

╭━━━━━━❰ MENTIONS
${lines.join("\n")}`;
  await sock.sendMessage(from, {
    text: heading, mentions,
  });
});
mk("tag", async (p) => commands.get("tagall").run(p));
mk("hidetag", async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  await sock.sendMessage(from, { text: args.join(" ") || " ", mentions: md.participants.map((p) => p.id) });
});
mk("tagme", async ({ sock, from }) => {
  await sock.sendMessage(from, { text: `@${from.split("@")[0]}`, mentions: [from] });
});
mk("mention", async (p) => commands.get("tagall").run(p));
mk("open", async ({ sock, from, msg }) => {
  if (!(await requireGroupAdmin(sock, from, msg))) return;
  await sock.groupSettingUpdate(from, "not_announcement");
  await sock.sendMessage(from, { text: "✅ Group opened. All members can send messages now." });
});
mk("close", async ({ sock, from, msg }) => {
  if (!(await requireGroupAdmin(sock, from, msg))) return;
  await sock.groupSettingUpdate(from, "announcement");
  await sock.sendMessage(from, { text: "✅ Group closed. Only admins can send messages now." });
});
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
  if (!msg.message?.imageMessage) return sock.sendMessage(from, { text: "❌ Reply to an image with .setgrouppp" });
  const buf = await downloadMedia(sock, msg);
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
const AUTO_LIST = ["autoseen", "autotyping", "autorecording", "autoreact", "autoviewstatus", "autoreactstatus", "autosavestatus", "autoreacttyping", "autorecordtyping"];
for (const name of AUTO_LIST) {
  register(name, {
    toggle: null,
    run: async ({ sock, from, msg, args }) => {
      if (!(await requireGroupAdmin(sock, from, msg))) return;
      const scope = from.endsWith("@g.us") ? from : from;
      if (!args[0]) return sock.sendMessage(from, { text: `${styledToggleReply(name, getToggles(scope)[name], `Usage: .${name} on/off`)}` });
      setToggle(scope, name, args[0]);
      await sock.sendMessage(from, { text: styledToggleReply(name, getToggles(scope)[name], "Updated for this group") });
    },
  });
}
for (const name of ANTI_LIST) {
  register(name, {
    toggle: null,
    run: async ({ sock, from, args, sessionId }) => {
      if (!args[0]) {
        const t = getToggles(from.endsWith("@g.us") ? from : sessionId);
        return sock.sendMessage(from, {
          text: styledToggleReply(name, t[name], `Usage: .${name} on/off`),
        });
      }
      const ok = setToggle(from.endsWith("@g.us") ? from : sessionId, name, args[0]);
      await sock.sendMessage(from, { text: ok ? styledToggleReply(name, getToggles(from.endsWith("@g.us") ? from : sessionId)[name], "Updated") : styledToggleReply(name, false, "Unknown toggle") });
    },
  });
}
register("antilink", {
  toggle: null,
  run: async ({ sock, from, msg, args, sessionId }) => {
    if (!(await requireGroupAdmin(sock, from, msg))) return;
    const mode = String(args[0] || "").toLowerCase();
    if (!mode) {
      const enabled = getToggles(from).antilink;
      const action = antilinkActionState.get(from) || "delete";
      return sock.sendMessage(from, { text: styledToggleReply("antilink", enabled, `Action: ${action} | Use: .antilink on/off/kick/delete`) });
    }
    if (mode === "kick" || mode === "delete") {
      antilinkActionState.set(from, mode);
      setToggle(from, "antilink", true);
      return sock.sendMessage(from, { text: styledToggleReply("antilink", true, `Action: ${mode} | Links will be deleted immediately`) });
    }
    if (mode === "on" || mode === "off") {
      setToggle(from, "antilink", mode);
      return sock.sendMessage(from, { text: styledToggleReply("antilink", mode === "on", "Updated") });
    }
    await sock.sendMessage(from, { text: styledToggleReply("antilink", false, "Usage: .antilink on/off/kick/delete") });
  },
});
register("autostatuslinkkick", {
  toggle: null,
  run: async ({ sock, from, args, sessionId }) => {
    if (!args[0]) {
      const t = getToggles(sessionId);
      return sock.sendMessage(from, { text: styledToggleReply("autostatuslinkkick", t.antistatuslinkkick, "Use: .autostatuslinkkick on/off") });
    }
    setToggle(sessionId, "antistatuslinkkick", args[0]);
    await sock.sendMessage(from, { text: styledToggleReply("autostatuslinkkick", getToggles(sessionId).antistatuslinkkick, "Updated") });
  },
});
register("set", {
  toggle: null,
  run: async ({ sock, from, args, sessionId }) => {
    if (args.length < 2) return sock.sendMessage(from, { text: styledToggleReply(args[0] || "SET", false, "Usage: .set <key> on/off") });
    const ok = setToggle(sessionId, args[0], args[1]);
    await sock.sendMessage(from, { text: ok ? styledToggleReply(args[0], getToggles(sessionId)[args[0]], "Updated") : styledToggleReply(args[0], false, "Unknown toggle") });
  },
});
register("botstatus", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    if (!(await requireGroupAdmin(sock, from, msg))) return;
    const toggles = getToggles(from);
    const botIsAdmin = await requireBotAdminOnly(sock, from);
    const anti = ANTI_LIST.filter((name) => toggles[name]);
    const enabled = [...commands.keys()].filter((name) => !ANTI_LIST.includes(name));
    const status = botIsAdmin ? "🟢 ACTIVE" : "🔴 INACTIVE — Bot is not group admin";
    const text = `╭━━━❰ *BOT STATUS* ❱━━━╮
┃ ${status}
┃ 📍 Group ID: ${from}
┃ 🛡️ Bot Admin: ${botIsAdmin ? "YES ✅" : "NO ❌"}
╰━━━━━━━━━━━━━━━━━━━━╯

⚔️ *Anti-Features ON (${anti.length})*
${anti.length ? anti.sort().map((name) => `✅ ${config.prefix}${name}`).join("\n") : "❌ No anti-feature is ON"}

🧰 *Normal Commands Available (${enabled.length})*
${enabled.length ? enabled.sort().map((name) => `✅ ${config.prefix}${name}`).join("\n") : "❌ No normal command is ON"}`;
    for (const part of (text.match(/[\s\S]{1,3500}/g) || [text])) await sock.sendMessage(from, { text: part });
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
      const statusJidList = md.participants.map((p) => p.id).filter(Boolean);
      const result = await sock.sendMessage("status@broadcast", { text }, { statusJidList });
      if (!result?.key?.id) throw new Error("WhatsApp did not return a status message id");
      await sock.sendMessage(from, { text: `╭━━━❰ *GC STATUS* ❱━━━╮\n┃ ✅ WhatsApp accepted the status request\n┃ 👥 Audience list: ${statusJidList.length} group members\n┃ ℹ️ Visibility depends on WhatsApp status privacy/account support\n╰━━━━━━━━━━━━━━━━━━━━╯` });
    } catch (error) { await sock.sendMessage(from, { text: `❌ Failed to post story: ${error?.message || "WhatsApp rejected it"}` }); }
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
async function resolveYouTube(input) {
  if (ytdl.validateURL(input)) return input;
  const result = await ytSearch(input);
  const first = result.videos?.[0];
  if (!first?.url) throw new Error("YouTube video not found");
  return first.url;
}
mk("movie", async ({ sock, from, args }) => {
  const input = args.join(" ").trim();
  if (!input) return sock.sendMessage(from, { text: "Usage: .movie <movie title>" });
  const result = await ytSearch(`${input} official trailer`);
  const trailer = result.videos?.[0];
  const q = encodeURIComponent(input);
  const text = `╭━━━❰ *MOVIE SEARCH* ❱━━━╮
┃ 🎬 Title: *${input}*
╰━━━━━━━━━━━━━━━━━━━━╯
${trailer ? `
▶️ *Official Trailer*
${trailer.title}
${trailer.url}` : "\n▶️ Official trailer not found"}

🔎 *Legal streaming availability*
JustWatch: https://www.justwatch.com/us/search?q=${q}
Google Play Movies: https://play.google.com/store/search?q=${q}&c=movies
Apple TV: https://tv.apple.com/us/search?term=${q}

ℹ️ Availability and pricing depend on your country. Full copyrighted movie files are not downloaded.`;
  await sock.sendMessage(from, { text });
});
async function downloadWithYtDlp(input, kind) {
  const url = await resolveYouTube(input);
  const ext = kind === "audio" ? "mp3" : "mp4";
  const base = path.join(os.tmpdir(), `md-ghani-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const output = `${base}.${ext}`;
  try {
    const format = kind === "audio" ? "bestaudio/best" : "bv*[height<=720]+ba/b[height<=720]/b";
    const binary = fs.existsSync("/opt/yt-dlp/bin/yt-dlp") ? "/opt/yt-dlp/bin/yt-dlp" : "yt-dlp";
    const clients = ["tv_embedded", "web_safari", "android", "web_creator"];
    let lastError;
    for (const client of clients) {
      const args = ["--no-playlist", "--no-warnings", "--force-ipv4", "--retries", "2", "--fragment-retries", "2", "--retry-sleep", "linear=1::3", "--extractor-args", `youtube:player_client=${client}`, "--max-filesize", "50M", "-f", format, "-o", output];
      if (kind === "audio") args.push("--extract-audio", "--audio-format", "mp3", "--audio-quality", "5");
      args.push(url);
      try {
        await execFileAsync(binary, args, { timeout: 150000, maxBuffer: 2 * 1024 * 1024 });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await fs.promises.rm(output, { force: true }).catch(() => {});
      }
    }
    if (lastError) throw lastError;
    const buffer = await fs.promises.readFile(output);
    if (!buffer.length) throw new Error("Downloaded file is empty");
    return { buffer, title: input, mimetype: kind === "audio" ? "audio/mpeg" : "video/mp4" };
  } finally {
    await fs.promises.rm(output, { force: true }).catch(() => {});
    await fs.promises.rm(`${base}.part`, { force: true }).catch(() => {});
  }
}
async function legacyYouTube(input, kind) {
  const isUrl = ytdl.validateURL(input);
  const url = isUrl ? input : (await axios.get("https://api.akuari.my.id/search/youtube", { params: { query: input }, timeout: 20000 })).data?.result?.[0]?.url;
  if (!url) throw new Error("Video not found");
  const data = (await axios.get("https://api.akuari.my.id/downloader/youtube", { params: { link: url }, timeout: 30000 })).data?.result;
  const mediaUrl = kind === "audio" ? data?.mp3 : data?.video;
  if (!mediaUrl) throw new Error("Fallback media provider returned no file");
  return { mediaUrl, title: input };
}
mk("ytmp4", async ({ sock, from, args }) => {
  if (!args[0]) return sock.sendMessage(from, { text: "Usage: .ytmp4 <YouTube URL>" });
  const input = args.join(" ");
  try {
    const media = await downloadWithYtDlp(input, "video");
    await sock.sendMessage(from, { video: media.buffer, mimetype: media.mimetype, caption: `🎬 ${media.title}` });
  } catch (primary) {
    try { const f = await legacyYouTube(input, "video"); await sock.sendMessage(from, { video: { url: f.mediaUrl }, caption: `🎬 ${f.title}` }); }
    catch { throw new Error("YouTube is rate-limiting downloads right now. Please try again in a few minutes."); }
  }
});
mk("ytmp3", async ({ sock, from, args }) => {
  if (!args[0]) return sock.sendMessage(from, { text: "Usage: .ytmp3 <YouTube URL>" });
  const input = args.join(" ");
  try {
    const media = await downloadWithYtDlp(input, "audio");
    await sock.sendMessage(from, { audio: media.buffer, mimetype: media.mimetype, ptt: false });
  } catch {
    try { const f = await legacyYouTube(input, "audio"); await sock.sendMessage(from, { audio: { url: f.mediaUrl }, mimetype: "audio/mpeg", ptt: false }); }
    catch { throw new Error("YouTube is rate-limiting downloads right now. Please try again in a few minutes."); }
  }
});
mk("song", async ({ sock, from, args }) => {
  const q = args.join(" ");
  if (!q) return sock.sendMessage(from, { text: "Usage: .song <song name>" });
  try {
    const media = await downloadWithYtDlp(q, "audio");
    await sock.sendMessage(from, { audio: media.buffer, mimetype: media.mimetype, ptt: false });
  } catch {
    try { const f = await legacyYouTube(q, "audio"); await sock.sendMessage(from, { audio: { url: f.mediaUrl }, mimetype: "audio/mpeg", ptt: false }); }
    catch { throw new Error("YouTube is rate-limiting downloads right now. Please try again in a few minutes."); }
  }
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
  const buf = await downloadMedia(sock, msg);
  const webp = await sharp(buf).webp().toBuffer();
  await sock.sendMessage(from, { sticker: webp });
});
mk("tosticker", async (p) => commands.get("sticker").run(p));
mk("togif", async ({ sock, from, msg }) => {
  const buf = await downloadMedia(sock, msg);
  await sock.sendMessage(from, { video: buf, gifPlayback: true });
});
mk("toimg", async ({ sock, from, msg }) => {
  const buf = await downloadMedia(sock, msg);
  const png = await sharp(buf).png().toBuffer();
  await sock.sendMessage(from, { image: png });
});
mk("sticker2img", async (p) => commands.get("toimg").run(p));
mk("toaudio", async ({ sock, from, msg }) => {
  const buf = await downloadMedia(sock, msg);
  await sock.sendMessage(from, { audio: buf, mimetype: "audio/mpeg" });
});
mk("topdf", async ({ sock, from, msg }) => {
  const buf = await downloadMedia(sock, msg);
  await sock.sendMessage(from, { document: buf, mimetype: "application/pdf", fileName: "file.pdf" });
});
mk("vv", async ({ sock, from, msg, sessionId }) => {
  const message = unwrapMessage(msg.message);
  const context = message?.extendedTextMessage?.contextInfo ||
    message?.imageMessage?.contextInfo || message?.videoMessage?.contextInfo || {};
  const quoted = context.quotedMessage;
  const quotedUnwrapped = unwrapMessage(quoted);
  const viewOnce = quoted?.viewOnceMessageV2 || quoted?.viewOnceMessage || quoted?.viewOnceMessageV2Extension ||
    quotedUnwrapped?.viewOnceMessageV2 || quotedUnwrapped?.viewOnceMessage;
  const original = viewOnce?.message || viewOnce || quotedUnwrapped || quoted;
  if (!original) return sock.sendMessage(from, { text: "❌ Reply to a view-once message with .vv" });
  const ownerMode = isController(sock, from, msg, sessionId);
  const botInbox = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
  const destination = ownerMode ? botInbox : from;
  const emoji = ["👀", "🔥", "😂", "😍", "😮", "❤️", "✨", "🤯"][Math.floor(Math.random() * 8)];
  if (ownerMode && context.stanzaId) {
    await sock.sendMessage(from, {
      react: { text: emoji, key: { remoteJid: from, id: context.stanzaId, participant: context.participant, fromMe: false } },
    }).catch(() => {});
  }
  const image = original.imageMessage;
  const video = original.videoMessage;
  const audio = original.audioMessage;
  const document = original.documentMessage;
  const sticker = original.stickerMessage;
  if (image || video || audio || document || sticker) {
    const fake = { key: { remoteJid: from, id: `VV-${Date.now()}` }, message: original };
    const buf = await downloadMedia(sock, fake);
    let sent;
    if (image) sent = await sock.sendMessage(destination, { image: buf, caption: `${emoji} ${image.caption || "View-once recovered"}` });
    else if (video) sent = await sock.sendMessage(destination, { video: buf, caption: `${emoji} ${video.caption || "View-once recovered"}` });
    else if (audio) sent = await sock.sendMessage(destination, { audio: buf, mimetype: audio.mimetype || "audio/mpeg", ptt: !!audio.ptt });
    else if (document) sent = await sock.sendMessage(destination, { document: buf, mimetype: document.mimetype || "application/octet-stream", fileName: document.fileName || "view-once-file", caption: `${emoji} View-once recovered` });
    else sent = await sock.sendMessage(destination, { sticker: buf });
    if (ownerMode) await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
    return sent;
  }
  const sent = await sock.sendMessage(destination, { text: `${emoji} View-once message recovered\n${original.conversation || original.extendedTextMessage?.text || ""}` });
  if (ownerMode) await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
  return sent;
});
mk("blur", async ({ sock, from, msg }) => {
  const buf = await downloadMedia(sock, msg);
  const blurred = await sharp(buf).blur(15).toBuffer();
  await sock.sendMessage(from, { image: blurred });
});
mk("crop", async ({ sock, from, msg }) => {
  const buf = await downloadMedia(sock, msg);
  const cropped = await sharp(buf).resize(500, 500, { fit: "cover" }).toBuffer();
  await sock.sendMessage(from, { image: cropped });
});
mk("setfont", async ({ sock, from, args }) => {
  const t = args.join(" ");
  await sock.sendMessage(from, { text: `*${t}*\n_${t}_\n~${t}~\n\`\`\`${t}\`\`\`` });
});
mk("tts", async ({ sock, from, args }) => {
  const text = args.join(" ");
  if (!text) return sock.sendMessage(from, { text: "Usage: .tts <text>" });
  const { data } = await axios.get("https://translate.google.com/translate_tts", {
    params: { ie: "UTF-8", client: "tw-ob", tl: "en", q: text.slice(0, 180) },
    responseType: "arraybuffer",
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  await sock.sendMessage(from, { audio: Buffer.from(data), mimetype: "audio/mpeg", ptt: false });
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
  if (!q) return sock.sendMessage(from, { text: "Usage: .weather <city>" });
  const geo = await axios.get("https://geocoding-api.open-meteo.com/v1/search", {
    params: { name: q, count: 1, language: "en", format: "json" }, timeout: 15000,
  });
  const place = geo.data?.results?.[0];
  if (!place) return sock.sendMessage(from, { text: `❌ Location not found: ${q}` });
  const forecast = await axios.get("https://api.open-meteo.com/v1/forecast", {
    params: { latitude: place.latitude, longitude: place.longitude, current: "temperature_2m,relative_humidity_2m,wind_speed_10m", timezone: "auto" }, timeout: 15000,
  });
  const c = forecast.data.current;
  await sock.sendMessage(from, { text: `🌤️ *${place.name}, ${place.country}*\n🌡️ Temp: ${c.temperature_2m}°C\n💧 Humidity: ${c.relative_humidity_2m}%\n💨 Wind: ${c.wind_speed_10m} km/h` });
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
mk("link", async ({ sock, from }) => {
  const code = await sock.groupInviteCode(from);
  await sock.sendMessage(from, { text: `🔗 *${(await sock.groupMetadata(from)).subject}*\nhttps://chat.whatsapp.com/${code}` });
});

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
  cuddle: "🤗", hug: "🤝", kiss: "💋", pat: "🫳",
  poke: "👉", slap: "👋", kill: "💀", shoot: "🔫", smile: "😊",
  wink: "😉", danger: "⚠️", shy: "😳",
};
for (const [name, emoji] of Object.entries(REACTIONS)) {
  mk(name, async ({ sock, from, msg }) => {
    const t = msg.message?.extendedTextMessage?.contextInfo?.participant || from;
    await sock.sendMessage(from, {
      text: `${emoji} *${name.toUpperCase()}*\n@${t.split("@")[0]} ➜ @${from.split("@")[0]}\n🎁 Gift sent with love!`,
      mentions: [t, from],
    });
  });
}
mk("reactionmenu", async ({ sock, from }) => {
  const list = Object.entries(REACTIONS).map(([n, e]) => `${e} .${n}`).join("\n");
  await sock.sendMessage(from, { text: `🎭 *Reaction Menu*\n\n${list}` });
});
mk("joke", async ({ sock, from }) => sock.sendMessage(from, { text: "😂 *Joke*\nProgrammer ne chai kyun banayi?\nBecause uska code brew ho raha tha!" }));
mk("quote", async ({ sock, from }) => sock.sendMessage(from, { text: "💬 *Quote*\nSuccess is the sum of small efforts, repeated every day." }));
mk("truth", async ({ sock, from }) => sock.sendMessage(from, { text: "🎯 *Truth*\nAapka sabse bada goal kya hai?" }));
mk("dare", async ({ sock, from }) => sock.sendMessage(from, { text: "🔥 *Dare*\nGroup mein ek funny voice note bhejo." }));
mk("diceroll", async ({ sock, from }) => sock.sendMessage(from, { text: `🎲 You rolled: *${1 + Math.floor(Math.random() * 6)}*` }));
mk("coin", async ({ sock, from }) => sock.sendMessage(from, { text: `🪙 Coin: *${Math.random() < 0.5 ? "Heads" : "Tails"}*` }));
mk("8ball", async ({ sock, from }) => sock.sendMessage(from, { text: `🎱 ${["Yes", "No", "Maybe", "Ask again later"][Math.floor(Math.random() * 4)]}` }));
mk("meme", async ({ sock, from }) => sock.sendMessage(from, { text: "🤣 Meme mode: Jab bot online ho, group ka mood automatically upgrade ho jata hai!" }));
mk("fun", async ({ sock, from }) => sock.sendMessage(from, { text: "🎮 *FUN MENU*\n.joke\n.quote\n.truth\n.dare\n.diceroll\n.coin\n.8ball\n.meme" }));

/* ============================================================
 * 18. COMMANDS — OWNER
 * ============================================================ */
const isOwner = (from) => config.owner.includes(from);
const mkOwner = (n, fn) => register(n, {
  toggle: null,
  owner: true,
  run: async (p) => {
    if (!isController(p.sock, p.from, p.msg, p.sessionId) && !p.msg.key.fromMe)
      return p.sock.sendMessage(p.from, { text: "🚫 Owner only command" });
    await fn(p);
  },
});
mkOwner("mode", async ({ sock, from, args }) => sock.sendMessage(from, { text: `⚙️ Mode: *${args[0] || "public"}*` }));
mkOwner("public", async ({ sock, from }) => sock.sendMessage(from, { text: styledToggleReply("public mode", true, "Bot is available to users") }));
mkOwner("private", async ({ sock, from }) => sock.sendMessage(from, { text: styledToggleReply("private mode", true, "Bot is restricted") }));
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
  await sock.sendMessage(from, { text: styledToggleReply("alwaysonline", getToggles(sessionId).alwaysonline, "Updated") });
});
mkOwner("warn", async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (t) await sock.sendMessage(from, { text: `⚠️ Warning 1/3 for @${t.split("@")[0]}`, mentions: [t] });
});
mkOwner("setwarn", async ({ sock, from, args }) => sock.sendMessage(from, { text: `⚙️ Warn limit set to ${args[0] || 3}` }));
mkOwner("add", async ({ sock, from, msg, args }) => {
  const target = getTargetJid(msg, args);
  if (!target) return sock.sendMessage(from, { text: "❌ Reply to, mention, or provide the number to add." });
  await sock.groupParticipantsUpdate(from, [target], "add");
  await sock.sendMessage(from, { text: `✅ Add request sent for @${target.split("@")[0]}.`, mentions: [target] });
});
mkOwner("everyonemsg", async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  await sock.sendMessage(from, { text: args.join(" ") || "📢", mentions: md.participants.map((p) => p.id) });
});
mkOwner("mycmd", async ({ sock, from }) => {
  const list = [...commands.keys()].sort().join(", ");
  await sock.sendMessage(from, { text: `📜 *Commands (${commands.size})*\n\n${list}` });
});
register("warn", {
  toggle: null,
  run: async ({ sock, from, msg, args }) => {
    if (!(await requireGroupAdmin(sock, from, msg))) return;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const target = ctx?.participant || ctx?.mentionedJid?.[0] || (args[0] ? `${args[0].replace(/\D/g, "")}@s.whatsapp.net` : null);
    if (!target) return sock.sendMessage(from, { text: "❌ Reply to or mention the member with .warn" });
    const key = `${from}:${target}`;
    const limit = Math.max(1, Number(args[0]) || 3);
    const count = (warningState.get(key) || 0) + 1;
    warningState.set(key, count);
    if (count >= limit) {
      warningState.delete(key);
      await sock.groupParticipantsUpdate(from, [target], "remove").catch(() => {});
      return sock.sendMessage(from, { text: `🚫 @${target.split("@")[0]} removed after ${limit} warnings.`, mentions: [target] });
    }
    await sock.sendMessage(from, { text: `⚠️ Warning ${count}/${limit} for @${target.split("@")[0]}. Next violation may remove the member.`, mentions: [target] });
  },
});

/* ============================================================
 * 19. COMMANDS — SETTINGS
 * ============================================================ */
register("setwelcome", { toggle: null, run: async ({ sock, from, args }) => {
  const settings = getGroupMessageSettings(from);
  const message = args.join(" ") || "🎉 Welcome";
  settings.welcome = `${message} {user} to {group}. You are member #{count}.`;
  await sock.sendMessage(from, { text: `✅ Welcome message set:\n${settings.welcome}\n\nOrder: message → user → group name → You are member #count` });
}});
register("setgoodbye", { toggle: null, run: async ({ sock, from, args }) => {
  const settings = getGroupMessageSettings(from);
  const message = args.join(" ") || "👋 Goodbye";
  settings.goodbye = `${message} {user} from {group}. You are member #{count}.`;
  await sock.sendMessage(from, { text: `✅ Goodbye message set:\n${settings.goodbye}\n\nOrder: message → user → group name → You are member #count` });
}});
register("welcome", { toggle: null, run: async ({ sock, from, msg, args, sessionId }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  const settings = getGroupMessageSettings(from);
  const mode = String(args[0] || "").toLowerCase();
  if (["on", "off"].includes(mode)) {
    if (!isController(sock, from, msg, sessionId)) return sock.sendMessage(from, { text: "🚫 Only the bot owner can change welcome ON/OFF." });
    settings.welcomeEnabled = mode === "on";
    return sock.sendMessage(from, { text: styledToggleReply("welcome", settings.welcomeEnabled, "Automatic messages updated for this group") });
  }
  if (["status", "state"].includes(mode)) {
    return sock.sendMessage(from, { text: styledToggleReply("welcome", settings.welcomeEnabled, "Use .welcome on/off") });
  }
  const md = await sock.groupMetadata(from);
  const user = msg.key?.participant || from;
  const text = formatGroupMessage(settings.welcome, md.subject || "Group", user, md.participants.length);
  await sock.sendMessage(from, { text, mentions: [user] });
}});
register("goodbye", { toggle: null, run: async ({ sock, from, msg, args, sessionId }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  const settings = getGroupMessageSettings(from);
  const mode = String(args[0] || "").toLowerCase();
  if (["on", "off"].includes(mode)) {
    if (!isController(sock, from, msg, sessionId)) return sock.sendMessage(from, { text: "🚫 Only the bot owner can change goodbye ON/OFF." });
    settings.goodbyeEnabled = mode === "on";
    return sock.sendMessage(from, { text: styledToggleReply("goodbye", settings.goodbyeEnabled, "Automatic messages updated for this group") });
  }
  if (["status", "state"].includes(mode)) {
    return sock.sendMessage(from, { text: styledToggleReply("goodbye", settings.goodbyeEnabled, "Use .goodbye on/off") });
  }
  const md = await sock.groupMetadata(from);
  const user = msg.key?.participant || from;
  const text = formatGroupMessage(settings.goodbye, md.subject || "Group", user, md.participants.length);
  await sock.sendMessage(from, { text, mentions: [user] });
}});
register("getbio", { toggle: null, run: async ({ sock, from }) => {
  const st = await sock.fetchStatus(from);
  await sock.sendMessage(from, { text: `📝 Bio: ${st?.status || "None"}` });
}});
register("getdp", { toggle: null, run: async ({ sock, from, msg, args }) => {
  const t = getTargetJid(msg, args, from);
  try {
    const url = await sock.profilePictureUrl(t, "image");
    await sock.sendMessage(from, { image: { url }, caption: `📷 @${t.split("@")[0]}`, mentions: [t] });
  } catch { await sock.sendMessage(from, { text: t === from ? "❌ This group has no profile picture." : "❌ This user has no profile picture." }); }
}});
register("dp", { toggle: null, run: async (p) => commands.get("getdp").run(p) });
register("getid", { toggle: null, run: async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant || from;
  await sock.sendMessage(from, { text: `🆔 ${t}` });
}});
register("profile", { toggle: null, run: async ({ sock, from, msg, args }) => {
  const t = await resolveOriginalJid(sock, getTargetJid(msg, args, msg?.key?.participant || from));
  const clean = String(t).split(":")[0].split("@")[0];
  let name = `+${clean}`;
  let admin = "Private chat";
  let groupSubject = "Private chat";
  if (from.endsWith("@g.us")) {
    const md = await sock.groupMetadata(from);
    const p = md.participants.find((x) => x.id === t || x.jid === t || String(x.id).split(":")[0] === clean);
    name = p?.name || p?.notify || p?.verifiedName || name;
    admin = p?.admin || p?.isAdmin || p?.role || "member";
    groupSubject = md.subject || groupSubject;
  }
  let about = "Unavailable";
  try { about = (await sock.fetchStatus(t))?.status || "No about/status"; } catch {}
  if (name === `+${clean}` && typeof sock.onWhatsApp === "function") {
    try {
      const contact = (await sock.onWhatsApp(t))?.[0];
      name = contact?.verifiedName || contact?.notify || name;
    } catch {}
  }
  let dpBuffer;
  try {
    const dpUrl = await sock.profilePictureUrl(t, "image");
    dpBuffer = Buffer.from((await axios.get(dpUrl, { responseType: "arraybuffer", timeout: 15000 })).data);
  } catch {}
  const caption = `╭━━━❰ *WHATSAPP PROFILE* ❱━━━╮
┃ 📛 Name: ${name}
┃ 📱 Number: +${clean}
┃ 🛡️ Role: ${admin}
┃ 🏷️ Group: ${groupSubject}
┃ 📝 About: ${about}
╰━━━━━━━━━━━━━━━━━━━━╯`;
  if (dpBuffer) await sock.sendMessage(from, { image: dpBuffer, caption, mentions: [t] });
  else await sock.sendMessage(from, { text: `${caption}\n📷 DP: Not available`, mentions: [t] });
}});
register("opentime", { toggle: null, run: async ({ sock, from, args }) => sock.sendMessage(from, { text: `⏰ Group open time: ${args.join(" ")}` }) });

/* ============================================================
 * 20. COMMANDS — ATTRACTIVE CATEGORY MENU
 * ============================================================
register("menu", {
  toggle: null,
  run: async ({ sock, from }) => {
    const categoryRules = [
      ["👑 OWNER & BOT", /^(owner|mode|setprefix|broadcast|bc|restart|shutdown|pair|session|addmenu|delmenu)/i],
      ["🛡️ GROUP MANAGEMENT", /^(kick|add|promote|demote|group|g|tagall|tag|hidetag|linkgroup|invite|revoke|setname|setdesc|setgrouppp|opentime|closetime|welcome|goodbye)/i],
      ["⚔️ SECURITY & ANTI", /^(anti|antilink|antibadword|antibot|antidelete|antidemote|antipromote|antistatus|antitag|antivideo|antiimage)/i],
      ["🎵 MEDIA & DOWNLOAD", /^(play|song|audio|video|yt|youtube|tiktok|download|dl|instagram|ig|facebook|fb|twitter|media|toaudio|tomp3|ytmp)/i],
      ["🖼️ STICKER & IMAGE", /^(sticker|s|stiker|toimg|image|photo|blur|crop|take|emojimix|write)/i],
      ["🎮 FUN & GAMES", /^(fun|joke|meme|quote|truth|dare|ship|love|cuddle|kiss|hug|poke|slap|pat|kill|shoot|smile|wink|danger|shy|reactionmenu|punch|diceroll|coin|8ball)/i],
      ["🔧 TOOLS", /^(calc|weather|translate|wiki|google|lyrics|short|qr|readqr|ss|fetch|url|ping|runtime|uptime|device|time|date|status|fakeinfo|profile|getid|getdp)/i],
      ["⚙️ SETTINGS & AUTO", /^(set|toggle|autoseen|autoreact|autotyping|autorecording|autorecordtyping|autoreacttyping|autoviewstatus|autoreactstatus|autosavestatus|alwaysonline|settings|config|reset|setwelcome|setgoodbye)/i],
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
      log.error(`menu button fallback: ${e?.message || e}`);
      const safeParts = menuText.match(/[\s\S]{1,3500}/g) || [menuText];
      for (const part of safeParts) await sock.sendMessage(from, { text: part });
    }
  },
});
register("help", { toggle: null, run: async (p) => commands.get("menu").run(p) });
register("addmenuimage", { toggle: null, run: async ({ sock, from, msg }) => {
  const buf = await downloadMedia(sock, msg);
  await sock.sendMessage(from, { image: buf, caption: `✅ Menu image set` });
}});
register("addmenuvideo", { toggle: null, run: async ({ sock, from, msg }) => {
  const buf = await downloadMedia(sock, msg);
  await sock.sendMessage(from, { video: buf, caption: `✅ Menu video set` });
}});
register("delmenuimage", { toggle: null, run: async ({ sock, from }) => sock.sendMessage(from, { text: "🗑️ Menu image removed" }) });
register("delmenuvideo", { toggle: null, run: async ({ sock, from }) => sock.sendMessage(from, { text: "🗑️ Menu video removed" }) });

/* ============================================================
 * 21. INLINE PAIRING PANEL HTML
 * ============================================================ */
const PAIR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
<meta name="theme-color" content="#000000"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
<title>MD-Ghani-Bot • H4CK3R</title>
<style>
  :root{
    --bg:#000000;
    --card:#020a02;
    --line:#0a2a0a;
    --line-2:#0f3d0f;
    --txt:#c8ffc8;
    --txt-2:#7dff7d;
    --muted:#3a8a3a;
    --green:#00ff41;
    --green-2:#00cc33;
    --green-dark:#008822;
    --lime:#7dff00;
    --mint:#00ffaa;
    --red:#ff0033;
    --amber:#ffb000;
  }
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  html,body{height:100%;width:100%;overflow:hidden}
  body{
    font-family:ui-monospace,"SF Mono",Monaco,Menlo,Consolas,"Courier New",monospace;
    background:var(--bg);
    color:var(--txt);
    -webkit-font-smoothing:antialiased;
    display:flex;align-items:center;justify-content:center;
    min-height:100dvh;
    padding:
      max(10px, env(safe-area-inset-top))
      max(10px, env(safe-area-inset-right))
      max(10px, env(safe-area-inset-bottom))
      max(10px, env(safe-area-inset-left));
    position:fixed;inset:0;
    overflow:hidden;
    letter-spacing:.4px;
  }

  /* MATRIX RAIN */
  #matrixCanvas{
    position:fixed;top:0;left:0;
    width:100%;height:100%;
    z-index:0;opacity:.35;
    pointer-events:none;
    mask-image:radial-gradient(ellipse at center, black 40%, transparent 95%);
    -webkit-mask-image:radial-gradient(ellipse at center, black 40%, transparent 95%);
  }
  .crt-scan{
    position:fixed;inset:0;z-index:1;
    background:repeating-linear-gradient(0deg,transparent 0,transparent 2px,rgba(0,255,65,.03) 3px,transparent 4px);
    pointer-events:none;
    animation:crtMove 8s linear infinite;
  }
  @keyframes crtMove{to{background-position:0 4px}}
  .crt-flicker{
    position:fixed;inset:0;z-index:1;
    background:rgba(0,255,65,.015);
    pointer-events:none;
    animation:flicker 3s steps(1) infinite;
  }
  @keyframes flicker{
    0%,100%{opacity:.4}
    5%{opacity:.2}
    10%{opacity:.5}
    15%{opacity:.3}
    50%{opacity:.4}
    55%{opacity:.15}
    60%{opacity:.5}
  }
  .vignette{
    position:fixed;inset:0;z-index:1;
    background:radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,.7) 100%);
    pointer-events:none;
  }

  /* WRAPPER */
  .wrap{
    position:relative;z-index:10;
    width:100%;max-width:440px;
    display:flex;flex-direction:column;
    gap:12px;
    max-height:100%;
    overflow-y:auto;
    overflow-x:hidden;
    scrollbar-width:none;
    padding:2px;
    justify-content:center;
  }
  .wrap::-webkit-scrollbar{display:none}

  /* HEADER */
  .terminal-header{
    width:100%;
    background:rgba(2,10,2,.94);
    border:1.5px solid var(--green);
    border-radius:6px;
    overflow:hidden;
    animation:slideDown .6s cubic-bezier(.2,.9,.3,1.1);
    box-shadow:0 0 30px rgba(0,255,65,.3),0 0 60px rgba(0,255,65,.1),inset 0 0 30px rgba(0,255,65,.05);
  }
  @keyframes slideDown{from{opacity:0;transform:translateY(-15px)}}

  .terminal-bar{
    display:flex;align-items:center;gap:8px;
    padding:9px 12px;
    background:rgba(0,0,0,.9);
    border-bottom:1px solid var(--line-2);
  }
  .terminal-bar .dots{display:flex;gap:6px}
  .terminal-bar .dots span{
    width:11px;height:11px;
    border-radius:50%;
    border:1px solid rgba(0,0,0,.5);
  }
  .terminal-bar .dots span:nth-child(1){background:#ff5f57;box-shadow:0 0 6px #ff5f57}
  .terminal-bar .dots span:nth-child(2){background:#febc2e;box-shadow:0 0 6px #febc2e}
  .terminal-bar .dots span:nth-child(3){background:#28c840;box-shadow:0 0 6px #28c840}
  .terminal-bar .title{
    flex:1;font-size:10.5px;
    color:var(--txt-2);
    text-align:center;
    letter-spacing:.5px;
    text-shadow:0 0 6px var(--green);
  }
  .terminal-bar .title .cursor{
    display:inline-block;
    width:7px;height:12px;
    background:var(--green);
    margin-left:3px;
    animation:blink 1s step-end infinite;
    vertical-align:middle;
    box-shadow:0 0 8px var(--green);
  }
  @keyframes blink{0%,50%{opacity:1}51%,100%{opacity:0}}
  .terminal-bar .rec{
    display:flex;align-items:center;gap:5px;
    font-size:9px;color:var(--red);
    font-weight:900;letter-spacing:1.5px;
  }
  .terminal-bar .rec .dot{
    width:7px;height:7px;
    background:var(--red);border-radius:50%;
    box-shadow:0 0 8px var(--red);
    animation:recPulse 1s ease-in-out infinite;
  }
  @keyframes recPulse{0%,100%{opacity:1}50%{opacity:.2}}

  .terminal-body{
    padding:14px 16px;
    display:flex;align-items:center;gap:12px;
  }
  .ascii-avatar{
    width:56px;height:56px;
    flex-shrink:0;
    display:grid;place-items:center;
    font-family:monospace;
    color:var(--green);
    text-shadow:0 0 6px var(--green);
    border:1.5px solid var(--green);
    background:rgba(0,255,65,.05);
    border-radius:4px;
    overflow:hidden;
    animation:avatarGlow 2s ease-in-out infinite;
  }
  @keyframes avatarGlow{
    0%,100%{box-shadow:0 0 15px rgba(0,255,65,.4), inset 0 0 15px rgba(0,255,65,.1)}
    50%{box-shadow:0 0 30px rgba(0,255,65,.8), inset 0 0 20px rgba(0,255,65,.2)}
  }
  .ascii-avatar .face{
    animation:faceBlink 4s steps(1) infinite;
    white-space:pre;font-size:6.5px;font-weight:900;
  }
  @keyframes faceBlink{0%,92%{opacity:1}93%,97%{opacity:.3}98%,100%{opacity:1}}

  .terminal-info{flex:1;min-width:0}
  .terminal-name{
    font-size:14px;font-weight:900;
    letter-spacing:.5px;
    color:var(--green);
    text-shadow:0 0 10px var(--green),0 0 20px rgba(0,255,65,.5);
    line-height:1.2;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
  .terminal-name .prompt{color:var(--txt-2);margin-right:2px}
  .terminal-name .typed{
    display:inline-block;
    overflow:hidden;white-space:nowrap;
    animation:typing 4s steps(20) infinite;
    vertical-align:bottom;
  }
  @keyframes typing{0%,10%{width:0}60%,90%{width:100%}100%{width:100%}}

  .terminal-sub{
    display:flex;align-items:center;gap:6px;
    font-size:9.5px;color:var(--muted);
    margin-top:5px;letter-spacing:1px;
    text-transform:uppercase;
  }
  .terminal-sub .online{
    color:var(--green);
    display:inline-flex;align-items:center;gap:4px;
  }
  .terminal-sub .online::before{
    content:'';width:6px;height:6px;
    background:var(--green);border-radius:50%;
    box-shadow:0 0 8px var(--green);
    animation:recPulse 1.5s ease-in-out infinite;
  }
  .terminal-stats{
    display:flex;flex-direction:column;align-items:flex-end;
    gap:3px;flex-shrink:0;
  }
  .terminal-stats .num{
    font-size:18px;font-weight:900;
    color:var(--green);line-height:1;
    text-shadow:0 0 12px var(--green);
  }
  .terminal-stats .lbl{
    font-size:8px;color:var(--muted);
    letter-spacing:1.5px;text-transform:uppercase;
  }

  /* SYSTEM MONITOR */
  .sys-monitor{
    display:grid;
    grid-template-columns:repeat(4,1fr);
    gap:6px;
    animation:slideDown .6s cubic-bezier(.2,.9,.3,1.1) .08s backwards;
  }
  .sys-item{
    background:rgba(2,10,2,.85);
    border:1px solid var(--line-2);
    border-radius:4px;
    padding:8px 6px;
    position:relative;overflow:hidden;
    text-align:center;
  }
  .sys-item::before{
    content:'';position:absolute;
    top:0;left:0;right:0;height:1px;
    background:linear-gradient(90deg, transparent, var(--green), transparent);
    opacity:.6;
  }
  .sys-item .s-lbl{
    font-size:7px;color:var(--muted);
    letter-spacing:1.3px;text-transform:uppercase;
    margin-bottom:4px;font-weight:800;
  }
  .sys-item .s-val{
    font-size:11.5px;font-weight:900;
    color:var(--green);line-height:1;
    letter-spacing:-.3px;
    text-shadow:0 0 6px rgba(0,255,65,.5);
  }
  .sys-item .s-bar{
    width:100%;height:2px;
    background:rgba(0,255,65,.1);
    border-radius:1px;margin-top:5px;
    overflow:hidden;position:relative;
  }
  .sys-item .s-bar::after{
    content:'';position:absolute;
    top:0;left:0;height:100%;
    background:var(--green);
    box-shadow:0 0 6px var(--green);
    width:var(--w,70%);
    animation:barPulse 3s ease-in-out infinite;
  }
  @keyframes barPulse{0%,100%{width:var(--w,70%)}50%{width:calc(var(--w,70%) + 10%)}}

  /* MAIN CARD */
  .card{
    width:100%;
    background:linear-gradient(180deg, #020a02 0%, #000000 100%);
    border:1.5px solid var(--green);
    border-radius:6px;
    padding:22px 18px 20px;
    position:relative;overflow:hidden;
    animation:slideDown .7s cubic-bezier(.2,.9,.3,1.1) .15s backwards;
    box-shadow:0 0 40px rgba(0,255,65,.2),0 0 80px rgba(0,255,65,.08),inset 0 0 40px rgba(0,255,65,.03);
  }
  .card::before{
    content:'>';position:absolute;
    top:6px;left:12px;
    color:var(--green);font-size:14px;font-weight:900;
    text-shadow:0 0 8px var(--green);
    animation:blink 1s step-end infinite;
  }
  .card::after{
    content:'_';position:absolute;
    top:6px;left:24px;
    color:var(--green);font-size:14px;font-weight:900;
    text-shadow:0 0 8px var(--green);
    animation:blink 1s step-end infinite reverse;
  }

  .access-badge{
    position:absolute;
    top:16px;right:18px;
    display:flex;align-items:center;gap:5px;
    padding:5px 10px;
    background:rgba(0,255,65,.1);
    border:1px solid var(--green);
    border-radius:4px;
    font-size:9px;color:var(--green);
    font-weight:900;letter-spacing:1.5px;
    text-transform:uppercase;
    box-shadow:0 0 15px rgba(0,255,65,.4);
    animation:accessPulse 2s ease-in-out infinite;
  }
  @keyframes accessPulse{
    0%,100%{box-shadow:0 0 15px rgba(0,255,65,.4)}
    50%{box-shadow:0 0 25px rgba(0,255,65,.8)}
  }
  .access-badge .lock{
    width:8px;height:8px;
    background:var(--green);
    box-shadow:0 0 6px var(--green);
    border-radius:2px;
  }

  /* SECTION HEAD */
  .sec{
    display:flex;align-items:center;gap:12px;
    margin-bottom:18px;
    position:relative;padding-top:18px;
  }
  .sec-icon{
    width:52px;height:52px;
    border:1.5px solid var(--green);
    border-radius:4px;
    background:rgba(0,255,65,.05);
    display:grid;place-items:center;
    flex-shrink:0;position:relative;
    box-shadow:0 0 20px rgba(0,255,65,.4),inset 0 0 15px rgba(0,255,65,.1);
    animation:secIconPulse 2s ease-in-out infinite;
  }
  @keyframes secIconPulse{
    0%,100%{box-shadow:0 0 20px rgba(0,255,65,.4), inset 0 0 15px rgba(0,255,65,.1)}
    50%{box-shadow:0 0 35px rgba(0,255,65,.8), inset 0 0 20px rgba(0,255,65,.2)}
  }
  .sec-icon svg{
    width:26px;height:26px;
    stroke:var(--green);stroke-width:2;
    fill:none;stroke-linecap:round;stroke-linejoin:round;
    filter:drop-shadow(0 0 8px var(--green));
  }
  .sec-icon::after{
    content:'';position:absolute;
    bottom:-2px;right:-2px;
    width:10px;height:10px;
    background:var(--green);border-radius:2px;
    box-shadow:0 0 10px var(--green);
    animation:recPulse 1.5s ease-in-out infinite;
  }
  .sec-info{flex:1;min-width:0}
  .sec-cmd{
    font-size:9px;color:var(--muted);
    letter-spacing:1.2px;margin-bottom:3px;
    text-transform:uppercase;
  }
  .sec-cmd .dollar{color:var(--green);text-shadow:0 0 6px var(--green)}
  .sec-title{
    font-size:20px;font-weight:900;
    letter-spacing:-.3px;line-height:1.1;
    color:var(--green);
    text-shadow:0 0 15px rgba(0,255,65,.6);
  }
  .sec-desc{
    font-size:10.5px;color:var(--txt-2);
    margin-top:5px;letter-spacing:.2px;
    line-height:1.4;opacity:.7;
  }

  /* FIELD */
  .field{margin-bottom:18px}
  .field-label{
    display:flex;align-items:center;justify-content:space-between;
    margin-bottom:10px;padding:0 2px;
  }
  .field-label .left{
    display:flex;align-items:center;gap:8px;
    font-size:10.5px;color:var(--txt-2);
    letter-spacing:1.2px;text-transform:uppercase;
    font-weight:800;
  }
  .field-label .num-badge{
    color:var(--green);font-weight:900;
    font-size:11px;text-shadow:0 0 6px var(--green);
  }
  .field-label .req{
    padding:3px 8px;
    background:rgba(255,0,51,.1);
    border:1px solid rgba(255,0,51,.5);
    border-radius:3px;
    font-size:8px;color:var(--red);
    font-weight:900;letter-spacing:1.2px;
    text-shadow:0 0 6px rgba(255,0,51,.5);
  }

  .input-box{
    display:flex;align-items:center;
    background:rgba(0,0,0,.7);
    border:1.5px solid var(--line-2);
    border-radius:4px;
    padding:2px;
    transition:all .25s;
    position:relative;overflow:hidden;
  }
  .input-box::before{
    content:'>';position:absolute;
    left:6px;top:50%;transform:translateY(-50%);
    color:var(--green);font-size:12px;font-weight:900;
    text-shadow:0 0 6px var(--green);
    z-index:1;
    animation:blink 1.5s step-end infinite;
    pointer-events:none;
  }
  .input-box:focus-within{
    border-color:var(--green);
    background:rgba(0,255,65,.03);
    box-shadow:0 0 0 3px rgba(0,255,65,.1),0 0 25px rgba(0,255,65,.4),inset 0 0 20px rgba(0,255,65,.05);
  }
  .cc-box{
    display:flex;align-items:center;gap:6px;
    padding:0 10px 0 20px;
    height:50px;
    border-right:1px solid var(--line-2);
    flex-shrink:0;
  }
  .cc-box .flag{font-size:14px}
  .cc-box .code{
    font-size:14px;font-weight:900;
    color:var(--green);
    text-shadow:0 0 8px var(--green);
    letter-spacing:.3px;
  }
  #phone{
    flex:1;background:transparent;
    border:0;outline:none;
    color:var(--txt);
    font-size:15.5px;font-weight:700;
    padding:14px 12px;
    letter-spacing:1.2px;
    font-family:ui-monospace,monospace;
    min-width:0;
    caret-color:var(--green);
  }
  #phone::placeholder{
    color:var(--muted);font-weight:400;
    font-size:12.5px;letter-spacing:.2px;
  }
  .clr{
    display:none;
    width:30px;height:30px;
    border-radius:3px;
    background:rgba(255,0,51,.15);
    border:1px solid rgba(255,0,51,.5);
    color:var(--red);
    font-size:12px;font-weight:900;
    margin-right:8px;
    cursor:pointer;
    align-items:center;justify-content:center;
    flex-shrink:0;transition:all .2s;
  }
  .clr.show{display:flex}
  .clr:active{background:rgba(255,0,51,.35);transform:scale(.92)}

  .hint{
    display:flex;align-items:center;gap:6px;
    font-size:10px;color:var(--muted);
    margin-top:9px;padding:0 2px;letter-spacing:.3px;
  }
  .hint svg{
    width:12px;height:12px;
    stroke:var(--green);stroke-width:2;
    fill:none;flex-shrink:0;
    filter:drop-shadow(0 0 4px var(--green));
  }
  .hint code{
    color:var(--green);font-weight:900;
    padding:2px 6px;
    background:rgba(0,255,65,.08);
    border:1px solid rgba(0,255,65,.3);
    border-radius:3px;
    font-size:10px;
    text-shadow:0 0 4px var(--green);
  }

  /* SHARED BUTTON STYLE */
  .btn-wrap{position:relative;width:100%;margin-bottom:12px}

  .hx-btn{
    width:100%;
    padding:18px 24px;
    border:2px solid var(--green);
    border-radius:4px;
    color:var(--green);
    font-family:ui-monospace,monospace;
    font-weight:900;
    font-size:15px;
    letter-spacing:2.5px;
    text-transform:uppercase;
    cursor:pointer;
    display:flex;align-items:center;justify-content:center;gap:10px;
    position:relative;overflow:hidden;
    background:rgba(0,255,65,.08);
    box-shadow:0 0 30px rgba(0,255,65,.4),inset 0 0 20px rgba(0,255,65,.1),inset 0 0 0 1px rgba(0,255,65,.2);
    transition:all .25s cubic-bezier(.2,.9,.3,1.2);
    text-shadow:0 0 8px var(--green);
    animation:btnGlow 3s ease-in-out infinite;
    text-decoration:none;
  }
  @keyframes btnGlow{
    0%,100%{box-shadow:0 0 30px rgba(0,255,65,.4), inset 0 0 20px rgba(0,255,65,.1), inset 0 0 0 1px rgba(0,255,65,.2)}
    50%{box-shadow:0 0 50px rgba(0,255,65,.7), inset 0 0 25px rgba(0,255,65,.15), inset 0 0 0 1px rgba(0,255,65,.3)}
  }
  .hx-btn::before{
    content:'';position:absolute;
    top:0;left:0;right:0;bottom:0;
    background:repeating-linear-gradient(0deg,transparent 0,transparent 2px,rgba(0,255,65,.05) 2px,rgba(0,255,65,.05) 3px);
    pointer-events:none;
  }
  .hx-btn::after{
    content:'';position:absolute;
    top:0;left:-100%;
    width:40%;height:100%;
    background:linear-gradient(90deg, transparent, rgba(0,255,65,.5), transparent);
    animation:btnShine 3s ease-in-out infinite;
    pointer-events:none;
  }
  @keyframes btnShine{0%,100%{left:-100%}50%,60%{left:150%}}

  .hx-btn:hover{
    transform:translateY(-2px);
    background:rgba(0,255,65,.15);
    color:#fff;
    box-shadow:0 0 60px rgba(0,255,65,.9),0 0 100px rgba(0,255,65,.4),inset 0 0 30px rgba(0,255,65,.2);
    text-shadow:0 0 12px var(--green),0 0 24px var(--green);
  }
  .hx-btn:active{transform:translateY(0) scale(.98)}
  .hx-btn:disabled{opacity:.5;cursor:not-allowed;animation-play-state:paused}

  .hx-btn .spinner{
    width:18px;height:18px;
    border:2.5px solid rgba(0,255,65,.25);
    border-top-color:var(--green);
    border-radius:50%;
    animation:spin .7s linear infinite;
    display:none;
  }
  .hx-btn.loading .spinner{display:block}
  @keyframes spin{to{transform:rotate(360deg)}}

  .hx-btn .arrow{
    display:inline-flex;align-items:center;justify-content:center;
    width:22px;height:22px;
    transition:transform .3s;
  }
  .hx-btn:hover .arrow{transform:translateX(5px)}
  .hx-btn .arrow svg{
    width:18px;height:18px;
    stroke:currentColor;stroke-width:3;
    fill:none;stroke-linecap:round;stroke-linejoin:round;
  }
  .hx-btn svg.lead-icon{
    width:20px;height:20px;
    fill:currentColor;
    flex-shrink:0;
    filter:drop-shadow(0 0 6px var(--green));
  }
  /* sound toggle inside button */
  .sound-toggle{
    position:absolute;
    top:50%;right:14px;
    transform:translateY(-50%);
    width:28px;height:28px;
    border-radius:4px;
    background:rgba(0,255,65,.1);
    border:1.5px solid var(--green);
    display:grid;place-items:center;
    cursor:pointer;
    transition:all .2s;
    z-index:3;
    box-shadow:0 0 10px rgba(0,255,65,.4);
  }
  .sound-toggle:active{
    background:rgba(0,255,65,.25);
    transform:translateY(-50%) scale(.95);
  }
  .sound-toggle svg{
    width:13px;height:13px;
    stroke:var(--green);stroke-width:2.5;
    fill:var(--green);
    filter:drop-shadow(0 0 4px var(--green));
  }
  .sound-toggle.muted svg .wave{opacity:0}
  .sound-toggle.muted::after{
    content:'';position:absolute;
    width:20px;height:2px;
    background:var(--green);
    transform:rotate(-45deg);
    box-shadow:0 0 6px var(--green);
  }

  /* shockwave */
  .shockwave{
    position:absolute;
    top:50%;left:50%;
    width:20px;height:20px;
    border:3px solid var(--green);
    border-radius:50%;
    transform:translate(-50%,-50%) scale(0);
    pointer-events:none;opacity:0;z-index:1;
    box-shadow:0 0 20px var(--green);
  }
  .shockwave.active{animation:shockwaveAnim .7s ease-out}
  @keyframes shockwaveAnim{
    0%{transform:translate(-50%,-50%) scale(0);opacity:1;border-width:4px}
    100%{transform:translate(-50%,-50%) scale(30);opacity:0;border-width:1px}
  }

  /* PROGRESS */
  .progress-wrap{
    margin-top:14px;
    opacity:0;max-height:0;overflow:hidden;
    transition:opacity .3s, max-height .3s;
  }
  .progress-wrap.active{opacity:1;max-height:60px}
  .progress-meta{
    display:flex;align-items:center;justify-content:space-between;
    font-size:10px;letter-spacing:1.2px;
    text-transform:uppercase;
    color:var(--muted);font-weight:800;
    margin-bottom:8px;
  }
  .progress-meta .pct{
    color:var(--green);font-weight:900;
    text-shadow:0 0 8px var(--green);
  }
  .progress-bar{
    width:100%;height:6px;
    background:rgba(0,0,0,.8);
    border-radius:2px;overflow:hidden;
    position:relative;
    border:1px solid var(--line-2);
  }
  .progress-bar .fill{
    height:100%;
    background:linear-gradient(90deg, var(--green-dark), var(--green), var(--lime));
    box-shadow:0 0 15px var(--green),0 0 30px rgba(0,255,65,.6);
    transition:width .3s ease;
    width:0%;position:relative;
  }
  .progress-bar .fill::after{
    content:'';position:absolute;
    top:0;right:0;width:20px;height:100%;
    background:linear-gradient(90deg,transparent,#fff);
    filter:blur(3px);
  }

  /* TRUST */
  .trust{
    display:flex;align-items:center;justify-content:space-around;
    gap:8px;margin-top:18px;padding-top:16px;
    border-top:1px dashed var(--line-2);
  }
  .trust-item{
    display:flex;align-items:center;gap:6px;
    font-size:10px;color:var(--txt-2);
    letter-spacing:.5px;font-weight:700;
  }
  .trust-item svg{
    width:14px;height:14px;
    stroke:var(--green);stroke-width:2.2;
    fill:none;stroke-linecap:round;stroke-linejoin:round;
    filter:drop-shadow(0 0 5px var(--green));
  }

  /* RESULT */
  .result{
    display:none;margin-top:18px;
    background:linear-gradient(135deg, rgba(0,255,65,.06), rgba(0,255,170,.03));
    border:1.5px solid var(--green);
    border-radius:6px;
    padding:20px 18px 16px;
    position:relative;overflow:hidden;
    animation:popIn .5s cubic-bezier(.2,.9,.3,1.4);
    box-shadow:0 0 40px rgba(0,255,65,.3),inset 0 1px 0 rgba(0,255,65,.2);
  }
  .result.show{display:block}
  @keyframes popIn{from{opacity:0;transform:scale(.94) translateY(8px)}}
  .result::before{
    content:'>';position:absolute;
    top:8px;left:10px;
    color:var(--green);font-weight:900;
    text-shadow:0 0 8px var(--green);
    animation:blink 1s step-end infinite;
  }
  .result-head{
    display:flex;align-items:center;justify-content:space-between;
    margin-bottom:16px;padding-left:16px;
  }
  .result-tag{
    display:flex;align-items:center;gap:7px;
    font-size:10px;font-weight:900;
    color:var(--green);letter-spacing:1.5px;
    text-transform:uppercase;
    text-shadow:0 0 8px var(--green);
  }
  .result-tag .dot{
    width:7px;height:7px;
    background:var(--green);border-radius:50%;
    box-shadow:0 0 10px var(--green);
    animation:recPulse 1.2s ease-in-out infinite;
  }
  .timer-circle{
    position:relative;
    width:48px;height:48px;
    display:grid;place-items:center;
    flex-shrink:0;
  }
  .timer-circle svg{
    position:absolute;inset:0;
    width:100%;height:100%;
    transform:rotate(-90deg);
  }
  .timer-circle svg circle{fill:none;stroke-width:3}
  .timer-circle .bg{stroke:rgba(0,255,65,.15)}
  .timer-circle .fg{
    stroke:var(--green);stroke-linecap:round;
    stroke-dasharray:113;stroke-dashoffset:0;
    transition:stroke-dashoffset 1s linear;
    filter:drop-shadow(0 0 6px var(--green));
  }
  .timer-circle .txt{
    font-size:12px;font-weight:900;
    color:var(--green);
    text-shadow:0 0 8px var(--green);
    position:relative;z-index:1;
  }
  .code-val{
    font-size:clamp(24px,8vw,32px);
    font-weight:900;
    letter-spacing:clamp(3px,1.6vw,8px);
    text-align:center;line-height:1.2;
    word-break:break-all;
    padding:12px 0 12px clamp(3px,1.6vw,8px);
    font-variant-numeric:tabular-nums;
    color:var(--green);
    text-shadow:0 0 10px var(--green),0 0 20px rgba(0,255,65,.6),0 0 40px rgba(0,255,65,.3);
    font-family:ui-monospace,monospace;
    animation:codeFlicker 3s steps(1) infinite;
  }
  @keyframes codeFlicker{
    0%,90%{opacity:1}
    91%,93%{opacity:.6}
    94%,100%{opacity:1}
  }
  .res-actions{display:flex;gap:10px;margin-top:16px}
  .res-actions button{
    flex:1;padding:12px;
    background:rgba(0,255,65,.05);
    border:1.5px solid var(--line-2);
    border-radius:4px;
    color:var(--txt-2);
    font-family:ui-monospace,monospace;
    font-size:11px;font-weight:800;
    letter-spacing:1.2px;text-transform:uppercase;
    cursor:pointer;transition:all .2s;
    display:flex;align-items:center;justify-content:center;gap:7px;
  }
  .res-actions button svg{
    width:14px;height:14px;
    stroke:currentColor;stroke-width:2.5;
    fill:none;stroke-linecap:round;stroke-linejoin:round;
  }
  .res-actions button:active{transform:scale(.97)}
  .res-actions .copy{
    background:rgba(0,255,65,.1);
    border-color:rgba(0,255,65,.5);
    color:var(--green);
    text-shadow:0 0 6px var(--green);
  }
  .res-actions .copy:active{
    background:rgba(0,255,65,.25);
    box-shadow:0 0 20px rgba(0,255,65,.6);
  }
  .res-actions button.copied{
    background:var(--green);color:#000;
    border-color:var(--green);
    box-shadow:0 0 28px var(--green);
    text-shadow:none;
  }

  /* STEPS */
  .steps{
    margin-top:18px;padding-top:18px;
    border-top:1px dashed var(--line-2);
    display:grid;gap:12px;
  }
  .steps-head{
    display:flex;align-items:center;justify-content:space-between;
    font-size:10.5px;font-weight:900;
    color:var(--green);letter-spacing:1.5px;
    text-transform:uppercase;margin-bottom:4px;
    text-shadow:0 0 8px var(--green);
  }
  .steps-head .left{
    display:flex;align-items:center;gap:8px;
  }
  .steps-head svg{
    width:14px;height:14px;
    stroke:var(--green);stroke-width:2.5;
    fill:none;
    filter:drop-shadow(0 0 6px var(--green));
  }
  .steps-head .count{font-size:10px;color:var(--muted)}
  .step{
    display:flex;gap:10px;align-items:flex-start;
    font-size:12px;color:var(--txt-2);
    line-height:1.5;letter-spacing:.2px;
  }
  .step .n{
    flex-shrink:0;
    width:26px;height:26px;
    border-radius:4px;
    display:grid;place-items:center;
    font-size:11px;font-weight:900;
    border:1.5px solid;
    font-family:ui-monospace,monospace;
  }
  .step:nth-child(2) .n{color:var(--green);background:rgba(0,255,65,.08);border-color:rgba(0,255,65,.5);box-shadow:0 0 8px rgba(0,255,65,.3)}
  .step:nth-child(3) .n{color:var(--lime);background:rgba(125,255,0,.08);border-color:rgba(125,255,0,.5);box-shadow:0 0 8px rgba(125,255,0,.3)}
  .step:nth-child(4) .n{color:var(--mint);background:rgba(0,255,170,.08);border-color:rgba(0,255,170,.5);box-shadow:0 0 8px rgba(0,255,170,.3)}
  .step:nth-child(5) .n{color:var(--amber);background:rgba(255,176,0,.08);border-color:rgba(255,176,0,.5);box-shadow:0 0 8px rgba(255,176,0,.3)}
  .step b{color:var(--green);font-weight:800;text-shadow:0 0 6px var(--green)}

  /* ALERT */
  .alert{
    display:none;margin-top:16px;
    padding:13px 15px;
    font-size:11.5px;line-height:1.5;
    align-items:center;gap:10px;
    border-radius:4px;
    border:1.5px solid;
    font-weight:700;
    animation:popIn .3s ease;
    font-family:ui-monospace,monospace;
  }
  .alert.show{display:flex}
  .alert.error{
    background:rgba(255,0,51,.1);
    border-color:rgba(255,0,51,.6);
    color:#ff6688;
    box-shadow:0 0 20px rgba(255,0,51,.3);
    text-shadow:0 0 6px rgba(255,0,51,.5);
  }
  .alert.success{
    background:rgba(0,255,65,.08);
    border-color:rgba(0,255,65,.6);
    color:var(--green);
    box-shadow:0 0 20px rgba(0,255,65,.4);
    text-shadow:0 0 6px var(--green);
  }
  .alert .ic{
    width:22px;height:22px;
    flex-shrink:0;display:grid;place-items:center;
  }
  .alert .ic svg{
    width:18px;height:18px;
    stroke:currentColor;stroke-width:2.5;
    fill:none;stroke-linecap:round;stroke-linejoin:round;
  }

  /* TOAST */
  .toast-container{
    position:fixed;top:20px;left:50%;
    transform:translateX(-50%);
    z-index:100;
    display:flex;flex-direction:column;gap:10px;
    pointer-events:none;
    width:calc(100% - 32px);max-width:400px;
  }
  .toast{
    display:flex;align-items:center;gap:12px;
    padding:12px 14px;
    background:rgba(2,10,2,.98);
    border:1.5px solid var(--green);
    border-radius:4px;
    box-shadow:0 0 40px rgba(0,255,65,.5),0 10px 30px rgba(0,0,0,.8);
    animation:toastIn .4s cubic-bezier(.2,.9,.3,1.5);
    pointer-events:auto;
    font-family:ui-monospace,monospace;
  }
  .toast.leaving{animation:toastOut .35s ease forwards}
  @keyframes toastIn{from{opacity:0;transform:translateY(-20px) scale(.9)}}
  @keyframes toastOut{to{opacity:0;transform:translateY(-20px) scale(.9)}}
  .toast-icon{
    width:34px;height:34px;
    border-radius:4px;
    background:rgba(0,255,65,.15);
    border:1.5px solid var(--green);
    display:grid;place-items:center;
    flex-shrink:0;
    box-shadow:0 0 15px rgba(0,255,65,.5);
  }
  .toast-icon svg{
    width:16px;height:16px;
    stroke:var(--green);stroke-width:2.5;
    fill:none;filter:drop-shadow(0 0 4px var(--green));
  }
  .toast-body{flex:1;min-width:0}
  .toast-title{
    font-size:11.5px;font-weight:900;
    color:var(--green);letter-spacing:.8px;
    text-transform:uppercase;
    text-shadow:0 0 6px var(--green);
  }
  .toast-desc{
    font-size:10.5px;color:var(--txt-2);
    margin-top:3px;
  }

  /* CONFETTI */
  .confetti{
    position:fixed;
    width:8px;height:8px;
    z-index:200;pointer-events:none;
    font-size:10px;
    font-family:ui-monospace,monospace;
    color:var(--green);
    text-shadow:0 0 8px var(--green);
    background:transparent;
    display:grid;place-items:center;
  }

  /* FOOTER */
  .footer{
    width:100%;
    display:flex;flex-direction:column;align-items:center;gap:12px;
    animation:slideDown .5s ease .35s backwards;
  }
  .footer-meta{
    display:flex;align-items:center;gap:12px;
    font-size:9.5px;color:var(--muted);
    letter-spacing:.5px;font-weight:700;
    flex-wrap:wrap;justify-content:center;
  }
  .footer-meta .val{
    display:inline-flex;align-items:center;gap:5px;
  }
  .footer-meta .val svg{
    width:12px;height:12px;
    stroke:var(--green);stroke-width:2.2;
    fill:none;stroke-linecap:round;
    filter:drop-shadow(0 0 4px var(--green));
  }
  .footer-meta .sep{
    color:var(--green);
    text-shadow:0 0 6px var(--green);
    font-weight:900;
  }

  @media (max-height:820px){
    .card{padding:20px 16px 18px}
    .sec-title{font-size:18px}
    .hx-btn{padding:16px 20px;font-size:14px}
    .terminal-body{padding:12px 14px}
    .ascii-avatar{width:48px;height:48px}
    .ascii-avatar .face{font-size:6px}
  }
  @media (max-height:700px){
    .hint{display:none}
    .sec-desc{display:none}
    .trust{display:none}
    .terminal-body{padding:10px 12px}
    .sys-item{padding:7px 5px}
    .sys-item .s-val{font-size:10.5px}
  }
</style>
</head>
<body>

<!-- MATRIX CANVAS -->
<canvas id="matrixCanvas"></canvas>
<div class="crt-scan"></div>
<div class="crt-flicker"></div>
<div class="vignette"></div>

<div class="wrap">

  <!-- HEADER -->
  <div class="terminal-header">
    <div class="terminal-bar">
      <div class="dots"><span></span><span></span><span></span></div>
      <div class="title">root@md-ghani:/home<span class="cursor"></span></div>
      <div class="rec"><span class="dot"></span>REC</div>
    </div>
    <div class="terminal-body">
      <div class="ascii-avatar">
        <div class="face">┌─────┐
│ ■ ■ │
│ ─── │
│  ▼  │
└─────┘</div>
      </div>
      <div class="terminal-info">
        <div class="terminal-name">
          <span class="prompt">$</span>
          <span class="typed">H4CK3R_M0D3</span>
        </div>
        <div class="terminal-sub">
          <span class="online">online</span>• v1.0.0
        </div>
      </div>
      <div class="terminal-stats">
        <div class="num">147</div>
        <div class="lbl">Wins</div>
      </div>
    </div>
  </div>

  <!-- SYSTEM MONITOR -->
  <div class="sys-monitor">
    <div class="sys-item">
      <div class="s-lbl">PING</div>
      <div class="s-val" id="statPing">24ms</div>
      <div class="s-bar" style="--w:80%"></div>
    </div>
    <div class="sys-item">
      <div class="s-lbl">LOAD</div>
      <div class="s-val" id="statLoad">12%</div>
      <div class="s-bar" style="--w:30%"></div>
    </div>
    <div class="sys-item">
      <div class="s-lbl">CPU</div>
      <div class="s-val" id="statCpu">8%</div>
      <div class="s-bar" style="--w:15%"></div>
    </div>
    <div class="sys-item">
      <div class="s-lbl">RAM</div>
      <div class="s-val" id="statRam">42%</div>
      <div class="s-bar" style="--w:42%"></div>
    </div>
  </div>

  <!-- MAIN CARD -->
  <div class="card">

    <div class="access-badge">
      <span class="lock"></span>
      ACCESS
    </div>

    <div class="sec">
      <div class="sec-icon">
        <svg viewBox="0 0 24 24">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
      </div>
      <div class="sec-info">
        <div class="sec-cmd"><span class="dollar">$</span> sudo ./deploy.sh</div>
        <div class="sec-title">PAIRING_CODE</div>
        <div class="sec-desc">&gt; initializing secure tunnel...</div>
      </div>
    </div>

    <div class="field">
      <div class="field-label">
        <div class="left">
          <span class="num-badge">&gt;_ 01</span>
          Target Number
        </div>
        <span class="req">REQUIRED</span>
      </div>
      <div class="input-box">
        <div class="cc-box">
          <span class="flag">🌐</span>
          <span class="code" id="ccText">+</span>
        </div>
        <input id="phone" type="tel" inputmode="numeric" autocomplete="tel"
               placeholder="country code + number" maxlength="15"/>
        <button class="clr" id="clearBtn" type="button" aria-label="Clear">✕</button>
      </div>
      <div class="hint">
        <svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Format: <code>91XXXXXXXXXX</code>
      </div>
    </div>

    <!-- BUTTON #1 : PAIRING CODE -->
    <div class="btn-wrap">
      <button class="hx-btn" id="btn" onclick="pair(event)">
        <span class="spinner"></span>
        <span class="btn-txt">&gt; GET_PAIRING_CODE</span>
        <span class="arrow">
          <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </span>
        <div class="shockwave" id="shockwave1"></div>
      </button>
      <div class="sound-toggle" id="soundToggle" onclick="toggleSound(event)" title="Sound">
        <svg viewBox="0 0 24 24">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path class="wave" d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="currentColor"/>
          <path class="wave" d="M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="currentColor"/>
        </svg>
      </div>
    </div>

    <!-- PROGRESS -->
    <div class="progress-wrap" id="progressWrap">
      <div class="progress-meta">
        <span>&gt; UPLOADING_PAYLOAD</span>
        <span class="pct" id="progressPct">0%</span>
      </div>
      <div class="progress-bar">
        <div class="fill" id="progressFill"></div>
      </div>
    </div>

    <!-- BUTTON #2 : JOIN CHANNEL -->
    <div class="btn-wrap" style="margin-top:18px">
      <a href="https://whatsapp.com/channel/0029Vb8vvB1Fcow4AY0NeC1p"
         onclick="openChannel(event)"
         target="_blank"
         rel="noopener"
         class="hx-btn"
         id="channelBtn">

        <svg class="lead-icon" viewBox="0 0 24 24">
          <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.1-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1.1.1-1.8-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 .9-2.2c.2-.3.5-.4.7-.4h.5c.2 0 .4-.1.6.4.2.5.7 1.8.8 1.9.1.1.1.3 0 .4-.1.2-.2.3-.3.5-.1.2-.3.4-.4.5-.1.1-.3.3-.1.5.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.4.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.2.1 1.5.7 1.8.8.3.1.4.2.5.3.1.2.1.7-.1 1.3z"/>
        </svg>

        <span>&gt; JOIN_CHANNEL</span>

        <span class="arrow">
          <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </span>

        <div class="shockwave" id="shockwave2"></div>
      </a>
    </div>

    <!-- TRUST -->
    <div class="trust">
      <div class="trust-item">
        <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        ENCRYPTED
      </div>
      <div class="trust-item">
        <svg viewBox="0 0 24 24"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        INSTANT
      </div>
      <div class="trust-item">
        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        VERIFIED
      </div>
    </div>

    <!-- RESULT -->
    <div class="result" id="codeBox">
      <div class="result-head">
        <div class="result-tag">
          <span class="dot"></span>
          PAYLOAD_DEPLOYED
        </div>
        <div class="timer-circle">
          <svg viewBox="0 0 44 44">
            <circle class="bg" cx="22" cy="22" r="18"/>
            <circle class="fg" id="timerCircle" cx="22" cy="22" r="18"/>
          </svg>
          <span class="txt" id="countdown">120</span>
        </div>
      </div>
      <div class="code-val" id="out">— — — — — — — —</div>
      <div class="res-actions">
        <button class="copy" id="copyBtn" onclick="copyCode()">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          Copy
        </button>
        <button onclick="resetForm()">
          <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Reset
        </button>
      </div>
    </div>

    <!-- STEPS -->
    <div class="steps" id="steps" style="display:none">
      <div class="steps-head">
        <div class="left">
          <svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          &gt; PROTOCOL_STEPS
        </div>
        <span class="count">[04]</span>
      </div>
      <div class="step"><span class="n">01</span><span>Open <b>WhatsApp</b> on target device</span></div>
      <div class="step"><span class="n">02</span><span>Navigate to <b>Settings → Linked Devices</b></span></div>
      <div class="step"><span class="n">03</span><span>Select <b>Link a Device → Link with phone number</b></span></div>
      <div class="step"><span class="n">04</span><span>Inject the code shown above</span></div>
    </div>

    <!-- ALERT -->
    <div class="alert" id="alert">
      <span class="ic" id="alertIc">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/></svg>
      </span>
      <span id="alertMsg"></span>
    </div>

  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-meta">
      <span class="val">
        <svg viewBox="0 0 24 24"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        FAST
      </span>
      <span class="sep">//</span>
      <span class="val">
        <svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        ALWAYS-ON
      </span>
      <span class="sep">//</span>
      <span class="val">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        MULTI-USER
      </span>
    </div>
  </div>

</div>

<script>
/* MATRIX RAIN */
(function(){
  const canvas = document.getElementById('matrixCanvas');
  const ctx = canvas.getContext('2d');
  let W, H, cols, drops;
  const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF!@#$%&*';
  const fontSize = 14;
  function resize(){
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    cols = Math.floor(W / fontSize);
    drops = Array(cols).fill(1);
  }
  resize();
  window.addEventListener('resize', resize);
  function draw(){
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#00ff41';
    ctx.font = fontSize + 'px monospace';
    for (let i = 0; i < drops.length; i++){
      const text = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(text, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > H && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  }
  setInterval(draw, 60);
})();

/* SOUND ENGINE */
const Sound = {
  ctx: null,
  enabled: true,
  init(){
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch(e){}
  },
  resume(){
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone({freq=440, dur=0.15, type='square', vol=0.3, slide=null, delay=0}){
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide.to, t0 + (slide.time || dur));
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  },
  noise({dur=0.1, vol=0.15, delay=0}){
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const bufferSize = this.ctx.sampleRate * dur;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++){
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(t0);
  },
  click(){
    this.tone({freq: 880, slide:{to: 1760, time: 0.08}, dur: 0.12, type: 'square', vol: 0.25});
    this.tone({freq: 2200, dur: 0.06, type: 'sawtooth', vol: 0.15, delay: 0.05});
    this.noise({dur: 0.08, vol: 0.12});
    this.tone({freq: 180, dur: 0.1, type: 'sine', vol: 0.2});
  },
  type(){
    this.tone({freq: 2000 + Math.random()*600, dur: 0.015, type: 'square', vol: 0.05});
  },
  success(){
    this.tone({freq: 660, dur: 0.1, type: 'square', vol: 0.22});
    this.tone({freq: 880, dur: 0.1, type: 'square', vol: 0.22, delay: 0.09});
    this.tone({freq: 1320, dur: 0.18, type: 'square', vol: 0.22, delay: 0.18});
    this.tone({freq: 1760, dur: 0.25, type: 'triangle', vol: 0.18, delay: 0.28});
  },
  error(){
    this.tone({freq: 220, slide:{to: 110, time: 0.15}, dur: 0.18, type: 'sawtooth', vol: 0.25});
    this.tone({freq: 180, slide:{to: 90, time: 0.15}, dur: 0.18, type: 'square', vol: 0.2, delay: 0.02});
  },
  copy(){
    this.tone({freq: 1200, dur: 0.06, type: 'square', vol: 0.2});
    this.tone({freq: 1800, dur: 0.08, type: 'square', vol: 0.18, delay: 0.06});
  },
  toggleOn(){
    this.tone({freq: 660, dur: 0.06, type: 'sine', vol: 0.2});
    this.tone({freq: 990, dur: 0.08, type: 'sine', vol: 0.2, delay: 0.06});
  },
  toggleOff(){
    this.tone({freq: 660, dur: 0.06, type: 'sine', vol: 0.2});
    this.tone({freq: 330, dur: 0.08, type: 'sine', vol: 0.2, delay: 0.06});
  },
  tick(){ this.tone({freq: 1600, dur: 0.02, type: 'square', vol: 0.08}); },
  hack(){
    this.tone({freq: 1400, dur: 0.04, type: 'square', vol: 0.12});
    this.tone({freq: 2100, dur: 0.04, type: 'square', vol: 0.1, delay: 0.05});
    this.tone({freq: 1400, dur: 0.04, type: 'square', vol: 0.12, delay: 0.1});
  }
};

const soundToggle = document.getElementById('soundToggle');
function toggleSound(e){
  e.stopPropagation();
  Sound.resume();
  Sound.enabled = !Sound.enabled;
  soundToggle.classList.toggle('muted', !Sound.enabled);
  if (Sound.enabled) Sound.toggleOn(); else Sound.toggleOff();
}
['click','touchstart','keydown'].forEach(evt => {
  document.addEventListener(evt, () => Sound.resume(), {once:true, passive:true});
});

/* Elements */
const phoneEl       = document.getElementById('phone');
const btn           = document.getElementById('btn');
const btnTxt        = btn.querySelector('.btn-txt');
const outEl         = document.getElementById('out');
const codeBox       = document.getElementById('codeBox');
const stepsEl       = document.getElementById('steps');
const alertEl       = document.getElementById('alert');
const alertMsg      = document.getElementById('alertMsg');
const alertIc       = document.getElementById('alertIc');
const clearBtn      = document.getElementById('clearBtn');
const ccText        = document.getElementById('ccText');
const statPing      = document.getElementById('statPing');
const statLoad      = document.getElementById('statLoad');
const statCpu       = document.getElementById('statCpu');
const statRam       = document.getElementById('statRam');
const progressWrap  = document.getElementById('progressWrap');
const progressFill  = document.getElementById('progressFill');
const progressPct   = document.getElementById('progressPct');
const countdownEl   = document.getElementById('countdown');
const timerCircle   = document.getElementById('timerCircle');
const shockwave1    = document.getElementById('shockwave1');
const shockwave2    = document.getElementById('shockwave2');

const ICON_ERR = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/></svg>';
const ICON_OK  = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>';

let currentCode = '';
let countdownTimer = null;
let progressTimer = null;

setInterval(() => {
  statPing.textContent = (18 + Math.floor(Math.random() * 14)) + 'ms';
  statLoad.textContent = (8 + Math.floor(Math.random() * 12)) + '%';
  statCpu.textContent  = (5 + Math.floor(Math.random() * 15)) + '%';
  statRam.textContent  = (35 + Math.floor(Math.random() * 20)) + '%';
}, 2500);

function showToast(title, desc){
  const container = document.querySelector('.toast-container') || (() => {
    const c = document.createElement('div');
    c.className = 'toast-container';
    document.body.appendChild(c);
    return c;
  })();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = \`
    <div class="toast-icon"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
    <div class="toast-body">
      <div class="toast-title">&gt; \${title}</div>
      <div class="toast-desc">\${desc}</div>
    </div>
  \`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}

function blastConfetti(){
  const chars = ['0','1','>','_','#','$','@','!','%','&','*'];
  for (let i = 0; i < 50; i++){
    const c = document.createElement('div');
    c.className = 'confetti';
    c.textContent = chars[Math.floor(Math.random() * chars.length)];
    c.style.left = '50%';
    c.style.top = '50%';
    const angle = Math.random() * Math.PI * 2;
    const distance = 100 + Math.random() * 280;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    const rot = Math.random() * 720 - 360;
    c.style.transform = 'translate(-50%,-50%)';
    document.body.appendChild(c);
    requestAnimationFrame(() => {
      c.style.transition = 'all 1s cubic-bezier(.2,.9,.3,1.2)';
      c.style.transform = \`translate(calc(-50% + \${tx}px), calc(-50% + \${ty}px)) rotate(\${rot}deg) scale(0)\`;
      c.style.opacity = '0';
    });
    setTimeout(() => c.remove(), 1100);
  }
}

phoneEl.addEventListener('input', () => {
  phoneEl.value = phoneEl.value.replace(/[^\\d]/g,'');
  clearBtn.classList.toggle('show', phoneEl.value.length > 0);
  ccText.textContent = phoneEl.value ? '+' + phoneEl.value.slice(0,2) : '+';
  if (phoneEl.value.length > 0) Sound.type();
});
clearBtn.onclick = () => {
  Sound.click();
  phoneEl.value = '';
  clearBtn.classList.remove('show');
  ccText.textContent = '+';
  phoneEl.focus();
};

function showAlert(type, msg){
  alertEl.className = 'alert show ' + type;
  alertIc.innerHTML = type === 'error' ? ICON_ERR : ICON_OK;
  alertMsg.textContent = msg;
}
function hideAlert(){ alertEl.className = 'alert'; }

function animateProgress(duration){
  progressWrap.classList.add('active');
  let pct = 0;
  progressFill.style.width = '0%';
  progressPct.textContent = '0%';
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    pct += Math.random() * 14 + 5;
    if (pct >= 100){ pct = 100; clearInterval(progressTimer); }
    progressFill.style.width = pct + '%';
    progressPct.textContent = Math.floor(pct) + '%';
  }, duration / 12);
}
function resetProgress(){
  clearInterval(progressTimer);
  progressFill.style.width = '0%';
  progressPct.textContent = '0%';
  progressWrap.classList.remove('active');
}
function setLoading(on, text){
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  btnTxt.textContent = text || (on ? '> EXECUTING...' : '> GET_PAIRING_CODE');
  if (on) animateProgress(2200);
  else resetProgress();
}

function startCountdown(){
  clearInterval(countdownTimer);
  let t = 120;
  const total = 120;
  countdownEl.textContent = t;
  timerCircle.style.strokeDashoffset = '0';
  countdownTimer = setInterval(() => {
    t--;
    if (t <= 0){
      t = 0;
      clearInterval(countdownTimer);
      countdownEl.textContent = '0';
      timerCircle.style.strokeDashoffset = '113';
      Sound.error();
      showAlert('error','Code expired. Please generate a new one.');
      codeBox.classList.remove('show');
      stepsEl.style.display = 'none';
      return;
    }
    countdownEl.textContent = t;
    timerCircle.style.strokeDashoffset = 113 * (1 - t/total);
    if (t <= 20){
      timerCircle.style.stroke = '#ff0033';
      if (t % 2 === 0) Sound.tick();
    } else {
      timerCircle.style.stroke = '#00ff41';
    }
  }, 1000);
}
function stopCountdown(){ clearInterval(countdownTimer); }

/* BUTTON #1 : PAIRING CODE */
async function pair(e){
  Sound.resume();
  Sound.click();

  if (e && e.clientX){
    const rect = btn.getBoundingClientRect();
    shockwave1.style.left = (e.clientX - rect.left) + 'px';
    shockwave1.style.top = (e.clientY - rect.top) + 'px';
    shockwave1.classList.remove('active');
    void shockwave1.offsetWidth;
    shockwave1.classList.add('active');
  }

  hideAlert();
  stopCountdown();
  const phone = phoneEl.value.trim();

  if (!phone) { Sound.error(); showAlert('error','&gt; ERROR: Enter WhatsApp number.'); phoneEl.focus(); return; }
  if (phone.length < 8) { Sound.error(); showAlert('error','&gt; ERROR: Number too short.'); return; }
  if (phone.length > 15) { Sound.error(); showAlert('error','&gt; ERROR: Number too long.'); return; }

  setLoading(true, '> EXECUTING...');
  codeBox.classList.remove('show');
  stepsEl.style.display = 'none';

  const beepLoop = setInterval(() => Sound.hack(), 400);

  try {
    const res = await fetch('/pair', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    clearInterval(beepLoop);

    if (data.ok && data.code){
      currentCode = String(data.code);
      outEl.textContent = currentCode.split('').join(' ');
      codeBox.classList.add('show');
      stepsEl.style.display = 'grid';
      showAlert('success','&gt; PAYLOAD INJECTED. Link within 2 min.');
      setLoading(false, '> GET_PAIRING_CODE');
      startCountdown();
      blastConfetti();
      Sound.success();
      showToast('PAYLOAD_DEPLOYED', 'Pairing code deployed successfully');
      setTimeout(()=>codeBox.scrollIntoView({behavior:'smooth',block:'nearest'}),150);
    } else {
      setLoading(false, '> GET_PAIRING_CODE');
      Sound.error();
      showAlert('error', '&gt; ERROR: ' + (data.error || 'Deployment failed.'));
    }
  } catch (err){
    clearInterval(beepLoop);
    setLoading(false, '> GET_PAIRING_CODE');
    Sound.error();
    showAlert('error','&gt; ERROR: ' + (err.message || 'server unreachable'));
  }
}

function copyCode(){
  if (!currentCode) return;
  Sound.copy();
  const done = () => {
    const b = document.getElementById('copyBtn');
    b.classList.add('copied');
    b.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Copied';
    showToast('COPIED', 'Pairing code saved to clipboard');
    setTimeout(()=>{
      b.classList.remove('copied');
      b.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg> Copy';
    }, 1800);
  };
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(currentCode).then(done).catch(()=>fallbackCopy(done));
  } else fallbackCopy(done);
}
function fallbackCopy(cb){
  const t = document.createElement('textarea');
  t.value = currentCode; document.body.appendChild(t);
  t.select(); try{ document.execCommand('copy'); cb(); }catch(_){}
  document.body.removeChild(t);
}

function resetForm(){
  Sound.click();
  stopCountdown();
  currentCode = '';
  phoneEl.value = '';
  clearBtn.classList.remove('show');
  ccText.textContent = '+';
  outEl.textContent = '— — — — — — — —';
  codeBox.classList.remove('show');
  stepsEl.style.display = 'none';
  resetProgress();
  hideAlert();
  phoneEl.focus();
}

phoneEl.addEventListener('keydown', e => { if (e.key === 'Enter') pair(e); });

/* BUTTON #2 : JOIN CHANNEL */
function openChannel(e){
  e.preventDefault();
  Sound.resume();
  Sound.click();

  const btn2 = document.getElementById('channelBtn');
  const rect = btn2.getBoundingClientRect();
  if (e.clientX && e.clientY){
    shockwave2.style.left = (e.clientX - rect.left) + 'px';
    shockwave2.style.top = (e.clientY - rect.top) + 'px';
  } else {
    shockwave2.style.left = '50%';
    shockwave2.style.top = '50%';
  }
  shockwave2.classList.remove('active');
  void shockwave2.offsetWidth;
  shockwave2.classList.add('active');

  setTimeout(() => Sound.success(), 200);

  const channelId = '0029Vb8vvB1Fcow4AY0NeC1p';
  const httpsLink = 'https://whatsapp.com/channel/' + channelId;
  const appLink   = 'whatsapp://channel/' + channelId;
  const isMobile  = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  if (isMobile){
    const start = Date.now();
    window.location.href = appLink;
    setTimeout(() => {
      if (Date.now() - start < 1500 && !document.hidden){
        window.open(httpsLink, '_blank');
      }
    }, 800);
  } else {
    window.open(httpsLink, '_blank');
  }
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
  const { phone } = req.body || {};
  const sessionId = String(phone || "").replace(/\D/g, "");
  if (sessionId.length < 10 || sessionId.length > 15) {
    return res.status(400).json({ ok: false, error: "Valid phone number with country code required" });
  }
  pair.got(sessionId);
  try {
    const out = await startSession(sessionId, sessionId);
    if (out.ok && out.code) return res.json({ ok: true, code: out.code, sessionId });
    if (out.ok) return res.json({ ok: true, code: "ALREADY_CONNECTED", sessionId });
    pair.fail(out.error);
    res.status(500).json({ ok: false, error: out.error });
  } catch (e) {
    sessions.delete(sessionId);
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

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`🛑 ${signal} received; closing sessions...`);
  for (const [sessionId, session] of sessions) {
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    try { session.sock?.end?.(new Error(`Process ${signal}`)); } catch (e) { log.error(`shutdown ${sessionId}: ${e?.message || e}`); }
  }
  setTimeout(() => process.exit(0), 1000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

log.info(`🚀 ${config.botName} started — ${commands.size} commands — ${sessions.size} session(s)`);
