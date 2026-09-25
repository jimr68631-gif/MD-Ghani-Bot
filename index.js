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
  channelLink: "https://whatsapp.com/channel/120363429085670060",
  pairingTimeout: 60000,
  browser: ["Windows", "Chrome", "Chrome 114.0.5735.198"],
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
  const normalizedPhone = String(phoneNumber || sessionId || "").replace(/\D/g, "");
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return { ok: false, error: "Valid phone number with country code required" };
  }
  phoneNumber = normalizedPhone;
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

  let pairingRequested = false;
  let pairingResolve;
  let pairingReject;
  const pairingReady = new Promise((resolve, reject) => {
    pairingResolve = resolve;
    pairingReject = reject;
  });

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true;
      try {
        const code = await sock.requestPairingCode(normalizedPhone);
        pair.ok(code);
        pairingResolve(code);
      } catch (e) {
        pair.fail(e);
        pair.err(e);
        pairingReject(e);
      }
    }
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
      if (!sock.authState.creds.registered) {
        log.error(`🚫 Pairing socket closed before registration for ${sessionId}`);
        if (!pairingRequested) pairingReject(new Error("Connection Closed"));
        sessions.delete(sessionId);
        return;
      }
      if (code !== DisconnectReason.loggedOut && !shuttingDown) {
        const restartRequired = code === DisconnectReason.restartRequired || code === 515;
        log.warn(`${restartRequired ? "🔄 Restarting paired session" : "♻️ Reconnecting"} ${sessionId}...`);
        const current = sessions.get(sessionId);
        if (current && !current.reconnectTimer) {
          current.reconnectTimer = setTimeout(() => {
            current.reconnectTimer = null;
            if (sessions.get(sessionId)?.sock === sock) sessions.delete(sessionId);
            startSession(sessionId, phoneNumber).catch((e) => log.error(`reconnect ${sessionId}: ${e?.message || e}`));
          }, restartRequired ? 1500 : 5000);
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
      // Wait for Baileys' QR/handshake event before requesting the pairing code.
      const code = await pairingReady;
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
const PAIR_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\"/>\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover\"/>\n<meta name=\"theme-color\" content=\"#020a04\"/>\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\"/>\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\"/>\n<meta name=\"mobile-web-app-capable\" content=\"yes\"/>\n<link rel=\"manifest\" href='data:application/manifest+json,{\"name\":\"MD-Ghani-Bot\",\"short_name\":\"MD-Ghani\",\"display\":\"standalone\",\"background_color\":\"%23020a04\",\"theme_color\":\"%23020a04\",\"start_url\":\".\"}'/>\n<title>MD-Ghani-Bot • TERMINAL PRO+</title>\n<style>\n  :root{\n    --bg:#020a04;\n    --bg-2:#04160a;\n    --panel:#061f0e;\n    --panel-2:#0a2b14;\n    --line:#0f3d1e;\n    --line-2:#1a5c2e;\n    --green:#22ff88;\n    --green-dim:#00cc66;\n    --amber:#ffb800;\n    --red:#ff3b3b;\n    --cyan:#00e5ff;\n    --txt:#b8ffce;\n    --txt-2:#5fbf82;\n    --muted:#2e6b44;\n  }\n  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}\n  html,body{height:100%;width:100%;overflow:hidden}\n  body{\n    font-family:ui-monospace,\"SF Mono\",Menlo,Consolas,monospace;\n    background:var(--bg);\n    color:var(--txt);\n    -webkit-font-smoothing:antialiased;\n    display:flex;align-items:center;justify-content:center;\n    min-height:100dvh;\n    padding:\n      max(10px, env(safe-area-inset-top))\n      max(10px, env(safe-area-inset-right))\n      max(10px, env(safe-area-inset-bottom))\n      max(10px, env(safe-area-inset-left));\n    position:fixed;inset:0;\n    overflow:hidden;\n    letter-spacing:.4px;\n    font-weight:500;\n  }\n\n  /* ═══ CRT BACKGROUND ═══ */\n  .bg-term{\n    position:fixed;inset:0;z-index:0;\n    background:\n      radial-gradient(ellipse 100% 80% at 50% 0%, rgba(34,255,136,.06) 0%, transparent 55%),\n      linear-gradient(180deg,#020a04 0%,#03100a 55%,#020a04 100%);\n    pointer-events:none;\n    animation:crtFlicker 6s steps(60) infinite;\n  }\n  @keyframes crtFlicker{\n    0%,100%{opacity:1}\n    92%{opacity:1}\n    93%{opacity:.92}\n    94%{opacity:1}\n    97%{opacity:.95}\n    98%{opacity:1}\n  }\n\n  /* Scanlines */\n  .scanlines{\n    position:fixed;inset:0;z-index:50;\n    pointer-events:none;\n    background:repeating-linear-gradient(0deg,\n      rgba(0,0,0,.22) 0px,\n      rgba(0,0,0,.22) 1px,\n      transparent 1px,\n      transparent 3px);\n    mix-blend-mode:multiply;\n    opacity:.7;\n  }\n  .vignette{\n    position:fixed;inset:0;z-index:49;\n    pointer-events:none;\n    background:radial-gradient(ellipse 120% 100% at 50% 50%,transparent 55%,rgba(0,0,0,.55) 100%);\n  }\n  .scanband{\n    position:fixed;left:0;right:0;\n    height:120px;z-index:48;\n    pointer-events:none;\n    background:linear-gradient(180deg,transparent,rgba(34,255,136,.05),transparent);\n    animation:scanMove 7s linear infinite;\n  }\n  @keyframes scanMove{0%{top:-140px}100%{top:110%}}\n\n  /* CRT OFF mode */\n  body.crt-off .scanlines,\n  body.crt-off .scanband,\n  body.crt-off .vignette{display:none}\n  body.crt-off .bg-term{animation:none}\n  body.crt-off .code-val{animation:none}\n  body.crt-off .skull{animation:none}\n\n  /* Matrix rain */\n  .rain{\n    position:fixed;\n    top:-30px;\n    font-size:13px;\n    color:rgba(34,255,136,.35);\n    writing-mode:vertical-lr;\n    white-space:nowrap;\n    z-index:1;\n    pointer-events:none;\n    text-shadow:0 0 6px rgba(34,255,136,.5);\n    user-select:none;\n    animation:rainFall linear infinite;\n  }\n  @keyframes rainFall{0%{transform:translateY(-100%)}100%{transform:translateY(110vh)}}\n\n  /* ═══ BOOT OVERLAY ═══ */\n  .boot{\n    position:fixed;inset:0;z-index:200;\n    background:#020a04;\n    display:flex;align-items:center;justify-content:center;\n    transition:opacity .35s steps(6);\n  }\n  .boot.done{opacity:0;pointer-events:none}\n  .boot-lines{\n    width:min(86%,340px);\n    font-size:12px;\n    line-height:2.1;\n    color:var(--green);\n    text-shadow:0 0 8px rgba(34,255,136,.6);\n  }\n  .boot-lines .dim{color:var(--muted)}\n  .boot-lines .ok{color:var(--amber)}\n  .boot-lines .cur{\n    display:inline-block;\n    width:7px;height:12px;\n    background:var(--green);\n    vertical-align:-1px;\n    animation:blink .5s steps(1) infinite;\n  }\n  @keyframes blink{50%{opacity:0}}\n\n  /* ═══ Wrapper ═══ */\n  .wrap{\n    position:relative;z-index:10;\n    width:100%;max-width:440px;\n    display:flex;flex-direction:column;\n    gap:14px;\n    max-height:100%;\n    overflow-y:auto;\n    overflow-x:hidden;\n    scrollbar-width:none;\n    padding:2px;\n    justify-content:safe center;\n  }\n  .wrap>*{flex-shrink:0}\n  .wrap::-webkit-scrollbar{display:none}\n\n  /* ═══ Header — Terminal window ═══ */\n  .header{\n    width:100%;\n    background:linear-gradient(180deg,rgba(6,31,14,.92),rgba(4,22,10,.9));\n    border:1px solid var(--line-2);\n    border-radius:6px;\n    position:relative;\n    overflow:hidden;\n    animation:bootIn .5s steps(12) backwards;\n    box-shadow:0 0 0 1px rgba(34,255,136,.08),0 0 30px rgba(34,255,136,.12),inset 0 0 40px rgba(0,0,0,.5);\n  }\n  @keyframes bootIn{from{opacity:0;transform:scaleY(.02)}}\n\n  .term-bar{\n    display:flex;align-items:center;gap:8px;flex-wrap:wrap;row-gap:6px;\n    padding:8px 12px;\n    background:rgba(0,0,0,.45);\n    border-bottom:1px solid var(--line);\n  }\n  .term-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}\n  .term-dot.r{background:#ff5f56;box-shadow:0 0 6px #ff5f56}\n  .term-dot.y{background:#ffbd2e;box-shadow:0 0 6px #ffbd2e}\n  .term-dot.g{background:#27c93f;box-shadow:0 0 6px #27c93f}\n  .term-title{\n    flex:1 1 70px;\n    min-width:60px;\n    font-size:10px;\n    color:var(--txt-2);\n    letter-spacing:1px;\n    overflow:hidden;\n    text-overflow:ellipsis;\n    white-space:nowrap;\n  }\n  .term-title .user{color:var(--green)}\n  .crt-btn{\n    font-family:inherit;\n    font-size:8px;\n    font-weight:900;\n    letter-spacing:.5px;\n    padding:3px 5px;\n    background:rgba(34,255,136,.08);\n    border:1px solid var(--line-2);\n    border-radius:3px;\n    color:var(--green);\n    cursor:pointer;\n    transition:all .15s;\n    flex-shrink:0;\n  }\n  .crt-btn:active{transform:scale(.92);background:rgba(34,255,136,.2)}\n\n  .header-body{display:flex;align-items:center;gap:14px;padding:14px 16px}\n\n  .avatar{\n    width:52px;height:52px;\n    border-radius:4px;\n    background:#03150a;\n    border:1px solid var(--green-dim);\n    display:grid;place-items:center;\n    flex-shrink:0;\n    position:relative;\n    font-size:24px;\n    box-shadow:inset 0 0 14px rgba(34,255,136,.2),0 0 14px rgba(34,255,136,.25);\n  }\n  .avatar::before{\n    content:'';\n    position:absolute;\n    inset:3px;\n    border:1px dashed rgba(34,255,136,.35);\n    border-radius:2px;\n  }\n  .avatar .cursor-blink{\n    position:absolute;\n    bottom:4px;right:4px;\n    width:6px;height:10px;\n    background:var(--green);\n    box-shadow:0 0 8px var(--green);\n    animation:blink 1s steps(1) infinite;\n  }\n\n  .header-info{flex:1;min-width:0}\n  .header-name{\n    font-size:16px;\n    font-weight:800;\n    letter-spacing:.5px;\n    line-height:1.2;\n    color:var(--green);\n    display:flex;align-items:center;gap:8px;\n    text-shadow:0 0 10px rgba(34,255,136,.6);\n  }\n  .header-name .ver{\n    font-size:9px;\n    color:var(--bg);\n    background:var(--green);\n    padding:2px 6px;\n    border-radius:2px;\n    font-weight:900;\n    letter-spacing:1px;\n    text-shadow:none;\n    box-shadow:0 0 10px rgba(34,255,136,.5);\n  }\n  .header-sub{\n    display:flex;align-items:center;gap:8px;\n    font-size:10px;\n    color:var(--muted);\n    margin-top:6px;\n    letter-spacing:1.5px;\n    text-transform:uppercase;\n    font-weight:700;\n  }\n  .header-sub .badge{\n    display:inline-flex;align-items:center;gap:5px;\n    padding:2px 8px;\n    background:rgba(34,255,136,.08);\n    border:1px solid rgba(34,255,136,.4);\n    color:var(--green);\n    font-size:9px;\n    font-weight:800;\n    letter-spacing:1.5px;\n  }\n  .header-sub .badge .dot{\n    width:5px;height:5px;\n    background:var(--green);\n    box-shadow:0 0 6px var(--green);\n    animation:dotPulse 1s steps(2) infinite;\n  }\n  @keyframes dotPulse{50%{opacity:.2}}\n\n  /* ═══ Stats ═══ */\n  .stats-row{\n    display:grid;\n    grid-template-columns:repeat(3,1fr);\n    gap:8px;\n    animation:bootIn .5s steps(12) .1s backwards;\n  }\n  .stat-card{\n    background:rgba(6,31,14,.85);\n    border:1px solid var(--line);\n    border-radius:4px;\n    padding:12px 8px;\n    text-align:center;\n    position:relative;\n    overflow:hidden;\n    transition:all .15s;\n  }\n  .stat-card:active{transform:scale(.96);border-color:var(--green-dim)}\n  .stat-card::before{\n    content:'';position:absolute;top:0;left:0;width:6px;height:6px;\n    border-top:1.5px solid var(--green-dim);border-left:1.5px solid var(--green-dim);\n  }\n  .stat-card::after{\n    content:'';position:absolute;bottom:0;right:0;width:6px;height:6px;\n    border-bottom:1.5px solid var(--green-dim);border-right:1.5px solid var(--green-dim);\n  }\n  .stat-card .val{\n    font-size:16px;\n    font-weight:900;\n    color:var(--green);\n    line-height:1;\n    font-variant-numeric:tabular-nums;\n    text-shadow:0 0 10px rgba(34,255,136,.6);\n    margin-bottom:6px;\n  }\n  .stat-card .lbl{\n    font-size:9px;\n    color:var(--muted);\n    letter-spacing:2px;\n    text-transform:uppercase;\n    font-weight:800;\n  }\n\n  /* ═══ Main Card ═══ */\n  .card{\n    width:100%;\n    background:linear-gradient(180deg,rgba(6,31,14,.92) 0%,rgba(3,14,7,.94) 100%);\n    border:1px solid var(--line-2);\n    border-radius:6px;\n    padding:24px 20px 20px;\n    position:relative;\n    overflow:hidden;\n    animation:bootIn .6s steps(14) .18s backwards;\n    box-shadow:0 0 0 1px rgba(34,255,136,.08),0 0 40px rgba(34,255,136,.1),inset 0 0 50px rgba(0,0,0,.5);\n  }\n  .card::before{\n    content:'';position:absolute;top:6px;left:6px;width:16px;height:16px;\n    border-top:2px solid var(--green);border-left:2px solid var(--green);\n    filter:drop-shadow(0 0 4px var(--green));pointer-events:none;z-index:2;\n  }\n  .card > .br{position:absolute;top:6px;right:6px;width:16px;height:16px;\n    border-top:2px solid var(--green);border-right:2px solid var(--green);\n    filter:drop-shadow(0 0 4px var(--green));pointer-events:none;z-index:2}\n  .card > .bl2{position:absolute;bottom:6px;left:6px;width:16px;height:16px;\n    border-bottom:2px solid var(--green);border-left:2px solid var(--green);\n    filter:drop-shadow(0 0 4px var(--green));pointer-events:none;z-index:2}\n  .card > .br2{position:absolute;bottom:6px;right:6px;width:16px;height:16px;\n    border-bottom:2px solid var(--green);border-right:2px solid var(--green);\n    filter:drop-shadow(0 0 4px var(--green));pointer-events:none;z-index:2}\n\n  .skull{\n    position:absolute;top:14px;right:16px;z-index:2;font-size:20px;opacity:.85;\n    animation:skullFlicker 4s steps(20) infinite;\n    filter:drop-shadow(0 0 8px rgba(34,255,136,.6));\n  }\n  @keyframes skullFlicker{\n    0%,100%{opacity:.85}90%{opacity:.85}91%{opacity:.2}92%{opacity:.85}95%{opacity:.4}96%{opacity:.85}\n  }\n\n  /* ═══ Section Head ═══ */\n  .sec{display:flex;align-items:center;gap:13px;margin-bottom:20px;position:relative;z-index:1}\n  .sec-icon{\n    width:52px;height:52px;border-radius:4px;\n    background:#03150a;border:1px solid var(--green-dim);\n    display:grid;place-items:center;flex-shrink:0;position:relative;\n    box-shadow:inset 0 0 14px rgba(34,255,136,.2),0 0 14px rgba(34,255,136,.25);\n  }\n  .sec-icon::after{\n    content:'';position:absolute;inset:-5px;\n    border:1px solid rgba(34,255,136,.25);border-radius:6px;\n    animation:iconPulse 2s ease-in-out infinite;\n  }\n  @keyframes iconPulse{0%,100%{opacity:.3;inset:-5px}50%{opacity:.8;inset:-7px}}\n  .sec-icon svg{\n    width:26px;height:26px;\n    stroke:var(--green);stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;\n    filter:drop-shadow(0 0 5px rgba(34,255,136,.7));\n  }\n  .sec-info{flex:1;min-width:0}\n  .sec-cmd{\n    font-size:10px;color:var(--muted);letter-spacing:1.5px;\n    margin-bottom:5px;text-transform:uppercase;font-weight:800;\n  }\n  .sec-cmd .dollar{color:var(--amber);text-shadow:0 0 6px var(--amber)}\n  .sec-title{\n    font-size:21px;font-weight:900;letter-spacing:.5px;line-height:1.1;\n    color:var(--green);text-shadow:0 0 14px rgba(34,255,136,.6);\n  }\n  .sec-title .gt{color:var(--txt-2);font-weight:400}\n  .sec-desc{font-size:11.5px;color:var(--txt-2);margin-top:5px;line-height:1.45}\n\n  /* ═══ Field ═══ */\n  .field{margin-bottom:18px;position:relative;z-index:1}\n  .field-label{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}\n  .field-label .left{\n    display:flex;align-items:center;gap:8px;\n    font-size:10.5px;color:var(--txt-2);letter-spacing:1.5px;\n    text-transform:uppercase;font-weight:800;\n  }\n  .field-label .num-badge{\n    width:24px;height:24px;border-radius:3px;\n    background:var(--green);display:grid;place-items:center;\n    font-size:10px;font-weight:900;color:#02120a;\n    box-shadow:0 0 10px rgba(34,255,136,.5);\n  }\n  .field-label .req{\n    padding:2px 8px;background:rgba(255,59,59,.1);border:1px solid rgba(255,59,59,.5);\n    font-size:8.5px;color:var(--red);font-weight:900;letter-spacing:1.5px;\n    text-transform:uppercase;animation:reqBlink 1.6s steps(2) infinite;\n  }\n  @keyframes reqBlink{50%{opacity:.45}}\n\n  .input-box{\n    display:flex;align-items:center;\n    background:rgba(0,0,0,.55);\n    border:1px solid var(--line-2);\n    border-radius:4px;\n    padding:2px;\n    position:relative;\n    overflow:hidden;\n    transition:all .2s;\n    box-shadow:inset 0 2px 8px rgba(0,0,0,.6);\n  }\n  .input-box::before{\n    content:'>';position:absolute;left:10px;\n    color:var(--amber);font-weight:900;font-size:14px;\n    text-shadow:0 0 6px var(--amber);\n    pointer-events:none;z-index:1;\n  }\n  .input-box:focus-within{\n    border-color:var(--green);\n    box-shadow:inset 0 2px 8px rgba(0,0,0,.6),0 0 0 3px rgba(34,255,136,.12),0 0 24px rgba(34,255,136,.3);\n  }\n\n  .cc-box{\n    display:flex;align-items:center;gap:4px;\n    padding:0 10px 0 24px;\n    height:52px;\n    border-right:1px solid var(--line);\n    flex-shrink:0;\n  }\n  .cc-box select{\n    font-family:inherit;\n    font-size:11px;\n    font-weight:800;\n    background:#03150a;\n    color:var(--green);\n    border:1px solid var(--line-2);\n    border-radius:3px;\n    padding:4px 2px;\n    outline:none;\n    cursor:pointer;\n    max-width:74px;\n    text-shadow:0 0 5px rgba(34,255,136,.5);\n  }\n  .cc-box select option{background:#03150a;color:var(--txt)}\n  .cc-box .code{\n    font-size:14px;font-weight:900;color:var(--amber);\n    text-shadow:0 0 8px var(--amber);letter-spacing:.5px;\n    font-variant-numeric:tabular-nums;\n  }\n  #phone{\n    flex:1;background:transparent;border:0;outline:none;\n    color:var(--green);font-size:15px;font-weight:700;\n    padding:14px 10px;letter-spacing:2px;\n    font-variant-numeric:tabular-nums;min-width:0;\n    caret-color:var(--green);\n    text-shadow:0 0 8px rgba(34,255,136,.5);\n  }\n  #phone::placeholder{color:var(--muted);font-weight:400;font-size:12px;letter-spacing:1px}\n  .clr{\n    display:none;width:32px;height:32px;border-radius:3px;\n    background:rgba(255,59,59,.1);border:1px solid rgba(255,59,59,.5);\n    color:var(--red);font-size:12px;font-weight:900;\n    margin-right:7px;cursor:pointer;align-items:center;justify-content:center;\n    flex-shrink:0;transition:all .12s;\n  }\n  .clr.show{display:flex}\n  .clr:active{background:rgba(255,59,59,.3);transform:scale(.92)}\n  .hint{\n    display:flex;align-items:center;gap:7px;flex-wrap:wrap;\n    font-size:10.5px;color:var(--muted);margin-top:9px;letter-spacing:.5px;\n  }\n  .hint .arrow{color:var(--green);font-weight:900}\n  .hint code{\n    color:var(--green);font-weight:900;padding:2px 7px;\n    background:rgba(34,255,136,.08);border:1px solid rgba(34,255,136,.3);\n    font-size:10.5px;font-variant-numeric:tabular-nums;\n    text-shadow:0 0 6px rgba(34,255,136,.5);\n  }\n  .hint .kbd{\n    color:var(--txt-2);padding:1px 5px;\n    border:1px solid var(--line-2);border-radius:2px;\n    font-size:9px;font-weight:800;\n  }\n\n  /* Recent chips */\n  .chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}\n  .chip{\n    font-family:inherit;\n    font-size:10px;font-weight:800;letter-spacing:.5px;\n    padding:5px 9px;\n    background:rgba(0,229,255,.05);\n    border:1px solid rgba(0,229,255,.3);\n    border-radius:3px;\n    color:var(--cyan);\n    cursor:pointer;\n    transition:all .12s;\n    text-shadow:0 0 5px rgba(0,229,255,.5);\n  }\n  .chip:active{transform:scale(.94);background:rgba(0,229,255,.15)}\n  .chip::before{content:'↺ ';color:var(--muted)}\n\n  /* ═══ Buttons ═══ */\n  .btn-wrap{position:relative;width:100%;margin-bottom:11px;z-index:1}\n  .term-btn{\n    width:100%;\n    padding:16px 22px;\n    border:1px solid;\n    border-radius:4px;\n    font-family:inherit;\n    font-weight:900;\n    font-size:13.5px;\n    letter-spacing:2px;\n    text-transform:uppercase;\n    cursor:pointer;\n    display:flex;align-items:center;justify-content:center;gap:10px;\n    position:relative;\n    overflow:hidden;\n    transition:all .15s;\n    text-decoration:none;\n  }\n  .term-btn.primary{\n    background:rgba(34,255,136,.1);\n    border-color:var(--green);\n    color:var(--green);\n    text-shadow:0 0 8px rgba(34,255,136,.7);\n    box-shadow:0 0 18px rgba(34,255,136,.25),inset 0 0 18px rgba(34,255,136,.12);\n  }\n  .term-btn.primary:hover{\n    background:rgba(34,255,136,.18);\n    box-shadow:0 0 28px rgba(34,255,136,.4),inset 0 0 22px rgba(34,255,136,.2);\n  }\n  .term-btn.secondary{\n    background:rgba(255,184,0,.08);\n    border-color:var(--amber);\n    color:var(--amber);\n    text-shadow:0 0 8px rgba(255,184,0,.7);\n    box-shadow:0 0 18px rgba(255,184,0,.22),inset 0 0 18px rgba(255,184,0,.1);\n  }\n  .term-btn.secondary:hover{\n    background:rgba(255,184,0,.16);\n    box-shadow:0 0 28px rgba(255,184,0,.38),inset 0 0 22px rgba(255,184,0,.18);\n  }\n  .term-btn::before{\n    content:'';position:absolute;top:0;left:-120%;width:60%;height:100%;\n    background:linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent);\n    animation:btnGlitch 4s steps(30) infinite;pointer-events:none;\n  }\n  @keyframes btnGlitch{0%,88%{left:-120%}92%{left:130%}100%{left:130%}}\n  .term-btn:active{transform:translateY(1px)}\n  .term-btn:disabled{opacity:.45;cursor:not-allowed}\n  .term-btn .spinner{\n    width:18px;height:18px;\n    border:2px solid rgba(34,255,136,.25);border-top-color:var(--green);\n    border-radius:50%;animation:spin .6s steps(12) infinite;\n    display:none;position:relative;z-index:2;\n  }\n  .term-btn.loading .spinner{display:block}\n  @keyframes spin{to{transform:rotate(360deg)}}\n  .term-btn .arrow{display:inline-flex;align-items:center;justify-content:center;position:relative;z-index:2;transition:transform .15s}\n  .term-btn:hover .arrow{transform:translateX(5px)}\n  .term-btn .arrow svg{width:18px;height:18px;stroke:currentColor;stroke-width:2.5;fill:none;stroke-linecap:round;stroke-linejoin:round}\n  .term-btn svg.lead-icon{width:19px;height:19px;fill:currentColor;flex-shrink:0;position:relative;z-index:2}\n  .term-btn .btn-txt{position:relative;z-index:2}\n  .term-btn .brackets{color:var(--txt-2);font-weight:400}\n\n  .sound-toggle{\n    position:absolute;top:50%;right:10px;\n    transform:translateY(-50%);\n    width:32px;height:32px;border-radius:3px;\n    background:rgba(0,0,0,.5);border:1px solid var(--line-2);\n    display:grid;place-items:center;cursor:pointer;\n    transition:all .15s;z-index:3;\n  }\n  .sound-toggle:active{transform:translateY(-50%) scale(.92);border-color:var(--green)}\n  .sound-toggle svg{\n    width:14px;height:14px;stroke:var(--green);stroke-width:2.5;fill:none;\n    filter:drop-shadow(0 0 4px rgba(34,255,136,.6));\n  }\n  .sound-toggle.muted svg .wave{opacity:0}\n  .sound-toggle.muted::after{\n    content:'';position:absolute;width:20px;height:1.5px;\n    background:var(--red);transform:rotate(-45deg);box-shadow:0 0 6px var(--red);\n  }\n\n  /* ═══ Progress ═══ */\n  .progress-wrap{\n    margin-top:14px;opacity:0;max-height:0;overflow:hidden;\n    transition:opacity .25s, max-height .25s;position:relative;z-index:1;\n  }\n  .progress-wrap.active{opacity:1;max-height:60px}\n  .progress-meta{\n    display:flex;align-items:center;justify-content:space-between;\n    font-size:10px;letter-spacing:1.5px;color:var(--txt-2);\n    font-weight:800;margin-bottom:7px;text-transform:uppercase;\n  }\n  .progress-meta .pct{\n    color:var(--green);font-weight:900;font-variant-numeric:tabular-nums;\n    text-shadow:0 0 8px rgba(34,255,136,.6);\n  }\n  .progress-bar{\n    width:100%;height:12px;\n    background:rgba(0,0,0,.6);\n    border:1px solid var(--line);border-radius:2px;\n    overflow:hidden;position:relative;\n    box-shadow:inset 0 2px 5px rgba(0,0,0,.6);\n  }\n  .progress-bar .fill{\n    height:100%;\n    background:repeating-linear-gradient(90deg,var(--green) 0px,var(--green) 8px,rgba(34,255,136,.45) 8px,rgba(34,255,136,.45) 12px);\n    box-shadow:0 0 12px rgba(34,255,136,.6);\n    transition:width .25s steps(8);\n    width:0%;\n  }\n\n  /* ═══ Trust ═══ */\n  .trust{\n    display:flex;align-items:center;justify-content:space-around;gap:8px;\n    margin-top:18px;padding-top:15px;\n    border-top:1px dashed var(--line-2);position:relative;z-index:1;\n  }\n  .trust-item{\n    display:flex;align-items:center;gap:6px;\n    font-size:9.5px;color:var(--txt-2);letter-spacing:1.5px;\n    font-weight:800;text-transform:uppercase;\n  }\n  .trust-item svg{\n    width:14px;height:14px;stroke:var(--green);stroke-width:2.2;fill:none;\n    stroke-linecap:round;stroke-linejoin:round;\n    filter:drop-shadow(0 0 4px rgba(34,255,136,.6));\n  }\n\n  /* ═══ Result ═══ */\n  .result{\n    display:none;\n    margin-top:18px;\n    background:rgba(6,31,14,.85);\n    border:1px solid var(--green);\n    border-radius:4px;\n    padding:20px 18px 16px;\n    position:relative;\n    overflow:hidden;\n    animation:resultBoot .4s steps(10);\n    box-shadow:0 0 30px rgba(34,255,136,.2),inset 0 0 30px rgba(34,255,136,.06);\n    z-index:1;\n  }\n  .result.show{display:block}\n  @keyframes resultBoot{\n    0%{opacity:0;clip-path:inset(0 100% 0 0)}\n    60%{opacity:1;clip-path:inset(0 0 0 0)}\n    70%{opacity:.4}80%{opacity:1}100%{opacity:1}\n  }\n  .result-head{\n    display:flex;align-items:center;justify-content:space-between;\n    margin-bottom:14px;position:relative;z-index:1;\n  }\n  .result-tag{\n    display:flex;align-items:center;gap:7px;\n    font-size:10px;font-weight:900;color:var(--green);\n    letter-spacing:1.5px;text-transform:uppercase;\n    text-shadow:0 0 8px rgba(34,255,136,.6);\n  }\n  .result-tag .dot{\n    width:7px;height:7px;background:var(--green);box-shadow:0 0 8px var(--green);\n    animation:dotPulse 1s steps(2) infinite;\n  }\n  .timer-circle{\n    position:relative;width:52px;height:40px;\n    display:grid;place-items:center;flex-shrink:0;\n    background:rgba(0,0,0,.55);\n    border:1px solid var(--green-dim);\n    border-radius:3px;\n    box-shadow:inset 0 0 12px rgba(34,255,136,.15),0 0 12px rgba(34,255,136,.2);\n  }\n  .timer-circle svg{display:none}\n  .timer-circle .txt{\n    font-size:14px;font-weight:900;color:var(--green);\n    text-shadow:0 0 8px rgba(34,255,136,.7);\n    font-variant-numeric:tabular-nums;\n  }\n  .timer-circle .txt::after{content:'s';font-size:9px;color:var(--muted);margin-left:1px}\n  .timer-circle.danger{border-color:var(--red)}\n  .timer-circle.danger .txt{color:var(--red);text-shadow:0 0 8px rgba(255,59,59,.7)}\n  .code-val{\n    font-family:inherit;\n    font-size:clamp(24px,8.5vw,32px);\n    font-weight:900;\n    letter-spacing:clamp(3px,1.8vw,8px);\n    text-align:center;line-height:1.25;word-break:break-all;\n    padding:14px 6px;font-variant-numeric:tabular-nums;\n    color:var(--green);\n    text-shadow:0 0 8px rgba(34,255,136,.8),0 0 24px rgba(34,255,136,.5);\n    position:relative;z-index:1;\n    animation:codeFlicker 3s steps(40) infinite;\n  }\n  @keyframes codeFlicker{0%,100%{opacity:1}88%{opacity:1}89%{opacity:.4}90%{opacity:1}94%{opacity:.7}95%{opacity:1}}\n  .res-actions{display:flex;gap:9px;margin-top:14px;position:relative;z-index:1}\n  .res-actions button{\n    flex:1;padding:12px;\n    background:rgba(34,255,136,.08);\n    border:1px solid var(--green-dim);\n    border-radius:3px;color:var(--green);\n    font-family:inherit;font-size:10.5px;font-weight:900;\n    letter-spacing:1.5px;text-transform:uppercase;\n    cursor:pointer;transition:all .15s;\n    display:flex;align-items:center;justify-content:center;gap:6px;\n    text-shadow:0 0 6px rgba(34,255,136,.6);\n  }\n  .res-actions button svg{width:13px;height:13px;stroke:currentColor;stroke-width:2.5;fill:none;stroke-linecap:round;stroke-linejoin:round}\n  .res-actions button:active{background:rgba(34,255,136,.2);transform:translateY(1px)}\n  .res-actions .copy{background:rgba(0,229,255,.06);border-color:#0891b2;color:var(--cyan);text-shadow:0 0 6px rgba(0,229,255,.6)}\n  .res-actions button.copied{background:rgba(34,255,136,.85);border-color:var(--green);color:#02120a;text-shadow:none}\n\n  /* ═══ Steps ═══ */\n  .steps{\n    margin-top:18px;padding-top:15px;\n    border-top:1px dashed var(--line-2);\n    display:grid;gap:10px;position:relative;z-index:1;\n  }\n  .steps-head{\n    display:flex;align-items:center;justify-content:space-between;\n    font-size:10px;font-weight:900;letter-spacing:1.5px;\n    text-transform:uppercase;margin-bottom:3px;\n    color:var(--amber);text-shadow:0 0 8px rgba(255,184,0,.6);\n  }\n  .steps-head .left{display:flex;align-items:center;gap:7px}\n  .steps-head svg{width:13px;height:13px;stroke:var(--amber);stroke-width:2.5;fill:none;filter:drop-shadow(0 0 4px rgba(255,184,0,.6))}\n  .steps-head .count{font-size:9px;color:var(--muted)}\n  .step{display:flex;gap:11px;align-items:flex-start;font-size:11.5px;color:var(--txt-2);line-height:1.5}\n  .step .n{\n    flex-shrink:0;width:22px;height:22px;border-radius:2px;\n    display:grid;place-items:center;font-size:10px;font-weight:900;\n    color:#02120a;background:var(--green-dim);\n    box-shadow:0 0 8px rgba(34,255,136,.4);font-variant-numeric:tabular-nums;\n  }\n  .step b{color:var(--green);font-weight:800;text-shadow:0 0 5px rgba(34,255,136,.5)}\n\n  /* ═══ SYSTEM LOG ═══ */\n  .log{\n    margin-top:16px;\n    background:rgba(0,0,0,.5);\n    border:1px solid var(--line);\n    border-radius:4px;\n    overflow:hidden;\n    position:relative;z-index:1;\n  }\n  .log-head{\n    padding:7px 12px;\n    font-size:9px;font-weight:900;letter-spacing:2px;\n    color:var(--muted);text-transform:uppercase;\n    background:rgba(0,0,0,.35);\n    border-bottom:1px solid var(--line);\n    display:flex;align-items:center;justify-content:space-between;\n  }\n  .log-head .live{color:var(--green);animation:dotPulse 1.2s steps(2) infinite}\n  .log-body{\n    max-height:110px;\n    overflow-y:auto;\n    scrollbar-width:none;\n    padding:8px 12px;\n  }\n  .log-body::-webkit-scrollbar{display:none}\n  .log-line{\n    font-size:10px;line-height:1.9;\n    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;\n    animation:logIn .2s steps(4);\n  }\n  @keyframes logIn{from{opacity:0;transform:translateX(-5px)}}\n  .log-line .t{color:var(--muted);margin-right:6px}\n  .log-line.t-ok{color:var(--green)}\n  .log-line.t-err{color:#ff8585}\n  .log-line.t-inf{color:var(--txt-2)}\n  .log-line.t-wrn{color:var(--amber)}\n\n  /* ═══ Alert ═══ */\n  .alert{\n    display:none;margin-top:15px;padding:13px 15px;\n    font-size:11.5px;line-height:1.5;align-items:center;gap:10px;\n    border-radius:3px;border:1px solid;font-weight:700;\n    animation:popIn .2s steps(5);position:relative;z-index:1;\n  }\n  .alert.show{display:flex}\n  @keyframes popIn{from{opacity:0;transform:translateX(-6px)}}\n  .alert.error{\n    background:rgba(255,59,59,.07);border-color:rgba(255,59,59,.55);\n    color:#ff8585;box-shadow:0 0 20px rgba(255,59,59,.25);\n  }\n  .alert.success{\n    background:rgba(34,255,136,.06);border-color:rgba(34,255,136,.55);\n    color:var(--green);box-shadow:0 0 20px rgba(34,255,136,.3);\n    text-shadow:0 0 5px rgba(34,255,136,.5);\n  }\n  .alert .ic{width:20px;height:20px;flex-shrink:0;display:grid;place-items:center}\n  .alert .ic svg{width:16px;height:16px;stroke:currentColor;stroke-width:2.5;fill:none;stroke-linecap:round;stroke-linejoin:round}\n\n  /* ═══ Toast ═══ */\n  .toast-container{\n    position:fixed;top:18px;left:50%;transform:translateX(-50%);\n    z-index:100;display:flex;flex-direction:column;gap:9px;\n    pointer-events:none;width:calc(100% - 32px);max-width:400px;\n  }\n  .toast{\n    display:flex;align-items:center;gap:11px;\n    padding:12px 14px;\n    background:rgba(4,22,10,.96);\n    border:1px solid var(--green);border-radius:4px;\n    box-shadow:0 0 30px rgba(34,255,136,.3),0 8px 24px rgba(0,0,0,.6);\n    animation:toastIn .25s steps(8);pointer-events:auto;\n  }\n  .toast.leaving{animation:toastOut .2s steps(5) forwards}\n  @keyframes toastIn{from{opacity:0;transform:translateY(-12px)}}\n  @keyframes toastOut{to{opacity:0;transform:translateY(-12px)}}\n  .toast-icon{\n    width:32px;height:32px;border-radius:3px;\n    background:rgba(34,255,136,.12);border:1px solid var(--green-dim);\n    display:grid;place-items:center;flex-shrink:0;\n    box-shadow:0 0 12px rgba(34,255,136,.3);\n  }\n  .toast-icon svg{width:15px;height:15px;stroke:var(--green);stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 4px rgba(34,255,136,.7))}\n  .toast-body{flex:1;min-width:0}\n  .toast-title{font-size:11.5px;font-weight:900;color:var(--green);letter-spacing:1px;text-transform:uppercase;text-shadow:0 0 7px rgba(34,255,136,.6)}\n  .toast-desc{font-size:10.5px;color:var(--txt-2);margin-top:2px}\n\n  /* ═══ Footer ═══ */\n  .footer{\n    width:100%;display:flex;flex-direction:column;align-items:center;gap:10px;\n    animation:bootIn .5s steps(12) .35s backwards;\n  }\n  .footer-meta{\n    display:flex;align-items:center;gap:11px;\n    font-size:9.5px;color:var(--txt-2);letter-spacing:1.5px;\n    font-weight:800;flex-wrap:wrap;justify-content:center;text-transform:uppercase;\n  }\n  .footer-meta .val{display:inline-flex;align-items:center;gap:5px}\n  .footer-meta .val svg{width:11px;height:11px;stroke:var(--green);stroke-width:2.2;fill:none;stroke-linecap:round;filter:drop-shadow(0 0 3px rgba(34,255,136,.6))}\n  .footer-meta .sep{color:var(--muted)}\n  .footer-meta .sep::before{content:'/';margin:0 2px}\n\n  /* ═══ PRO FEATURES CSS ═══ */\n  .up-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;box-shadow:0 0 8px currentColor}\n  .up-dot.ok{background:var(--green);color:var(--green)}\n  .up-dot.warn{background:var(--amber);color:var(--amber)}\n  .up-dot.bad{background:var(--red);color:var(--red)}\n\n  .regen-btn{\n    width:100%;margin-top:10px;padding:12px;\n    font-family:inherit;font-size:10.5px;font-weight:900;letter-spacing:1.5px;\n    text-transform:uppercase;cursor:pointer;border-radius:3px;\n    background:rgba(255,59,59,.08);border:1px solid rgba(255,59,59,.55);color:#ff8585;\n    text-shadow:0 0 6px rgba(255,59,59,.6);\n    animation:reqBlink 1.2s steps(2) infinite;\n    transition:all .15s;\n  }\n  .regen-btn:active{background:rgba(255,59,59,.2);transform:translateY(1px)}\n\n  .export-btn{\n    font-family:inherit;font-size:8px;font-weight:900;letter-spacing:1px;\n    padding:2px 6px;background:transparent;border:1px solid var(--line-2);\n    border-radius:2px;color:var(--txt-2);cursor:pointer;margin-right:6px;\n  }\n  .export-btn:active{background:rgba(34,255,136,.15);color:var(--green)}\n  .log-head .live{display:inline}\n\n  .overlay{\n    position:fixed;inset:0;z-index:150;\n    background:rgba(2,10,4,.85);\n    display:none;align-items:center;justify-content:center;\n  }\n  .overlay.show{display:flex}\n  .keys-panel{\n    width:min(88%,320px);\n    background:rgba(4,22,10,.97);\n    border:1px solid var(--green);\n    border-radius:4px;\n    padding:18px;\n    box-shadow:0 0 40px rgba(34,255,136,.3);\n    animation:popIn .2s steps(5);\n  }\n  .keys-title{font-size:10px;font-weight:900;letter-spacing:2px;color:var(--green);text-transform:uppercase;margin-bottom:12px;text-shadow:0 0 8px rgba(34,255,136,.6)}\n  .key-row{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--txt-2);padding:6px 0;border-bottom:1px dashed var(--line)}\n  .key-row:last-of-type{border-bottom:0}\n  .key-row .kbd{color:var(--amber);font-weight:900;min-width:70px;text-shadow:0 0 6px rgba(255,184,0,.5)}\n  .keys-close{\n    width:100%;margin-top:14px;padding:10px;\n    font-family:inherit;font-size:10px;font-weight:900;letter-spacing:1.5px;\n    background:rgba(34,255,136,.08);border:1px solid var(--green-dim);\n    border-radius:3px;color:var(--green);cursor:pointer;\n  }\n  .keys-close:active{background:rgba(34,255,136,.2)}\n\n  /* ═══ PRO+ FEATURES CSS ═══ */\n  body.ph-amber{filter:hue-rotate(-105deg) saturate(1.15)}\n  body.ph-cyan{filter:hue-rotate(40deg)}\n  body.ph-pink{filter:hue-rotate(175deg) saturate(1.2)}\n\n  .swatches{display:flex;gap:3px;align-items:center;flex-shrink:0}\n  .sw{width:9px;height:9px;border-radius:2px;cursor:pointer;\n    border:1px solid rgba(255,255,255,.3);padding:0;transition:all .15s}\n  .sw.on{border-color:#fff;box-shadow:0 0 7px currentColor;transform:scale(1.2)}\n  .sw-green{background:#22ff88;color:#22ff88}\n  .sw-amber{background:#ffb800;color:#ffb800}\n  .sw-cyan{background:#22d3ee;color:#22d3ee}\n  .sw-pink{background:#ff2d95;color:#ff2d95}\n\n  .mini-link-btn{\n    width:100%;margin-top:-2px;margin-bottom:11px;\n    padding:9px;font-family:inherit;font-size:9px;font-weight:900;\n    letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;\n    background:transparent;border:1px dashed var(--line-2);\n    border-radius:3px;color:var(--txt-2);transition:all .15s;\n  }\n  .mini-link-btn:active{border-color:var(--green);color:var(--green);transform:translateY(1px)}\n\n  .paste-btn{\n    font-family:inherit;font-size:9px;font-weight:900;letter-spacing:1px;\n    padding:2px 7px;background:transparent;border:1px dashed var(--line-2);\n    border-radius:2px;color:var(--txt-2);cursor:pointer;margin-left:4px;\n  }\n  .paste-btn:active{border-color:var(--green);color:var(--green)}\n\n  @keyframes shakeX{\n    0%,100%{transform:translateX(0)}\n    20%{transform:translateX(-7px)}\n    40%{transform:translateX(7px)}\n    60%{transform:translateX(-5px)}\n    80%{transform:translateX(5px)}\n  }\n  .shake{animation:shakeX .4s}\n\n  .qr-panel{\n    margin-top:16px;border:1px solid var(--line);border-radius:4px;\n    overflow:hidden;text-align:center;position:relative;z-index:1;\n  }\n  .qr-head{\n    padding:7px 12px;font-size:9px;font-weight:900;letter-spacing:2px;\n    color:var(--muted);text-transform:uppercase;\n    background:rgba(0,0,0,.35);border-bottom:1px solid var(--line);\n    display:flex;align-items:center;justify-content:space-between;\n  }\n  .qr-x{cursor:pointer;color:var(--txt-2);font-weight:900}\n  .qr-x:active{color:var(--red)}\n  .qr-img{\n    width:140px;height:140px;margin:12px auto 4px;display:block;\n    background:#fff;border:4px solid var(--green);border-radius:4px;\n  }\n  .qr-sub{font-size:9px;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;padding:6px 0 10px}\n\n  .hist-panel{\n    margin-top:16px;border:1px solid var(--line);border-radius:4px;\n    overflow:hidden;position:relative;z-index:1;\n  }\n  .hist-body{padding:6px 12px 8px}\n  .hist-line{\n    font-size:10px;line-height:2;color:var(--txt-2);\n    display:flex;justify-content:space-between;gap:8px;\n    border-bottom:1px dashed var(--line);\n  }\n  .hist-line:last-child{border-bottom:0}\n  .hist-line .n{color:var(--cyan);text-shadow:0 0 5px rgba(0,229,255,.5)}\n  .hist-line .t{color:var(--muted);flex-shrink:0}\n  .hist-empty{font-size:10px;color:var(--muted);padding:6px 0;letter-spacing:1px}\n\n  /* PERF / LITE MODE — for low-end devices */\n  body.perf .rain{display:none}\n  body.perf .scanband{display:none}\n  body.perf .meteor{display:none}\n  body.perf .bg-term{animation:none}\n  body.perf .code-val{animation:none}\n  body.perf .skull{animation:none}\n  body.perf .term-btn::before{animation:none}\n\n  /* ═══ Responsive ═══ */\n  @media (max-height:820px){\n    .card{padding:20px 16px 16px}\n    .sec-title{font-size:18px}\n    .term-btn{padding:14px 18px;font-size:12.5px}\n    .header-body{padding:12px 14px}\n    .avatar{width:46px;height:46px;font-size:20px}\n    .skull{font-size:16px}\n    .log-body{max-height:84px}\n  }\n  @media (max-width:430px){\n    .term-title{display:none}\n  }\n  @media (max-height:700px){\n    .hint{display:none}\n    .sec-desc{display:none}\n    .trust{display:none}\n    .header-body{padding:10px 12px}\n    .stat-card{padding:10px 6px}\n    .log{display:none}\n    .qr-panel{display:none}\n    .hist-panel{display:none}\n  }\n</style>\n</head>\n<body>\n\n<!-- Boot overlay -->\n<div class=\"boot\" id=\"boot\"><div class=\"boot-lines\" id=\"bootLines\"></div></div>\n\n<!-- CRT layers -->\n<div class=\"bg-term\"></div>\n<div class=\"scanband\"></div>\n<div class=\"vignette\"></div>\n<div class=\"scanlines\"></div>\n\n<div class=\"wrap\">\n\n  <!-- Header -->\n  <div class=\"header\">\n    <div class=\"term-bar\">\n      <span class=\"term-dot r\"></span>\n      <span class=\"term-dot y\"></span>\n      <span class=\"term-dot g\"></span>\n      <span class=\"term-title\"><span class=\"user\">md-ghani</span>@bot:~$</span>\n      <button class=\"crt-btn\" id=\"crtBtn\" onclick=\"toggleCRT(event)\">CRT:ON</button>\n      <button class=\"crt-btn\" id=\"keysBtn\" onclick=\"toggleKeys(event)\">KEYS</button>\n      <button class=\"crt-btn\" id=\"langBtn\" onclick=\"cycleLang(event)\">EN</button>\n      <button class=\"crt-btn\" id=\"sndBtn\" onclick=\"cycleSnd(event)\">SND:MIX</button>\n      <button class=\"crt-btn\" id=\"perfBtn\" onclick=\"togglePerf(event)\">PERF:OFF</button>\n      <span class=\"swatches\">\n        <button class=\"sw sw-green on\" onclick=\"setPhosphor('green')\" title=\"green\"></button>\n        <button class=\"sw sw-amber\" onclick=\"setPhosphor('amber')\" title=\"amber\"></button>\n        <button class=\"sw sw-cyan\" onclick=\"setPhosphor('cyan')\" title=\"cyan\"></button>\n        <button class=\"sw sw-pink\" onclick=\"setPhosphor('pink')\" title=\"pink\"></button>\n      </span>\n      <span class=\"up-dot ok\" id=\"upDot\" title=\"connection\"></span>\n    </div>\n    <div class=\"header-body\">\n      <div class=\"avatar\">🤖<span class=\"cursor-blink\"></span></div>\n      <div class=\"header-info\">\n        <div class=\"header-name\">\n          MD-GHANI-BOT\n          <span class=\"ver\">v1.0</span>\n        </div>\n        <div class=\"header-sub\">\n          <span class=\"badge\"><span class=\"dot\"></span>ONLINE</span>\n          SESSION ACTIVE\n        </div>\n      </div>\n    </div>\n  </div>\n\n  <!-- Stats -->\n  <div class=\"stats-row\">\n    <div class=\"stat-card\">\n      <div class=\"val\" id=\"statPing\">24ms</div>\n      <div class=\"lbl\">Ping</div>\n    </div>\n    <div class=\"stat-card\">\n      <div class=\"val\">99.9%</div>\n      <div class=\"lbl\">Uptime</div>\n    </div>\n    <div class=\"stat-card\">\n      <div class=\"val\" id=\"statPairs\">0</div>\n      <div class=\"lbl\">Pairs</div>\n    </div>\n  </div>\n\n  <!-- Main Card -->\n  <div class=\"card\">\n    <span class=\"br\"></span><span class=\"bl2\"></span><span class=\"br2\"></span>\n    <div class=\"skull\">☠</div>\n\n    <div class=\"sec\">\n      <div class=\"sec-icon\">\n        <svg viewBox=\"0 0 24 24\">\n          <rect x=\"5\" y=\"2\" width=\"14\" height=\"20\" rx=\"3\"/>\n          <line x1=\"12\" y1=\"18\" x2=\"12\" y2=\"18.01\" stroke-width=\"3\"/>\n        </svg>\n      </div>\n      <div class=\"sec-info\">\n        <div class=\"sec-cmd\"><span class=\"dollar\">$</span> ./link-device --secure</div>\n        <div class=\"sec-title\">&gt; LINK_DEVICE<span class=\"gt\">_</span></div>\n        <div class=\"sec-desc\" data-i18n=\"secDesc\">Establish encrypted handshake with your WhatsApp</div>\n      </div>\n    </div>\n\n    <div class=\"field\">\n      <div class=\"field-label\">\n        <div class=\"left\">\n          <span class=\"num-badge\">01</span>\n          <span data-i18n=\"targetNum\">TARGET_NUMBER</span>\n        </div>\n        <span class=\"req\" data-i18n=\"req\">REQUIRED</span>\n      </div>\n      <div class=\"input-box\">\n        <div class=\"cc-box\">\n          <select id=\"ccSelect\" aria-label=\"Country code\" onchange=\"onCCChange()\">\n            <option value=\"\">🌐</option>\n            <option value=\"91\">🇮🇳 +91</option>\n            <option value=\"92\">🇵🇰 +92</option>\n            <option value=\"880\">🇧🇩 +880</option>\n            <option value=\"1\">🇺🇸 +1</option>\n            <option value=\"44\">🇬🇧 +44</option>\n            <option value=\"971\">🇦🇪 +971</option>\n            <option value=\"966\">🇸🇦 +966</option>\n            <option value=\"62\">🇮🇩 +62</option>\n            <option value=\"60\">🇲🇾 +60</option>\n            <option value=\"254\">🇰🇪 +254</option>\n            <option value=\"234\">🇳🇬 +234</option>\n            <option value=\"55\">🇧🇷 +55</option>\n          </select>\n          <span class=\"code\" id=\"ccText\">+</span>\n        </div>\n        <input id=\"phone\" type=\"tel\" inputmode=\"numeric\" autocomplete=\"tel\"\n               placeholder=\"enter country code + number\" maxlength=\"15\"/>\n        <button class=\"clr\" id=\"clearBtn\" type=\"button\" aria-label=\"Clear\">✕</button>\n      </div>\n      <div class=\"hint\">\n        <span class=\"arrow\">&gt;</span>\n        <span data-i18n=\"hintFmt\">format:</span> <code>91XXXXXXXXXX</code>\n        <span class=\"kbd\">CTRL+↵ EXEC</span>\n        <button class=\"paste-btn\" onclick=\"pasteNumber(event)\">[ PASTE ]</button>\n      </div>\n      <div class=\"chips\" id=\"chips\"></div>\n    </div>\n\n    <!-- BUTTON #1 -->\n    <div class=\"btn-wrap\">\n      <button class=\"term-btn primary\" id=\"btn\" onclick=\"pair(event)\">\n        <span class=\"spinner\"></span>\n        <span class=\"brackets\">[</span>\n        <span class=\"btn-txt\" data-i18n=\"btnPair\">EXECUTE_PAIR</span>\n        <span class=\"brackets\">]</span>\n        <span class=\"arrow\">\n          <svg viewBox=\"0 0 24 24\"><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/><polyline points=\"12 5 19 12 12 19\"/></svg>\n        </span>\n      </button>\n      <div class=\"sound-toggle\" id=\"soundToggle\" onclick=\"toggleSound(event)\" title=\"Sound\">\n        <svg viewBox=\"0 0 24 24\">\n          <polygon points=\"11 5 6 9 2 9 2 15 6 15 11 19 11 5\"/>\n          <path class=\"wave\" d=\"M15.54 8.46a5 5 0 0 1 0 7.07\" fill=\"none\" stroke=\"currentColor\"/>\n          <path class=\"wave\" d=\"M19.07 4.93a10 10 0 0 1 0 14.14\" fill=\"none\" stroke=\"currentColor\"/>\n        </svg>\n      </div>\n    </div>\n\n    <div class=\"progress-wrap\" id=\"progressWrap\">\n      <div class=\"progress-meta\">\n        <span>ESTABLISHING_HANDSHAKE...</span>\n        <span class=\"pct\" id=\"progressPct\">0%</span>\n      </div>\n      <div class=\"progress-bar\">\n        <div class=\"fill\" id=\"progressFill\"></div>\n      </div>\n    </div>\n\n    <!-- BUTTON #2 -->\n    <div class=\"btn-wrap\">\n      <a href=\"https://whatsapp.com/channel/120363429085670060\"\n         onclick=\"openChannel(event)\"\n         target=\"_blank\"\n         rel=\"noopener\"\n         class=\"term-btn secondary\"\n         id=\"channelBtn\">\n        <svg class=\"lead-icon\" viewBox=\"0 0 24 24\">\n          <path d=\"M12 2a10 10 0 0 0-8.6 15L2 22l5.1-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1.1.1-1.8-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 .9-2.2c.2-.3.5-.4.7-.4h.5c.2 0 .4-.1.6.4.2.5.7 1.8.8 1.9.1.1.1.3 0 .4-.1.2-.2.3-.3.5-.1.2-.3.4-.4.5-.1.1-.3.3-.1.5.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.4.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.2.1 1.5.7 1.8.8.3.1.4.2.5.3.1.2.1.7-.1 1.3z\"/>\n        </svg>\n        <span data-i18n=\"btnChannel\">JOIN_CHANNEL</span>\n        <span class=\"arrow\">\n          <svg viewBox=\"0 0 24 24\"><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/><polyline points=\"12 5 19 12 12 19\"/></svg>\n        </span>\n      </a>\n    </div>\n\n    <button class=\"mini-link-btn\" onclick=\"copyChannelLink()\">&#128279; COPY_CHANNEL_LINK</button>\n\n    <div class=\"trust\">\n      <div class=\"trust-item\">\n        <svg viewBox=\"0 0 24 24\"><path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"/></svg>\n        <span data-i18n=\"trust1\">AES-256</span>\n      </div>\n      <div class=\"trust-item\">\n        <svg viewBox=\"0 0 24 24\"><polyline points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"/></svg>\n        <span data-i18n=\"trust2\">0-Delay</span>\n      </div>\n      <div class=\"trust-item\">\n        <svg viewBox=\"0 0 24 24\"><polyline points=\"20 6 9 17 4 12\"/></svg>\n        <span data-i18n=\"trust3\">Verified</span>\n      </div>\n    </div>\n\n    <div class=\"result\" id=\"codeBox\">\n      <div class=\"result-head\">\n        <div class=\"result-tag\">\n          <span class=\"dot\"></span>\n          <span data-i18n=\"codeDeployed\">CODE_DEPLOYED</span>\n        </div>\n        <div class=\"timer-circle\" id=\"timerBox\">\n          <span class=\"txt\" id=\"countdown\">120</span>\n        </div>\n      </div>\n      <div class=\"code-val\" id=\"out\">— — — — — — — —</div>\n      <div class=\"res-actions\">\n        <button class=\"copy\" id=\"copyBtn\" onclick=\"copyCode()\">\n          <svg viewBox=\"0 0 24 24\"><rect x=\"9\" y=\"9\" width=\"13\" height=\"13\" rx=\"2\"/><path d=\"M5 15V5a2 2 0 0 1 2-2h10\"/></svg>\n          <span data-i18n=\"copyBtn\">COPY_CODE</span>\n        </button>\n        <button onclick=\"resetForm()\">\n          <svg viewBox=\"0 0 24 24\"><polyline points=\"23 4 23 10 17 10\"/><path d=\"M20.49 15a9 9 0 1 1-2.12-9.36L23 10\"/></svg>\n          <span data-i18n=\"resetBtn\">RESET</span>\n        </button>\n      </div>\n      <button class=\"regen-btn\" id=\"regenBtn\" onclick=\"regen(event)\" style=\"display:none\">&#8635; <span data-i18n=\"regen\">REGENERATE_CODE</span></button>\n    </div>\n\n    <div class=\"steps\" id=\"steps\" style=\"display:none\">\n      <div class=\"steps-head\">\n        <div class=\"left\">\n          <svg viewBox=\"0 0 24 24\"><polyline points=\"9 11 12 14 22 4\"/><path d=\"M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11\"/></svg>\n          <span data-i18n=\"execSeq\">EXECUTION_SEQUENCE</span>\n        </div>\n        <span class=\"count\">[4]</span>\n      </div>\n      <div class=\"step\"><span class=\"n\">1</span><span data-i18n=\"step1\">Open <b>WhatsApp</b> on your device</span></div>\n      <div class=\"step\"><span class=\"n\">2</span><span data-i18n=\"step2\">Go to <b>Settings → Linked Devices</b></span></div>\n      <div class=\"step\"><span class=\"n\">3</span><span data-i18n=\"step3\">Tap <b>Link a Device → Link with phone number</b></span></div>\n      <div class=\"step\"><span class=\"n\">4</span><span data-i18n=\"step4\">Enter the code shown above</span></div>\n    </div>\n\n    <!-- CHANNEL QR -->\n    <div class=\"qr-panel\" id=\"qrPanel\">\n      <div class=\"qr-head\">\n        <span>// CHANNEL_QR</span>\n        <span class=\"qr-x\" onclick=\"document.getElementById('qrPanel').style.display='none'\">[x]</span>\n      </div>\n      <img class=\"qr-img\" alt=\"channel qr\"\n           src=\"https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=https%3A%2F%2Fwhatsapp.com%2Fchannel%2F120363429085670060\"\n           onload=\"log('ok','channel QR loaded')\"\n           onerror=\"this.closest('.qr-panel').style.display='none';log('wrn','QR service unreachable — panel hidden')\"/>\n      <div class=\"qr-sub\">scan to join channel</div>\n    </div>\n\n    <!-- SESSION HISTORY -->\n    <div class=\"hist-panel\" id=\"histPanel\">\n      <div class=\"log-head\">\n        <span>// SESSION_HISTORY</span>\n        <span><button class=\"export-btn\" onclick=\"clearHistory()\">[ CLEAR ]</button></span>\n      </div>\n      <div class=\"hist-body\" id=\"histBody\"></div>\n    </div>\n\n    <!-- SYSTEM LOG -->\n    <div class=\"log\">\n      <div class=\"log-head\">\n        <span>// SYSTEM_LOG</span>\n        <span><button class=\"export-btn\" onclick=\"exportLog()\">⇩ EXPORT</button><span class=\"live\">● LIVE</span></span>\n      </div>\n      <div class=\"log-body\" id=\"logBody\"></div>\n    </div>\n\n    <div class=\"alert\" id=\"alert\">\n      <span class=\"ic\" id=\"alertIc\">\n        <svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"12\" y1=\"8\" x2=\"12\" y2=\"12\"/><line x1=\"12\" y1=\"16\" x2=\"12\" y2=\"16.01\"/></svg>\n      </span>\n      <span id=\"alertMsg\"></span>\n    </div>\n\n  </div>\n\n  <!-- Footer -->\n  <div class=\"footer\">\n    <div class=\"footer-meta\">\n      <span class=\"val\">\n        <svg viewBox=\"0 0 24 24\"><polyline points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"/></svg>\n        <span data-i18n=\"f1\">FAST</span>\n      </span>\n      <span class=\"sep\"></span>\n      <span class=\"val\">\n        <svg viewBox=\"0 0 24 24\"><path d=\"M22 11.08V12a10 10 0 1 1-5.93-9.14\"/><polyline points=\"22 4 12 14.01 9 11.01\"/></svg>\n        <span data-i18n=\"f2\">ALWAYS-ON</span>\n      </span>\n      <span class=\"sep\"></span>\n      <span class=\"val\">\n        <svg viewBox=\"0 0 24 24\"><path d=\"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/></svg>\n        <span data-i18n=\"f3\">MULTI-USER</span>\n      </span>\n      <span class=\"sep\"></span>\n      <span class=\"val\">&#9201; <span id=\"uptime\">00:00:00</span></span>\n    </div>\n  </div>\n\n</div>\n\n<!-- KEYS overlay -->\n<div class=\"overlay\" id=\"keysOverlay\" onclick=\"if(event.target===this)toggleKeys(event)\">\n  <div class=\"keys-panel\">\n    <div class=\"keys-title\">// KEYBOARD_SHORTCUTS</div>\n    <div class=\"key-row\"><span class=\"kbd\">CTRL + &#8629;</span><span>execute pair command</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">C</span><span>copy pairing code</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">R</span><span>reset form</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">M</span><span>toggle matrix rain intensity</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">F</span><span>toggle fullscreen</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">?</span><span>toggle this panel</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">ESC</span><span>close panel</span></div>\n    <button class=\"keys-close\" onclick=\"toggleKeys(event)\">[ CLOSE ]</button>\n  </div>\n</div>\n\n<script>\n/* ═══ BOOT SEQUENCE ═══ */\n(function(){\n  const boot = document.getElementById('boot');\n  const lines = document.getElementById('bootLines');\n  const seq = [\n    {t:'MD-GHANI OS v1.0 — SECURE BOOT', c:'', delay:0},\n    {t:'> loading crypto modules', c:'dim', delay:280},\n    {t:'  [OK] aes-256 engine', c:'ok', delay:420},\n    {t:'> establishing uplink', c:'dim', delay:420},\n    {t:'  [OK] handshake ready', c:'ok', delay:420},\n    {t:'> access granted_', c:'', delay:380},\n  ];\n  let total = 0;\n  seq.forEach(item => {\n    total += item.delay;\n    setTimeout(() => {\n      const div = document.createElement('div');\n      if (item.c) div.className = item.c;\n      div.textContent = item.t;\n      lines.appendChild(div);\n      Sound.type();\n    }, total);\n  });\n  setTimeout(() => {\n    boot.classList.add('done');\n    setTimeout(() => boot.remove(), 500);\n  }, total + 550);\n})();\n\n/* ═══ Matrix rain ═══ */\n(function(){\n  const chars = '01アイウエオカキクケコサシスセソ0123456789ABCDEF<>/{}#$';\n  for (let i = 0; i < 14; i++){\n    const col = document.createElement('div');\n    col.className = 'rain';\n    let text = '';\n    const len = 12 + Math.floor(Math.random() * 14);\n    for (let j = 0; j < len; j++) text += chars[Math.floor(Math.random() * chars.length)];\n    col.textContent = text;\n    col.style.left = (Math.random() * 96) + 'vw';\n    col.style.animationDuration = (9 + Math.random() * 12) + 's';\n    col.style.animationDelay = (-Math.random() * 14) + 's';\n    col.style.opacity = .25 + Math.random() * .35;\n    if (Math.random() > .85) col.style.color = 'rgba(255,184,0,.3)';\n    document.body.appendChild(col);\n  }\n})();\n\n/* ═══ SYSTEM LOG ═══ */\nfunction log(type, msg){\n  const body = document.getElementById('logBody');\n  if (!body) return;\n  const now = new Date();\n  const t = now.toTimeString().slice(0,8);\n  const div = document.createElement('div');\n  div.className = 'log-line t-' + type;\n  const tag = {ok:'OK ', err:'ERR', inf:'INF', wrn:'WRN'}[type] || 'INF';\n  div.innerHTML = '<span class=\"t\">[' + t + ']</span><b>[' + tag + ']</b> ' + msg;\n  body.appendChild(div);\n  while (body.children.length > 30) body.removeChild(body.firstChild);\n  body.scrollTop = body.scrollHeight;\n}\n\n/* ═══ SOUND ENGINE ═══ */\nfunction buzz(p){\n  if (navigator.vibrate){ try{ navigator.vibrate(p); }catch(e){} }\n}\n\nconst Sound = {\n  ctx: null,\n  enabled: true,\n  wave: 'mix',\n  init(){\n    if (this.ctx) return;\n    try {\n      const AC = window.AudioContext || window.webkitAudioContext;\n      this.ctx = new AC();\n    } catch(e){}\n  },\n  resume(){\n    this.init();\n    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();\n  },\n  tone({freq=440, dur=0.15, type='square', vol=0.15, slide=null, delay=0}){\n    if (!this.enabled) return;\n    this.init();\n    if (!this.ctx) return;\n    const t0 = this.ctx.currentTime + delay;\n    const osc = this.ctx.createOscillator();\n    const gain = this.ctx.createGain();\n    osc.type = (Sound.wave === 'mix') ? type : Sound.wave;\n    osc.frequency.setValueAtTime(freq, t0);\n    if (slide) osc.frequency.exponentialRampToValueAtTime(slide.to, t0 + (slide.time || dur));\n    gain.gain.setValueAtTime(0, t0);\n    gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);\n    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);\n    osc.connect(gain);\n    gain.connect(this.ctx.destination);\n    osc.start(t0);\n    osc.stop(t0 + dur + 0.05);\n  },\n  click(){ buzz(10); this.tone({freq:1200, dur:0.05, type:'square', vol:0.12}); },\n  type(){ this.tone({freq:1800 + Math.random()*400, dur:0.02, type:'square', vol:0.04}); },\n  success(){\n    buzz([30,40,30]);\n    this.tone({freq:523, dur:0.09, type:'square', vol:0.13});\n    this.tone({freq:659, dur:0.09, type:'square', vol:0.13, delay:0.1});\n    this.tone({freq:784, dur:0.09, type:'square', vol:0.13, delay:0.2});\n    this.tone({freq:1047, dur:0.28, type:'square', vol:0.13, delay:0.3});\n  },\n  error(){\n    buzz([60,50,60]);\n    this.tone({freq:300, dur:0.15, type:'sawtooth', vol:0.1});\n    this.tone({freq:200, dur:0.22, type:'sawtooth', vol:0.1, delay:0.12});\n  },\n  copy(){\n    buzz(15);\n    this.tone({freq:900, dur:0.05, type:'square', vol:0.11});\n    this.tone({freq:1350, dur:0.07, type:'square', vol:0.11, delay:0.06});\n  },\n  toggleOn(){\n    this.tone({freq:800, dur:0.06, type:'square', vol:0.11});\n    this.tone({freq:1100, dur:0.08, type:'square', vol:0.11, delay:0.07});\n  },\n  toggleOff(){\n    this.tone({freq:1100, dur:0.06, type:'square', vol:0.11});\n    this.tone({freq:700, dur:0.08, type:'square', vol:0.11, delay:0.07});\n  },\n  tick(){ this.tone({freq:1500, dur:0.02, type:'square', vol:0.06}); }\n};\n\nconst soundToggle = document.getElementById('soundToggle');\nfunction toggleSound(e){\n  e.stopPropagation();\n  Sound.resume();\n  Sound.enabled = !Sound.enabled;\n  soundToggle.classList.toggle('muted', !Sound.enabled);\n  if (Sound.enabled) Sound.toggleOn(); else Sound.toggleOff();\n  log('inf', 'audio engine ' + (Sound.enabled ? 'enabled' : 'muted'));\n}\n['click','touchstart','keydown'].forEach(evt => {\n  document.addEventListener(evt, () => Sound.resume(), {once:true, passive:true});\n});\n\n/* CRT toggle */\nfunction toggleCRT(e){\n  e.stopPropagation();\n  Sound.click();\n  document.body.classList.toggle('crt-off');\n  const on = !document.body.classList.contains('crt-off');\n  document.getElementById('crtBtn').textContent = on ? 'CRT:ON' : 'CRT:OFF';\n  log('inf', 'CRT effects ' + (on ? 'enabled' : 'disabled'));\n}\n\n/* Elements */\nconst phoneEl       = document.getElementById('phone');\nconst btn           = document.getElementById('btn');\nconst btnTxt        = btn.querySelector('.btn-txt');\nconst outEl         = document.getElementById('out');\nconst codeBox       = document.getElementById('codeBox');\nconst stepsEl       = document.getElementById('steps');\nconst alertEl       = document.getElementById('alert');\nconst alertMsg      = document.getElementById('alertMsg');\nconst alertIc       = document.getElementById('alertIc');\nconst clearBtn      = document.getElementById('clearBtn');\nconst ccText        = document.getElementById('ccText');\nconst ccSelect      = document.getElementById('ccSelect');\nconst statPing      = document.getElementById('statPing');\nconst progressWrap  = document.getElementById('progressWrap');\nconst progressFill  = document.getElementById('progressFill');\nconst progressPct   = document.getElementById('progressPct');\nconst countdownEl   = document.getElementById('countdown');\nconst timerBox      = document.getElementById('timerBox');\n\nconst ICON_ERR = '<svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"12\" y1=\"8\" x2=\"12\" y2=\"12\"/><line x1=\"12\" y1=\"16\" x2=\"12\" y2=\"16.01\"/></svg>';\nconst ICON_OK  = '<svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"8 12 11 15 16 9\"/></svg>';\n\nlet currentCode = '';\nlet pairCount = 0;\nlet pairRetry = false;\nlet typeTimer = null;\nlet countdownTimer = null;\nlet progressTimer = null;\nlet selectedCC = '';\n\nconst bootTime = Date.now();\nsetInterval(() => {\n  const ping = 18 + Math.floor(Math.random() * 14);\n  statPing.textContent = ping + 'ms';\n  const dot = document.getElementById('upDot');\n  if (dot) dot.className = 'up-dot ' + (ping < 28 ? 'ok' : ping < 40 ? 'warn' : 'bad');\n}, 2500);\n\nsetInterval(() => {\n  const s = Math.floor((Date.now() - bootTime) / 1000);\n  const hh = String(Math.floor(s / 3600)).padStart(2,'0');\n  const mm = String(Math.floor((s % 3600) / 60)).padStart(2,'0');\n  const ss = String(s % 60).padStart(2,'0');\n  const el = document.getElementById('uptime');\n  if (el) el.textContent = hh + ':' + mm + ':' + ss;\n}, 1000);\n\nfunction showToast(title, desc){\n  const container = document.querySelector('.toast-container') || (() => {\n    const c = document.createElement('div');\n    c.className = 'toast-container';\n    document.body.appendChild(c);\n    return c;\n  })();\n  const toast = document.createElement('div');\n  toast.className = 'toast';\n  toast.innerHTML = `\n    <div class=\"toast-icon\"><svg viewBox=\"0 0 24 24\"><polyline points=\"20 6 9 17 4 12\"/></svg></div>\n    <div class=\"toast-body\">\n      <div class=\"toast-title\">${title}</div>\n      <div class=\"toast-desc\">${desc}</div>\n    </div>\n  `;\n  container.appendChild(toast);\n  setTimeout(() => {\n    toast.classList.add('leaving');\n    setTimeout(() => toast.remove(), 300);\n  }, 3000);\n}\n\n/* Country code picker */\nfunction onCCChange(){\n  Sound.click();\n  selectedCC = ccSelect.value;\n  ccText.textContent = selectedCC ? '+' + selectedCC : '+';\n  if (selectedCC && phoneEl.value && !phoneEl.value.startsWith(selectedCC)){\n    phoneEl.value = '';\n  }\n  if (selectedCC){\n    phoneEl.placeholder = 'number without ' + selectedCC;\n    phoneEl.focus();\n  } else {\n    phoneEl.placeholder = 'enter country code + number';\n  }\n  log('inf', 'country code set → +' + (selectedCC || 'auto'));\n}\n\n/* Recent numbers */\nconst RECENT_KEY = 'mdghani_recent';\nfunction getRecent(){\n  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }\n  catch(e){ return []; }\n}\nfunction saveRecent(num){\n  let list = getRecent().filter(n => n !== num);\n  list.unshift(num);\n  list = list.slice(0, 3);\n  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch(e){}\n  renderChips();\n}\nfunction renderChips(){\n  const box = document.getElementById('chips');\n  const list = getRecent();\n  box.innerHTML = '';\n  list.forEach(num => {\n    const c = document.createElement('button');\n    c.className = 'chip';\n    c.type = 'button';\n    c.textContent = num;\n    c.onclick = () => {\n      Sound.click();\n      phoneEl.value = num;\n      clearBtn.classList.add('show');\n      ccText.textContent = '+' + num.slice(0,2);\n      log('inf', 'recent number loaded → ' + num);\n      phoneEl.focus();\n    };\n    box.appendChild(c);\n  });\n}\nrenderChips();\n\nphoneEl.addEventListener('input', () => {\n  phoneEl.value = phoneEl.value.replace(/[^\\d]/g,'');\n  clearBtn.classList.toggle('show', phoneEl.value.length > 0);\n  ccText.textContent = phoneEl.value ? '+' + phoneEl.value.slice(0,2) : (selectedCC ? '+' + selectedCC : '+');\n  if (phoneEl.value.length > 0) Sound.type();\n});\nphoneEl.addEventListener('focus', () => log('inf', 'target field focused'));\nclearBtn.onclick = () => {\n  Sound.click();\n  phoneEl.value = '';\n  clearBtn.classList.remove('show');\n  ccText.textContent = selectedCC ? '+' + selectedCC : '+';\n  phoneEl.focus();\n};\n\nfunction showAlert(type, msg){\n  alertEl.className = 'alert show ' + type;\n  alertIc.innerHTML = type === 'error' ? ICON_ERR : ICON_OK;\n  alertMsg.textContent = msg;\n}\nfunction hideAlert(){ alertEl.className = 'alert'; }\n\nfunction animateProgress(duration){\n  progressWrap.classList.add('active');\n  let pct = 0;\n  progressFill.style.width = '0%';\n  progressPct.textContent = '0%';\n  clearInterval(progressTimer);\n  progressTimer = setInterval(() => {\n    pct += Math.random() * 12 + 4;\n    if (pct >= 100){ pct = 100; clearInterval(progressTimer); }\n    progressFill.style.width = pct + '%';\n    progressPct.textContent = Math.floor(pct) + '%';\n  }, duration / 12);\n}\nfunction resetProgress(){\n  clearInterval(progressTimer);\n  progressFill.style.width = '0%';\n  progressPct.textContent = '0%';\n  progressWrap.classList.remove('active');\n}\nfunction setLoading(on, text){\n  btn.disabled = on;\n  btn.classList.toggle('loading', on);\n  btnTxt.textContent = text || (on ? 'PROCESSING' : 'EXECUTE_PAIR');\n  if (on) animateProgress(2400);\n  else resetProgress();\n}\n\nfunction startCountdown(){\n  clearInterval(countdownTimer);\n  document.title = '&#9889; CODE ACTIVE — MD-Ghani-Bot';\n  let t = 120;\n  countdownEl.textContent = t;\n  timerBox.classList.remove('danger');\n  countdownTimer = setInterval(() => {\n    t--;\n    if (t <= 0){\n      t = 0;\n      clearInterval(countdownTimer);\n      countdownEl.textContent = '0';\n      Sound.error();\n      showAlert('error','ERR_CODE_EXPIRED — generate a new one.');\n      log('err', 'pairing code expired');\n      codeBox.classList.remove('show');\n      stepsEl.style.display = 'none';\n      document.getElementById('regenBtn').style.display = 'block';\n      return;\n    }\n    countdownEl.textContent = t;\n    if (t <= 20){\n      timerBox.classList.add('danger');\n      if (t % 2 === 0) Sound.tick();\n      if (t <= 5){ Sound.tick(); buzz(25); }\n    }\n  }, 1000);\n}\nfunction stopCountdown(){\n  clearInterval(countdownTimer);\n  document.title = 'MD-Ghani-Bot • TERMINAL PRO+';\n}\n\nfunction formatCode(code){\n  return code.replace(/(\\d{4})(?=\\d)/g, '$1-');\n}\n\nfunction regen(e){\n  Sound.click();\n  log('wrn', 'manual regenerate requested');\n  pair(e);\n}\n\nfunction typeCode(code){\n  clearInterval(typeTimer);\n  outEl.textContent = '';\n  const chars = [];\n  let i = 0;\n  typeTimer = setInterval(() => {\n    if (i >= code.length){\n      clearInterval(typeTimer);\n      outEl.textContent = formatCode(code);\n      return;\n    }\n    chars.push(code[i]);\n    outEl.textContent = formatCode(chars.join('')) + (i < code.length - 1 ? '_' : '');\n    Sound.tick();\n    i++;\n  }, 90);\n}\n\nfunction shakeInput(){\n  const box = document.querySelector('.input-box');\n  box.classList.remove('shake');\n  void box.offsetWidth;\n  box.classList.add('shake');\n  buzz([50,40,50]);\n}\n\nasync function pair(e){\n  Sound.resume();\n  Sound.click();\n\n  hideAlert();\n  stopCountdown();\n  document.getElementById('regenBtn').style.display = 'none';\n\n  /* Merge country code if selected via dropdown */\n  let raw = phoneEl.value.trim();\n  let phone = raw;\n  if (selectedCC && raw && !raw.startsWith(selectedCC)){\n    phone = selectedCC + raw;\n  }\n\n  if (!phone) { Sound.error(); shakeInput(); showAlert('error','ERROR: target number required.'); phoneEl.focus(); return; }\n  if (phone.length < 8) { Sound.error(); shakeInput(); showAlert('error','ERROR: number too short — include country code.'); log('err','validation failed: too short'); return; }\n  if (phone.length > 15) { Sound.error(); shakeInput(); showAlert('error','ERROR: number too long — verify and retry.'); log('err','validation failed: too long'); return; }\n\n  setLoading(true, 'PROCESSING');\n  codeBox.classList.remove('show');\n  stepsEl.style.display = 'none';\n  log('inf', 'pair request → +' + phone);\n  log('wrn', 'awaiting server response...');\n\n  try {\n    const res = await fetch('/pair', {\n      method:'POST',\n      headers:{ 'Content-Type':'application/json' },\n      body: JSON.stringify({ phone })\n    });\n    const data = await res.json();\n\n    if (data.ok && data.code){\n      pairRetry = false;\n      currentCode = String(data.code);\n      typeCode(currentCode);\n      autoCopyCode();\n      codeBox.classList.add('show');\n      stepsEl.style.display = 'grid';\n      showAlert('success','OK: code deployed — link within 2 minutes.');\n      setLoading(false, 'EXECUTE_PAIR');\n      startCountdown();\n      Sound.success();\n      showToast('ACCESS GRANTED', 'Pairing code generated successfully');\n      saveRecent(phone);\n      addHistory(phone);\n      pairCount++;\n      document.getElementById('statPairs').textContent = pairCount;\n      log('ok', 'code received → ' + currentCode);\n      log('ok', 'session window: 120s');\n      setTimeout(()=>codeBox.scrollIntoView({behavior:'smooth',block:'nearest'}),150);\n    } else {\n      setLoading(false, 'EXECUTE_PAIR');\n      Sound.error();\n      showAlert('error', 'FAIL: ' + (data.error || 'execution failed — retry.'));\n      log('err', 'server rejected: ' + (data.error || 'unknown'));\n    }\n  } catch (err){\n    if (!pairRetry){\n      pairRetry = true;\n      log('wrn', 'connection failed — auto-retry in 2s...');\n      btnTxt.textContent = 'RETRYING';\n      showToast('RETRYING', 'connection failed — trying again automatically');\n      setTimeout(() => { if (pairRetry) pair(e); }, 2000);\n      return;\n    }\n    pairRetry = false;\n    setLoading(false, 'EXECUTE_PAIR');\n    Sound.error();\n    showAlert('error','ERR_CONNECTION: ' + (err.message || 'server unreachable'));\n    log('err', 'network failure: ' + (err.message || 'unreachable'));\n  }\n}\n\nfunction copyCode(){\n  if (!currentCode) return;\n  Sound.copy();\n  const done = () => {\n    const b = document.getElementById('copyBtn');\n    if (b.dataset.orig === undefined) b.dataset.orig = b.innerHTML;\n    b.classList.add('copied');\n    b.innerHTML = '<svg viewBox=\"0 0 24 24\"><polyline points=\"20 6 9 17 4 12\"/></svg> COPIED';\n    showToast('BUFFER SAVED', 'Pairing code copied to clipboard');\n    log('ok', 'code copied to clipboard');\n    setTimeout(()=>{\n      b.classList.remove('copied');\n      b.innerHTML = b.dataset.orig;\n    }, 1800);\n  };\n  if (navigator.clipboard && navigator.clipboard.writeText){\n    navigator.clipboard.writeText(currentCode).then(done).catch(()=>fallbackCopy(done));\n  } else fallbackCopy(done);\n}\nfunction fallbackCopy(cb){\n  const t = document.createElement('textarea');\n  t.value = currentCode; document.body.appendChild(t);\n  t.select(); try{ document.execCommand('copy'); cb(); }catch(_){}\n  document.body.removeChild(t);\n}\n\nfunction resetForm(){\n  if (currentCode && !confirm('Abort current pairing session?')) return;\n  Sound.click();\n  stopCountdown();\n  clearInterval(typeTimer);\n  currentCode = '';\n  phoneEl.value = '';\n  clearBtn.classList.remove('show');\n  ccText.textContent = selectedCC ? '+' + selectedCC : '+';\n  outEl.textContent = '— — — — — — — —';\n  codeBox.classList.remove('show');\n  stepsEl.style.display = 'none';\n  resetProgress();\n  hideAlert();\n  log('inf', 'form state reset');\n  phoneEl.focus();\n}\n\nphoneEl.addEventListener('keydown', e => {\n  if (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) pair(e);\n});\n\n/* ═══ PRO+ FEATURES ═══ */\nconst I18N = {\n  en: {},\n  hi: {\n    secDesc: 'Apne WhatsApp se secure handshake establish karein',\n    targetNum: 'टारगेट नंबर',\n    req: 'ज़रूरी',\n    phonePh: 'country code + number daalein',\n    hintFmt: 'format:',\n    btnPair: 'पेयर कोड लें',\n    btnChannel: 'चैनल ज्वॉइन करें',\n    trust1: 'AES-256', trust2: '0-डिले', trust3: 'वेरीफाइड',\n    codeDeployed: 'कोड तैयार',\n    copyBtn: 'कॉपी करें', resetBtn: 'रीसेट',\n    regen: 'नया कोड बनाएं',\n    execSeq: 'एक्ज़ीक्यूशन सीक्वेंस',\n    step1: 'Apne device pe <b>WhatsApp</b> kholein',\n    step2: '<b>Settings → Linked Devices</b> pe jayein',\n    step3: '<b>Link a Device → Link with phone number</b> tap karein',\n    step4: 'Upar diya hua code enter karein',\n    f1: 'फास्ट', f2: 'हमेशा-ऑन', f3: 'मल्टी-यूज़र'\n  }\n};\nlet curLang = 'en';\nfunction setLang(l, silent){\n  curLang = l;\n  document.querySelectorAll('[data-i18n]').forEach(el => {\n    if (el.dataset.en === undefined) el.dataset.en = el.innerHTML;\n    const dict = I18N[l] || {};\n    el.innerHTML = (l === 'en' || dict[el.getAttribute('data-i18n')] === undefined)\n      ? el.dataset.en : dict[el.getAttribute('data-i18n')];\n  });\n  phoneEl.placeholder = (l === 'hi') ? I18N.hi.phonePh : 'enter country code + number';\n  document.getElementById('langBtn').textContent = (l === 'en') ? 'EN' : 'हिं';\n  try { localStorage.setItem('mdghani_lang', l); } catch(e){}\n  if (!silent){ Sound.click(); log('inf', 'language → ' + l); }\n}\nfunction cycleLang(e){\n  e.stopPropagation();\n  setLang(curLang === 'en' ? 'hi' : 'en');\n}\n\nconst SND_PRESETS = ['MIX','SOFT','DEEP'];\nlet curSnd = 'MIX';\nfunction setSnd(p, silent){\n  curSnd = p;\n  Sound.wave = {MIX:'mix', SOFT:'sine', DEEP:'sawtooth'}[p] || 'mix';\n  document.getElementById('sndBtn').textContent = 'SND:' + p;\n  try { localStorage.setItem('mdghani_snd', p); } catch(e){}\n  if (!silent){ Sound.toggleOn(); log('inf', 'sound preset → ' + p); }\n}\nfunction cycleSnd(e){\n  e.stopPropagation();\n  const i = (SND_PRESETS.indexOf(curSnd) + 1) % SND_PRESETS.length;\n  setSnd(SND_PRESETS[i]);\n}\n\nfunction setPhosphor(name, silent){\n  document.body.classList.remove('ph-amber','ph-cyan','ph-pink');\n  if (name !== 'green') document.body.classList.add('ph-' + name);\n  document.querySelectorAll('.sw').forEach(s => s.classList.remove('on'));\n  const btn = document.querySelector('.sw-' + name);\n  if (btn) btn.classList.add('on');\n  try { localStorage.setItem('mdghani_ph', name); } catch(e){}\n  if (!silent){ Sound.click(); log('inf', 'phosphor color → ' + name); }\n}\n\nfunction copyChannelLink(){\n  Sound.copy();\n  const link = 'https://whatsapp.com/channel/120363429085670060';\n  const done = () => {\n    showToast('LINK COPIED', 'Channel link saved to clipboard');\n    log('ok', 'channel link copied to clipboard');\n  };\n  if (navigator.clipboard && navigator.clipboard.writeText){\n    navigator.clipboard.writeText(link).then(done).catch(()=>{});\n  } else {\n    const t = document.createElement('textarea');\n    t.value = link; document.body.appendChild(t);\n    t.select(); try{ document.execCommand('copy'); done(); }catch(e){}\n    document.body.removeChild(t);\n  }\n}\n\nlet rainBoost = false;\nfunction toggleRain(){\n  Sound.click();\n  rainBoost = !rainBoost;\n  document.querySelectorAll('.rain.extra').forEach(el => el.remove());\n  if (rainBoost){\n    const chars = '01アイウエオカキクケコサシスセソ<>/{}#$';\n    for (let i = 0; i < 18; i++){\n      const col = document.createElement('div');\n      col.className = 'rain extra';\n      let text = '';\n      const len = 14 + Math.floor(Math.random() * 16);\n      for (let j = 0; j < len; j++) text += chars[Math.floor(Math.random() * chars.length)];\n      col.textContent = text;\n      col.style.left = (Math.random() * 96) + 'vw';\n      col.style.animationDuration = (6 + Math.random() * 8) + 's';\n      col.style.animationDelay = (-Math.random() * 10) + 's';\n      col.style.opacity = .3 + Math.random() * .4;\n      document.body.appendChild(col);\n    }\n    log('wrn', 'matrix rain intensity → MAXIMUM');\n    showToast('MATRIX MODE', 'background rain boosted');\n  } else {\n    log('inf', 'matrix rain intensity → normal');\n  }\n}\n\nfunction pasteNumber(e){\n  e.stopPropagation();\n  Sound.click();\n  if (!navigator.clipboard || !navigator.clipboard.readText){\n    Sound.error();\n    showToast('PASTE FAILED', 'clipboard access not available');\n    log('err', 'clipboard read unsupported on this device');\n    return;\n  }\n  navigator.clipboard.readText().then(txt => {\n    const digits = (txt || '').replace(/[^\\d]/g, '');\n    if (digits.length >= 8 && digits.length <= 15){\n      phoneEl.value = digits;\n      clearBtn.classList.add('show');\n      ccText.textContent = '+' + digits.slice(0,2);\n      Sound.copy();\n      showToast('PASTED', 'number loaded from clipboard');\n      log('ok', 'number pasted from clipboard → +' + digits);\n    } else {\n      Sound.error();\n      showToast('INVALID', 'clipboard has no valid number');\n      log('err', 'clipboard content invalid (' + digits.length + ' digits)');\n    }\n  }).catch(() => {\n    Sound.error();\n    showToast('PASTE FAILED', 'clipboard permission denied');\n    log('err', 'clipboard permission denied');\n  });\n}\n\n/* ═══ BATCH 5 FEATURES ═══ */\nconst HIST_KEY = 'mdghani_history';\nfunction getHist(){\n  try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; }\n  catch(e){ return []; }\n}\nfunction addHistory(phone){\n  const list = getHist();\n  list.unshift({ t: Date.now(), n: phone });\n  try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 5))); } catch(e){}\n  renderHist();\n}\nfunction renderHist(){\n  const body = document.getElementById('histBody');\n  if (!body) return;\n  const list = getHist();\n  body.innerHTML = '';\n  if (!list.length){\n    body.innerHTML = '<div class=\"hist-empty\">// no sessions recorded</div>';\n    return;\n  }\n  list.forEach(item => {\n    const d = new Date(item.t);\n    const ts = d.toLocaleDateString(undefined, {day:'2-digit', month:'2-digit'})\n      + ' ' + d.toTimeString().slice(0,5);\n    const div = document.createElement('div');\n    div.className = 'hist-line';\n    div.innerHTML = '<span class=\"n\">+' + item.n + '</span><span class=\"t\">' + ts + '</span>';\n    body.appendChild(div);\n  });\n}\nfunction clearHistory(){\n  Sound.click();\n  try { localStorage.removeItem(HIST_KEY); } catch(e){}\n  renderHist();\n  log('wrn', 'session history cleared');\n  showToast('CLEARED', 'pair history removed');\n}\n\nfunction autoCopyCode(){\n  if (!navigator.clipboard || !navigator.clipboard.writeText) return;\n  navigator.clipboard.writeText(currentCode).then(() => {\n    showToast('AUTO-COPIED', 'code saved — paste directly in WhatsApp');\n    log('ok', 'code auto-copied to clipboard');\n  }).catch(() => {});\n}\n\nfunction togglePerf(e){\n  if (e) e.stopPropagation();\n  Sound.click();\n  document.body.classList.toggle('perf');\n  const on = document.body.classList.contains('perf');\n  document.getElementById('perfBtn').textContent = on ? 'PERF:ON' : 'PERF:OFF';\n  try { localStorage.setItem('mdghani_perf', on ? '1' : '0'); } catch(e2){}\n  log('inf', 'performance mode → ' + (on ? 'LITE (heavy fx off)' : 'FULL'));\n  showToast(on ? 'LITE MODE' : 'FULL MODE', on ? 'heavy animations disabled' : 'all effects enabled');\n}\n\nfunction toggleFullscreen(){\n  Sound.click();\n  if (!document.fullscreenElement){\n    if (document.documentElement.requestFullscreen){\n      document.documentElement.requestFullscreen().catch(() => {\n        showToast('BLOCKED', 'fullscreen not allowed');\n      });\n      log('inf', 'fullscreen → ON');\n    }\n  } else if (document.exitFullscreen){\n    document.exitFullscreen();\n    log('inf', 'fullscreen → OFF');\n  }\n}\n\nwindow.addEventListener('offline', () => {\n  Sound.error();\n  showAlert('error', 'OFFLINE — network connection lost');\n  log('err', 'network offline — waiting for reconnect');\n  const dot = document.getElementById('upDot');\n  if (dot) dot.className = 'up-dot bad';\n  const b = document.getElementById('statPing');\n  if (b) b.textContent = '--';\n});\nwindow.addEventListener('online', () => {\n  Sound.success();\n  showAlert('success', 'BACK ONLINE — connection restored');\n  log('ok', 'network restored — uplink re-established');\n  buzz([30,40,30]);\n});\n\nfunction exportLog(){\n  Sound.copy();\n  const body = document.getElementById('logBody');\n  const lines = Array.from(body.children).map(c => c.textContent).join('\\n');\n  const blob = new Blob(['MD-GHANI SYSTEM LOG\\nexported: ' + new Date().toISOString() + '\\n' + '='.repeat(40) + '\\n\\n' + lines + '\\n'], {type:'text/plain'});\n  const a = document.createElement('a');\n  a.href = URL.createObjectURL(blob);\n  a.download = 'mdghani-log.txt';\n  document.body.appendChild(a);\n  a.click();\n  document.body.removeChild(a);\n  URL.revokeObjectURL(a.href);\n  showToast('LOG EXPORTED', 'system log saved as .txt file');\n  log('ok', 'log exported to mdghani-log.txt');\n}\n\nfunction toggleKeys(e){\n  if (e) e.stopPropagation();\n  Sound.click();\n  document.getElementById('keysOverlay').classList.toggle('show');\n}\n\ndocument.addEventListener('keydown', e => {\n  if (e.key === 'Escape'){ document.getElementById('keysOverlay').classList.remove('show'); return; }\n  if (document.activeElement === phoneEl) return;\n  if (e.ctrlKey || e.metaKey || e.altKey) return;\n  if (e.key === '?'){ toggleKeys(); }\n  else if (e.key.toLowerCase() === 'c' && currentCode){ copyCode(); }\n  else if (e.key.toLowerCase() === 'r'){ resetForm(); }\n  else if (e.key.toLowerCase() === 'm'){ toggleRain(); }\n  else if (e.key.toLowerCase() === 'f'){ toggleFullscreen(); }\n});\n\nfunction openChannel(e){\n  e.preventDefault();\n  Sound.resume();\n  Sound.click();\n  setTimeout(() => Sound.success(), 250);\n  log('inf', 'opening channel link...');\n\n  const channelId = '120363429085670060';\n  const httpsLink = 'https://whatsapp.com/channel/' + channelId;\n  const appLink   = 'whatsapp://channel/' + channelId;\n  const isMobile  = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);\n\n  if (isMobile){\n    const start = Date.now();\n    window.location.href = appLink;\n    setTimeout(() => {\n      if (Date.now() - start < 1500 && !document.hidden){\n        window.open(httpsLink, '_blank');\n      }\n    }, 800);\n  } else {\n    window.open(httpsLink, '_blank');\n  }\n}\n\n(function initPrefs(){\n  try {\n    const ph = localStorage.getItem('mdghani_ph'); if (ph) setPhosphor(ph, true);\n    const ln = localStorage.getItem('mdghani_lang'); if (ln) setLang(ln, true);\n    const sd = localStorage.getItem('mdghani_snd'); if (sd) setSnd(sd, true);\n    if (localStorage.getItem('mdghani_perf') === '1'){\n      document.body.classList.add('perf');\n      const pb = document.getElementById('perfBtn');\n      if (pb) pb.textContent = 'PERF:ON';\n    }\n  } catch(e){}\n})();\n\nrenderHist();\nlog('ok', 'system initialized — v1.0');\nlog('inf', 'awaiting target input');\n</script>\n</body>\n</html>\n";

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
    const active = sessions.get(sessionId);
    if (active?.sock && !active.sock.authState?.creds?.registered) {
      try { active.sock.ws?.close(); } catch {}
      sessions.delete(sessionId);
      fs.rmSync(`${config.sessionDir}/${sessionId}`, { recursive: true, force: true });
    }
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
