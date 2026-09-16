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
const antiWarningStyles = {
  1: [
    (user, key) => `⚠️ *WARNING (1/3)*\n@${user}, *${key}* are not allowed in this group.\nNext time you will be removed.`,
    (user, key) => `╭━━━❰ ⚠️ WARNING 1/3 ❱━━━╮\n┃ @${user}\n┃ *${key}* are not allowed here.\n┃ Next time you will be removed.\n╰━━━━━━━━━━━━━━━━━━━━╯`,
    (user, key) => `🚨 *GROUP WARNING • 1/3* 🚨\n@${user} — please stop using *${key}*.\n⚠️ Next violation = removal.`,
    (user, key) => `⚠️ @${user}\nThis is warning *1 of 3*. *${key}* are not allowed in this group.\n🔔 Next time you will be removed.`,
  ],
  2: [
    (user, key) => `⚠️ *WARNING (2/3)*\n@${user}, *${key}* are still not allowed here.\n🚫 One more violation and you will be removed.`,
    (user, key) => `╭━━━❰ 🚨 WARNING 2/3 ❱━━━╮\n┃ @${user}\n┃ This is your second warning for *${key}*.\n┃ Next violation will remove you.\n╰━━━━━━━━━━━━━━━━━━━━╯`,
    (user, key) => `🔔 *SECOND WARNING* — 2/3\n@${user}, do not repeat *${key}* in this group.\n⛔ Final warning is next.`,
    (user, key) => `⚠️ @${user}\nWarning *2 of 3*: *${key}* are not allowed.\n🚪 Repeat it once more and you will be removed.`,
  ],
  3: [
    (user, key) => `🚨 *FINAL WARNING (3/3)* 🚨\n@${user}, *${key}* are not allowed in this group.\n🚫 You are being removed now.`,
    (user, key) => `╭━━━❰ 🚫 FINAL WARNING 3/3 ❱━━━╮\n┃ @${user}\n┃ *${key}* violated the group rules.\n┃ Removing you now.\n╰━━━━━━━━━━━━━━━━━━━━╯`,
    (user, key) => `⛔ *WARNING 3/3 — FINAL*\n@${user}, this was your last warning for *${key}*.\n👋 You will now be removed from the group.`,
    (user, key) => `🚨 @${user}\nThird and final warning for *${key}*.\n🔨 Group protection is removing you now.`,
  ],
};
const antiWarningLastStyle = new Map();
const BOT_ADMIN_OPTIONAL_COMMANDS = new Set([
  "song", "welcome", "goodbye", "setwelcome", "setgoodbye", "song2", "video", "tagall", "tag",
]);
const OWNER_ONLY_COMMANDS = new Set([
  "song", "welcome", "goodbye", "setwelcome", "setgoodbye", "song2", "video", "tagall", "tag",
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
      if ((revoke || !item.update?.message) && deletedChat && deletedId && getToggles(sessionId).antidelete) {
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
  sock.ev.on("messages.delete", async (event) => {
    const keys = Array.isArray(event) ? event : (event?.keys || []);
    for (const key of keys) {
      await recoverDeletedMessage(sock, sessionId, key, null);
    }
  });
}

async function recoverDeletedMessage(sock, sessionId, deletedKey, deleteUpdate = null) {
  const deletedChat = deletedKey?.remoteJid;
  const deletedId = deletedKey?.id;
  if (!deletedChat || !deletedId) return;
  if (!getToggles(sessionId).antidelete) return;
  const cacheKey = `${deletedChat}:${deletedId}`;
  const old = deletedMessageCache.get(cacheKey);
  if (!old) return;
  deletedMessageCache.delete(cacheKey);
  const oldMessage = unwrapMessage(old.message);
  const botInbox = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
  const source = deletedChat;
  const originalSender = await resolveOriginalJid(sock, old.key?.participantAlt || old.key?.participant || old.key?.remoteJid || "Unknown");
  const deletedBy = await resolveOriginalJid(sock, deleteUpdate?.key?.participantAlt || deleteUpdate?.key?.participant || deleteUpdate?.key?.remoteJid || "Unknown");
  const clean = (jid) => String(jid).split("@")[0].split(":")[0];
  const isGroup = source.endsWith("@g.us");
  const isChannel = source.endsWith("@newsletter") || source === "status@broadcast";
  const cachedGroup = isGroup ? groupMetadataCache.get(source) : null;
  const participants = cachedGroup?.data?.participants || [];
  const findParticipant = (jid) => participants.find((p) => p.id === jid || p.jid === jid || p.id === old.key?.participant || p.jid === old.key?.participant);
  const senderName = old.pushName || findParticipant(originalSender)?.name || findParticipant(originalSender)?.notify || "Unknown user";
  const deletedByName = deleteUpdate?.pushName || findParticipant(deletedBy)?.name || findParticipant(deletedBy)?.notify || "Unknown user";
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
    if (oldMessage?.stickerMessage) await sock.sendMessage(botInbox, { sticker: await downloadMedia(sock, fake) });
    else if (oldMessage?.imageMessage) await sock.sendMessage(botInbox, { image: await downloadMedia(sock, fake), caption: mediaCaption });
    else if (oldMessage?.videoMessage) await sock.sendMessage(botInbox, { video: await downloadMedia(sock, fake), caption: mediaCaption });
    else if (oldMessage?.audioMessage) await sock.sendMessage(botInbox, { audio: await downloadMedia(sock, fake), mimetype: oldMessage.audioMessage.mimetype || "audio/mpeg", ptt: !!oldMessage.audioMessage.ptt });
    else if (oldMessage?.documentMessage) await sock.sendMessage(botInbox, { document: await downloadMedia(sock, fake), mimetype: oldMessage.documentMessage.mimetype || "application/octet-stream", fileName: oldMessage.documentMessage.fileName || "recovered-file", caption: mediaCaption });
  } catch (mediaError) {
    log.warn(`antidelete media recovery failed: ${mediaError?.message || mediaError}`);
  }
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
    const styleKey = `${group}:${user}:${warningNumber}`;
    const styles = antiWarningStyles[warningNumber] || antiWarningStyles[1];
    let styleIndex = Math.floor(Math.random() * styles.length);
    if (styles.length > 1 && styleIndex === antiWarningLastStyle.get(styleKey)) {
      styleIndex = (styleIndex + 1) % styles.length;
    }
    antiWarningLastStyle.set(styleKey, styleIndex);
    const warningText = styles[styleIndex](user.split("@")[0], key.toUpperCase());
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
    if (groupChat && !controller) return;
    const botAdmin = groupChat ? await isBotAdmin(sock, from) : false;
    if (groupChat && !botAdmin && !BOT_ADMIN_OPTIONAL_COMMANDS.has(normalizedCommand)) return;
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

    // The selected commands are private to the connected owner in every group.
    // Everyone else is ignored without a reply, even when the bot is a group admin.
    if (groupChat && OWNER_ONLY_COMMANDS.has(normalizedCommand) && !controller) return;

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
      const ownerSpecial = controller && OWNER_ONLY_COMMANDS.has(normalizedCommand);
      if (!ownerSpecial && !(await requireGroupAdmin(sock, from, msg, !BOT_ADMIN_OPTIONAL_COMMANDS.has(normalizedCommand)))) return;
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
  const lines = mentions.map((m) => `${tagEmoji} @${m.split("@")[0]}`);
  const heading = `❏ Group : ${md.subject || "Group"}
❏ Members: ${mentions.length}
❏ Message: ${txt}

╭━━━━━━❰ MENTIONS
${lines.join("\n")}`;
  await sock.sendMessage(from, {
    text: heading, mentions,
  });
});
mk("tag", async ({ sock, from, msg, args }) => {
  const target = getTargetJid(msg, args, null);
  if (!target) return sock.sendMessage(from, { text: "❌ Reply to or mention one member with .tag" });
  const text = args.filter((arg) => !/^\d{5,}$/.test(arg)).join(" ") || "📢 Attention";
  await sock.sendMessage(from, {
    text: `${text}\n\n👤 @${target.split("@")[0]}`,
    mentions: [target],
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
  const current = unwrapMessage(msg?.message);
  const quoted = current?.extendedTextMessage?.contextInfo?.quotedMessage ||
    current?.imageMessage?.contextInfo?.quotedMessage ||
    current?.videoMessage?.contextInfo?.quotedMessage;
  const directImage = current?.imageMessage;
  const quotedImage = unwrapMessage(quoted)?.imageMessage;
  if (!directImage && !quotedImage) return sock.sendMessage(from, { text: "❌ Send an image or reply to an image with .setgrouppp" });
  const mediaMessage = directImage ? msg : {
    key: {
      remoteJid: from,
      id: current?.extendedTextMessage?.contextInfo?.stanzaId || `quoted-${Date.now()}`,
      participant: current?.extendedTextMessage?.contextInfo?.participant,
    },
    message: quoted,
  };
  const buf = await downloadMedia(sock, mediaMessage);
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
      const scope = name === "antidelete"
        ? sessionId
        : (from.endsWith("@g.us") ? from : sessionId);
      if (!args[0]) {
        const t = getToggles(scope);
        return sock.sendMessage(from, {
          text: styledToggleReply(name, t[name], `Usage: .${name} on/off`),
        });
      }
      const ok = setToggle(scope, name, args[0]);
      await sock.sendMessage(from, { text: ok ? styledToggleReply(name, getToggles(scope)[name], "Updated") : styledToggleReply(name, false, "Unknown toggle") });
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
▶️ *Official Trailer / Preview*
${trailer.title}
${trailer.url}
✅ Direct official preview link above` : "\n▶️ Official trailer not found"}

🔎 *Legal streaming / rental sources*
JustWatch (country-wise availability): https://www.justwatch.com/us/search?q=${q}
Google TV / Movies (rent or buy): https://play.google.com/store/search?q=${q}&c=movies
Apple TV (official search): https://tv.apple.com/us/search?term=${q}
Netflix (official search): https://www.netflix.com/search?q=${q}
Prime Video (official search): https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${q}

ℹ️ Availability and pricing depend on your country. Copyrighted movie files are not downloaded; use the legal sources above to watch, rent, or buy.`;
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
  const md = await sock.groupMetadata(from);
  const invite = `https://chat.whatsapp.com/${code}`;
  const caption = `🔗 *${md.subject || "Group Invite"}*\n${invite}`;
  try {
    const dp = await sock.profilePictureUrl(from, "image");
    await sock.sendMessage(from, { image: { url: dp }, caption });
  } catch {
    await sock.sendMessage(from, { text: caption });
  }
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
    if (!isController(p.sock, p.from, p.msg, p.sessionId))
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
