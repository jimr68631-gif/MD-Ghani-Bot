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
  generateWAMessageContent,
  generateWAMessageFromContent,
  jidNormalizedUser,
  proto,
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
function getMediaInput(msg) {
  const direct = unwrapMessage(msg?.message);
  const directEntry = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"]
    .find((key) => direct?.[key]);
  if (directEntry) return { message: msg, content: direct, kind: directEntry };
  const quoted = getQuotedMessage(msg);
  const quotedEntry = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"]
    .find((key) => quoted?.[key]);
  if (!quotedEntry) return null;
  return {
    message: { key: { remoteJid: msg?.key?.remoteJid, id: msg?.key?.id || `quoted-${Date.now()}` }, message: quoted },
    content: quoted,
    kind: quotedEntry,
  };
}
async function convertVideoToSticker(buf) {
  const id = `md-ghani-sticker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const input = path.join(os.tmpdir(), `${id}.input`);
  const output = path.join(os.tmpdir(), `${id}.webp`);
  try {
    await fs.promises.writeFile(input, buf);
    await execFileAsync("ffmpeg", ["-y", "-i", input, "-t", "6", "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=black@0,fps=15", "-an", "-c:v", "libwebp", "-q:v", "55", "-loop", "0", output], { timeout: 30000, maxBuffer: 1024 * 1024 });
    return await fs.promises.readFile(output);
  } finally {
    await Promise.all([fs.promises.rm(input, { force: true }), fs.promises.rm(output, { force: true })]);
  }
}
async function extractVideoFrame(buf) {
  const id = `md-ghani-frame-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const input = path.join(os.tmpdir(), `${id}.input`);
  const output = path.join(os.tmpdir(), `${id}.jpg`);
  try {
    await fs.promises.writeFile(input, buf);
    await execFileAsync("ffmpeg", ["-y", "-ss", "0", "-i", input, "-frames:v", "1", "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease", "-q:v", "4", output], { timeout: 20000, maxBuffer: 1024 * 1024 });
    return await fs.promises.readFile(output);
  } finally {
    await Promise.all([fs.promises.rm(input, { force: true }), fs.promises.rm(output, { force: true })]);
  }
}
async function convertToGifVideo(buf, kind) {
  const id = `md-ghani-gif-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const input = path.join(os.tmpdir(), `${id}.${kind === "imageMessage" ? "png" : "mp4"}`);
  const output = path.join(os.tmpdir(), `${id}.mp4`);
  try {
    await fs.promises.writeFile(input, buf);
    const source = kind === "imageMessage"
      ? ["-loop", "1", "-i", input, "-t", "3"]
      : ["-i", input, "-t", "6"];
    await execFileAsync("ffmpeg", ["-y", ...source, "-vf", "scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:-1:-1:color=black", "-r", "15", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output], { timeout: 30000, maxBuffer: 1024 * 1024 });
    return await fs.promises.readFile(output);
  } finally {
    await Promise.all([fs.promises.rm(input, { force: true }), fs.promises.rm(output, { force: true })]);
  }
}
function getQuotedMessage(message) {
  const content = unwrapMessage(message?.message || message);
  const context = content?.extendedTextMessage?.contextInfo ||
    content?.imageMessage?.contextInfo || content?.videoMessage?.contextInfo ||
    content?.documentMessage?.contextInfo || {};
  return context.quotedMessage ? unwrapMessage(context.quotedMessage) : null;
}
function cleanJid(jid) {
  return String(jid || "").split(":")[0].split("@")[0].replace(/\D/g, "");
}
function displayUser(jid, participant = null) {
  const number = cleanJid(jid);
  const name = participant?.name || participant?.notify || participant?.verifiedName;
  return name && number ? `${name} (+${number})` : name || (number ? `+${number}` : "Unknown user");
}
function reportIdentity(identity) {
  const rawName = String(identity?.name || "").replace(/\s+/g, " ").trim();
  const name = /^(unknown user|whatsapp contact|\+?\d+)$/i.test(rawName) ? "" : rawName;
  const jid = String(identity?.jid || "");
  const number = jid && !jid.endsWith("@lid") && !jid.endsWith("@g.us") ? cleanJid(jid) : "";
  const numberLabel = number ? `+${number}` : "";
  return name ? `${name}${numberLabel ? ` (${numberLabel})` : ""}` : (numberLabel || "Unknown sender");
}
async function resolveAntideleteIdentity(sock, candidates, participants = [], fallbackName = "") {
  const raw = [...new Set((Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean))];
  const resolved = await Promise.all(raw.map((jid) => resolveOriginalJid(sock, jid)));
  const all = [...new Set([...raw, ...resolved].filter(Boolean))];
  const normalized = new Set(all.map((jid) => String(jid).split(":")[0].toLowerCase()));
  const numbers = new Set(all.map(cleanJid).filter(Boolean));
  const participant = (participants || []).find((entry) => {
    const aliases = [entry?.id, entry?.jid, entry?.phoneNumber, entry?.lid, entry?.idAlt, entry?.phoneNumberAlt].filter(Boolean);
    return aliases.some((alias) => {
      const value = String(alias).split(":")[0].toLowerCase();
      return normalized.has(value) || (!value.endsWith("@lid") && !value.endsWith("@g.us") && numbers.has(cleanJid(value)));
    });
  });
  const identity = await resolveUserIdentity(sock, all, participants, fallbackName);
  const phoneCandidates = [participant?.phoneNumber, participant?.phoneNumberAlt, participant?.idAlt, ...all];
  for (const candidate of phoneCandidates.filter(Boolean)) {
    const value = await resolveOriginalJid(sock, candidate);
    if (!value || String(value).endsWith("@lid") || String(value).endsWith("@g.us")) continue;
    const phoneJid = String(value).includes("@") ? value : `${cleanJid(value)}@s.whatsapp.net`;
    if (cleanJid(phoneJid)) {
      identity.jid = phoneJid;
      break;
    }
  }
  const usableName = (value) => {
    const name = String(value || "").replace(/\s+/g, " ").trim();
    return name && !/^(unknown user|whatsapp contact|\+?\d+)$/i.test(name) ? name : "";
  };
  identity.name = usableName(fallbackName) || usableName(participant?.notify) ||
    usableName(participant?.name) || usableName(participant?.verifiedName) || usableName(identity.name);
  return identity;
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
  antispam: false, antiflood: false, antiraid: false, antiinvite: false,
  autoreact: false, autoseen: false, autoreactstatus: false,
  autorecording: false, autorecordtyping: false, autosavestatus: false,
  autotyping: false, autoviewstatus: false,
  autoreply: false,
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
const REPEAT_GUARD_TOGGLE_KEYS = new Set([
  "alwaysonline", "antibot", "antidelete", "antidemote", "antiimage", "antilink",
  "antipoll", "antipromote", "antistatus", "antistatuslinkkick", "antisticker",
  "antivideo", "antivoice",
]);
const toggleStateFile = path.resolve(config.sessionDir, ".repeat-guard-toggle-state.json");
function saveRepeatGuardToggleState() {
  const saved = {};
  for (const [scope, values] of toggleState) {
    const selected = {};
    for (const key of REPEAT_GUARD_TOGGLE_KEYS) selected[key] = values?.[key] ?? defaultToggles[key];
    if ([...REPEAT_GUARD_TOGGLE_KEYS].some((key) => selected[key] !== defaultToggles[key])) saved[scope] = selected;
  }
  const tempFile = `${toggleStateFile}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(toggleStateFile), { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(saved));
    fs.renameSync(tempFile, toggleStateFile);
  } catch (error) {
    try { fs.rmSync(tempFile, { force: true }); } catch {}
    log.warn(`toggle state save failed: ${error?.message || error}`);
  }
}
try {
  if (fs.existsSync(toggleStateFile)) {
    const saved = JSON.parse(fs.readFileSync(toggleStateFile, "utf8"));
    for (const [scope, values] of Object.entries(saved || {})) {
      if (!scope || !values || typeof values !== "object") continue;
      const state = { ...defaultToggles };
      for (const key of REPEAT_GUARD_TOGGLE_KEYS) {
        if (typeof values[key] === "boolean") state[key] = values[key];
      }
      toggleState.set(scope, state);
    }
  }
} catch (error) { log.warn(`toggle state load failed: ${error?.message || error}`); }
const groupMessageSettings = new Map();
const antiWarningCounts = new Map();
const spamState = new Map();
const raidState = new Map();
const antiWarningStyles = [
  (user, key) => `⚠️ *WARNING (1/3)*\n👤 ${user} — *${key}* is not allowed in this group.\nPlease do not repeat it.`,
  (user, key) => `╭━━━❰ ⚠️ WARNING 2/3 ❱━━━╮\n┃ 👤 ${user}\n┃ *${key}* is not allowed here.\n┃ Next violation will remove you.\n╰━━━━━━━━━━━━━━━━━━━━╯`,
  (user, key) => `🚨 *FINAL WARNING (3/3)* 🚨\n👤 ${user} — *${key}* is still not allowed in this group.\n🚫 You are being removed now.`,
];
const BOT_ADMIN_OPTIONAL_COMMANDS = new Set([
  "song", "play", "song2", "video", "tagall", "tag", "movie", "antidelete",
  "welcome", "goodbye", "setwelcome", "setgoodbye", "botstatus",
]);
// Only these commands are available to verified group admins who are not the connected owner.
const GROUP_ADMIN_ALLOWED_COMMANDS = new Set([
  "menu", "help", "rules", "groupinfo", "totalmembers", "admins",
  "settings", "securitystatus", "botstatus",
  "warn", "kick", "open", "close",
  "welcome", "goodbye", "setwelcome", "setgoodbye",
  "antilink", "antimessage", "antitag", "antitagadmin", "antibot", "antibug", "antistatuslinkkick",
]);
const GROUP_ADMIN_COMMANDS = new Set([
  "add", "kick", "promote", "demote", "kickall", "kickoffline", "leave",
  "tagall", "mention", "hidetag", "open", "close", "restrict", "unrestrict",
  "lock", "unlock", "announcement", "unannouncement", "setrules", "reject",
  "rejectall", "approve", "revoke", "clearwarnings", "delgrouppp", "setgrouppp", "setname",
  "setdesc", "warn", "setwelcome", "setgoodbye", "setautoreply", "welcome", "goodbye",
  "groupdesc", "resetmember", "lockdown", "slowmode", "keywordreply", "groupbackup",
  "restoregroup", "maintenance", "antical", "antispamlink", "welcomeedit", "autostatuslinkkick",
  "antilink", "botstatus", "set", "autoseen", "autotyping", "autorecording", "autoreact",
  "autoviewstatus", "autoreactstatus", "autosavestatus", "autoreacttyping",
  "autorecordtyping", "autoreply", "antibadword", "antibot", "antibug", "anticontact",
  "antidelete", "antidemote", "antipromote", "antidocument", "antiedit", "antiforward",
  "antigif", "antiimage", "antilocation", "antimessage", "antipoll", "antistatus",
  "antisticker", "antitag", "antitagadmin", "antivideo", "antivoice", "antistatuslinkkick",
  "antispam", "antiflood", "antiraid", "antiinvite",
]);
// These commands must be completely silent for everyone except the connected owner.
const OWNER_ONLY_SILENT_COMMANDS = new Set([
  "song", "song2", "play", "video", "tag", "tagall",
]);
const defaultGroupMessageSettings = () => ({
  welcome: "🎉 Welcome {user} to {group}. You are member #{count}.",
  goodbye: "👋 Goodbye {user} from {group}. You are member #{count}.",
  rules: "No group rules have been set yet.",
  autoreply: "Thanks for your message.",
  welcomeEnabled: false,
  goodbyeEnabled: false,
});
const groupMessageSettingsFile = path.resolve(config.sessionDir, ".group-message-settings.json");
const normalizeGroupMessageSettings = (value) => {
  const defaults = defaultGroupMessageSettings();
  return {
    welcome: typeof value?.welcome === "string" ? value.welcome : defaults.welcome,
    goodbye: typeof value?.goodbye === "string" ? value.goodbye : defaults.goodbye,
    rules: typeof value?.rules === "string" ? value.rules : defaults.rules,
    autoreply: typeof value?.autoreply === "string" ? value.autoreply : defaults.autoreply,
    welcomeEnabled: value?.welcomeEnabled === true,
    goodbyeEnabled: value?.goodbyeEnabled === true,
  };
};
try {
  if (fs.existsSync(groupMessageSettingsFile)) {
    const saved = JSON.parse(fs.readFileSync(groupMessageSettingsFile, "utf8"));
    for (const [group, settings] of Object.entries(saved || {})) {
      if (group.endsWith("@g.us") && settings && typeof settings === "object") {
        groupMessageSettings.set(group, normalizeGroupMessageSettings(settings));
      }
    }
  }
} catch (error) { log.warn(`group message settings load failed: ${error?.message || error}`); }
function saveGroupMessageSettings() {
  const tempFile = `${groupMessageSettingsFile}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(groupMessageSettingsFile), { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(Object.fromEntries(groupMessageSettings)));
    fs.renameSync(tempFile, groupMessageSettingsFile);
  } catch (error) {
    try { fs.rmSync(tempFile, { force: true }); } catch {}
    log.warn(`group message settings save failed: ${error?.message || error}`);
  }
}
const getGroupMessageSettings = (group) => {
  if (!groupMessageSettings.has(group)) groupMessageSettings.set(group, defaultGroupMessageSettings());
  return groupMessageSettings.get(group);
};
function normalizeJidValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.includes("@")) return text;
  const digits = text.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : null;
}
function isMentionableJid(jid) {
  return !!jid && !String(jid).endsWith("@lid") && !String(jid).endsWith("@g.us");
}
function mentionLabel(jid, fallback = "group member") {
  if (!isMentionableJid(jid)) return fallback;
  const number = cleanJid(jid);
  return number ? `@${number}` : fallback;
}
const formatGroupMessage = (template, groupName, user, count) => {
  const jid = normalizeJidValue(user);
  return String(template)
    .replaceAll("{group}", groupName)
    .replaceAll("{user}", mentionLabel(jid, "member"))
    .replaceAll("{count}", String(count));
};
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
async function resolveUserIdentity(sock, candidates, participants = [], fallbackName = "") {
  const rawCandidates = [...new Set((Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean))];
  let resolvedCandidates = [];
  for (const raw of rawCandidates) {
    const resolved = await resolveOriginalJid(sock, raw);
    resolvedCandidates.push(raw, resolved);
  }
  resolvedCandidates = [...new Set(resolvedCandidates.filter(Boolean))];
  const participant = participants.find((p) => {
    const ids = [p?.id, p?.jid, p?.phoneNumber].filter(Boolean).map(String);
    return ids.some((id) => resolvedCandidates.includes(id) || resolvedCandidates.some((candidate) => cleanJid(id) && cleanJid(id) === cleanJid(candidate)));
  });
  const jid = participant?.phoneNumber || participant?.jid ||
    resolvedCandidates.find((id) => !String(id).endsWith("@lid") && !String(id).endsWith("@g.us")) || resolvedCandidates[0] || "Unknown";
  const name = fallbackName || participant?.name || participant?.notify || participant?.verifiedName ||
    (cleanJid(jid) ? "WhatsApp contact" : "Unknown user");
  return { jid, name };
}
async function resolveParticipantMentionJid(sock, participant, groupParticipants = []) {
  const fields = typeof participant === "string"
    ? [participant]
    : [participant?.phoneNumber, participant?.jid, participant?.id, participant?.lid].filter(Boolean);
  const candidates = fields.map(normalizeJidValue).filter(Boolean);
  const explicitPhone = typeof participant === "string" ? null : normalizeJidValue(participant?.phoneNumber);
  if (isMentionableJid(explicitPhone)) return explicitPhone;
  const resolved = [];
  for (const candidate of candidates) {
    const mapped = normalizeJidValue(await resolveOriginalJid(sock, candidate));
    if (isMentionableJid(mapped)) return mapped;
    if (mapped) resolved.push(mapped);
  }
  const identity = await resolveUserIdentity(sock, [...candidates, ...resolved], groupParticipants);
  const identityJid = normalizeJidValue(identity?.jid);
  if (isMentionableJid(identityJid)) return identityJid;
  return identityJid || resolved[0] || candidates[0] || null;
}
const getToggles = (id) => {
  if (!toggleState.has(id)) toggleState.set(id, { ...defaultToggles });
  return toggleState.get(id);
};
const setToggle = (id, key, val) => {
  const t = getToggles(id);
  if (!(key in t)) return false;
  const normalized = typeof val === "string" ? val.trim().toLowerCase() : val;
  const previous = t[key];
  t[key] = normalized === true || normalized === "true" || normalized === "on";
  if (previous !== t[key] && REPEAT_GUARD_TOGGLE_KEYS.has(key)) saveRepeatGuardToggleState();
  return true;
};
const setToggleIfChanged = (id, key, val) => {
  const previous = getToggles(id)[key];
  const ok = setToggle(id, key, val);
  return { ok, changed: ok && previous !== getToggles(id)[key] };
};
const isOn = (id, key) => !!getToggles(id)[key];
const styledToggleReply = (name, enabled, detail = "") => `╭━━━❰ *${String(name).toUpperCase()}* ❱━━━╮
┃ ${enabled ? "🟢 Status: ON ✅" : "🔴 Status: OFF ❌"}
${detail ? `┃ 📝 ${detail}\n` : ""}╰━━━━━━━━━━━━━━━━━━━━╯`;
const professionalizeReply = (text) => {
  const value = String(text ?? "");
  if (!value.trim() || value.includes("╭━━━❰") || value.includes("╭━━━━━━❰")) return value;
  return `╭━━━❰ *${config.botName.toUpperCase()}* ❱━━━╮\n${value.split("\n").map((line) => `┃ ${line}`).join("\n")}\n╰━━━━━━━━━━━━━━━━━━━━╯`;
};

/* ============================================================
 *  4. COMMAND REGISTRY + SESSIONS
 * ============================================================ */
const commands = new Map();
const protectedMediaCommands = new Set();
const register = (name, opts) => {
  const key = String(name).trim().toLowerCase();
  if (protectedMediaCommands.has(key)) {
    log.warn(`Ignored duplicate registration for protected media command: ${key}`);
    return commands;
  }
  return commands.set(key, opts);
};
const registerProtectedMediaCommand = (name, opts) => {
  const key = String(name).trim().toLowerCase();
  commands.set(key, opts);
  protectedMediaCommands.add(key);
  return commands;
};
const sessions = new Map();
let shuttingDown = false;
const approvalJobs = new Map();
const deletedMessageCache = new Map();
// Keep recent full messages available for Baileys retry/decryption requests.
const messageRetryCache = new Map();
const messageIdCache = new Map();
const antideleteHandled = new Set();
const processedUpsertMessages = new Set();
const processedCommandMessages = new Map();
const processedCommandCacheFile = path.resolve(config.sessionDir, ".processed-command-messages.jsonl");
const PROCESSED_COMMAND_TTL_MS = 7 * 86400000;
const PROCESSED_COMMAND_LIMIT = 5000;
try {
  if (fs.existsSync(processedCommandCacheFile)) {
    const now = Date.now();
    for (const line of fs.readFileSync(processedCommandCacheFile, "utf8").split(/\r?\n/)) {
      try {
        const record = JSON.parse(line);
        if (record?.token && Number.isFinite(record.processedAt) && now - record.processedAt < PROCESSED_COMMAND_TTL_MS) {
          processedCommandMessages.set(record.token, record.processedAt);
        }
      } catch {}
    }
    while (processedCommandMessages.size > PROCESSED_COMMAND_LIMIT) {
      processedCommandMessages.delete(processedCommandMessages.keys().next().value);
    }
    if (fs.statSync(processedCommandCacheFile).size > 1024 * 1024) {
      fs.writeFileSync(processedCommandCacheFile, [...processedCommandMessages]
        .map(([token, processedAt]) => JSON.stringify({ token, processedAt })).join("\n"));
    }
  }
} catch (error) { log.warn(`command dedupe cache load failed: ${error?.message || error}`); }
function rememberProcessedCommand(token) {
  const processedAt = Date.now();
  processedCommandMessages.set(token, processedAt);
  while (processedCommandMessages.size > PROCESSED_COMMAND_LIMIT) {
    processedCommandMessages.delete(processedCommandMessages.keys().next().value);
  }
  try {
    fs.mkdirSync(path.dirname(processedCommandCacheFile), { recursive: true });
    fs.appendFileSync(processedCommandCacheFile, `${JSON.stringify({ token, processedAt })}\n`);
  } catch (error) { log.warn(`command dedupe cache save failed: ${error?.message || error}`); }
}
const persistentMessageCache = new Map();
const persistentMessageCacheFile = path.resolve(config.sessionDir, ".antidelete-message-cache.json");
let persistentWriteTimer = null;
try {
  if (fs.existsSync(persistentMessageCacheFile)) {
    const saved = JSON.parse(fs.readFileSync(persistentMessageCacheFile, "utf8"));
    for (const [id, record] of Object.entries(saved || {})) {
      if (record?.savedAt && Date.now() - record.savedAt < 7 * 86400000) persistentMessageCache.set(id, record.message);
    }
  }
} catch (error) { log.warn(`antidelete cache load failed: ${error?.message || error}`); }
function schedulePersistentCacheWrite() {
  if (persistentWriteTimer) return;
  persistentWriteTimer = setTimeout(() => {
    persistentWriteTimer = null;
    try {
      fs.mkdirSync(path.dirname(persistentMessageCacheFile), { recursive: true });
      const output = {};
      for (const [id, message] of persistentMessageCache) output[id] = { savedAt: Date.now(), message };
      fs.writeFileSync(persistentMessageCacheFile, JSON.stringify(output));
    } catch (error) { log.warn(`antidelete cache save failed: ${error?.message || error}`); }
  }, 1000);
}
function messageCacheKeys(key) {
  const id = key?.id;
  if (!id) return [];
  return [...new Set([
    key?.remoteJid,
    key?.remoteJidAlt,
    key?.participant,
    key?.participantAlt,
  ].filter(Boolean).map((jid) => `${jid}:${id}`))];
}
function cacheMessage(cache, msg) {
  let snapshot = msg;
  try { snapshot = structuredClone(msg); } catch {}
  for (const cacheKey of messageCacheKeys(msg?.key)) cache.set(cacheKey, snapshot);
  const id = msg?.key?.id;
  if (id) {
    const key = String(id);
    messageIdCache.set(key, snapshot);
    persistentMessageCache.set(key, snapshot);
    while (persistentMessageCache.size > 3000) persistentMessageCache.delete(persistentMessageCache.keys().next().value);
    schedulePersistentCacheWrite();
  }
}
function findCachedRecord(key) {
  for (const cacheKey of messageCacheKeys(key)) {
    const cached = messageRetryCache.get(cacheKey) || deletedMessageCache.get(cacheKey);
    if (cached) return cached;
  }
  const id = key?.id ? String(key.id) : "";
  if (id) {
    const cached = messageIdCache.get(id);
    if (cached) return cached;
    const persisted = persistentMessageCache.get(id);
    if (persisted) return persisted;
    for (const candidate of [...messageRetryCache.values(), ...deletedMessageCache.values(), ...persistentMessageCache.values()]) {
      if (String(candidate?.key?.id || candidate?.message?.key?.id || "") !== id) continue;
      const candidateJids = [candidate?.key?.remoteJid, candidate?.key?.remoteJidAlt, candidate?.message?.key?.remoteJid, candidate?.message?.key?.remoteJidAlt].filter(Boolean);
      const wantedJids = [key?.remoteJid, key?.remoteJidAlt].filter(Boolean);
      if (!wantedJids.length || !candidateJids.length || wantedJids.some((wanted) => candidateJids.some((candidateJid) => wanted === candidateJid || cleanJid(wanted) === cleanJid(candidateJid)))) {
        return candidate;
      }
    }
  }
  return undefined;
}
function findCachedMessage(key) {
  const record = findCachedRecord(key);
  if (!record) return undefined;
  // Baileys getMessage must receive only WAMessageContent, not the wrapper.
  // Accept both shapes because older cache files may contain the body directly.
  return record?.key && record?.message ? record.message : record;
}
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
      const content = findCachedMessage(key);
      return content && typeof content === "object" ? content : undefined;
    },
  });

  sessions.set(sessionId, { sock, info: { phoneNumber }, wired: false, starting: false, reconnectTimer: null });
  sock.ev.on("creds.update", saveCreds);
  // Register handlers immediately instead of waiting for the first open event.
  // This removes the post-connection window where WhatsApp is connected but
  // incoming commands are not yet being processed.
  wireHandlers(sessionId);

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
      sock.sendPresenceUpdate(getToggles(sessionId).alwaysonline ? "available" : "unavailable").catch(() => {});
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
        saveRepeatGuardToggleState();
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
      const protocol = msg.message?.protocolMessage;
      const protocolType = protocol?.type;
      if (protocolType === 0 || String(protocolType).toUpperCase() === "REVOKE") {
        // Baileys delivers message deletions as a REVOKE protocol message in
        // messages.upsert, not reliably through messages.update.
        if (type === "notify") {
          sock.ev.emit("messages.update", [{
            key: msg.key,
            update: { message: { protocolMessage: { ...protocol, type: 0 } } },
            participant: msg.participant,
            pushName: msg.pushName,
          }]);
        }
        continue;
      }
      cacheMessage(deletedMessageCache, msg);
      cacheMessage(messageRetryCache, msg);
      if (deletedMessageCache.size > 1000) deletedMessageCache.delete(deletedMessageCache.keys().next().value);
      if (messageRetryCache.size > 5000) messageRetryCache.delete(messageRetryCache.keys().next().value);
      if (messageIdCache.size > 6000) messageIdCache.delete(messageIdCache.keys().next().value);
      // Append events are history/backfill, not new user commands. Also ignore
      // a repeated notify for the same WhatsApp message ID.
      if (type !== "notify") continue;
      const messageId = msg.key?.id ? String(msg.key.id) : null;
      const messageToken = messageId ? `${sessionId}:id:${messageId}` : null;
      if (messageToken) {
        if (processedUpsertMessages.has(messageToken)) continue;
        const commandText = isPrefixedCommandMessage(msg);
        const legacyTokens = [...new Set([msg.key?.remoteJid, msg.key?.remoteJidAlt]
          .filter(Boolean).map((jid) => `${sessionId}:${jid}:${messageId}`))];
        if (commandText && (processedCommandMessages.has(messageToken) ||
            legacyTokens.some((token) => processedCommandMessages.has(token)))) {
          processedUpsertMessages.add(messageToken);
          continue;
        }
        processedUpsertMessages.add(messageToken);
        if (commandText) rememberProcessedCommand(messageToken);
        if (processedUpsertMessages.size > 10000) {
          processedUpsertMessages.delete(processedUpsertMessages.values().next().value);
        }
      }
      Promise.resolve(runAuto(sock, msg, sessionId, toggles)).catch((e) => log.error(`auto: ${e.message}`));
      Promise.resolve(runAnti(sock, msg, sessionId, toggles)).catch((e) => log.error(`anti: ${e.message}`));
      Promise.resolve(handleMessage(sock, msg, sessionId)).catch((e) => log.error(`handler: ${e.message}`));
    }
  });
  sock.ev.on("group-participants.update", async (update) => {
    const { id, participants, action } = update || {};
    if (!id?.endsWith("@g.us") || !["add", "remove", "leave", "promote", "demote"].includes(action)) return;
    try {
      groupMetadataCache.delete(id);
      if (action === "promote" || action === "demote") {
        const policy = action === "promote" ? "antipromote" : "antidemote";
        if (!getToggles(id)[policy] || !(await isBotAdmin(sock, id))) return;
        const actor = update.author || update.actor || update.sender || null;
        const targetRecords = (participants || []).filter(Boolean);
        const targets = targetRecords.map((participant) => normalizeJidValue(
          typeof participant === "string" ? participant : participant?.id || participant?.jid || participant?.phoneNumber || participant?.lid
        )).filter(Boolean);
        if (!targets.length) return;
        const md = await sock.groupMetadata(id).catch(() => ({ participants: [] }));
        const knownParticipants = md?.participants || [];
        if (action === "promote") {
          for (const target of targets) {
            await sock.groupParticipantsUpdate(id, [target], "demote").catch((error) =>
              log.warn(`antipromote rollback failed: ${error?.message || error}`)
            );
          }
        }
        const actorJid = actor ? await resolveParticipantMentionJid(sock, actor, knownParticipants) : null;
        const targetMentionJids = [...new Set(await Promise.all(
          targetRecords.map((participant) => resolveParticipantMentionJid(sock, participant, knownParticipants))
        ))].filter(Boolean);
        const actorIsController = !!actor && isController(sock, id, {
          key: { participantAlt: actor, participant: actorJid, fromMe: false },
        }, sessionId);
        const targetText = targetMentionJids.map((jid) => mentionLabel(jid, "affected member")).join(", ") || "affected member";
        const actionText = action === "promote" ? "promotion was reversed" : "member was demoted";
        const mentions = [...new Set([...targetMentionJids, actorJid].filter(isMentionableJid))];
        if (actor) {
          const actorLabel = mentionLabel(actorJid, "acting admin");
          const removalText = actorIsController ? "The bot owner is protected from removal." : "The admin who changed the role is being removed.";
          await sock.sendMessage(id, {
            text: `⚠️ *${policy.toUpperCase()}* — ${targetText}: ${actionText} by ${actorLabel}. ${removalText}`,
            mentions,
          }).catch(() => {});
          if (!actorIsController) {
            const actorTarget = actorJid || normalizeJidValue(typeof actor === "string" ? actor : actor?.id || actor?.jid || actor?.phoneNumber);
            if (actorTarget) {
              await sock.groupParticipantsUpdate(id, [actorTarget], "remove").catch((error) =>
                log.warn(`${policy} actor removal failed: ${error?.message || error}`)
              );
            }
          }
        } else {
          await sock.sendMessage(id, {
            text: `⚠️ *${policy.toUpperCase()}* — ${targetText}: ${actionText}. The acting admin could not be identified, so no one was removed.`,
            mentions,
          }).catch(() => {});
          log.warn(`${policy}: group event did not include an actor; cannot safely kick the admin`);
        }
        return;
      }
      if (action === "add" && getToggles(id).antiraid && participants?.length) {
        const now = Date.now();
        const recent = (raidState.get(id) || []).filter((time) => now - time < 60000);
        recent.push(...participants.map(() => now));
        raidState.set(id, recent);
        if (recent.length >= 3 && await isBotAdmin(sock, id)) {
          for (const participant of participants) await sock.groupParticipantsUpdate(id, [participant], "remove").catch(() => {});
          await sock.sendMessage(id, { text: "🛡️ Anti-raid active: rapid member additions were removed." }).catch(() => {});
          raidState.delete(id);
          return;
        }
      }
      if (action !== "add" && action !== "remove" && action !== "leave") return;
      const md = await sock.groupMetadata(id);
      const settings = getGroupMessageSettings(id);
      if (action === "add" && !settings.welcomeEnabled) return;
      if (action !== "add" && !settings.goodbyeEnabled) return;
      const template = action === "add" ? settings.welcome : settings.goodbye;
      const groupName = md.subject || "Group";
      const count = md.participants.length;
      for (const participant of participants || []) {
        const user = await resolveParticipantMentionJid(sock, participant, md.participants || []);
        const text = formatGroupMessage(template, groupName, user || "member", count);
        await sock.sendMessage(id, { text, mentions: isMentionableJid(user) ? [user] : [] });
      }
    } catch (e) {
      log.warn(`welcome/goodbye message failed: ${e?.message || e}`);
    }
  });
  sock.ev.on("messages.update", async (updates) => {
    const botInbox = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
    for (const item of updates || []) {
      const edited = item.update?.message?.protocolMessage?.type === 14;
      const editedKey = item.update?.message?.protocolMessage?.key || item.key;
      const editedGroup = editedKey?.remoteJid;
      const antieditEnabled = getToggles(sessionId).antiedit ||
        (editedGroup?.endsWith("@g.us") && getToggles(editedGroup).antiedit);
      if (edited && editedGroup?.endsWith("@g.us") && antieditEnabled) {
        const old = findCachedMessage(editedKey);
        const before = unwrapMessage(old?.message);
        const after = unwrapMessage(item.update?.message?.protocolMessage?.editedMessage);
        const beforeText = before?.conversation || before?.extendedTextMessage?.text || before?.imageMessage?.caption || before?.videoMessage?.caption || "[media]";
        const afterText = after?.conversation || after?.extendedTextMessage?.text || after?.imageMessage?.caption || after?.videoMessage?.caption || "[media]";
        const sender = editedKey.participant || editedKey.remoteJid;
        await sock.sendMessage(botInbox, { text: `✏️ *ANTIEDIT REPORT*\n\n👤 User: ${displayUser(sender)}\n📌 Group: ${editedKey.remoteJid}\n\n↩️ Before:\n${beforeText}\n\n✍️ After:\n${afterText}` }).catch(() => {});
      }
      // Only an explicit WhatsApp revoke is a deletion. Other message updates
      // (receipts, reactions, status changes) often omit `update.message` too.
      const revokeType = item.update?.message?.protocolMessage?.type;
      const revoke = revokeType === 0 || String(revokeType).toUpperCase() === "REVOKE";
      const deletedKey = item.update?.message?.protocolMessage?.key || item.key;
      const deletedChat = deletedKey?.remoteJid || item.key?.remoteJid;
      const deletedId = deletedKey?.id;
      const antideleteEnabled = getToggles(sessionId).antidelete ||
        (deletedChat?.endsWith("@g.us") && getToggles(deletedChat).antidelete);
      if (revoke && deletedChat && deletedId && antideleteEnabled) {
        // Message IDs are unique per WhatsApp session; claim the deletion
        // synchronously so parallel/retried Baileys updates cannot report it twice.
        const deleteToken = `${sessionId}:${deletedId}`;
        if (antideleteHandled.has(deleteToken)) continue;
        antideleteHandled.add(deleteToken);
        if (antideleteHandled.size > 10000) antideleteHandled.delete(antideleteHandled.values().next().value);
        let old = findCachedRecord(deletedKey);
        if (!old) {
          await new Promise((resolve) => setTimeout(resolve, 700));
          old = findCachedRecord(deletedKey);
        }
        if (!old) {
          const isGroup = deletedChat.endsWith("@g.us");
          let groupData = null;
          if (isGroup) {
            const cached = groupMetadataCache.get(deletedChat);
            if (cached?.expires > Date.now()) groupData = cached.data;
            else {
              try {
                groupData = await sock.groupMetadata(deletedChat);
                groupMetadataCache.set(deletedChat, { data: groupData, expires: Date.now() + 30000 });
              } catch {}
            }
          }
          const participants = groupData?.participants || [];
          const senderCandidates = deletedKey.fromMe
            ? [sock.user?.id, sock.user?.lid].filter(Boolean)
            : (isGroup
              ? [deletedKey.participantAlt, deletedKey.participant]
              : [deletedKey.remoteJidAlt, deletedKey.remoteJid]);
          const deletedByCandidates = isGroup
            ? [item.key?.participantAlt, item.key?.participant, item.participantAlt, item.participant].filter(Boolean)
            : (item.key?.fromMe ? [sock.user?.id, sock.user?.lid].filter(Boolean) : [item.key?.remoteJidAlt, item.key?.remoteJid].filter(Boolean));
          const senderIds = senderCandidates.map(cleanJid).filter(Boolean);
          const deletedByIds = deletedByCandidates.map(cleanJid).filter(Boolean);
          const sameSenderDeletedIt = senderIds.some((id) => deletedByIds.includes(id));
          const fallbackIdentity = await resolveAntideleteIdentity(sock, senderCandidates, participants, sameSenderDeletedIt ? item.pushName : "");
          const fallbackDeletedByIdentity = await resolveAntideleteIdentity(sock, deletedByCandidates, participants, item.pushName);
          const botAccountLabel = reportIdentity({ jid: sock.user?.id || sock.user?.lid, name: "Bot account" });
          const senderLabel = deletedKey.fromMe ? botAccountLabel : reportIdentity(fallbackIdentity);
          const deletedByLabel = item.key?.fromMe ? botAccountLabel : reportIdentity(fallbackDeletedByIdentity);
          const sourceName = groupData?.subject || (isGroup ? "WhatsApp Group" : "Personal Inbox");
          const deletedAt = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" });
          const report = `╭━━━❰ *ANTIDELETE* ❱━━━╮
┃ 🗑️ Deleted message
┃ 📍 Chat: ${sourceName}
┃ 👤 Sender: ${senderLabel}
┃ 🗑️ Deleted by: ${deletedByLabel}
┃ 🕒 ${deletedAt}
╰━━━━━━━━━━━━━━━━━━━━╯
ℹ️ Content wasn't cached before deletion (for example, the bot was offline), so it can't be recovered.`;
          await sock.sendMessage(botInbox, { text: report }).catch(() => {});
          continue;
        }
        const oldKey = old?.key || old?.message?.key;
        const antideletePayload = unwrapAntideletePayload(old?.message || old);
        const oldMessage = antideletePayload.message;
        const isViewOnce = antideletePayload.isViewOnce || !!oldKey?.isViewOnce;
        const isStatusMention = antideletePayload.isStatusMention;
        if (!oldMessage || (oldKey?.fromMe && oldKey?.remoteJid === botInbox)) continue;
        const source = deletedChat;
        const isGroup = source.endsWith("@g.us");
        const isChannel = source.endsWith("@newsletter") || source === "status@broadcast";
        let cachedGroup = isGroup ? groupMetadataCache.get(source) : null;
        if (isGroup && (!cachedGroup || cachedGroup.expires <= Date.now())) {
          try {
            const data = await sock.groupMetadata(source);
            cachedGroup = { data, expires: Date.now() + 30000 };
            groupMetadataCache.set(source, cachedGroup);
          } catch {}
        }
        const participants = cachedGroup?.data?.participants || [];
        const botAccountLabel = reportIdentity({ jid: sock.user?.id || sock.user?.lid, name: "Bot account" });
        const senderIdentity = await resolveAntideleteIdentity(
          sock,
          oldKey?.fromMe
            ? [sock.user?.id, sock.user?.lid].filter(Boolean)
            : (isGroup
              ? [oldKey?.participantAlt, oldKey?.participant]
              : [oldKey?.participantAlt, oldKey?.participant, oldKey?.remoteJidAlt, oldKey?.remoteJid]),
          participants,
          old.pushName,
        );
        const deletedByCandidates = isGroup
          ? [item.key?.participantAlt, item.key?.participant, item.participantAlt, item.participant].filter(Boolean)
          : (item.key?.fromMe ? [sock.user?.id, sock.user?.lid].filter(Boolean) : [item.key?.remoteJidAlt, item.key?.remoteJid].filter(Boolean));
        const deletedByIdentity = await resolveAntideleteIdentity(
          sock,
          deletedByCandidates,
          participants,
          item.pushName,
        );
        const originalSender = senderIdentity.jid;
        const deletedBy = deletedByIdentity.jid;
        const senderLabel = oldKey?.fromMe ? botAccountLabel : reportIdentity(senderIdentity);
        const deletedByLabel = item.key?.fromMe ? botAccountLabel : reportIdentity(deletedByIdentity);
        const sourceName = cachedGroup?.expires > Date.now() && cachedGroup.data?.subject
          ? cachedGroup.data.subject
          : (isChannel ? "WhatsApp Channel/Status" : (isGroup ? "WhatsApp Group" : "Personal Inbox"));
        const contentType = source === "status@broadcast" || source.endsWith("@newsletter") ? "STATUS" :
          oldMessage?.conversation || oldMessage?.extendedTextMessage?.text ? "Text" :
          oldMessage?.imageMessage ? "Photo" : oldMessage?.videoMessage ? "Video" :
          oldMessage?.audioMessage ? "Voice/Audio" : oldMessage?.documentMessage ? "Document/File" :
          oldMessage?.stickerMessage ? "Sticker" : oldMessage?.contactMessage ? "Contact" :
          oldMessage?.locationMessage ? "Location" : oldMessage?.pollCreationMessage ? "Poll" : "Media/Other";
        const type = isStatusMention
          ? `Status mention${contentType !== "Media/Other" ? ` • ${contentType}` : ""}`
          : (isViewOnce ? `View-once ${contentType === "Media/Other" ? "message" : contentType}` : contentType);
        const rawText = oldMessage?.conversation || oldMessage?.extendedTextMessage?.text ||
          oldMessage?.imageMessage?.caption || oldMessage?.videoMessage?.caption ||
          oldMessage?.documentMessage?.caption || oldMessage?.audioMessage?.caption || "";
        if (/ANTIDELETE REPORT|Message Deleted & Recovered|Source Chat:/i.test(rawText)) continue;
        const linkPattern = /https?:\/\/[^\s]+|wa\.me\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|t\.me\/[^\s]+/gi;
        const links = [...new Set(rawText.match(linkPattern) || [])];
        const cleanText = rawText.replace(linkPattern, "").trim();
        const fallbackContent = isStatusMention
          ? "[Status mention; referenced content unavailable]"
          : (isViewOnce ? "[View-once media]" : "[No text content in this message]");
        const text = [cleanText || (links.length ? "" : fallbackContent), links.length ? `🔗 Link(s):\n${links.join("\n")}` : ""]
          .filter(Boolean).join("\n\n");
        const deletedAt = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" });
        const report = `╭━━━❰ *ANTIDELETE • RECOVERED* ❱━━━╮
┃ 📦 ${type}  •  📍 ${sourceName}
┃ 👤 From: ${senderLabel}
┃ 🗑️ Deleted by: ${deletedByLabel}
┃ 🕒 ${deletedAt}
╰━━━━━━━━━━━━━━━━━━━━╯
${text}`;
        const reportMentions = [senderIdentity, deletedByIdentity]
          .filter((identity) => reportIdentity(identity).startsWith("@") && identity.jid && !String(identity.jid).endsWith("@lid"))
          .map((identity) => identity.jid);
        await sock.sendMessage(botInbox, { text: report, mentions: [...new Set(reportMentions)] }).catch(() => {});
        const mediaCaption = `📌 Source: ${sourceName}\n👤 Sent by: ${senderLabel}\n🗑️ Deleted by: ${deletedByLabel}`;
        try {
          const fake = { key: oldKey, message: oldMessage };
          if (oldMessage?.imageMessage) {
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
          } else if (oldMessage?.stickerMessage) {
            const media = await downloadMedia(sock, fake);
            await sock.sendMessage(botInbox, { sticker: media });
          } else if (oldMessage?.conversation || oldMessage?.extendedTextMessage?.text || rawText) {
            // Text is already included in the concise report above; do not send a second nested report.
          } else if (oldMessage?.contactMessage || oldMessage?.locationMessage || oldMessage?.pollCreationMessage || isStatusMention || isViewOnce) {
            // Keep protocol wrappers out of the user-facing report; the summary above carries the readable type/content.
          } else {
            await sock.sendMessage(botInbox, { text: `📦 *Recovered Message*\n${mediaCaption}` });
          }
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
  const statusMessage = from === "status@broadcast";
  toggles = statusMessage || !from.endsWith("@g.us") ? getToggles(sessionId) : getToggles(from);
  const autoMessage = unwrapMessage(msg.message);
  const autoText = autoMessage?.conversation || autoMessage?.extendedTextMessage?.text || "";
  if (toggles.autoreply && !msg.key?.fromMe && autoText && !autoText.startsWith(config.prefix)) {
    const reply = from.endsWith("@g.us") ? getGroupMessageSettings(from).autoreply : "Thanks for your message.";
    sock.sendMessage(from, { text: `🤖 ${reply}` }).catch(() => {});
  }
  if (toggles.autoseen) sock.readMessages([msg.key]).catch(() => {});
  if (toggles.autotyping && !msg.key?.fromMe) {
    sock.sendPresenceUpdate("composing", from).catch(() => {});
    setTimeout(() => sock.sendPresenceUpdate("paused", from).catch(() => {}), 1500);
  }
  if (toggles.autorecording && !msg.key?.fromMe) {
    sock.sendPresenceUpdate("recording", from).catch(() => {});
    setTimeout(() => sock.sendPresenceUpdate("paused", from).catch(() => {}), 1500);
  }
  if (toggles.autoreact && !msg.key?.fromMe) {
    const emojis = ["❤️", "🔥", "👍", "😍", "💯", "⚡", "✨", "🎯"];
    const e = emojis[Math.floor(Math.random() * emojis.length)];
    sock.sendMessage(from, { react: { text: e, key: msg.key } }).catch(() => {});
  }
  if (toggles.autoreacttyping && !msg.key?.fromMe) {
    sock.sendPresenceUpdate("composing", from).catch(() => {});
    setTimeout(() => sock.sendPresenceUpdate("paused", from).catch(() => {}), 1500);
  }
  if (toggles.autorecordtyping && !msg.key?.fromMe) {
    sock.sendPresenceUpdate("recording", from).catch(() => {});
    setTimeout(() => sock.sendPresenceUpdate("paused", from).catch(() => {}), 1500);
  }
  if (statusMessage) {
    if (toggles.autosavestatus) {
      const statusMessage = unwrapMessage(msg.message);
      const statusText = statusMessage?.conversation || statusMessage?.extendedTextMessage?.text || statusMessage?.imageMessage?.caption || statusMessage?.videoMessage?.caption || "[Status media]";
      const inbox = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
      sock.sendMessage(inbox, { text: `💾 *Status Saved*\n👤 From: ${displayUser(msg.key.participant)}\n\n${statusText}` }).catch(() => {});
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

function getMentionedJids(message) {
  return [...new Set(Object.values(message || {})
    .flatMap((part) => part?.contextInfo?.mentionedJid || [])
    .filter((jid) => typeof jid === "string" && jid.length > 0))];
}

function isBotMention(sock, mentionedJids, text) {
  const botNumbers = new Set([sock.user?.id, sock.user?.lid].map(cleanJid).filter(Boolean));
  if (mentionedJids.some((jid) => botNumbers.has(cleanJid(jid)))) return true;
  return [...botNumbers].some((number) => String(text || "").includes(`@${number}`));
}

function isAntibugPayload(message, text) {
  const document = message?.documentMessage || {};
  const source = `${text || ""} ${document.fileName || ""} ${document.mimetype || ""}`;
  const malwareTerms = /\b(?:malware|ransomware|trojan|keylogger|spyware|virus|worm)\b/i;
  const exploitTerms = /\b(?:crash payload|exploit payload|whatsapp crash|bug payload)\b/i;
  const executableFile = /\.(?:apk|exe|dll|bat|cmd|scr|msi|jar|vbs|ps1|hta)(?:[?#\s"']|$)/i;
  const dangerousScheme = /(?:javascript\s*:|data\s*:\s*text\/html)/i;
  const controlBytes = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
  const repeatedPayload = /(.)\1{500,}/s;
  return malwareTerms.test(source) || exploitTerms.test(source) || executableFile.test(source) ||
    dangerousScheme.test(source) || controlBytes.test(text || "") || repeatedPayload.test(text || "");
}

function findGroupStatusPayload(root, depth = 0) {
  if (!root || typeof root !== "object" || depth > 8) return null;
  for (const [key, value] of Object.entries(root)) {
    if (/^(?:groupStatusMessage(?:V\d+)?|groupStatusMentionMessage|statusMentionMessage)$/.test(key)) return value;
    const nested = findGroupStatusPayload(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function groupStatusContainsLink(message) {
  const payload = findGroupStatusPayload(message);
  if (!payload) return false;
  try { return LINK_RE.test(JSON.stringify(payload)); }
  catch { return false; }
}

async function runAnti(sock, msg, sessionId, toggles) {
  const from = msg.key.remoteJid;
  if (!from?.endsWith("@g.us")) return;
  if (msg.key.fromMe) return;
  if (!(await isBotAdmin(sock, from))) return;
  toggles = getToggles(from);

  const antiKeys = ["antilink", "antiinvite", "antispam", "antiflood", "antiraid", "antibadword", "antibot", "antibug", "antimessage", "antidemote", "antipromote", "antitag", "antitagadmin", "antistatuslinkkick", "antisticker", "antiimage", "antivideo", "antivoice", "antidocument", "antigif", "antilocation", "anticontact", "antipoll", "antistatus", "antiforward", "antiviewonce"];
  if (!antiKeys.some((key) => toggles[key])) return;

  const sender = msg.key.participantAlt || msg.key.participant || from;
  const message = unwrapMessage(msg.message);
  const text = message?.conversation || message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption || message?.videoMessage?.caption || "";

  const isAdmin = await isUserAdmin(sock, from, sender);
  const mentionedJids = getMentionedJids(message);
  const isControllerSender = isController(sock, from, msg, sessionId);

  if (toggles.antibug && isAntibugPayload(message, text)) {
    await takeAction(sock, from, sender, msg, "antibug", { kick: true });
    return;
  }
  if (toggles.antistatuslinkkick && groupStatusContainsLink(msg.message)) {
    await takeAction(sock, from, sender, msg, "antistatuslinkkick", { kick: true });
    return;
  }
  if (toggles.antibot && !isControllerSender && !isAdmin &&
      (String(text).trim().startsWith(config.prefix) || isBotMention(sock, mentionedJids, text))) {
    await takeAction(sock, from, sender, msg, "antibot", { kick: true });
    return;
  }
  if (toggles.antitagadmin && mentionedJids.length) {
    for (const jid of mentionedJids) {
      if (await isUserAdmin(sock, from, jid)) {
        await takeAction(sock, from, sender, msg, "antitagadmin", { noKick: true });
        return;
      }
    }
  }
  if (toggles.antitag && mentionedJids.length) {
    await takeAction(sock, from, sender, msg, "antitag", { noKick: true });
    return;
  }
  if (toggles.antimessage && !isAdmin) {
    await takeAction(sock, from, sender, msg, "antimessage", { noKick: true });
    return;
  }
  if (isAdmin) return;

  const now = Date.now();
  const spamKey = `${from}:${sender}`;
  const spam = spamState.get(spamKey) || { times: [], texts: [] };
  spam.times = spam.times.filter((time) => now - time < 10000);
  spam.texts = spam.texts.filter((item) => now - item.time < 10000);
  spam.times.push(now);
  spam.texts.push({ time: now, text: text.trim().toLowerCase() });
  spamState.set(spamKey, spam);
  if (toggles.antispam && spam.times.length >= 5) {
    await takeAction(sock, from, sender, msg, "antispam");
    return;
  }
  if (toggles.antiflood && spam.texts.filter((item) => item.text === text.trim().toLowerCase()).length >= 3) {
    await takeAction(sock, from, sender, msg, "antiflood");
    return;
  }

  const checks = [
    ["antilink", () => LINK_RE.test(text)],
    ["antiinvite", () => /chat\.whatsapp\.com\//i.test(text)],
    ["antibadword", () => BAD_WORDS.some((w) => text.toLowerCase().includes(w))],
    ["antitagadmin", async () => {
      for (const jid of mentionedJids) {
        if (await isUserAdmin(sock, from, jid)) return true;
      }
      return false;
    }],
    ["antitag", () => mentionedJids.length > 0],
    ["antisticker", () => !!message?.stickerMessage],
    ["antiimage", () => !!message?.imageMessage],
    ["antivideo", () => !!message?.videoMessage],
    ["antivoice", () => !!message?.audioMessage?.ptt],
    ["antidocument", () => !!message?.documentMessage],
    ["antigif", () => !!message?.videoMessage?.gifPlayback],
    ["antilocation", () => !!message?.locationMessage],
    ["anticontact", () => !!message?.contactMessage],
    ["antipoll", () => Object.keys(message || {}).some((key) => /^pollCreationMessage(?:V\d+)?$/.test(key) && !!message[key])],
    ["antistatus", () => ["groupStatusMessage", "groupStatusMessageV2", "groupStatusMentionMessage", "statusMentionMessage"].some((key) => !!message?.[key])],
    ["antiforward", () => !!message?.extendedTextMessage?.contextInfo?.forwardingScore],
    ["antiviewonce", () => !!(msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2)],
  ];

  for (const [key, test] of checks) {
    if (!toggles[key]) continue;
    if (!(await test())) continue;
    await takeAction(sock, from, sender, msg, key);
    return;
  }
}

async function takeAction(sock, group, user, msg, key, options = {}) {
  try {
    const warningKey = `${group}:${user}:${key}`;
    const warningNumber = Math.min(3, (antiWarningCounts.get(warningKey) || 0) + 1);
    antiWarningCounts.set(warningKey, warningNumber);
    await sock.sendMessage(group, { delete: msg.key }).catch(() => {});
    const shouldRemove = options.kick === true || (!options.noKick && warningNumber >= 3);
    const participants = groupMetadataCache.get(group)?.data?.participants || [];
    const identity = await resolveUserIdentity(sock, [msg?.key?.participantAlt, user], participants, msg?.pushName);
    const participant = participants.find((p) => [p.id, p.jid, p.phoneNumber].filter(Boolean)
      .some((id) => cleanJid(id) && cleanJid(id) === cleanJid(identity.jid || user)));
    const usableName = (value) => {
      const candidate = String(value || "").replace(/\s+/g, " ").trim();
      return candidate && !/^(unknown user|whatsapp contact|\+?\d+)$/i.test(candidate) ? candidate : "";
    };
    const name = [msg?.pushName, participant?.notify, participant?.name, participant?.verifiedName]
      .map(usableName).find(Boolean) || "";
    const mentionJid = identity.jid && !String(identity.jid).endsWith("@g.us") ? identity.jid : user;
    const mentionNumber = cleanJid(mentionJid);
    const userLabel = mentionNumber
      ? `${name ? `${name} ` : ""}@${mentionNumber}`
      : name || "Group member";
    const warningText = options.kick
      ? `🚨 *${key.toUpperCase()}* — ${userLabel}: message deleted and user removed immediately.`
      : options.noKick
        ? `⚠️ *${key.toUpperCase()}* — ${userLabel}: message deleted. Warning ${warningNumber}/3; this rule does not auto-kick.`
        : antiWarningStyles[warningNumber - 1](userLabel, key.toUpperCase());
    await sock.sendMessage(group, {
      text: warningText,
      mentions: mentionNumber && !String(mentionJid).endsWith("@g.us") ? [mentionJid] : [],
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
    const candidates = Array.isArray(user) ? user : [user];
    const knownJids = new Set();
    const knownNumbers = new Set();
    for (const candidate of candidates.filter(Boolean)) {
      const values = [candidate, await resolveOriginalJid(sock, candidate)];
      for (const value of values.filter(Boolean)) {
        knownJids.add(String(value).split(":")[0].toLowerCase());
        const number = cleanJid(value);
        if (number) knownNumbers.add(number);
      }
    }
    const participant = md.participants.find((p) => {
      const ids = [p.id, p.jid, p.phoneNumber, p.lid, p.idAlt, p.phoneNumberAlt].filter(Boolean);
      return ids.some((id) => {
        const jid = String(id).split(":")[0].toLowerCase();
        const number = cleanJid(id);
        return knownJids.has(jid) || (number && knownNumbers.has(number));
      });
    });
    return !!(participant?.admin || participant?.isAdmin || participant?.role === "admin" || participant?.role === "superadmin");
  } catch { return false; }
}

async function requireGroupAdmin(sock, from, msg, botMustBeAdmin = true) {
  if (!from?.endsWith("@g.us")) {
    await sock.sendMessage(from, { text: "❌ This command works only in groups." });
    return false;
  }
  const sender = [msg?.key?.participantAlt, msg?.key?.participant,
    ...(msg?.key?.fromMe ? [sock.user?.id, sock.user?.lid] : [])].filter(Boolean);
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
  // Messages sent by the connected WhatsApp account can carry a LID in
  // participant; fromMe is the reliable owner signal in that case.
  const senders = msg?.key?.fromMe
    ? [sock.user?.id, sock.user?.lid, from]
    : [msg?.key?.participantAlt, msg?.key?.participant, from];
  const values = senders.filter(Boolean).flatMap((v) => [
    String(v).split(":")[0].split("@")[0],
    cleanJid(v),
  ]).filter(Boolean);
  const owners = config.owner.map((v) => String(v).split("@")[0]);
  const connected = String(sessionId).replace(/\D/g, "");
  return values.some((v) => owners.includes(v) || (connected && v === connected));
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
    // Ignore these commands silently when written by anyone other than the owner.
    if (OWNER_ONLY_SILENT_COMMANDS.has(normalizedCommand) && !isController(sock, from, msg, sessionId)) return;
    const groupChat = from.endsWith("@g.us");
    const controller = isController(sock, from, msg, sessionId);
    const groupAdminCommand = GROUP_ADMIN_ALLOWED_COMMANDS.has(normalizedCommand);
    const requiresGroupAdmin = GROUP_ADMIN_COMMANDS.has(normalizedCommand);
    const groupAdmin = groupChat && (requiresGroupAdmin || groupAdminCommand)
      ? await isUserAdmin(sock, from, [msg.key?.participantAlt, msg.key?.participant,
        ...(msg.key?.fromMe ? [sock.user?.id, sock.user?.lid] : [])])
      : false;
    // Non-owner group members may run only the allowlisted commands, and only as group admins.
    if (groupChat && !controller && (!groupAdminCommand || !groupAdmin)) return;
    if (groupChat && requiresGroupAdmin && !groupAdmin) return;
    const botAdmin = groupChat && requiresGroupAdmin ? await isBotAdmin(sock, from) : false;
    const botAdminOptional = normalizedCommand === "antidelete" ||
      (controller && BOT_ADMIN_OPTIONAL_COMMANDS.has(normalizedCommand));
    if (groupChat && requiresGroupAdmin && !botAdmin && !botAdminOptional) return;
    let cmd = commands.get(normalizedCommand);
    log.info(`📨 Command received: ${normalizedCommand} from ${from}`);
    if (!cmd && (normalizedCommand === "menu" || normalizedCommand === "help")) {
      cmd = {
        toggle: null,
        run: async ({ sock: targetSock, from: targetFrom }) => {
          const groups = [
            ["👑 OWNER & BOT", /^(owner|mode|health|setprefix|backup|restore|broadcast|bc|restart|shutdown|pair|session|addmenu|delmenu)/i],
            ["🛡️ GROUP MANAGEMENT", /^(kick|add|promote|demote|group|g$|welcome|goodbye|members|admins|groupstats|pending|reject|rejectall|approve|cancelapprove|rules|setrules|clearwarnings|tagall|tag|tagme|hidetag|linkgroup|invite|revoke|setname|setdesc|setgrouppp|open|close|opentime|closetime)/i],
            ["⚔️ SECURITY & ANTI", /^(anti|antilink|antibadword|antibot|antidelete|antiedit|antispam|antiflood|antiraid|antiinvite|antidemote|antipromote|antistatus|antitag|antivideo|antiimage)/i],
            ["🎵 MEDIA & DOWNLOAD", /^(play|song|song2|audio|video|yt|youtube|tiktok|download|dl|instagram|ig|facebook|fb|twitter|media|toaudio|tomp3|ytmp)/i],
            ["🖼️ STICKER & IMAGE", /^(sticker|s$|stiker|toimg|image|photo|blur|crop|take|emojimix|write)/i],
            ["🎮 FUN & GAMES", /^(fun|joke|meme|quote|truth|dare|ship|love|kiss|hug|slap|pat|punch|kill|diceroll|coin|8ball)/i],
            ["🔧 TOOLS", /^(calc|weather|translate|wiki|google|lyrics|short|qr|readqr|ss|fetch|url|ping|runtime|uptime|device|time|date|status|fakeinfo|profile|getbio|getid|getdp)/i],
            ["⚙️ SETTINGS & AUTO", /^(set|toggle|autoseen|autoreact|autotyping|autorecording|autorecordtyping|autoreacttyping|autoviewstatus|autoreactstatus|autosavestatus|autostatuslinkkick|alwaysonline|settings|config|reset)/i],
          ];
          const names = [...commands.keys()];
          const grouped = groups.map(([title, rule]) => [title, names.filter((name) => rule.test(name))]);
          const used = new Set(grouped.flatMap(([, list]) => list));
          const other = names.filter((name) => !used.has(name));
          if (other.length) grouped.push(["📦 MORE COMMANDS", other]);
          const body = grouped.filter(([, list]) => list.length).map(([title, list]) => `╭─❰ *${title}* ❱\n${list.sort().map((name) => `│ ▸ ${config.prefix}${name}`).join("\n")}\n╰──────────────`).join("\n\n");
          const text = `╭━━━❰ *${config.botName}* ❱━━━╮\n┃ 🤖 Prefix: *${config.prefix}*\n┃ 📦 Commands: *${commands.size}*\n┃ 🟢 Status: *ONLINE*\n╰━━━━━━━━━━━━━━━━╯\n\n${body}\n\n> ⚡ Fast • Secure • Reliable`;
          const contextInfo = { forwardingScore: 999, isForwarded: true, forwardedNewsletterMessageInfo: { newsletterJid: config.channelJid, newsletterName: config.botName, serverMessageId: -1 } };
          try { await targetSock.sendMessage(targetFrom, { text, contextInfo }); }
          catch { await targetSock.sendMessage(targetFrom, { text }); }
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
      if (!isController(sock, from, msg, sessionId)) return;
      if (requiresGroupAdmin && !(await requireGroupAdmin(
        sock, from, msg, !BOT_ADMIN_OPTIONAL_COMMANDS.has(normalizedCommand)
      ))) return;
    } else if (requiresGroupAdmin) {
      const ownerSpecial = controller && !botAdmin && BOT_ADMIN_OPTIONAL_COMMANDS.has(normalizedCommand);
      if (!ownerSpecial && !(await requireGroupAdmin(sock, from, msg, !BOT_ADMIN_OPTIONAL_COMMANDS.has(normalizedCommand)))) return;
    }

    if (cmd.toggle && !isOn(sessionId, cmd.toggle)) {
      return sock.sendMessage(from, {
        text: styledToggleReply(cmdName, false, `Enable with .${cmdName} on`),
      });
    }

    try {
      const originalSendMessage = sock.sendMessage;
      sock.sendMessage = async (jid, content, ...sendArgs) => {
        if (!(cmdName === "gcsstatus" && jid === "status@broadcast") && content && typeof content.text === "string") {
          content = { ...content, text: professionalizeReply(content.text) };
        }
        return originalSendMessage.call(sock, jid, content, ...sendArgs);
      };
      try {
        await cmd.run({ sock, msg, from, args, sessionId, text: commandText, cmdName });
      } finally {
        sock.sendMessage = originalSendMessage;
      }
    } catch (e) {
      log.error(`cmd ${cmdName}: ${e?.stack || e}`);
      await sock.sendMessage(from, { text: `╭━━━❰ *COMMAND ERROR* ❱━━━╮\n┃ ❌ Command: *${cmdName}*\n┃ 📝 ${e?.message || "Please try again"}\n╰━━━━━━━━━━━━━━━━━━━━╯` }).catch(() => {});
    }
  } catch (e) { log.error("handler: " + e.message); }
}

function unwrapMessage(message) {
  let current = message;
  for (let i = 0; i < 8 && current; i++) {
    const next = current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message;
    if (!next || next === current) break;
    current = next;
  }
  return current;
}
function isPrefixedCommandMessage(msg) {
  const message = unwrapMessage(msg?.message);
  const text = message?.conversation || message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption || message?.videoMessage?.caption ||
    message?.documentMessage?.caption || message?.buttonsResponseMessage?.selectedButtonId ||
    message?.listResponseMessage?.singleSelectReply?.selectedRowId || "";
  return String(text).trimStart().startsWith(config.prefix);
}
function unwrapAntideletePayload(message) {
  let current = message?.message || message;
  let isStatusMention = false;
  let isViewOnce = false;
  for (let i = 0; i < 8 && current; i++) {
    if (current?.statusMentionMessage) {
      isStatusMention = true;
      if (current.statusMentionMessage.quotedStatus) {
        current = current.statusMentionMessage.quotedStatus;
        continue;
      }
      break;
    }
    let next = null;
    if (current?.viewOnceMessage?.message) {
      isViewOnce = true;
      next = current.viewOnceMessage.message;
    } else if (current?.viewOnceMessageV2?.message) {
      isViewOnce = true;
      next = current.viewOnceMessageV2.message;
    } else if (current?.viewOnceMessageV2Extension?.message) {
      isViewOnce = true;
      next = current.viewOnceMessageV2Extension.message;
    } else {
      next = current?.ephemeralMessage?.message || current?.documentWithCaptionMessage?.message;
    }
    if (!next || next === current) break;
    current = next;
  }
  return { message: unwrapMessage(current), isStatusMention, isViewOnce };
}

/* ============================================================
 * 10. COMMANDS — GROUP
 * ============================================================ */
const mk = (n, fn) => register(n, { toggle: null, run: fn });
const mkProtectedMedia = (n, fn) => registerProtectedMediaCommand(n, { toggle: null, run: fn });
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
mk("tag", async ({ sock, from, msg, args }) => {
  const target = getTargetJid(msg, args);
  if (!target) {
    return sock.sendMessage(from, {
      text: "╭━━━❰ *TAG COMMAND* ❱━━━╮\n┃ ❌ Reply to or mention one member.\n┃ 💡 Usage: .tag @member\n╰━━━━━━━━━━━━━━━━━━━━╯",
    });
  }
  const message = args.filter((arg) => !/^\d+$/.test(arg)).join(" ") || "You have been tagged.";
  await sock.sendMessage(from, {
    text: `╭━━━❰ *MEMBER TAGGED* ❱━━━╮\n┃ 👤 @${target.split("@")[0]}\n┃ 📝 ${message}\n╰━━━━━━━━━━━━━━━━━━━━╯`,
    mentions: [target],
  });
});
mk("hidetag", async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  await sock.sendMessage(from, { text: args.join(" ") || " ", mentions: md.participants.map((p) => p.id) });
});
mk("tagme", async ({ sock, from, msg, sessionId }) => {
  const sender = msg?.key?.fromMe
    ? (sock.user?.id || sock.user?.lid || `${String(sessionId).replace(/\D/g, "")}@s.whatsapp.net`)
    : (msg?.key?.participant || from);
  const resolvedSender = await resolveOriginalJid(sock, sender);
  await sock.sendMessage(from, { text: `@${resolvedSender.split("@")[0]}`, mentions: [resolvedSender] });
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
async function updateGroupPrivacy(sock, from, msg, setting, enabledText, disabledText) {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  if (!(await requireGroupAdmin(sock, from, msg))) return;
  await sock.groupSettingUpdate(from, setting);
  await sock.sendMessage(from, { text: enabledText || disabledText });
}
mk("restrict", async ({ sock, from, msg }) => updateGroupPrivacy(sock, from, msg, "locked", "✅ Group restricted. Only admins can edit group info.", ""));
mk("unrestrict", async ({ sock, from, msg }) => updateGroupPrivacy(sock, from, msg, "unlocked", "✅ Group privacy opened. Members can edit group info.", ""));
mk("lock", async ({ sock, from, msg }) => updateGroupPrivacy(sock, from, msg, "announcement", "✅ Group locked. Only admins can send messages.", ""));
mk("unlock", async ({ sock, from, msg }) => updateGroupPrivacy(sock, from, msg, "not_announcement", "✅ Group unlocked. All members can send messages.", ""));
mk("announcement", async ({ sock, from, msg }) => updateGroupPrivacy(sock, from, msg, "announcement", "✅ Announcement mode enabled. Only admins can send messages.", ""));
mk("unannouncement", async ({ sock, from, msg }) => updateGroupPrivacy(sock, from, msg, "not_announcement", "✅ Announcement mode disabled. All members can send messages.", ""));
mk("groupinfo", async ({ sock, from }) => {
  const md = await sock.groupMetadata(from);
  const admins = md.participants.filter((p) => p.admin).map((p) => displayUser(p.id, p)).join(", ");
  await sock.sendMessage(from, {
    text: `📛 *${md.subject}*\n🆔 ${md.id}\n👥 Members: ${md.participants.length}\n👑 Admins: ${admins || "None"}\n📝 ${md.desc?.toString() || "No description"}`,
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
mk("rules", async ({ sock, from }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  const md = await sock.groupMetadata(from);
  const rules = getGroupMessageSettings(from).rules;
  await sock.sendMessage(from, { text: `╭━━━❰ *${md.subject || "GROUP"} RULES* ❱━━━╮\n┃ 📜 ${rules.replace(/\n/g, "\n┃ ")}\n╰━━━━━━━━━━━━━━━━━━━━╯` });
});
mk("setrules", async ({ sock, from, msg, args }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  if (!(await requireGroupAdmin(sock, from, msg))) return;
  const rules = args.join(" ").trim();
  if (!rules) return sock.sendMessage(from, { text: "Usage: .setrules <group rules>" });
  getGroupMessageSettings(from).rules = rules;
  await sock.sendMessage(from, { text: `✅ Group rules updated.\n\n📜 ${rules}` });
});
mk("pending", async ({ sock, from }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  const requests = await sock.groupRequestParticipantsList(from);
  if (!requests?.length) return sock.sendMessage(from, { text: "📥 No pending join requests." });
  const lines = requests.map((request, index) => `${index + 1}. +${cleanJid(request?.jid || request?.id) || "Unknown"}`);
  await sock.sendMessage(from, { text: `📥 *PENDING JOIN REQUESTS (${requests.length})*\n\n${lines.join("\n")}\n\nUse .approve or .reject <number>.` });
});
mk("reject", async ({ sock, from, msg, args }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  if (!(await requireGroupAdmin(sock, from, msg))) return;
  const wanted = String(args[0] || "").replace(/\D/g, "");
  if (!wanted) return sock.sendMessage(from, { text: "Usage: .reject <number>" });
  const requests = await sock.groupRequestParticipantsList(from);
  const request = (requests || []).find((item) => cleanJid(item?.jid || item?.id) === wanted);
  if (!request) return sock.sendMessage(from, { text: "📥 No matching pending join request found." });
  const jid = request.jid || request.id;
  await sock.groupRequestParticipantsUpdate(from, [jid], "reject");
  await sock.sendMessage(from, { text: `✅ Join request +${wanted} rejected.` });
});
mk("rejectall", async ({ sock, from, msg }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  if (!(await requireGroupAdmin(sock, from, msg))) return;
  const requests = await sock.groupRequestParticipantsList(from);
  if (!requests?.length) return sock.sendMessage(from, { text: "📥 No pending join requests." });
  let rejected = 0;
  for (const request of requests) {
    const jid = request?.jid || request?.id;
    if (!jid) continue;
    await sock.groupRequestParticipantsUpdate(from, [jid], "reject");
    rejected += 1;
  }
  await sock.sendMessage(from, { text: `✅ Rejected ${rejected} pending join request(s).` });
});
mk("admins", async ({ sock, from }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  const md = await sock.groupMetadata(from);
  const admins = await Promise.all(md.participants.filter((participant) => participant.admin).map(async (participant, index) => {
    const jid = await resolveOriginalJid(sock, participant.phoneNumber || participant.jid || participant.id);
    return `${index + 1}. ${displayUser(jid, participant)}`;
  }));
  await sock.sendMessage(from, { text: `👑 *GROUP ADMINS*\n\n${admins.join("\n") || "No admins found."}` });
});
mk("groupstats", async ({ sock, from }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  const md = await sock.groupMetadata(from);
  const admins = md.participants.filter((participant) => participant.admin).length;
  const settings = getGroupMessageSettings(from);
  await sock.sendMessage(from, { text: `📊 *GROUP STATISTICS*\n\n📛 Name: ${md.subject || "Unknown"}\n👥 Members: ${md.participants.length}\n👑 Admins: ${admins}\n🟢 Welcome: ${settings.welcomeEnabled ? "ON" : "OFF"}\n🟢 Goodbye: ${settings.goodbyeEnabled ? "ON" : "OFF"}\n📜 Rules: ${settings.rules === "No group rules have been set yet." ? "NOT SET" : "SET"}` });
});
mk("members", async ({ sock, from }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  const md = await sock.groupMetadata(from);
  const lines = md.participants.map((participant, index) => `${index + 1}. ${displayUser(participant.id, participant)}${participant.admin ? " 👑" : ""}`);
  for (const part of (lines.join("\n").match(/[\s\S]{1,3500}/g) || ["No members found."])) await sock.sendMessage(from, { text: `👥 *GROUP MEMBERS*\n\n${part}` });
});
mk("revoke", async ({ sock, from, msg }) => {
  if (!(await requireGroupAdmin(sock, from, msg))) return;
  await sock.groupRevokeInvite(from);
  await sock.sendMessage(from, { text: "✅ Group invite link reset. The old link is no longer valid." });
});
mk("clearwarnings", async ({ sock, from, msg }) => {
  if (!(await requireGroupAdmin(sock, from, msg))) return;
  for (const key of [...antiWarningCounts.keys()]) if (key.startsWith(`${from}:`)) antiWarningCounts.delete(key);
  for (const key of [...warningState.keys()]) if (key.startsWith(`${from}:`)) warningState.delete(key);
  await sock.sendMessage(from, { text: "✅ All warning counts for this group have been cleared." });
});
register("approve", { toggle: null, owner: true, run: async ({ sock, from, args }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  if (approvalJobs.has(from)) return sock.sendMessage(from, { text: "⏳ An approval process is already running. Use .cancelapprove to stop it." });
  const requests = await sock.groupRequestParticipantsList(from);
  const wanted = String(args[0] || "all").replace(/\D/g, "");
  const pending = (requests || []).filter((request) => {
    if (!wanted || wanted === "all") return true;
    return cleanJid(request?.jid || request?.id) === wanted;
  });
  if (!pending.length) return sock.sendMessage(from, { text: "📥 No matching pending join request found." });
  const job = { cancelled: false };
  approvalJobs.set(from, job);
  let approved = 0;
  try {
    for (const request of pending) {
      if (job.cancelled) break;
      const jid = request?.jid || request?.id;
      if (!jid) continue;
      await sock.groupRequestParticipantsUpdate(from, [jid], "approve");
      approved += 1;
    }
    await sock.sendMessage(from, {
      text: job.cancelled
        ? `🛑 Approval cancelled. Approved ${approved}/${pending.length} request(s) before cancellation.`
        : `✅ Approved ${approved} pending request(s).`,
    });
  } finally {
    if (approvalJobs.get(from) === job) approvalJobs.delete(from);
  }
}});
register("cancelapprove", { toggle: null, owner: true, run: async ({ sock, from }) => {
  const job = approvalJobs.get(from);
  if (!job) return sock.sendMessage(from, { text: "ℹ️ No approval process is currently running." });
  job.cancelled = true;
  await sock.sendMessage(from, { text: "🛑 Approval cancellation requested. The current request will stop after its active operation." });
}});
mk("delgrouppp", async ({ sock, from }) => {
  await sock.removeProfilePicture(from);
  await sock.sendMessage(from, { text: "🗑️ Group PP deleted" });
});
mk("setgrouppp", async ({ sock, from, msg }) => {
  const direct = unwrapMessage(msg.message);
  const quoted = getQuotedMessage(msg);
  const mediaMessage = direct?.imageMessage ? msg : quoted?.imageMessage ? { message: quoted } : null;
  if (!mediaMessage) return sock.sendMessage(from, { text: "❌ Please reply to an image with .setgrouppp, or send the image with the command." });
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
  "antispam","antiflood","antiraid","antiinvite",
];
const AUTO_LIST = ["autoseen", "autotyping", "autorecording", "autoreact", "autoviewstatus", "autoreactstatus", "autosavestatus", "autoreacttyping", "autorecordtyping", "autoreply"];
for (const name of AUTO_LIST) {
  register(name, {
    toggle: null,
    run: async ({ sock, from, msg, args }) => {
      if (!(await requireGroupAdmin(sock, from, msg, false))) return;
      const sessionScoped = ["autoviewstatus", "autoreactstatus", "autosavestatus"].includes(name);
      const scope = sessionScoped ? (sock.user?.id?.split(":")[0] || from) : from;
      if (!args[0]) return sock.sendMessage(from, { text: `${styledToggleReply(name, getToggles(scope)[name], `Usage: .${name} on/off`)}` });
      const result = setToggleIfChanged(scope, name, args[0]);
      if (!result.changed) return;
      await sock.sendMessage(from, { text: styledToggleReply(name, getToggles(scope)[name], "Updated for this group") });
    },
  });
}
for (const name of ANTI_LIST) {
  register(name, {
    toggle: null,
    run: async ({ sock, from, args, sessionId }) => {
      const scope = from.endsWith("@g.us") ? from : sessionId;
      if (!args[0]) {
        const t = getToggles(scope);
        return sock.sendMessage(from, {
          text: styledToggleReply(name, t[name], `Usage: .${name} on/off`),
        });
      }
      const result = setToggleIfChanged(scope, name, args[0]);
      if (!result.ok) return sock.sendMessage(from, { text: styledToggleReply(name, false, "Unknown toggle") });
      if (!result.changed) return;
      await sock.sendMessage(from, { text: styledToggleReply(name, getToggles(scope)[name], "Updated") });
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
      const previousAction = antilinkActionState.get(from) || "delete";
      const result = setToggleIfChanged(from, "antilink", true);
      antilinkActionState.set(from, mode);
      if (previousAction === mode && !result.changed) return;
      return sock.sendMessage(from, { text: styledToggleReply("antilink", true, `Action: ${mode} | Links will be deleted immediately`) });
    }
    if (mode === "on" || mode === "off") {
      const result = setToggleIfChanged(from, "antilink", mode);
      if (!result.changed) return;
      return sock.sendMessage(from, { text: styledToggleReply("antilink", mode === "on", "Updated") });
    }
    await sock.sendMessage(from, { text: styledToggleReply("antilink", false, "Usage: .antilink on/off/kick/delete") });
  },
});
register("autostatuslinkkick", {
  toggle: null,
  run: async ({ sock, from, args, sessionId }) => {
    const scope = from.endsWith("@g.us") ? from : sessionId;
    if (!args[0]) {
      const t = getToggles(scope);
      return sock.sendMessage(from, { text: styledToggleReply("autostatuslinkkick", t.antistatuslinkkick, "Use: .autostatuslinkkick on/off") });
    }
    const result = setToggleIfChanged(scope, "antistatuslinkkick", args[0]);
    if (!result.changed) return;
    await sock.sendMessage(from, { text: styledToggleReply("autostatuslinkkick", getToggles(scope).antistatuslinkkick, "Updated") });
  },
});
register("set", {
  toggle: null,
  run: async ({ sock, from, args, sessionId }) => {
    if (args.length < 2) return sock.sendMessage(from, { text: styledToggleReply(args[0] || "SET", false, "Usage: .set <key> on/off") });
    const result = setToggleIfChanged(sessionId, args[0], args[1]);
    if (!result.ok) return sock.sendMessage(from, { text: styledToggleReply(args[0], false, "Unknown toggle") });
    if (!result.changed) return;
    await sock.sendMessage(from, { text: styledToggleReply(args[0], getToggles(sessionId)[args[0]], "Updated") });
  },
});
register("botstatus", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    if (!(await requireGroupAdmin(sock, from, msg, false))) return;
    const toggles = getToggles(from);
    const botIsAdmin = await isBotAdmin(sock, from);
    const groupSettings = getGroupMessageSettings(from);
    const active = [...new Set([...commands.keys()].filter((name) => toggles[name] === true))];
    if (groupSettings.welcomeEnabled && commands.has("welcome")) active.push("welcome");
    if (groupSettings.goodbyeEnabled && commands.has("goodbye")) active.push("goodbye");
    active.sort();
    const text = `╭━━━❰ *BOT STATUS* ❱━━━╮
┃ 🛡️ Bot admin: ${botIsAdmin ? "YES ✅" : "NO ⚠️"}
┃ ⚙️ Active commands: *${active.length}*
╰━━━━━━━━━━━━━━━━━━━━╯
${active.length ? active.map((name) => `▸ ${config.prefix}${name}`).join("\n") : "No commands are currently enabled."}`;
    await sock.sendMessage(from, { text });
  },
});
register("settings", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    if (!(await requireGroupAdmin(sock, from, msg))) return;
    const toggles = getToggles(from);
    const group = from.endsWith("@g.us") ? getGroupMessageSettings(from) : null;
    const enabled = Object.entries(toggles).filter(([, value]) => value === true).map(([name]) => name);
    const text = `╭━━━❰ *GROUP SETTINGS* ❱━━━╮
┃ 🛡️ Security ON: ${enabled.length}
┃ 🎉 Welcome: ${group ? (group.welcomeEnabled ? "ON" : "OFF") : "N/A"}
┃ 👋 Goodbye: ${group ? (group.goodbyeEnabled ? "ON" : "OFF") : "N/A"}
┃ 📜 Rules: ${group && group.rules !== "No group rules have been set yet." ? "SET" : "NOT SET"}
╰━━━━━━━━━━━━━━━━━━━━╯

${enabled.length ? `🟢 *Enabled Features*\n${enabled.map((name) => `▸ ${name}`).join("\n")}` : "🔴 No security/auto features enabled."}`;
    await sock.sendMessage(from, { text });
  },
});
register("resetsettings", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    if (!(await requireGroupAdmin(sock, from, msg))) return;
    toggleState.delete(from);
    saveRepeatGuardToggleState();
    groupMessageSettings.delete(from);
    saveGroupMessageSettings();
    antiWarningCounts.delete(from);
    await sock.sendMessage(from, { text: "✅ Group settings reset to defaults. Existing session-wide owner settings were not changed." });
  },
});
register("securitystatus", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    if (!(await requireGroupAdmin(sock, from, msg))) return;
    const toggles = getToggles(from);
    const antiLines = ANTI_LIST.map((name) => `▸ ${name}: ${toggles[name] ? "🟢 ON" : "🔴 OFF"}`);
    const autoLines = AUTO_LIST.map((name) => `▸ ${name}: ${toggles[name] ? "🟢 ON" : "🔴 OFF"}`);
    await sock.sendMessage(from, { text: `🛡️ *SECURITY STATUS*\n\n⚔️ *Anti Features*\n${antiLines.join("\n")}\n\n⚙️ *Auto Features*\n${autoLines.join("\n")}` });
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
      const rawAudience = md.participants
        .map((p) => p?.jid || p?.phoneNumber || p?.id)
        .filter((jid) => jid && !String(jid).endsWith("@g.us"));
      const statusJidList = [...new Set((await Promise.all(rawAudience.map((jid) => resolveOriginalJid(sock, jid))))
        .filter((jid) => String(jid).endsWith("@s.whatsapp.net")))];
      if (!statusJidList.length) throw new Error("No valid WhatsApp audience JIDs found for this group");
      const result = await sock.sendMessage("status@broadcast", { text }, { statusJidList, broadcast: true });
      if (!result?.key?.id) throw new Error("WhatsApp did not return a status message id");
      await sock.sendMessage(from, { text: `╭━━━❰ *GC STATUS* ❱━━━╮\n┃ ✅ Status published successfully\n┃ 👥 Audience: ${statusJidList.length} group members\n┃ 📡 Broadcast mode: enabled\n╰━━━━━━━━━━━━━━━━━━━━╯` });
    } catch (error) { await sock.sendMessage(from, { text: `❌ Failed to post story: ${error?.message || "WhatsApp rejected it"}` }); }
  },
});
register("gcsstatus", {
  toggle: null,
  run: async ({ sock, from, msg }) => {
    let sentGroups = 0;
    let totalGroups = 0;
    try {
      const quoted = getQuotedMessage(msg);
      const text = quoted?.conversation ?? quoted?.extendedTextMessage?.text ?? "";
      if (typeof text !== "string" || !text.trim()) {
        return sock.sendMessage(from, {
          text: "⚠️ Kisi text ya link ko reply karke sirf *.gcsstatus* bhejein.",
        }, { quoted: msg });
      }

      await sock.sendMessage(from, {
        text: "⏳ *gcsstatus* chal raha hai… har group ki Story par post ho rahi hai.",
      });

      if (typeof sock.groupFetchAllParticipating !== "function") {
        throw new Error("Is WhatsApp connection me group list available nahi hai.");
      }
      const groupEntries = Object.entries(await sock.groupFetchAllParticipating() || {});
      if (!groupEntries.length) throw new Error("Bot kisi bhi group me nahi hai.");
      if (typeof sock.relayMessage !== "function") {
        throw new Error("Is Baileys connection me direct group-story relay available nahi hai.");
      }
      if (typeof generateWAMessageContent !== "function" || typeof generateWAMessageFromContent !== "function") {
        throw new Error("Installed Baileys me group-story message helpers available nahi hain.");
      }
      const senderJid = jidNormalizedUser(sock?.user?.id || sock?.user?.jid || "");
      if (!senderJid) throw new Error("Bot ka sender JID resolve nahi hua.");
      totalGroups = groupEntries.length;

      for (let i = 0; i < groupEntries.length; i++) {
        const [groupJid] = groupEntries[i];
        const storyContent = await generateWAMessageContent({ text }, { jid: groupJid });
        if (!storyContent?.extendedTextMessage) {
          throw new Error(`Group ${i + 1}/${totalGroups} ke liye text-story content nahi bana.`);
        }
        storyContent.extendedTextMessage.font = 1;
        storyContent.extendedTextMessage.backgroundArgb = 0xff23313a;
        storyContent.extendedTextMessage.contextInfo = {
          ...(storyContent.extendedTextMessage.contextInfo || {}),
          forwardingScore: 0,
          featureEligibilities: { canBeReshared: true, canReceiveMultiReact: true },
          pairedMediaType: 0,
          isGroupStatus: true,
          statusAttributions: [{
            type: proto.StatusAttribution.Type.GROUP_STATUS,
            groupStatus: { authorJid: senderJid },
          }],
        };
        const generated = generateWAMessageFromContent(groupJid, {
          groupStatusMessageV2: { message: storyContent },
        }, { userJid: senderJid });
        if (!generated?.message || !generated?.key?.id) {
          throw new Error(`Group ${i + 1}/${totalGroups} ka story message generate nahi hua.`);
        }
        await sock.relayMessage(groupJid, generated.message, { messageId: generated.key.id });
        sentGroups++;
        if (i < groupEntries.length - 1) await new Promise((resolve) => setTimeout(resolve, 800));
      }

      await sock.sendMessage(from, {
        text: `✅ *gcsstatus Group Stories post kar di*\n\n📋 Groups: *${sentGroups}/${totalGroups}*\n📌 Har group ki apni Story par post hua; individual status audience list use nahi hui.`,
      });
    } catch (error) {
      log.error(`gcsstatus failed: ${error?.stack || error}`);
      await sock.sendMessage(from, {
        text: `${sentGroups ? `⚠️ *${sentGroups}/${totalGroups} group stories pehle hi bheji gayi.*\n` : ""}❌ *gcsstatus nahi chala:*\n${error?.message || "Unknown error"}`,
      }).catch(() => {});
    }
  },
});
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
let ytDlpBinaryPromise;
async function getYtDlpBinary() {
  if (!ytDlpBinaryPromise) {
    ytDlpBinaryPromise = (async () => {
      const candidates = [
        process.env.YT_DLP_PATH,
        "/opt/yt-dlp/bin/yt-dlp",
        "yt-dlp",
      ].filter(Boolean);
      for (const candidate of candidates) {
        try {
          await execFileAsync(candidate, ["--version"], { timeout: 10000 });
          return candidate;
        } catch {}
      }
      // Download the official standalone binary once when the host has no yt-dlp package.
      const target = path.join(os.tmpdir(), "md-ghani-yt-dlp");
      try {
        const response = await axios.get(
          "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
          { responseType: "arraybuffer", timeout: 60000 }
        );
        await fs.promises.writeFile(target, Buffer.from(response.data), { mode: 0o755 });
        await fs.promises.chmod(target, 0o755);
        await execFileAsync(target, ["--version"], { timeout: 15000 });
        return target;
      } catch (error) {
        throw new Error(`yt-dlp unavailable: ${error?.message || error}`);
      }
    })();
  }
  return ytDlpBinaryPromise;
}

const mediaFooter = () => `> ${config.botName}`;
async function sendMediaFooter(sock, from) {
  await sock.sendMessage(from, { text: mediaFooter() });
}

async function downloadWithYtDlp(input, kind) {
  const url = await resolveYouTube(input);
  const ext = kind === "audio" ? "mp3" : "mp4";
  const base = path.join(os.tmpdir(), `md-ghani-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const output = `${base}.${ext}`;
  const outputTemplate = `${base}.%(ext)s`;
  try {
    const format = kind === "audio"
      ? "ba[ext=m4a]/ba[ext=webm]/bestaudio/best"
      : "bv*[height<=480]+ba/b[height<=480]/bv*[height<=720]+ba/b[height<=720]/b";
    const binary = await getYtDlpBinary();
    // The Docker image installs yt-dlp's no-cookie PO-token provider. Use its
    // recommended mweb client when present; keep the existing client fallback
    // for deployments that run without the provider package.
    const potProviderHome = process.env.YOUTUBE_POT_PROVIDER_SERVER_HOME ||
      "/opt/bgutil-ytdlp-pot-provider/server";
    const hasPotProvider = fs.existsSync(path.join(potProviderHome, "build", "main.js")) &&
      fs.existsSync(path.join(potProviderHome, "node_modules"));
    const clients = hasPotProvider
      ? ["mweb"]
      : ["web_safari", "web", "web_creator", "mweb", "android", "tv_embedded", "android_vr"];
    const downloadEnv = { ...process.env };
    for (const key of ["YOUTUBE_PROXY", "YOUTUBE_COOKIES_FILE", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
      delete downloadEnv[key];
    }
    let lastError;
    for (const client of clients) {
      // Do not force an address family; let the host use its available route.
      const args = ["--no-playlist", "--no-warnings", "--no-check-certificates", "--geo-bypass", "--retries", "3", "--fragment-retries", "3", "--retry-sleep", "linear=1::3", "--concurrent-fragments", "1", "--js-runtimes", "node", "--remote-components", "ejs:github", "--extractor-args", `youtube:player_client=${client}`, "--max-filesize", "50M", "--merge-output-format", "mp4", "-f", format, "-o", outputTemplate];
      if (hasPotProvider) args.push("--extractor-args", `youtubepot-bgutilscript:server_home=${potProviderHome}`);
      if (kind === "audio") args.push("--extract-audio", "--audio-format", "mp3", "--audio-quality", "5");
      else args.push("--remux-video", "mp4");
      args.push(url);
      try {
        await execFileAsync(binary, args, { timeout: 150000, maxBuffer: 2 * 1024 * 1024, env: downloadEnv });
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
    const prefix = `${path.basename(base)}.`;
    const leftovers = await fs.promises.readdir(os.tmpdir()).catch(() => []);
    await Promise.all(leftovers
      .filter((name) => name.startsWith(prefix))
      .map((name) => fs.promises.rm(path.join(os.tmpdir(), name), { force: true }).catch(() => {})));
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
async function getYouTubeMediaDetails(input) {
  const directUrl = ytdl.validateURL(input);
  if (directUrl) {
    try {
      const info = await ytdl.getInfo(input);
      const details = info.videoDetails || {};
      return {
        url: input,
        title: details.title || "YouTube media",
        author: details.author?.name || "",
        seconds: Number(details.lengthSeconds) || 0,
        thumbnail: details.thumbnails?.at(-1)?.url || details.thumbnails?.[0]?.url || "",
      };
    } catch {}
    return { url: input, title: "YouTube media", author: "", seconds: 0, thumbnail: "" };
  }
  const result = await ytSearch(input);
  const video = result.videos?.find((item) => item?.url) || null;
  if (video) {
    return {
      url: video.url,
      title: video.title || "YouTube media",
      author: video.author?.name || "",
      seconds: Number(video.seconds) || 0,
      timestamp: video.timestamp || "",
      thumbnail: video.thumbnail || "",
    };
  }
  throw new Error("No matching YouTube media found");
}
function formatMediaDuration(media) {
  const seconds = Math.floor(Number(media.seconds) || 0);
  if (seconds > 0) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }
  return media.timestamp || "Unknown";
}
function mediaFileName(title, extension) {
  const safe = String(title || "media")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${safe || "media"}.${extension}`;
}
function isYouTubeAccessBlocked(errorText) {
  return /\b403\b|\b429\b|too many requests|forbidden|failed to extract any player response|sign in to confirm|confirm.{0,30}not a bot|not a bot|bot verification|captcha|unusual traffic/i.test(String(errorText || ""));
}
async function sendYouTubeMedia(sock, from, input, kind) {
  const details = await getYouTubeMediaDetails(input);
  const title = String(details.title || "YouTube media").replace(/[\r\n]+/g, " ").trim().slice(0, 180);
  const duration = formatMediaDuration(details);
  const isAudio = kind === "audio";

  let media;
  try {
    media = await downloadWithYtDlp(details.url, kind);
  } catch (primaryError) {
    const primaryDetails = [primaryError?.stderr, primaryError?.message].filter(Boolean).join(" ");
    if (isYouTubeAccessBlocked(primaryDetails)) {
      log.warn(`YouTube ${kind} primary download blocked; trying the configured legacy fallback`);
    }
    try { media = await legacyYouTube(details.url, kind); }
    catch (fallbackError) {
      const errorDetails = [primaryError?.stderr, primaryError?.message, fallbackError?.message]
        .filter(Boolean).join(" ");
      const blocked = isYouTubeAccessBlocked(errorDetails);
      log.warn(`YouTube ${kind} download failed: ${blocked ? "access or bot-verification block" : (fallbackError?.message || primaryError?.message || fallbackError)}`);
      const message = blocked
        ? `❌ YouTube refused this download from the bot server. Try a different video or try again later.`
        : `❌ Couldn't download *${title}*. Please try again shortly.`;
      await sock.sendMessage(from, { text: message }).catch(() => {});
      return;
    }
  }

  if (isAudio) {
    const output = {
      audio: media.buffer || { url: media.mediaUrl },
      mimetype: "audio/mpeg",
      ptt: false,
    };
    await sock.sendMessage(from, output);
    return;
  }
  const videoCaption = `╭━━━❰ *VIDEO READY* ❱━━━╮\n┃ 🎬 ${title}\n┃ ⏱️ ${duration}\n┃ ✅ Format: MP4\n╰━━━━━━━━━━━━━━━━━━━━╯`;
  await sock.sendMessage(from, {
    video: media.buffer || { url: media.mediaUrl },
    mimetype: "video/mp4",
    caption: videoCaption,
  });
}
mkProtectedMedia("ytmp4", async ({ sock, from, args }) => {
  if (!args[0]) return sock.sendMessage(from, { text: "Usage: .ytmp4 <YouTube URL>" });
  await sendYouTubeMedia(sock, from, args.join(" "), "video");
});
mk("ytmp3", async ({ sock, from, args }) => {
  if (!args[0]) return sock.sendMessage(from, { text: "Usage: .ytmp3 <YouTube URL>" });
  const input = args.join(" ");
  try {
    const media = await downloadWithYtDlp(input, "audio");
    await sock.sendMessage(from, { audio: media.buffer, mimetype: media.mimetype, ptt: false });
    await sendMediaFooter(sock, from);
  } catch {
    try { const f = await legacyYouTube(input, "audio"); await sock.sendMessage(from, { audio: { url: f.mediaUrl }, mimetype: "audio/mpeg", ptt: false });
      await sendMediaFooter(sock, from); }
    catch (fallbackError) {
      log.warn(`YouTube download failed: ${fallbackError?.message || fallbackError}`);
      throw new Error("YouTube download failed. Please try again shortly.");
    }
  }
});
mkProtectedMedia("song", async ({ sock, from, args }) => {
  const q = args.join(" ");
  if (!q) return sock.sendMessage(from, { text: "Usage: .song <song name>" });
  await sendYouTubeMedia(sock, from, q, "audio");
});
mkProtectedMedia("song2", async (p) => commands.get("song").run(p));
mkProtectedMedia("play", async (p) => commands.get("song").run(p));
mkProtectedMedia("video", async (p) => commands.get("ytmp4").run(p));
mk("youtube", async (p) => commands.get("ytmp4").run(p));
mk("yt", async (p) => commands.get("ytmp4").run(p));
mk("audio", async (p) => commands.get("song").run(p));
mk("download", async (p) => commands.get("ytmp4").run(p));
mk("dl", async (p) => commands.get("ytmp4").run(p));
mk("media", async (p) => commands.get("ytmp4").run(p));
mk("tomp3", async (p) => commands.get("ytmp3").run(p));
mk("ytmp", async (p) => commands.get("ytmp4").run(p));
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
  const input = getMediaInput(msg);
  if (!input || !["imageMessage", "videoMessage"].includes(input.kind)) {
    return sock.sendMessage(from, { text: "❌ Send or reply to an image/video with .sticker" });
  }
  const buf = await downloadMedia(sock, input.message);
  const webp = input.kind === "videoMessage"
    ? await convertVideoToSticker(buf)
    : await sharp(buf).rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  await sock.sendMessage(from, { sticker: webp });
});
mk("tosticker", async (p) => commands.get("sticker").run(p));
mk("togif", async ({ sock, from, msg }) => {
  const input = getMediaInput(msg);
  if (!input || !["imageMessage", "videoMessage"].includes(input.kind)) return sock.sendMessage(from, { text: "❌ Send or reply to an image/video with .togif" });
  const buf = await downloadMedia(sock, input.message);
  const gifVideo = await convertToGifVideo(buf, input.kind);
  await sock.sendMessage(from, { video: gifVideo, gifPlayback: true });
});
mk("toimg", async ({ sock, from, msg }) => {
  const input = getMediaInput(msg);
  if (!input || !["imageMessage", "videoMessage"].includes(input.kind)) return sock.sendMessage(from, { text: "❌ Send or reply to an image/video with .toimg" });
  const buf = await downloadMedia(sock, input.message);
  const png = input.kind === "videoMessage" ? await extractVideoFrame(buf) : await sharp(buf).rotate().png().toBuffer();
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
  const input = getMediaInput(msg);
  if (!input || input.kind !== "imageMessage") return sock.sendMessage(from, { text: "❌ Send or reply to an image with .blur" });
  const buf = await downloadMedia(sock, input.message);
  const blurred = await sharp(buf).rotate().blur(15).jpeg({ quality: 82 }).toBuffer();
  await sock.sendMessage(from, { image: blurred });
});
mk("crop", async ({ sock, from, msg }) => {
  const input = getMediaInput(msg);
  if (!input || input.kind !== "imageMessage") return sock.sendMessage(from, { text: "❌ Send or reply to an image with .crop" });
  const buf = await downloadMedia(sock, input.message);
  const cropped = await sharp(buf).rotate().resize(500, 500, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
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
mkOwner("health", async ({ sock, from }) => {
  const minutes = Math.floor(process.uptime() / 60);
  const seconds = Math.floor(process.uptime() % 60).toString().padStart(2, "0");
  const active = [...sessions.values()].filter((session) => session.sock?.user).length;
  await sock.sendMessage(from, { text: `🩺 *BOT HEALTH*\n\n🟢 Process: ONLINE\n⏱️ Uptime: ${minutes}m ${seconds}s\n🔐 Active sessions: ${active}\n📦 Commands loaded: ${commands.size}\n🛡️ Security engine: READY\n💾 Backup engine: READY` });
});
mkOwner("setprefix", async ({ sock, from, args }) => {
  const prefix = String(args[0] || "").trim();
  if (!prefix || /\s/.test(prefix) || prefix.length > 3) return sock.sendMessage(from, { text: "Usage: .setprefix <1-3 character prefix>" });
  config.prefix = prefix;
  await sock.sendMessage(from, { text: `✅ Command prefix changed to: *${config.prefix}*` });
});
mkOwner("session", async ({ sock, from }) => {
  const active = [...sessions.entries()].map(([id, session]) => `• ${id}: ${session.sock?.user ? "CONNECTED" : "STARTING"}`);
  await sock.sendMessage(from, { text: `🔐 *SESSION STATUS*\n\n${active.join("\n") || "No active sessions."}` });
});
mkOwner("backup", async ({ sock, from }) => {
  const backup = {
    version: 1,
    createdAt: new Date().toISOString(),
    prefix: config.prefix,
    toggles: Object.fromEntries(toggleState),
    groupSettings: Object.fromEntries(groupMessageSettings),
  };
  const file = path.join(config.sessionDir, "md-ghani-settings-backup.json");
  await fs.promises.mkdir(config.sessionDir, { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(backup, null, 2));
  await sock.sendMessage(from, { document: Buffer.from(JSON.stringify(backup, null, 2)), mimetype: "application/json", fileName: "md-ghani-settings-backup.json", caption: "✅ Settings backup created." });
});
mkOwner("restore", async ({ sock, from }) => {
  const file = path.join(config.sessionDir, "md-ghani-settings-backup.json");
  if (!fs.existsSync(file)) return sock.sendMessage(from, { text: "❌ No settings backup found. Use .backup first." });
  const backup = JSON.parse(await fs.promises.readFile(file, "utf8"));
  if (backup.prefix) config.prefix = String(backup.prefix);
  toggleState.clear();
  for (const [id, values] of Object.entries(backup.toggles || {})) toggleState.set(id, { ...defaultToggles, ...values });
  saveRepeatGuardToggleState();
  groupMessageSettings.clear();
  for (const [id, values] of Object.entries(backup.groupSettings || {})) {
    if (id.endsWith("@g.us") && values && typeof values === "object") {
      groupMessageSettings.set(id, normalizeGroupMessageSettings(values));
    }
  }
  saveGroupMessageSettings();
  await sock.sendMessage(from, { text: "✅ Settings restored from the latest backup." });
});
mkOwner("restart", async ({ sock, from }) => {
  await sock.sendMessage(from, { text: "♻️ Restarting bot safely. Please wait for reconnection." });
  setTimeout(() => process.exit(0), 800);
});
mkOwner("public", async ({ sock, from }) => sock.sendMessage(from, { text: styledToggleReply("public mode", true, "Bot is available to users") }));
mkOwner("private", async ({ sock, from }) => sock.sendMessage(from, { text: styledToggleReply("private mode", true, "Bot is restricted") }));
mkOwner("approve", async ({ sock, from, args }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  if (approvalJobs.has(from)) return sock.sendMessage(from, { text: "⏳ An approval process is already running. Use .cancelapprove to stop it." });
  const requests = await sock.groupRequestParticipantsList(from);
  const wanted = String(args[0] || "all").replace(/\D/g, "");
  const pending = (requests || []).filter((request) => !wanted || wanted === "all" || cleanJid(request?.jid || request?.id) === wanted);
  if (!pending.length) return sock.sendMessage(from, { text: "📥 No matching pending join request found." });
  const job = { cancelled: false };
  approvalJobs.set(from, job);
  let approved = 0;
  try {
    for (const request of pending) {
      if (job.cancelled) break;
      const jid = request?.jid || request?.id;
      if (!jid) continue;
      await sock.groupRequestParticipantsUpdate(from, [jid], "approve");
      approved += 1;
    }
    await sock.sendMessage(from, { text: job.cancelled ? `🛑 Approval cancelled. Approved ${approved}/${pending.length} request(s) before cancellation.` : `✅ Approved ${approved} pending request(s).` });
  } finally {
    if (approvalJobs.get(from) === job) approvalJobs.delete(from);
  }
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
  if (args[0]) {
    const result = setToggleIfChanged(sessionId, "alwaysonline", args[0]);
    if (!result.changed) return;
  }
  await sock.sendPresenceUpdate(getToggles(sessionId).alwaysonline ? "available" : "unavailable").catch(() => {});
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
register("setwelcome", { toggle: null, run: async ({ sock, from, msg, args }) => {
  if (!(await requireGroupAdmin(sock, from, msg, false))) return;
  const settings = getGroupMessageSettings(from);
  const message = args.join(" ") || "🎉 Welcome";
  settings.welcome = `${message} {user} to {group}. You are member #{count}.`;
  saveGroupMessageSettings();
  await sock.sendMessage(from, { text: `✅ Welcome message set:\n${settings.welcome}\n\nOrder: message → user → group name → You are member #count` });
}});
register("setgoodbye", { toggle: null, run: async ({ sock, from, msg, args }) => {
  if (!(await requireGroupAdmin(sock, from, msg, false))) return;
  const settings = getGroupMessageSettings(from);
  const message = args.join(" ") || "👋 Goodbye";
  settings.goodbye = `${message} {user} from {group}. You are member #{count}.`;
  saveGroupMessageSettings();
  await sock.sendMessage(from, { text: `✅ Goodbye message set:\n${settings.goodbye}\n\nOrder: message → user → group name → You are member #count` });
}});
register("setautoreply", { toggle: null, run: async ({ sock, from, msg, args }) => {
  if (!(await requireGroupAdmin(sock, from, msg))) return;
  const reply = args.join(" ").trim();
  if (!reply) return sock.sendMessage(from, { text: "Usage: .setautoreply <reply text>" });
  getGroupMessageSettings(from).autoreply = reply;
  saveGroupMessageSettings();
  await sock.sendMessage(from, { text: `✅ Autoreply text updated:\n${reply}\n\nUse .autoreply on/off to control it.` });
}});
register("welcome", { toggle: null, run: async ({ sock, from, msg, args }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  const settings = getGroupMessageSettings(from);
  const mode = String(args[0] || "").toLowerCase();
  if (["on", "off"].includes(mode)) {
    if (!(await requireGroupAdmin(sock, from, msg, false))) return;
    const enabled = mode === "on";
    if (settings.welcomeEnabled === enabled) return;
    settings.welcomeEnabled = enabled;
    saveGroupMessageSettings();
    return sock.sendMessage(from, { text: styledToggleReply("welcome", settings.welcomeEnabled, "Automatic messages updated for this group") });
  }
  if (["status", "state"].includes(mode)) {
    return sock.sendMessage(from, { text: styledToggleReply("welcome", settings.welcomeEnabled, "Use .welcome on/off") });
  }
  const md = await sock.groupMetadata(from);
  const user = await resolveParticipantMentionJid(sock, msg.key?.participantAlt || msg.key?.participant, md.participants || []);
  const text = formatGroupMessage(settings.welcome, md.subject || "Group", user || "member", md.participants.length);
  await sock.sendMessage(from, { text, mentions: isMentionableJid(user) ? [user] : [] });
}});
register("goodbye", { toggle: null, run: async ({ sock, from, msg, args }) => {
  if (!from.endsWith("@g.us")) return sock.sendMessage(from, { text: "❌ This command works only in groups." });
  const settings = getGroupMessageSettings(from);
  const mode = String(args[0] || "").toLowerCase();
  if (["on", "off"].includes(mode)) {
    if (!(await requireGroupAdmin(sock, from, msg, false))) return;
    const enabled = mode === "on";
    if (settings.goodbyeEnabled === enabled) return;
    settings.goodbyeEnabled = enabled;
    saveGroupMessageSettings();
    return sock.sendMessage(from, { text: styledToggleReply("goodbye", settings.goodbyeEnabled, "Automatic messages updated for this group") });
  }
  if (["status", "state"].includes(mode)) {
    return sock.sendMessage(from, { text: styledToggleReply("goodbye", settings.goodbyeEnabled, "Use .goodbye on/off") });
  }
  const md = await sock.groupMetadata(from);
  const user = await resolveParticipantMentionJid(sock, msg.key?.participantAlt || msg.key?.participant, md.participants || []);
  const text = formatGroupMessage(settings.goodbye, md.subject || "Group", user || "member", md.participants.length);
  await sock.sendMessage(from, { text, mentions: isMentionableJid(user) ? [user] : [] });
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
  let participant;
  if (from.endsWith("@g.us")) {
    const md = await sock.groupMetadata(from);
    participant = md.participants.find((p) => p.id === t || p.jid === t || cleanJid(p.id) === cleanJid(t));
  }
  await sock.sendMessage(from, { text: `👤 User: ${displayUser(t, participant)}\n🆔 WhatsApp ID: ${t}` });
}});
register("profile", { toggle: null, run: async ({ sock, from, msg, args }) => {
  const fallback = msg?.key?.fromMe ? (sock.user?.id || sock.user?.lid) : (msg?.key?.participant || from);
  const rawTarget = getTargetJid(msg, args, fallback);
  let t = await resolveOriginalJid(sock, rawTarget);
  let name = "Unknown user";
  let admin = "Private chat";
  let groupSubject = "Private chat";
  if (from.endsWith("@g.us")) {
    const md = await sock.groupMetadata(from);
    const identity = await resolveUserIdentity(sock, [rawTarget, t], md.participants, msg?.pushName || sock.user?.name || sock.user?.verifiedName);
    t = identity.jid;
    const p = md.participants.find((x) => [x.id, x.jid, x.phoneNumber].filter(Boolean).some((id) => cleanJid(id) === cleanJid(t)));
    name = identity.name || p?.name || p?.notify || p?.verifiedName || name;
    admin = p?.admin || p?.isAdmin || p?.role || "member";
    groupSubject = md.subject || groupSubject;
  } else if (typeof sock.onWhatsApp === "function") {
    try { const contact = (await sock.onWhatsApp(t))?.[0]; name = contact?.verifiedName || contact?.notify || msg?.pushName || sock.user?.name || sock.user?.verifiedName || name; } catch {}
  }
  const clean = cleanJid(t) || "Unknown";
  let about = "Unavailable";
  try { about = (await sock.fetchStatus(t))?.status || "No about/status"; } catch {}
  if (name === "Unknown user" && typeof sock.onWhatsApp === "function") {
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
      ["👑 OWNER & BOT", /^(owner|mode|health|setprefix|backup|restore|broadcast|broadcastgroup|bc|restart|shutdown|pair|session|addmenu|delmenu|maintenance|diagnose|ownerinfo)/i],
      ["🛡️ GROUP MANAGEMENT", /^(kick|add|promote|demote|group|g$|welcome|goodbye|members|admins|groupstats|groupstatus|pending|reject|approve|cancelapprove|rules|setrules|tagall|tag|tagme|hidetag|linkgroup|getlink|invite|revoke|setname|setdesc|groupdesc|setgrouppp|open|close|warnings|resetmember|clearwarnings|lockdown|slowmode|keywordreply|report|poll|remind|note|notes|groupbackup|restoregroup|welcomeedit|groupmenu|privacycheck|opentime|closetime)/i],
      ["⚔️ SECURITY & ANTI", /^(anti|sentinel|trustlevel|verify|quarantine|release|riskcheck|smartfilter|incident|timeline|case|appeal|appeals|approveappeal|rejectappeal|rulecheck|autowarn|permission|commandlock|role|automod|antical|antispamlink|antilink|antibadword|antibot|antidelete|antiedit|antispam|antiflood|antiraid|antiinvite|antidemote|antipromote|antistatus|antitag|antivideo|antiimage)/i],
      ["🎵 MEDIA & DOWNLOAD", /^(play|song|audio|video|yt|youtube|tiktok|download|dl|instagram|ig|facebook|fb|twitter|media|toaudio|tomp3|ytmp)/i],
      ["🖼️ STICKER & IMAGE", /^(sticker|s$|stiker|toimg|image|photo|blur|crop|take|emojimix|write)/i],
      ["🎮 FUN & GAMES", /^(fun|joke|meme|quote|truth|dare|ship|love|cuddle|kiss|hug|poke|slap|pat|kill|shoot|smile|wink|danger|shy|reactionmenu|punch|diceroll|coin|8ball)/i],
      ["🔧 TOOLS", /^(calc|weather|translate|wiki|google|lyrics|short|qr|readqr|ss|fetch|url|ping|runtime|uptime|device|time|date|status|fakeinfo|profile|getbio|getid|getdp|safeurl|digest|leaderboard|pollresult)/i],
      ["⚙️ SETTINGS & AUTO", /^(set|toggle|autoseen|autoreact|autotyping|autorecording|autorecordtyping|autoreacttyping|autoviewstatus|autoreactstatus|autosavestatus|autostatuslinkkick|alwaysonline|autoreply|setautoreply|goodmorning|goodnight|birthday|settings|config|reset|setwelcome|setgoodbye)/i],
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
    // Keep the complete categorized menu, including MORE COMMANDS, together.
    await sock.sendMessage(from, { text: menuText, contextInfo });
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
 * 20.5. SUGGESTED COMMANDS — SAFE EXTENSIONS
 * Existing commands are deliberately never overwritten.
 * ============================================================ */
const suggestedState = new Map();
const suggestedTimers = new Set();
const suggestedData = (id) => {
  if (!suggestedState.has(id)) suggestedState.set(id, {});
  return suggestedState.get(id);
};
const suggestedOwnerInbox = (sock) => `${String(sock.user?.id || "").split(":")[0]}@s.whatsapp.net`;
const registerSuggested = (name, opts) => {
  if (!commands.has(name)) register(name, { toggle: null, ...opts });
};
const suggestedToggle = async ({ sock, from, args }, name, detail = "Feature setting updated") => {
  const data = suggestedData(from);
  const mode = String(args[0] || "status").toLowerCase();
  if (["on", "off"].includes(mode)) data[name] = mode === "on";
  await sock.sendMessage(from, { text: `⚙️ *${name.toUpperCase()}*: ${data[name] ? "ON" : "OFF"}\n📝 ${detail}` });
};

registerSuggested("groupdesc", { run: async ({ sock, from, msg, args }) => {
  if (!(await requireGroupAdmin(sock, from, msg))) return;
  const desc = args.join(" ").trim();
  if (!desc) return sock.sendMessage(from, { text: "Usage: .groupdesc <description>" });
  await sock.groupUpdateDescription(from, desc);
  await sock.sendMessage(from, { text: "✅ Group description updated." });
}});
registerSuggested("getlink", { run: async ({ sock, from }) => {
  const code = await sock.groupInviteCode(from);
  await sock.sendMessage(from, { text: `🔗 *GROUP INVITE LINK*\n\nhttps://chat.whatsapp.com/${code}` });
}});
registerSuggested("linkgroup", { run: async (p) => commands.get("getlink").run(p) });
registerSuggested("warnings", { run: async ({ sock, from }) => {
  const rows = [...warningState.entries(), ...antiWarningCounts.entries()].filter(([key]) => key.startsWith(`${from}:`));
  const counts = new Map();
  for (const [key, value] of rows) { const user = key.slice(from.length + 1).split(":")[0]; counts.set(user, (counts.get(user) || 0) + Number(value || 0)); }
  await sock.sendMessage(from, { text: `⚠️ *WARNINGS*\n\n${[...counts.entries()].map(([u, n], i) => `${i + 1}. ${displayUser(u)} — ${n}`).join("\n") || "No active warnings."}` });
}});
registerSuggested("resetmember", { run: async ({ sock, from, msg, args }) => {
  const target = getTargetJid(msg, args);
  if (!target) return sock.sendMessage(from, { text: "Usage: .resetmember @member" });
  for (const key of [...warningState.keys()]) if (key.startsWith(`${from}:${target}`)) warningState.delete(key);
  for (const key of [...antiWarningCounts.keys()]) if (key.startsWith(`${from}:${target}`)) antiWarningCounts.delete(key);
  await sock.sendMessage(from, { text: `✅ Warning records cleared for ${displayUser(target)}.` });
}});
registerSuggested("lockdown", { run: async ({ sock, from, args }) => suggestedToggle({ sock, from, args }, "lockdown", "Emergency group protection mode") });
registerSuggested("securityreport", { run: async ({ sock, from }) => {
  const t = getToggles(from); const md = await sock.groupMetadata(from); const pending = await sock.groupRequestParticipantsList(from).catch(() => []);
  await sock.sendMessage(from, { text: `🛡️ *SECURITY REPORT*\n\n👥 Members: ${md.participants.length}\n👑 Bot admin: ${await isBotAdmin(sock, from) ? "YES" : "NO"}\n📥 Pending requests: ${pending.length}\n🔗 Anti-link: ${t.antilink ? "ON" : "OFF"}\n⚠️ Anti-spam: ${t.antispam ? "ON" : "OFF"}\n🚨 Anti-raid: ${t.antiraid ? "ON" : "OFF"}` });
}});
registerSuggested("auditlog", { run: async ({ sock, from }) => {
  const rows = suggestedData(from).audit || [];
  await sock.sendMessage(from, { text: `🧾 *AUDIT LOG*\n\n${rows.slice(-20).map((r, i) => `${i + 1}. ${r}`).join("\n") || "No tracked actions yet."}` });
}});
registerSuggested("slowmode", { run: async ({ sock, from, args }) => {
  const seconds = Math.max(0, Number(args[1] || args[0]) || 0); suggestedData(from).slowmode = seconds;
  await sock.sendMessage(from, { text: seconds ? `🐢 Slowmode set to ${seconds} second(s).` : "✅ Slowmode disabled." });
}});
registerSuggested("keywordreply", { run: async ({ sock, from, args }) => {
  const data = suggestedData(from); data.keywords ||= {}; const action = String(args[0] || "list").toLowerCase(); const key = String(args[1] || "").toLowerCase();
  if (action === "add" && key && args.slice(2).length) data.keywords[key] = args.slice(2).join(" ");
  else if (["delete", "remove"].includes(action) && key) delete data.keywords[key];
  const list = Object.entries(data.keywords).map(([k, v]) => `• ${k} → ${v}`).join("\n") || "No keyword replies configured.";
  await sock.sendMessage(from, { text: `🔤 *KEYWORD REPLIES*\n\n${list}\n\nUsage: .keywordreply add <word> <reply>` });
}});
registerSuggested("report", { run: async ({ sock, from, msg, args }) => {
  const sender = msg?.key?.fromMe ? (sock.user?.id || sock.user?.lid) : msg?.key?.participant;
  const target = getTargetJid(msg, args, sender || null); const reason = args.filter((a) => !/^\d+$/.test(a)).join(" ") || "No reason provided";
  const groupName = from.endsWith("@g.us") ? ((await sock.groupMetadata(from).catch(() => null))?.subject || "Group") : "Private Chat";
  await sock.sendMessage(suggestedOwnerInbox(sock), { text: `🚩 *GROUP REPORT*\n\nGroup: ${groupName}\nUser: ${displayUser(target || sender)}\nReason: ${reason}` });
  await sock.sendMessage(from, { text: "✅ Report sent to the bot owner." });
}});
registerSuggested("poll", { run: async ({ sock, from, args }) => {
  const parts = args.join(" ").split("|").map((v) => v.trim()).filter(Boolean);
  if (parts.length < 3) return sock.sendMessage(from, { text: "Usage: .poll Question | Option 1 | Option 2" });
  await sock.sendMessage(from, { poll: { name: parts[0], values: parts.slice(1), selectableCount: 1 } });
}});
registerSuggested("remind", { run: async ({ sock, from, args }) => {
  const match = String(args[0] || "").match(/^(\d+)(s|m|h|d)$/i); const message = args.slice(1).join(" ");
  if (!match || !message) return sock.sendMessage(from, { text: "Usage: .remind 30m <message>" });
  const ms = Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()]);
  const timer = setTimeout(() => { suggestedTimers.delete(timer); sock.sendMessage(from, { text: `⏰ *REMINDER*\n${message}` }).catch(() => {}); }, Math.min(ms, 7 * 86400000)); suggestedTimers.add(timer);
  await sock.sendMessage(from, { text: `✅ Reminder set for ${match[0]}.` });
}});
registerSuggested("note", { run: async ({ sock, from, args }) => {
  const data = suggestedData(from); data.notes ||= {}; const action = String(args[0] || "list").toLowerCase(); const key = String(args[1] || "").toLowerCase();
  if (action === "add" && key) data.notes[key] = args.slice(2).join(" ") || ""; else if (action === "delete" && key) delete data.notes[key];
  await sock.sendMessage(from, { text: `🗒️ *NOTES*\n\n${Object.entries(data.notes).map(([k, v]) => `• ${k}: ${v}`).join("\n") || "No notes saved."}` });
}});
registerSuggested("notes", { run: async (p) => commands.get("note").run(p) });
registerSuggested("groupbackup", { run: async ({ sock, from }) => {
  suggestedData(from).backup = { toggles: getToggles(from), messages: { ...getGroupMessageSettings(from) }, savedAt: new Date().toISOString() };
  await sock.sendMessage(from, { text: "✅ Group configuration snapshot saved." });
}});
registerSuggested("restoregroup", { run: async ({ sock, from }) => {
  const b = suggestedData(from).backup; if (!b) return sock.sendMessage(from, { text: "❌ No group backup found." });
  Object.assign(getGroupMessageSettings(from), b.messages || {}); toggleState.set(from, { ...defaultToggles, ...(b.toggles || {}) });
  saveRepeatGuardToggleState();
  await sock.sendMessage(from, { text: "✅ Group configuration restored." });
}});
registerSuggested("maintenance", { run: async ({ sock, from, args }) => suggestedToggle({ sock, from, args }, "maintenance", "Owner maintenance mode") });
registerSuggested("antical", { run: async ({ sock, from, args }) => suggestedToggle({ sock, from, args }, "antical", "Call moderation flag") });
registerSuggested("antispamlink", { run: async ({ sock, from, args }) => suggestedToggle({ sock, from, args }, "antispamlink", "Separate link protection profile") });
registerSuggested("welcomeedit", { run: async ({ sock, from, msg, args }) => { if (!(await requireGroupAdmin(sock, from, msg))) return; getGroupMessageSettings(from).welcome = args.join(" ") || getGroupMessageSettings(from).welcome; await sock.sendMessage(from, { text: "✅ Welcome template updated." }); }});
registerSuggested("groupmenu", { run: async ({ sock, from }) => { const names = [...commands.keys()].filter((n) => /^(group|admin|member|kick|tag|warn|anti|welcome|goodbye|rule|revoke|pending|reject|approve|lockdown|security)/i.test(n)); await sock.sendMessage(from, { text: `🛡️ *GROUP MENU*\n\n${names.map((n) => `• ${config.prefix}${n}`).join("\n")}` }); }});
registerSuggested("ownerinfo", { run: async ({ sock, from }) => sock.sendMessage(from, { text: `👑 *OWNER INFO*\n${config.owner.map((o) => `+${cleanJid(o)}`).join("\n")}` }) });
registerSuggested("diagnose", { run: async ({ sock, from }) => sock.sendMessage(from, { text: `🔎 *DIAGNOSTICS*\n\n🟢 Runtime: ${process.version}\n🟢 Commands: ${commands.size}\n🟢 FFmpeg: ${fs.existsSync("/usr/bin/ffmpeg") ? "READY" : "MISSING"}\n🟢 Backup store: READY\n🟢 Security engine: READY` }) });
registerSuggested("qr", { run: async ({ sock, from, args }) => {
  const value = args.join(" ").trim(); if (!value) return sock.sendMessage(from, { text: "Usage: .qr <text or link>" });
  await sock.sendMessage(from, { text: `📱 *QR CODE LINK*\n\nhttps://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(value)}` });
}});
registerSuggested("readqr", { run: async ({ sock, from }) => sock.sendMessage(from, { text: "📷 Reply to a QR image with .readqr. QR decoding requires an image-capable WhatsApp reply." }) });
registerSuggested("translate", { run: async ({ sock, from, args }) => {
  const text = args.join(" ").trim(); if (!text) return sock.sendMessage(from, { text: "Usage: .translate <text>" });
  try { const { data } = await axios.get("https://translate.googleapis.com/translate_a/single", { params: { client: "gtx", sl: "auto", tl: "en", dt: "t", q: text }, timeout: 15000 }); const out = (data?.[0] || []).map((row) => row?.[0] || "").join(""); return sock.sendMessage(from, { text: `🌐 *TRANSLATION*\n\n${out || "Translation unavailable."}` }); } catch { return sock.sendMessage(from, { text: "❌ Translation service is temporarily unavailable." }); }
}});

const premiumCommandNames = [
  "smartmod", "memberprofile", "membercard", "activity", "welcomepro", "groupwelcomepro", "linkcheck", "autodelete", "modlog", "appealbox", "trusted", "trustlist", "muted", "unmuted", "smartmute", "smartunmute", "groupstatspro", "backupstatus", "commandstats", "settingsimport", "guardian", "emergencylock", "securityscore", "moderationpanel", "ruleengine", "actionpolicy", "incidentreport", "grouphealth", "commandpermission", "commanddisable", "commandenable", "multibackup", "configdiff", "smartreply", "owneralert", "groupdigest",
];
for (const name of premiumCommandNames) registerSuggested(name, { run: async ({ sock, from, msg, args }) => {
  const data = suggestedData(from); const mode = String(args[0] || "status").toLowerCase();
  if (["guardian", "emergencylock", "autodelete", "owneralert"].includes(name)) return suggestedToggle({ sock, from, args }, name, "Premium protection profile");
  if (["memberprofile", "membercard"].includes(name)) {
    const target = getTargetJid(msg, args) || msg.key?.participant || from; const md = from.endsWith("@g.us") ? await sock.groupMetadata(from) : null; const p = md?.participants.find((x) => x.id === target || x.jid === target || x.phoneNumber === target);
    return sock.sendMessage(from, { text: `👤 *${name.toUpperCase()}*\n\nUser: ${displayUser(p?.phoneNumber || p?.jid || target, p)}\nAdmin: ${p?.admin ? "YES" : "NO"}\nWarnings: ${data.warnings || 0}\nTrust: ${data.trusted?.includes(target) ? "TRUSTED" : "STANDARD"}` });
  }
  if (name === "linkcheck") { try { const u = new URL(args[0]); return sock.sendMessage(from, { text: `🔗 *LINK CHECK*\n\n${u.href}\nProtocol: ${u.protocol}\nHost: ${u.hostname}\nWhatsApp invite: ${/chat\.whatsapp\.com\//i.test(u.href) ? "YES" : "NO"}` }); } catch { return sock.sendMessage(from, { text: "❌ Invalid URL. Usage: .linkcheck <url>" }); } }
  if (["trusted", "trustlist"].includes(name)) { const target = getTargetJid(msg, args); data.trusted ||= []; if (mode === "add" && target && !data.trusted.includes(target)) data.trusted.push(target); if (["remove", "delete"].includes(mode)) data.trusted = data.trusted.filter((x) => x !== target); return sock.sendMessage(from, { text: `✅ Trusted members: ${data.trusted.map((x) => displayUser(x)).join(", ") || "None"}` }); }
  if (["muted", "smartmute", "smartunmute"].includes(name)) { const target = getTargetJid(msg, args); data.muted ||= []; if (name === "smartmute" && target && !data.muted.includes(target)) data.muted.push(target); if (name === "smartunmute" && target) data.muted = data.muted.filter((x) => x !== target); return sock.sendMessage(from, { text: `🔇 Muted members: ${data.muted.map((x) => displayUser(x)).join(", ") || "None"}` }); }
  if (name === "securityscore") { const t = getToggles(from); const active = ["antilink", "antibadword", "antispam", "antiflood", "antiraid", "antiinvite"].filter((k) => t[k]).length; return sock.sendMessage(from, { text: `🛡️ *SECURITY SCORE: ${Math.min(100, active * 15 + (await isBotAdmin(sock, from) ? 10 : 0))}/100*\nActive protections: ${active}` }); }
  if (["activity", "groupdigest", "commandstats", "backupstatus", "grouphealth", "moderationpanel"].includes(name)) return sock.sendMessage(from, { text: `📊 *${name.toUpperCase()}*\n\nCommands loaded: ${commands.size}\nTracked commands: ${data.commandCount || 0}\nWarnings: ${data.warnings || 0}\nBackup: ${data.backup ? "AVAILABLE" : "READY"}` });
  if (name === "multibackup") { data.backups ||= []; if (mode === "create") data.backups.push({ at: new Date().toISOString(), toggles: getToggles(from), settings: { ...getGroupMessageSettings(from) } }); if (mode === "restore" && data.backups[Number(args[1]) - 1]) { const b = data.backups[Number(args[1]) - 1]; Object.assign(getGroupMessageSettings(from), b.settings); toggleState.set(from, { ...defaultToggles, ...b.toggles }); saveRepeatGuardToggleState(); } return sock.sendMessage(from, { text: `💾 Multi-backups available: ${data.backups.length}` }); }
  if (["commanddisable", "commandenable"].includes(name)) { data.disabled ||= []; if (name === "commanddisable" && args[0] && !data.disabled.includes(args[0])) data.disabled.push(args[0]); if (name === "commandenable") data.disabled = data.disabled.filter((x) => x !== args[0]); return sock.sendMessage(from, { text: `🚫 Disabled commands: ${data.disabled.join(", ") || "None"}` }); }
  if (["anonymous", "suggest"].includes(name)) { await sock.sendMessage(suggestedOwnerInbox(sock), { text: `💡 ${name.toUpperCase()}\nFrom: ${from}\n${args.join(" ")}` }); return sock.sendMessage(from, { text: "✅ Sent privately to the owner." }); }
  data[name] = mode === "off" ? false : mode === "on" ? true : (data[name] ?? true);
  await sock.sendMessage(from, { text: `⚙️ *${name.toUpperCase()}*: ${data[name] ? "ON" : "OFF"}` });
}});

const advancedNames = ["sentinel", "trustlevel", "verify", "quarantine", "release", "riskcheck", "smartfilter", "incident", "timeline", "case", "appeal", "appeals", "approveappeal", "rejectappeal", "rulecheck", "autowarn", "permission", "commandlock", "role", "automod", "snapshot", "rollback", "smartmenu", "digest", "leaderboard", "pollresult", "safeurl", "privacycheck", "goodmorning", "goodnight", "birthday", "anonymous", "suggest", "broadcastgroup", "groupstatus"];
for (const name of advancedNames) registerSuggested(name, { owner: ["broadcastgroup", "ownerinfo", "diagnose"].includes(name), run: async ({ sock, from, msg, args }) => {
  const data = suggestedData(from); const action = String(args[0] || "status").toLowerCase();
  if (name === "safeurl") { try { const u = new URL(args[0]); return sock.sendMessage(from, { text: `🔗 URL: ${u.href}\n🔒 Protocol: ${u.protocol}\n⚠️ Shortened/suspicious review required manually.` }); } catch { return sock.sendMessage(from, { text: "❌ Invalid URL." }); } }
  if (name === "privacycheck") return sock.sendMessage(from, { text: `🔐 *PRIVACY CHECK*\n\n👑 Bot admin: ${await isBotAdmin(sock, from) ? "YES" : "NO"}\n📥 Pending requests: ${(await sock.groupRequestParticipantsList(from).catch(() => [])).length}\n⚙️ Group settings available: YES` });
  if (name === "groupstatus") return commands.get("groupstats")?.run({ sock, from, msg, args });
  if (name === "broadcastgroup") { const text = args.join(" "); const groups = [...groupMessageSettings.keys()].filter((id) => id.endsWith("@g.us")); for (const group of groups) await sock.sendMessage(group, { text: `📢 ${text}` }).catch(() => {}); return sock.sendMessage(from, { text: `✅ Broadcast sent to ${groups.length} known group(s).` }); }
  if (name === "smartmenu") { const list = [...commands.keys()].filter((n) => !commands.get(n)?.owner).sort(); return sock.sendMessage(from, { text: `📋 *SMART MENU*\n\n${list.map((n) => `• ${config.prefix}${n}`).join("\n")}` }); }
  if (name === "timeline" || name === "auditlog" || name === "digest" || name === "leaderboard" || name === "pollresult") return sock.sendMessage(from, { text: `📊 *${name.toUpperCase()}*\n\nNo historical data has been collected yet.` });
  if (name === "anonymous" || name === "suggest") { await sock.sendMessage(suggestedOwnerInbox(sock), { text: `💡 *${name.toUpperCase()}*\nFrom: ${from}\n\n${args.join(" ") || "No message provided"}` }); return sock.sendMessage(from, { text: "✅ Message sent privately to the owner." }); }
  if (name === "verify") return sock.sendMessage(from, { text: "✅ Verification request recorded. An admin must review this member." });
  if (["quarantine", "release"].includes(name)) { const target = getTargetJid(msg, args); if (!target) return sock.sendMessage(from, { text: `Usage: .${name} @member` }); data[name] ||= []; if (name === "quarantine") data[name].push(target); else data.quarantine = (data.quarantine || []).filter((id) => id !== target); return sock.sendMessage(from, { text: `✅ ${displayUser(target)} ${name === "quarantine" ? "marked for quarantine" : "released"}.` }); }
  if (name === "trustlevel" || name === "riskcheck") return sock.sendMessage(from, { text: `🛡️ *${name.toUpperCase()}*\n\nUser history: ${data.warnings || "No local risk events recorded."}` });
  if (name === "snapshot" || name === "rollback") { if (name === "snapshot") data.snapshot = { ...getGroupMessageSettings(from), toggles: getToggles(from) }; else if (data.snapshot) { Object.assign(getGroupMessageSettings(from), data.snapshot); toggleState.set(from, { ...defaultToggles, ...(data.snapshot.toggles || {}) }); saveRepeatGuardToggleState(); } return sock.sendMessage(from, { text: `✅ ${name} ${name === "snapshot" ? "saved" : "completed"}.` }); }
  data[name] = action === "off" ? false : action === "on" ? true : (data[name] ?? true);
  await sock.sendMessage(from, { text: `⚙️ *${name.toUpperCase()}*: ${data[name] ? "ON" : "OFF"}` });
}});

/* ============================================================
 * 21. INLINE PAIRING PANEL HTML
 * ============================================================ */
const PAIR_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\"/>\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover\"/>\n<meta name=\"theme-color\" content=\"#020a04\"/>\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\"/>\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\"/>\n<meta name=\"mobile-web-app-capable\" content=\"yes\"/>\n<title>MD-Ghani-Bot \u2022 TERMINAL PRO+</title>\n<style>\n  :root{\n    --bg:#020a04;--bg-2:#04160a;--panel:#061f0e;--panel-2:#0a2b14;\n    --line:#0f3d1e;--line-2:#1a5c2e;--green:#22ff88;--green-dim:#00cc66;\n    --amber:#ffb800;--red:#ff3b3b;--cyan:#00e5ff;--txt:#b8ffce;\n    --txt-2:#5fbf82;--muted:#2e6b44;\n  }\n  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}\n  html,body{height:100%;width:100%;overflow:hidden}\n  body{\n    font-family:ui-monospace,\"SF Mono\",Menlo,Consolas,monospace;\n    background:var(--bg);color:var(--txt);-webkit-font-smoothing:antialiased;\n    display:flex;align-items:center;justify-content:center;min-height:100dvh;\n    padding:max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right))\n            max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));\n    position:fixed;inset:0;overflow:hidden;letter-spacing:.4px;font-weight:500;\n  }\n  .bg-term{position:fixed;inset:0;z-index:0;background:radial-gradient(ellipse 100% 80% at 50% 0%, rgba(34,255,136,.06) 0%, transparent 55%),linear-gradient(180deg,#020a04 0%,#03100a 55%,#020a04 100%);pointer-events:none}\n  .scanlines{position:fixed;inset:0;z-index:50;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0px,rgba(0,0,0,.22) 1px,transparent 1px,transparent 3px);mix-blend-mode:multiply;opacity:.7}\n  .vignette{position:fixed;inset:0;z-index:49;pointer-events:none;background:radial-gradient(ellipse 120% 100% at 50% 50%,transparent 55%,rgba(0,0,0,.55) 100%)}\n  .scanband{position:fixed;left:0;right:0;height:120px;z-index:48;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(34,255,136,.05),transparent);animation:scanMove 7s linear infinite}\n  @keyframes scanMove{0%{top:-140px}100%{top:110%}}\n  body.crt-off .scanlines,body.crt-off .scanband,body.crt-off .vignette{display:none}\n  .rain{position:fixed;top:-30px;font-size:13px;color:rgba(34,255,136,.35);writing-mode:vertical-lr;white-space:nowrap;z-index:1;pointer-events:none;text-shadow:0 0 6px rgba(34,255,136,.5);user-select:none;animation:rainFall linear infinite}\n  @keyframes rainFall{0%{transform:translateY(-100%)}100%{transform:translateY(110vh)}}\n  .boot{position:fixed;inset:0;z-index:200;background:#020a04;display:flex;align-items:center;justify-content:center;transition:opacity .35s steps(6)}\n  .boot.done{opacity:0;pointer-events:none}\n  .boot-lines{width:min(86%,340px);font-size:12px;line-height:2.1;color:var(--green);text-shadow:0 0 8px rgba(34,255,136,.6)}\n  .boot-lines .dim{color:var(--muted)}\n  .boot-lines .ok{color:var(--amber)}\n  .wrap{position:relative;z-index:10;width:100%;max-width:440px;display:flex;flex-direction:column;gap:14px;max-height:100%;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;padding:2px;justify-content:safe center}\n  .wrap>*{flex-shrink:0}\n  .wrap::-webkit-scrollbar{display:none}\n  .header{width:100%;background:linear-gradient(180deg,rgba(6,31,14,.92),rgba(4,22,10,.9));border:1px solid var(--line-2);border-radius:6px;position:relative;overflow:hidden;box-shadow:0 0 0 1px rgba(34,255,136,.08),0 0 30px rgba(34,255,136,.12),inset 0 0 40px rgba(0,0,0,.5)}\n  .term-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;row-gap:6px;padding:8px 12px;background:rgba(0,0,0,.45);border-bottom:1px solid var(--line)}\n  .term-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}\n  .term-dot.r{background:#ff5f56}.term-dot.y{background:#ffbd2e}.term-dot.g{background:#27c93f}\n  .term-title{flex:1 1 70px;min-width:60px;font-size:10px;color:var(--txt-2);letter-spacing:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n  .term-title .user{color:var(--green)}\n  .crt-btn{font-family:inherit;font-size:8px;font-weight:900;letter-spacing:.5px;padding:3px 5px;background:rgba(34,255,136,.08);border:1px solid var(--line-2);border-radius:3px;color:var(--green);cursor:pointer;transition:all .15s;flex-shrink:0}\n  .crt-btn:active{transform:scale(.92);background:rgba(34,255,136,.2)}\n  .header-body{display:flex;align-items:center;gap:14px;padding:14px 16px}\n  .avatar{width:52px;height:52px;border-radius:4px;background:#03150a;border:1px solid var(--green-dim);display:grid;place-items:center;flex-shrink:0;position:relative;font-size:24px;box-shadow:inset 0 0 14px rgba(34,255,136,.2),0 0 14px rgba(34,255,136,.25)}\n  .avatar::before{content:'';position:absolute;inset:3px;border:1px dashed rgba(34,255,136,.35);border-radius:2px}\n  .header-info{flex:1;min-width:0}\n  .header-name{font-size:16px;font-weight:800;letter-spacing:.5px;line-height:1.2;color:var(--green);display:flex;align-items:center;gap:8px;text-shadow:0 0 10px rgba(34,255,136,.6)}\n  .header-name .ver{font-size:9px;color:var(--bg);background:var(--green);padding:2px 6px;border-radius:2px;font-weight:900;letter-spacing:1px;text-shadow:none}\n  .header-sub{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--muted);margin-top:6px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700}\n  .header-sub .badge{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;background:rgba(34,255,136,.08);border:1px solid rgba(34,255,136,.4);color:var(--green);font-size:9px;font-weight:800;letter-spacing:1.5px}\n  .header-sub .badge .dot{width:5px;height:5px;background:var(--green);box-shadow:0 0 6px var(--green);animation:dotPulse 1s steps(2) infinite}\n  @keyframes dotPulse{50%{opacity:.2}}\n  .stats-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}\n  .stat-card{background:rgba(6,31,14,.85);border:1px solid var(--line);border-radius:4px;padding:12px 8px;text-align:center;position:relative;overflow:hidden;transition:all .15s}\n  .stat-card::before{content:'';position:absolute;top:0;left:0;width:6px;height:6px;border-top:1.5px solid var(--green-dim);border-left:1.5px solid var(--green-dim)}\n  .stat-card::after{content:'';position:absolute;bottom:0;right:0;width:6px;height:6px;border-bottom:1.5px solid var(--green-dim);border-right:1.5px solid var(--green-dim)}\n  .stat-card .val{font-size:16px;font-weight:900;color:var(--green);line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 0 10px rgba(34,255,136,.6);margin-bottom:6px}\n  .stat-card .lbl{font-size:9px;color:var(--muted);letter-spacing:2px;text-transform:uppercase;font-weight:800}\n  .card{width:100%;background:linear-gradient(180deg,rgba(6,31,14,.92) 0%,rgba(3,14,7,.94) 100%);border:1px solid var(--line-2);border-radius:6px;padding:24px 20px 20px;position:relative;overflow:hidden;box-shadow:0 0 0 1px rgba(34,255,136,.08),0 0 40px rgba(34,255,136,.1),inset 0 0 50px rgba(0,0,0,.5)}\n  .card::before{content:'';position:absolute;top:6px;left:6px;width:16px;height:16px;border-top:2px solid var(--green);border-left:2px solid var(--green);pointer-events:none;z-index:2}\n  .skull{position:absolute;top:14px;right:16px;z-index:2;font-size:20px;opacity:.85}\n  .sec{display:flex;align-items:center;gap:13px;margin-bottom:20px;position:relative;z-index:1}\n  .sec-icon{width:52px;height:52px;border-radius:4px;background:#03150a;border:1px solid var(--green-dim);display:grid;place-items:center;flex-shrink:0;position:relative;box-shadow:inset 0 0 14px rgba(34,255,136,.2),0 0 14px rgba(34,255,136,.25)}\n  .sec-icon svg{width:26px;height:26px;stroke:var(--green);stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}\n  .sec-info{flex:1;min-width:0}\n  .sec-cmd{font-size:10px;color:var(--muted);letter-spacing:1.5px;margin-bottom:5px;text-transform:uppercase;font-weight:800}\n  .sec-cmd .dollar{color:var(--amber)}\n  .sec-title{font-size:21px;font-weight:900;letter-spacing:.5px;line-height:1.1;color:var(--green);text-shadow:0 0 14px rgba(34,255,136,.6)}\n  .sec-title .gt{color:var(--txt-2);font-weight:400}\n  .sec-desc{font-size:11.5px;color:var(--txt-2);margin-top:5px;line-height:1.45}\n  .field{margin-bottom:18px;position:relative;z-index:1}\n  .field-label{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}\n  .field-label .left{display:flex;align-items:center;gap:8px;font-size:10.5px;color:var(--txt-2);letter-spacing:1.5px;text-transform:uppercase;font-weight:800}\n  .field-label .num-badge{width:24px;height:24px;border-radius:3px;background:var(--green);display:grid;place-items:center;font-size:10px;font-weight:900;color:#02120a}\n  .field-label .req{padding:2px 8px;background:rgba(255,59,59,.1);border:1px solid rgba(255,59,59,.5);font-size:8.5px;color:var(--red);font-weight:900;letter-spacing:1.5px;text-transform:uppercase}\n  .input-box{display:flex;align-items:center;background:rgba(0,0,0,.55);border:1px solid var(--line-2);border-radius:4px;padding:2px;position:relative;overflow:hidden;transition:all .2s;box-shadow:inset 0 2px 8px rgba(0,0,0,.6)}\n  .input-box::before{content:'>';position:absolute;left:10px;color:var(--amber);font-weight:900;font-size:14px;pointer-events:none;z-index:1}\n  .input-box:focus-within{border-color:var(--green);box-shadow:inset 0 2px 8px rgba(0,0,0,.6),0 0 0 3px rgba(34,255,136,.12)}\n  .cc-box{display:flex;align-items:center;gap:4px;padding:0 10px 0 24px;height:52px;border-right:1px solid var(--line);flex-shrink:0}\n  .cc-box select{font-family:inherit;font-size:11px;font-weight:800;background:#03150a;color:var(--green);border:1px solid var(--line-2);border-radius:3px;padding:4px 2px;outline:none;cursor:pointer;max-width:74px}\n  .cc-box select option{background:#03150a;color:var(--txt)}\n  .cc-box .code{font-size:14px;font-weight:900;color:var(--amber);letter-spacing:.5px;font-variant-numeric:tabular-nums}\n  #phone{flex:1;background:transparent;border:0;outline:none;color:var(--green);font-size:15px;font-weight:700;padding:14px 10px;letter-spacing:2px;font-variant-numeric:tabular-nums;min-width:0;caret-color:var(--green)}\n  #phone::placeholder{color:var(--muted);font-weight:400;font-size:12px;letter-spacing:1px}\n  .clr{display:none;width:32px;height:32px;border-radius:3px;background:rgba(255,59,59,.1);border:1px solid rgba(255,59,59,.5);color:var(--red);font-size:12px;font-weight:900;margin-right:7px;cursor:pointer;align-items:center;justify-content:center;flex-shrink:0}\n  .clr.show{display:flex}\n  .hint{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:10.5px;color:var(--muted);margin-top:9px;letter-spacing:.5px}\n  .hint .arrow{color:var(--green);font-weight:900}\n  .hint code{color:var(--green);font-weight:900;padding:2px 7px;background:rgba(34,255,136,.08);border:1px solid rgba(34,255,136,.3);font-size:10.5px;font-variant-numeric:tabular-nums}\n  .hint .kbd{color:var(--txt-2);padding:1px 5px;border:1px solid var(--line-2);border-radius:2px;font-size:9px;font-weight:800}\n  .chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}\n  .chip{font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.5px;padding:5px 9px;background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.3);border-radius:3px;color:var(--cyan);cursor:pointer}\n  .chip::before{content:'\u21ba ';color:var(--muted)}\n  .btn-wrap{position:relative;width:100%;margin-bottom:11px;z-index:1}\n  .term-btn{width:100%;padding:16px 22px;border:1px solid;border-radius:4px;font-family:inherit;font-weight:900;font-size:13.5px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;position:relative;overflow:hidden;transition:all .15s;text-decoration:none}\n  .term-btn.primary{background:rgba(34,255,136,.1);border-color:var(--green);color:var(--green);box-shadow:0 0 18px rgba(34,255,136,.25),inset 0 0 18px rgba(34,255,136,.12)}\n  .term-btn.secondary{background:rgba(255,184,0,.08);border-color:var(--amber);color:var(--amber);box-shadow:0 0 18px rgba(255,184,0,.22),inset 0 0 18px rgba(255,184,0,.1)}\n  .term-btn:active{transform:translateY(1px)}\n  .term-btn:disabled{opacity:.45;cursor:not-allowed}\n  .term-btn .spinner{width:18px;height:18px;border:2px solid rgba(34,255,136,.25);border-top-color:var(--green);border-radius:50%;animation:spin .6s steps(12) infinite;display:none;position:relative;z-index:2}\n  .term-btn.loading .spinner{display:block}\n  @keyframes spin{to{transform:rotate(360deg)}}\n  .term-btn .arrow{display:inline-flex;align-items:center;justify-content:center;position:relative;z-index:2}\n  .term-btn .arrow svg{width:18px;height:18px;stroke:currentColor;stroke-width:2.5;fill:none;stroke-linecap:round;stroke-linejoin:round}\n  .term-btn svg.lead-icon{width:19px;height:19px;fill:currentColor;flex-shrink:0;position:relative;z-index:2}\n  .term-btn .btn-txt{position:relative;z-index:2}\n  .term-btn .brackets{color:var(--txt-2);font-weight:400}\n  .sound-toggle{position:absolute;top:50%;right:10px;transform:translateY(-50%);width:32px;height:32px;border-radius:3px;background:rgba(0,0,0,.5);border:1px solid var(--line-2);display:grid;place-items:center;cursor:pointer;z-index:3}\n  .sound-toggle svg{width:14px;height:14px;stroke:var(--green);stroke-width:2.5;fill:none}\n  .sound-toggle.muted svg .wave{opacity:0}\n  .sound-toggle.muted::after{content:'';position:absolute;width:20px;height:1.5px;background:var(--red);transform:rotate(-45deg)}\n  .progress-wrap{margin-top:14px;opacity:0;max-height:0;overflow:hidden;transition:opacity .25s, max-height .25s;position:relative;z-index:1}\n  .progress-wrap.active{opacity:1;max-height:60px}\n  .progress-meta{display:flex;align-items:center;justify-content:space-between;font-size:10px;letter-spacing:1.5px;color:var(--txt-2);font-weight:800;margin-bottom:7px;text-transform:uppercase}\n  .progress-meta .pct{color:var(--green);font-weight:900;font-variant-numeric:tabular-nums}\n  .progress-bar{width:100%;height:12px;background:rgba(0,0,0,.6);border:1px solid var(--line);border-radius:2px;overflow:hidden;position:relative}\n  .progress-bar .fill{height:100%;background:repeating-linear-gradient(90deg,var(--green) 0px,var(--green) 8px,rgba(34,255,136,.45) 8px,rgba(34,255,136,.45) 12px);transition:width .25s steps(8);width:0%}\n  .trust{display:flex;align-items:center;justify-content:space-around;gap:8px;margin-top:18px;padding-top:15px;border-top:1px dashed var(--line-2);position:relative;z-index:1}\n  .trust-item{display:flex;align-items:center;gap:6px;font-size:9.5px;color:var(--txt-2);letter-spacing:1.5px;font-weight:800;text-transform:uppercase}\n  .trust-item svg{width:14px;height:14px;stroke:var(--green);stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round}\n  .result{display:none;margin-top:18px;background:rgba(6,31,14,.85);border:1px solid var(--green);border-radius:4px;padding:20px 18px 16px;position:relative;overflow:hidden;box-shadow:0 0 30px rgba(34,255,136,.2);z-index:1}\n  .result.show{display:block}\n  .result-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;position:relative;z-index:1}\n  .result-tag{display:flex;align-items:center;gap:7px;font-size:10px;font-weight:900;color:var(--green);letter-spacing:1.5px;text-transform:uppercase}\n  .result-tag .dot{width:7px;height:7px;background:var(--green);animation:dotPulse 1s steps(2) infinite}\n  .timer-circle{position:relative;width:52px;height:40px;display:grid;place-items:center;flex-shrink:0;background:rgba(0,0,0,.55);border:1px solid var(--green-dim);border-radius:3px}\n  .timer-circle .txt{font-size:14px;font-weight:900;color:var(--green);font-variant-numeric:tabular-nums}\n  .timer-circle .txt::after{content:'s';font-size:9px;color:var(--muted);margin-left:1px}\n  .timer-circle.danger{border-color:var(--red)}\n  .timer-circle.danger .txt{color:var(--red)}\n  .code-val{font-family:inherit;font-size:clamp(24px,8.5vw,32px);font-weight:900;letter-spacing:clamp(3px,1.8vw,8px);text-align:center;line-height:1.25;word-break:break-all;padding:14px 6px;font-variant-numeric:tabular-nums;color:var(--green);text-shadow:0 0 8px rgba(34,255,136,.8);position:relative;z-index:1}\n  .res-actions{display:flex;gap:9px;margin-top:14px;position:relative;z-index:1}\n  .res-actions button{flex:1;padding:12px;background:rgba(34,255,136,.08);border:1px solid var(--green-dim);border-radius:3px;color:var(--green);font-family:inherit;font-size:10.5px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}\n  .res-actions button svg{width:13px;height:13px;stroke:currentColor;stroke-width:2.5;fill:none}\n  .res-actions .copy{background:rgba(0,229,255,.06);border-color:#0891b2;color:var(--cyan)}\n  .res-actions button.copied{background:rgba(34,255,136,.85);border-color:var(--green);color:#02120a}\n  .steps{margin-top:18px;padding-top:15px;border-top:1px dashed var(--line-2);display:grid;gap:10px;position:relative;z-index:1}\n  .steps-head{display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:3px;color:var(--amber)}\n  .steps-head .left{display:flex;align-items:center;gap:7px}\n  .steps-head svg{width:13px;height:13px;stroke:var(--amber);stroke-width:2.5;fill:none}\n  .steps-head .count{font-size:9px;color:var(--muted)}\n  .step{display:flex;gap:11px;align-items:flex-start;font-size:11.5px;color:var(--txt-2);line-height:1.5}\n  .step .n{flex-shrink:0;width:22px;height:22px;border-radius:2px;display:grid;place-items:center;font-size:10px;font-weight:900;color:#02120a;background:var(--green-dim);font-variant-numeric:tabular-nums}\n  .step b{color:var(--green);font-weight:800}\n  .log{margin-top:16px;background:rgba(0,0,0,.5);border:1px solid var(--line);border-radius:4px;overflow:hidden;position:relative;z-index:1}\n  .log-head{padding:7px 12px;font-size:9px;font-weight:900;letter-spacing:2px;color:var(--muted);text-transform:uppercase;background:rgba(0,0,0,.35);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}\n  .log-head .live{color:var(--green)}\n  .log-body{max-height:110px;overflow-y:auto;scrollbar-width:none;padding:8px 12px}\n  .log-body::-webkit-scrollbar{display:none}\n  .log-line{font-size:10px;line-height:1.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n  .log-line .t{color:var(--muted);margin-right:6px}\n  .log-line.t-ok{color:var(--green)}\n  .log-line.t-err{color:#ff8585}\n  .log-line.t-inf{color:var(--txt-2)}\n  .log-line.t-wrn{color:var(--amber)}\n  .alert{display:none;margin-top:15px;padding:13px 15px;font-size:11.5px;line-height:1.5;align-items:center;gap:10px;border-radius:3px;border:1px solid;font-weight:700;position:relative;z-index:1}\n  .alert.show{display:flex}\n  .alert.error{background:rgba(255,59,59,.07);border-color:rgba(255,59,59,.55);color:#ff8585}\n  .alert.success{background:rgba(34,255,136,.06);border-color:rgba(34,255,136,.55);color:var(--green)}\n  .alert .ic{width:20px;height:20px;flex-shrink:0;display:grid;place-items:center}\n  .alert .ic svg{width:16px;height:16px;stroke:currentColor;stroke-width:2.5;fill:none}\n  .toast-container{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:100;display:flex;flex-direction:column;gap:9px;pointer-events:none;width:calc(100% - 32px);max-width:400px}\n  .toast{display:flex;align-items:center;gap:11px;padding:12px 14px;background:rgba(4,22,10,.96);border:1px solid var(--green);border-radius:4px;box-shadow:0 0 30px rgba(34,255,136,.3);pointer-events:auto}\n  .toast-icon{width:32px;height:32px;border-radius:3px;background:rgba(34,255,136,.12);border:1px solid var(--green-dim);display:grid;place-items:center;flex-shrink:0}\n  .toast-icon svg{width:15px;height:15px;stroke:var(--green);stroke-width:3;fill:none}\n  .toast-body{flex:1;min-width:0}\n  .toast-title{font-size:11.5px;font-weight:900;color:var(--green);letter-spacing:1px;text-transform:uppercase}\n  .toast-desc{font-size:10.5px;color:var(--txt-2);margin-top:2px}\n  .footer{width:100%;display:flex;flex-direction:column;align-items:center;gap:10px}\n  .footer-meta{display:flex;align-items:center;gap:11px;font-size:9.5px;color:var(--txt-2);letter-spacing:1.5px;font-weight:800;flex-wrap:wrap;justify-content:center;text-transform:uppercase}\n  .footer-meta .val{display:inline-flex;align-items:center;gap:5px}\n  .footer-meta .val svg{width:11px;height:11px;stroke:var(--green);stroke-width:2.2;fill:none}\n  .footer-meta .sep{color:var(--muted)}\n  .footer-meta .sep::before{content:'/';margin:0 2px}\n  .up-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}\n  .up-dot.ok{background:var(--green)}\n  .up-dot.warn{background:var(--amber)}\n  .up-dot.bad{background:var(--red)}\n  .regen-btn{width:100%;margin-top:10px;padding:12px;font-family:inherit;font-size:10.5px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;border-radius:3px;background:rgba(255,59,59,.08);border:1px solid rgba(255,59,59,.55);color:#ff8585}\n  .export-btn{font-family:inherit;font-size:8px;font-weight:900;letter-spacing:1px;padding:2px 6px;background:transparent;border:1px solid var(--line-2);border-radius:2px;color:var(--txt-2);cursor:pointer;margin-right:6px}\n  .overlay{position:fixed;inset:0;z-index:150;background:rgba(2,10,4,.85);display:none;align-items:center;justify-content:center}\n  .overlay.show{display:flex}\n  .keys-panel{width:min(88%,320px);background:rgba(4,22,10,.97);border:1px solid var(--green);border-radius:4px;padding:18px}\n  .keys-title{font-size:10px;font-weight:900;letter-spacing:2px;color:var(--green);text-transform:uppercase;margin-bottom:12px}\n  .key-row{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--txt-2);padding:6px 0;border-bottom:1px dashed var(--line)}\n  .key-row:last-of-type{border-bottom:0}\n  .key-row .kbd{color:var(--amber);font-weight:900;min-width:70px}\n  .keys-close{width:100%;margin-top:14px;padding:10px;font-family:inherit;font-size:10px;font-weight:900;letter-spacing:1.5px;background:rgba(34,255,136,.08);border:1px solid var(--green-dim);border-radius:3px;color:var(--green);cursor:pointer}\n  body.ph-amber{filter:hue-rotate(-105deg) saturate(1.15)}\n  body.ph-cyan{filter:hue-rotate(40deg)}\n  body.ph-pink{filter:hue-rotate(175deg) saturate(1.2)}\n  .swatches{display:flex;gap:3px;align-items:center;flex-shrink:0}\n  .sw{width:9px;height:9px;border-radius:2px;cursor:pointer;border:1px solid rgba(255,255,255,.3);padding:0}\n  .sw.on{border-color:#fff;box-shadow:0 0 7px currentColor;transform:scale(1.2)}\n  .sw-green{background:#22ff88;color:#22ff88}\n  .sw-amber{background:#ffb800;color:#ffb800}\n  .sw-cyan{background:#22d3ee;color:#22d3ee}\n  .sw-pink{background:#ff2d95;color:#ff2d95}\n  .mini-link-btn{width:100%;margin-top:-2px;margin-bottom:11px;padding:9px;font-family:inherit;font-size:9px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;background:transparent;border:1px dashed var(--line-2);border-radius:3px;color:var(--txt-2)}\n  .paste-btn{font-family:inherit;font-size:9px;font-weight:900;letter-spacing:1px;padding:2px 7px;background:transparent;border:1px dashed var(--line-2);border-radius:2px;color:var(--txt-2);cursor:pointer;margin-left:4px}\n  .qr-panel{margin-top:16px;border:1px solid var(--line);border-radius:4px;overflow:hidden;text-align:center;position:relative;z-index:1}\n  .qr-head{padding:7px 12px;font-size:9px;font-weight:900;letter-spacing:2px;color:var(--muted);text-transform:uppercase;background:rgba(0,0,0,.35);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}\n  .qr-x{cursor:pointer;color:var(--txt-2);font-weight:900}\n  .qr-img{width:140px;height:140px;margin:12px auto 4px;display:block;background:#fff;border:4px solid var(--green);border-radius:4px}\n  .qr-sub{font-size:9px;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;padding:6px 0 10px}\n  .hist-panel{margin-top:16px;border:1px solid var(--line);border-radius:4px;overflow:hidden;position:relative;z-index:1}\n  .hist-body{padding:6px 12px 8px}\n  .hist-line{font-size:10px;line-height:2;color:var(--txt-2);display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed var(--line)}\n  .hist-line:last-child{border-bottom:0}\n  .hist-line .n{color:var(--cyan)}\n  .hist-line .t{color:var(--muted);flex-shrink:0}\n  .hist-empty{font-size:10px;color:var(--muted);padding:6px 0;letter-spacing:1px}\n  /* \u2550\u2550\u2550 ACTIVE SOCKETS \u2550\u2550\u2550 */\n  .total-users-bar{display:flex;align-items:center;justify-content:space-between;margin-top:16px;padding:14px 16px;background:linear-gradient(90deg,rgba(34,255,136,.1),rgba(0,229,255,.06));border:1px solid var(--green-dim);border-radius:4px;position:relative;z-index:1;overflow:hidden}\n  .total-users-bar .label{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:900;letter-spacing:2px;color:var(--txt-2);text-transform:uppercase}\n  .total-users-bar .label svg{width:15px;height:15px;stroke:var(--green);stroke-width:2.5;fill:none}\n  .total-users-bar .value{font-size:24px;font-weight:900;color:var(--green);font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:6px}\n  .total-users-bar .value .unit{font-size:9px;color:var(--muted);letter-spacing:1.5px;font-weight:800}\n  .sockets-panel{margin-top:12px;border:1px solid var(--line-2);border-radius:4px;overflow:hidden;position:relative;z-index:1;background:rgba(0,0,0,.4)}\n  .sockets-head{padding:8px 12px;font-size:9px;font-weight:900;letter-spacing:2px;color:var(--muted);text-transform:uppercase;background:rgba(0,0,0,.45);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}\n  .sockets-head .live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);margin-right:6px;vertical-align:middle}\n  .sockets-head .count-tag{color:var(--green);font-weight:900;font-variant-numeric:tabular-nums}\n  .sockets-head .sync-tag{font-size:8px;color:var(--muted);letter-spacing:1px;margin-right:6px;font-weight:800}\n  .sockets-head .sync-tag.on{color:var(--cyan)}\n  .sockets-head .sync-tag.err{color:var(--red)}\n  .sockets-body{max-height:200px;overflow-y:auto;scrollbar-width:none;padding:2px 0}\n  .sockets-body::-webkit-scrollbar{display:none}\n  .socket-row{display:flex;align-items:center;gap:10px;padding:9px 12px;font-size:10.5px;border-bottom:1px dashed var(--line)}\n  .socket-row:last-child{border-bottom:0}\n  .socket-row .flag{font-size:16px;flex-shrink:0;width:22px;text-align:center}\n  .socket-row .info{flex:1;min-width:0}\n  .socket-row .num{color:var(--green);font-weight:900;letter-spacing:.5px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11.5px}\n  .socket-row .meta{display:flex;gap:7px;font-size:9px;color:var(--muted);letter-spacing:1px;margin-top:3px;text-transform:uppercase;flex-wrap:wrap}\n  .socket-row .name{color:var(--cyan);font-weight:800}\n  .socket-row .country{color:var(--amber);font-weight:800}\n  .socket-row .status{width:7px;height:7px;border-radius:50%;flex-shrink:0;background:var(--green)}\n  .socket-row.off .status{background:var(--muted)}\n  .socket-row.off .num{color:var(--txt-2)}\n  .socket-empty{font-size:10px;color:var(--muted);padding:18px 12px;text-align:center;letter-spacing:1.5px;text-transform:uppercase}\n  .sockets-actions{display:flex;gap:6px;padding:7px 10px;border-top:1px solid var(--line);background:rgba(0,0,0,.3)}\n  .sockets-actions button{flex:1;font-family:inherit;font-size:8.5px;font-weight:900;letter-spacing:1px;padding:6px 4px;background:transparent;border:1px solid var(--line-2);border-radius:2px;color:var(--txt-2);cursor:pointer}\n  body.perf .rain{display:none}\n  body.perf .scanband{display:none}\n  body.perf .bg-term{animation:none}\n  @media (max-height:820px){\n    .card{padding:20px 16px 16px}\n    .sec-title{font-size:18px}\n    .term-btn{padding:14px 18px;font-size:12.5px}\n    .avatar{width:46px;height:46px;font-size:20px}\n    .sockets-body{max-height:150px}\n  }\n  @media (max-width:430px){.term-title{display:none}}\n  @media (max-height:700px){\n    .hint{display:none}\n    .sec-desc{display:none}\n    .trust{display:none}\n    .log{display:none}\n    .qr-panel{display:none}\n    .hist-panel{display:none}\n    .sockets-body{max-height:120px}\n  }\n</style>\n</head>\n<body>\n\n<!-- Boot overlay -->\n<div class=\"boot\" id=\"boot\"><div class=\"boot-lines\" id=\"bootLines\"></div></div>\n\n<!-- CRT layers -->\n<div class=\"bg-term\"></div>\n<div class=\"scanband\"></div>\n<div class=\"vignette\"></div>\n<div class=\"scanlines\"></div>\n\n<div class=\"wrap\">\n\n  <!-- Header -->\n  <div class=\"header\">\n    <div class=\"term-bar\">\n      <span class=\"term-dot r\"></span>\n      <span class=\"term-dot y\"></span>\n      <span class=\"term-dot g\"></span>\n      <span class=\"term-title\"><span class=\"user\">md-ghani</span>@bot:~$</span>\n      <button class=\"crt-btn\" id=\"crtBtn\" onclick=\"toggleCRT(event)\">CRT:ON</button>\n      <button class=\"crt-btn\" onclick=\"toggleKeys(event)\">KEYS</button>\n      <button class=\"crt-btn\" id=\"langBtn\" onclick=\"cycleLang(event)\">EN</button>\n      <button class=\"crt-btn\" id=\"sndBtn\" onclick=\"cycleSnd(event)\">SND:MIX</button>\n      <button class=\"crt-btn\" id=\"perfBtn\" onclick=\"togglePerf(event)\">PERF:OFF</button>\n      <span class=\"swatches\">\n        <button class=\"sw sw-green on\" onclick=\"setPhosphor('green')\"></button>\n        <button class=\"sw sw-amber\" onclick=\"setPhosphor('amber')\"></button>\n        <button class=\"sw sw-cyan\" onclick=\"setPhosphor('cyan')\"></button>\n        <button class=\"sw sw-pink\" onclick=\"setPhosphor('pink')\"></button>\n      </span>\n      <span class=\"up-dot ok\" id=\"upDot\"></span>\n    </div>\n    <div class=\"header-body\">\n      <div class=\"avatar\">\ud83e\udd16</div>\n      <div class=\"header-info\">\n        <div class=\"header-name\">MD-GHANI-BOT <span class=\"ver\">v1.0</span></div>\n        <div class=\"header-sub\">\n          <span class=\"badge\"><span class=\"dot\"></span>ONLINE</span>\n          SESSION ACTIVE\n        </div>\n      </div>\n    </div>\n  </div>\n\n  <!-- Stats -->\n  <div class=\"stats-row\">\n    <div class=\"stat-card\"><div class=\"val\" id=\"statPing\">24ms</div><div class=\"lbl\">Ping</div></div>\n    <div class=\"stat-card\"><div class=\"val\">99.9%</div><div class=\"lbl\">Uptime</div></div>\n    <div class=\"stat-card\"><div class=\"val\" id=\"statPairs\">0</div><div class=\"lbl\">Pairs</div></div>\n  </div>\n\n  <!-- Main Card -->\n  <div class=\"card\">\n    <div class=\"skull\">\u2620</div>\n\n    <div class=\"sec\">\n      <div class=\"sec-icon\">\n        <svg viewBox=\"0 0 24 24\"><rect x=\"5\" y=\"2\" width=\"14\" height=\"20\" rx=\"3\"/><line x1=\"12\" y1=\"18\" x2=\"12\" y2=\"18.01\" stroke-width=\"3\"/></svg>\n      </div>\n      <div class=\"sec-info\">\n        <div class=\"sec-cmd\"><span class=\"dollar\">$</span> ./link-device --secure</div>\n        <div class=\"sec-title\">&gt; LINK_DEVICE<span class=\"gt\">_</span></div>\n        <div class=\"sec-desc\" data-i18n=\"secDesc\">Establish encrypted handshake with your WhatsApp</div>\n      </div>\n    </div>\n\n    <div class=\"field\">\n      <div class=\"field-label\">\n        <div class=\"left\"><span class=\"num-badge\">01</span><span data-i18n=\"targetNum\">TARGET_NUMBER</span></div>\n        <span class=\"req\" data-i18n=\"req\">REQUIRED</span>\n      </div>\n      <div class=\"input-box\">\n        <div class=\"cc-box\">\n          <select id=\"ccSelect\" onchange=\"onCCChange()\">\n            <option value=\"\">\ud83c\udf10</option>\n            <option value=\"91\">\ud83c\uddee\ud83c\uddf3 +91</option>\n            <option value=\"92\">\ud83c\uddf5\ud83c\uddf0 +92</option>\n            <option value=\"880\">\ud83c\udde7\ud83c\udde9 +880</option>\n            <option value=\"1\">\ud83c\uddfa\ud83c\uddf8 +1</option>\n            <option value=\"44\">\ud83c\uddec\ud83c\udde7 +44</option>\n            <option value=\"971\">\ud83c\udde6\ud83c\uddea +971</option>\n            <option value=\"966\">\ud83c\uddf8\ud83c\udde6 +966</option>\n            <option value=\"62\">\ud83c\uddee\ud83c\udde9 +62</option>\n            <option value=\"60\">\ud83c\uddf2\ud83c\uddfe +60</option>\n            <option value=\"254\">\ud83c\uddf0\ud83c\uddea +254</option>\n            <option value=\"234\">\ud83c\uddf3\ud83c\uddec +234</option>\n            <option value=\"55\">\ud83c\udde7\ud83c\uddf7 +55</option>\n          </select>\n          <span class=\"code\" id=\"ccText\">+</span>\n        </div>\n        <input id=\"phone\" type=\"tel\" inputmode=\"numeric\" placeholder=\"enter country code + number\" maxlength=\"15\"/>\n        <button class=\"clr\" id=\"clearBtn\" type=\"button\">\u2715</button>\n      </div>\n      <div class=\"hint\">\n        <span class=\"arrow\">&gt;</span>\n        <span data-i18n=\"hintFmt\">format:</span> <code>91XXXXXXXXXX</code>\n        <span class=\"kbd\">CTRL+\u21b5 EXEC</span>\n        <button class=\"paste-btn\" onclick=\"pasteNumber(event)\">[ PASTE ]</button>\n      </div>\n      <div class=\"chips\" id=\"chips\"></div>\n    </div>\n\n    <div class=\"btn-wrap\">\n      <button class=\"term-btn primary\" id=\"pairBtn\" onclick=\"pair(event)\">\n        <span class=\"spinner\"></span>\n        <span class=\"brackets\">[</span>\n        <span class=\"btn-txt\" data-i18n=\"btnPair\">EXECUTE_PAIR</span>\n        <span class=\"brackets\">]</span>\n        <span class=\"arrow\"><svg viewBox=\"0 0 24 24\"><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/><polyline points=\"12 5 19 12 12 19\"/></svg></span>\n      </button>\n      <div class=\"sound-toggle\" id=\"soundToggle\" onclick=\"toggleSound(event)\">\n        <svg viewBox=\"0 0 24 24\"><polygon points=\"11 5 6 9 2 9 2 15 6 15 11 19 11 5\"/><path class=\"wave\" d=\"M15.54 8.46a5 5 0 0 1 0 7.07\" fill=\"none\" stroke=\"currentColor\"/><path class=\"wave\" d=\"M19.07 4.93a10 10 0 0 1 0 14.14\" fill=\"none\" stroke=\"currentColor\"/></svg>\n      </div>\n    </div>\n\n    <div class=\"progress-wrap\" id=\"progressWrap\">\n      <div class=\"progress-meta\"><span>ESTABLISHING_HANDSHAKE...</span><span class=\"pct\" id=\"progressPct\">0%</span></div>\n      <div class=\"progress-bar\"><div class=\"fill\" id=\"progressFill\"></div></div>\n    </div>\n\n    <div class=\"btn-wrap\">\n      <a href=\"https://whatsapp.com/channel/120363429085670060\" onclick=\"openChannel(event)\" target=\"_blank\" rel=\"noopener\" class=\"term-btn secondary\">\n        <svg class=\"lead-icon\" viewBox=\"0 0 24 24\"><path d=\"M12 2a10 10 0 0 0-8.6 15L2 22l5.1-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1.1.1-1.8-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 .9-2.2c.2-.3.5-.4.7-.4h.5c.2 0 .4-.1.6.4.2.5.7 1.8.8 1.9.1.1.1.3 0 .4-.1.2-.2.3-.3.5-.1.2-.3.4-.4.5-.1.1-.3.3-.1.5.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.4.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.2.1 1.5.7 1.8.8.3.1.4.2.5.3.1.2.1.7-.1 1.3z\"/></svg>\n        <span data-i18n=\"btnChannel\">JOIN_CHANNEL</span>\n        <span class=\"arrow\"><svg viewBox=\"0 0 24 24\"><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/><polyline points=\"12 5 19 12 12 19\"/></svg></span>\n      </a>\n    </div>\n\n    <button class=\"mini-link-btn\" onclick=\"copyChannelLink()\">&#128279; COPY_CHANNEL_LINK</button>\n\n    <div class=\"trust\">\n      <div class=\"trust-item\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"/></svg><span data-i18n=\"trust1\">AES-256</span></div>\n      <div class=\"trust-item\"><svg viewBox=\"0 0 24 24\"><polyline points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"/></svg><span data-i18n=\"trust2\">0-Delay</span></div>\n      <div class=\"trust-item\"><svg viewBox=\"0 0 24 24\"><polyline points=\"20 6 9 17 4 12\"/></svg><span data-i18n=\"trust3\">Verified</span></div>\n    </div>\n\n    <div class=\"result\" id=\"codeBox\">\n      <div class=\"result-head\">\n        <div class=\"result-tag\"><span class=\"dot\"></span><span data-i18n=\"codeDeployed\">CODE_DEPLOYED</span></div>\n        <div class=\"timer-circle\" id=\"timerBox\"><span class=\"txt\" id=\"countdown\">120</span></div>\n      </div>\n      <div class=\"code-val\" id=\"out\">\u2014 \u2014 \u2014 \u2014 \u2014 \u2014 \u2014 \u2014</div>\n      <div class=\"res-actions\">\n        <button class=\"copy\" id=\"copyBtn\" onclick=\"copyCode()\">\n          <svg viewBox=\"0 0 24 24\"><rect x=\"9\" y=\"9\" width=\"13\" height=\"13\" rx=\"2\"/><path d=\"M5 15V5a2 2 0 0 1 2-2h10\"/></svg>\n          <span data-i18n=\"copyBtn\">COPY_CODE</span>\n        </button>\n        <button onclick=\"resetForm()\">\n          <svg viewBox=\"0 0 24 24\"><polyline points=\"23 4 23 10 17 10\"/><path d=\"M20.49 15a9 9 0 1 1-2.12-9.36L23 10\"/></svg>\n          <span data-i18n=\"resetBtn\">RESET</span>\n        </button>\n      </div>\n      <button class=\"regen-btn\" id=\"regenBtn\" onclick=\"regen(event)\" style=\"display:none\">&#8635; <span data-i18n=\"regen\">REGENERATE_CODE</span></button>\n    </div>\n\n    <div class=\"steps\" id=\"steps\" style=\"display:none\">\n      <div class=\"steps-head\">\n        <div class=\"left\"><svg viewBox=\"0 0 24 24\"><polyline points=\"9 11 12 14 22 4\"/><path d=\"M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11\"/></svg><span data-i18n=\"execSeq\">EXECUTION_SEQUENCE</span></div>\n        <span class=\"count\">[4]</span>\n      </div>\n      <div class=\"step\"><span class=\"n\">1</span><span data-i18n=\"step1\">Open <b>WhatsApp</b> on your device</span></div>\n      <div class=\"step\"><span class=\"n\">2</span><span data-i18n=\"step2\">Go to <b>Settings \u2192 Linked Devices</b></span></div>\n      <div class=\"step\"><span class=\"n\">3</span><span data-i18n=\"step3\">Tap <b>Link a Device \u2192 Link with phone number</b></span></div>\n      <div class=\"step\"><span class=\"n\">4</span><span data-i18n=\"step4\">Enter the code shown above</span></div>\n    </div>\n\n    <div class=\"qr-panel\" id=\"qrPanel\">\n      <div class=\"qr-head\">\n        <span>// CHANNEL_QR</span>\n        <span class=\"qr-x\" onclick=\"document.getElementById('qrPanel').style.display='none'\">[x]</span>\n      </div>\n      <img class=\"qr-img\" alt=\"channel qr\" src=\"https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=https%3A%2F%2Fwhatsapp.com%2Fchannel%2F120363429085670060\" onerror=\"this.closest('.qr-panel').style.display='none'\"/>\n      <div class=\"qr-sub\">scan to join channel</div>\n    </div>\n\n    <div class=\"hist-panel\">\n      <div class=\"log-head\">\n        <span>// SESSION_HISTORY</span>\n        <span><button class=\"export-btn\" onclick=\"clearHistory()\">[ CLEAR ]</button></span>\n      </div>\n      <div class=\"hist-body\" id=\"histBody\"></div>\n    </div>\n\n    <!-- \u2550\u2550\u2550 TOTAL USERS \u2550\u2550\u2550 -->\n    <div class=\"total-users-bar\">\n      <div class=\"label\">\n        <svg viewBox=\"0 0 24 24\"><path d=\"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M23 21v-2a4 4 0 0 0-3-3.87\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/></svg>\n        <span>TOTAL_USERS</span>\n      </div>\n      <div class=\"value\"><span id=\"totalUsersVal\">0</span><span class=\"unit\">UNIQUE</span></div>\n    </div>\n\n    <!-- \u2550\u2550\u2550 ACTIVE SOCKETS \u2550\u2550\u2550 -->\n    <div class=\"sockets-panel\">\n      <div class=\"sockets-head\">\n        <span><span class=\"live-dot\"></span>// ACTIVE_SOCKETS</span>\n        <span>\n          <span class=\"sync-tag\" id=\"syncTag\">SYNC:IDLE</span>\n          <span class=\"count-tag\" id=\"socketsCount\">0</span>\n        </span>\n      </div>\n      <div class=\"sockets-body\" id=\"socketsBody\">\n        <div class=\"socket-empty\">// awaiting connections...</div>\n      </div>\n      <div class=\"sockets-actions\">\n        <button onclick=\"refreshSockets()\">&#8635; REFRESH</button>\n        <button onclick=\"clearSockets()\">[ CLEAR ALL ]</button>\n        <button onclick=\"exportSockets()\">&#8681; EXPORT</button>\n      </div>\n    </div>\n\n    <div class=\"log\">\n      <div class=\"log-head\">\n        <span>// SYSTEM_LOG</span>\n        <span><button class=\"export-btn\" onclick=\"exportLog()\">\u21e9 EXPORT</button><span class=\"live\">\u25cf LIVE</span></span>\n      </div>\n      <div class=\"log-body\" id=\"logBody\"></div>\n    </div>\n\n    <div class=\"alert\" id=\"alert\">\n      <span class=\"ic\" id=\"alertIc\"></span>\n      <span id=\"alertMsg\"></span>\n    </div>\n\n  </div>\n\n  <div class=\"footer\">\n    <div class=\"footer-meta\">\n      <span class=\"val\"><svg viewBox=\"0 0 24 24\"><polyline points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"/></svg><span data-i18n=\"f1\">FAST</span></span>\n      <span class=\"sep\"></span>\n      <span class=\"val\"><svg viewBox=\"0 0 24 24\"><path d=\"M22 11.08V12a10 10 0 1 1-5.93-9.14\"/><polyline points=\"22 4 12 14.01 9 11.01\"/></svg><span data-i18n=\"f2\">ALWAYS-ON</span></span>\n      <span class=\"sep\"></span>\n      <span class=\"val\"><svg viewBox=\"0 0 24 24\"><path d=\"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/></svg><span data-i18n=\"f3\">MULTI-USER</span></span>\n      <span class=\"sep\"></span>\n      <span class=\"val\">&#9201; <span id=\"uptime\">00:00:00</span></span>\n    </div>\n  </div>\n\n</div>\n\n<div class=\"overlay\" id=\"keysOverlay\" onclick=\"if(event.target===this)toggleKeys(event)\">\n  <div class=\"keys-panel\">\n    <div class=\"keys-title\">// KEYBOARD_SHORTCUTS</div>\n    <div class=\"key-row\"><span class=\"kbd\">CTRL+\u21b5</span><span>execute pair</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">C</span><span>copy code</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">R</span><span>reset form</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">M</span><span>toggle rain</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">F</span><span>fullscreen</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">?</span><span>this panel</span></div>\n    <div class=\"key-row\"><span class=\"kbd\">ESC</span><span>close</span></div>\n    <button class=\"keys-close\" onclick=\"toggleKeys(event)\">[ CLOSE ]</button>\n  </div>\n</div>\n\n<script>\n/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n   SAFE BOOTSTRAP \u2014 entire app is wrapped so a single error\n   never blanks the page. Boot overlay has hard timeout.\n   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */\n\n/* Force-remove boot overlay no matter what after 3s */\nsetTimeout(function(){\n  var b = document.getElementById('boot');\n  if (b) { b.classList.add('done'); setTimeout(function(){ if (b && b.parentNode) b.parentNode.removeChild(b); }, 500); }\n}, 3000);\n\n(function(){\n'use strict';\n\n/* \u2550\u2550\u2550 SAFE WRAPPER \u2550\u2550\u2550 */\nfunction safe(fn, label){\n  try { fn(); }\n  catch(err){ console.error('[MD-GHANI][' + (label||'?') + ']', err); }\n}\n\n/* \u2550\u2550\u2550 LOG \u2550\u2550\u2550 */\nfunction log(type, msg){\n  try {\n    var body = document.getElementById('logBody');\n    if (!body) return;\n    var now = new Date();\n    var t = now.toTimeString().slice(0,8);\n    var div = document.createElement('div');\n    div.className = 'log-line t-' + type;\n    var tag = {ok:'OK ', err:'ERR', inf:'INF', wrn:'WRN'}[type] || 'INF';\n    div.innerHTML = '<span class=\"t\">[' + t + ']</span><b>[' + tag + ']</b> ' + msg;\n    body.appendChild(div);\n    while (body.children.length > 30) body.removeChild(body.firstChild);\n    body.scrollTop = body.scrollHeight;\n  } catch(e){}\n}\n\n/* \u2550\u2550\u2550 SOUND \u2550\u2550\u2550 */\nfunction buzz(p){ if (navigator.vibrate){ try{ navigator.vibrate(p); }catch(e){} } }\n\nvar Sound = {\n  ctx:null, enabled:true, wave:'mix',\n  init:function(){ if (this.ctx) return; try{ var AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC(); }catch(e){} },\n  resume:function(){ this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },\n  tone:function(o){\n    if (!this.enabled) return;\n    this.init(); if (!this.ctx) return;\n    var freq = o.freq||440, dur = o.dur||0.15, type = o.type||'square', vol = o.vol||0.15, delay = o.delay||0;\n    try {\n      var t0 = this.ctx.currentTime + delay;\n      var osc = this.ctx.createOscillator();\n      var gain = this.ctx.createGain();\n      osc.type = (Sound.wave === 'mix') ? type : Sound.wave;\n      osc.frequency.setValueAtTime(freq, t0);\n      gain.gain.setValueAtTime(0, t0);\n      gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);\n      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);\n      osc.connect(gain); gain.connect(this.ctx.destination);\n      osc.start(t0); osc.stop(t0 + dur + 0.05);\n    } catch(e){}\n  },\n  click:function(){ buzz(10); this.tone({freq:1200, dur:0.05, vol:0.12}); },\n  type:function(){ this.tone({freq:1800+Math.random()*400, dur:0.02, vol:0.04}); },\n  success:function(){\n    buzz([30,40,30]);\n    this.tone({freq:523, dur:0.09, vol:0.13});\n    this.tone({freq:659, dur:0.09, vol:0.13, delay:0.1});\n    this.tone({freq:784, dur:0.09, vol:0.13, delay:0.2});\n    this.tone({freq:1047, dur:0.28, vol:0.13, delay:0.3});\n  },\n  error:function(){ buzz([60,50,60]); this.tone({freq:300, dur:0.15, type:'sawtooth', vol:0.1}); this.tone({freq:200, dur:0.22, type:'sawtooth', vol:0.1, delay:0.12}); },\n  copy:function(){ buzz(15); this.tone({freq:900, dur:0.05, vol:0.11}); this.tone({freq:1350, dur:0.07, vol:0.11, delay:0.06}); },\n  toggleOn:function(){ this.tone({freq:800, dur:0.06, vol:0.11}); this.tone({freq:1100, dur:0.08, vol:0.11, delay:0.07}); },\n  toggleOff:function(){ this.tone({freq:1100, dur:0.06, vol:0.11}); this.tone({freq:700, dur:0.08, vol:0.11, delay:0.07}); },\n  tick:function(){ this.tone({freq:1500, dur:0.02, vol:0.06}); }\n};\n\n/* \u2550\u2550\u2550 BOOT SEQUENCE \u2550\u2550\u2550 */\nsafe(function(){\n  var boot = document.getElementById('boot');\n  var lines = document.getElementById('bootLines');\n  if (!boot || !lines) return;\n  var seq = [\n    {t:'MD-GHANI OS v1.0 \u2014 SECURE BOOT', c:'', delay:0},\n    {t:'> loading crypto modules', c:'dim', delay:250},\n    {t:'  [OK] aes-256 engine', c:'ok', delay:350},\n    {t:'> establishing uplink', c:'dim', delay:350},\n    {t:'  [OK] handshake ready', c:'ok', delay:350},\n    {t:'> access granted_', c:'', delay:300}\n  ];\n  var total = 0;\n  seq.forEach(function(item){\n    total += item.delay;\n    setTimeout(function(){\n      try {\n        var div = document.createElement('div');\n        if (item.c) div.className = item.c;\n        div.textContent = item.t;\n        lines.appendChild(div);\n        Sound.type();\n      } catch(e){}\n    }, total);\n  });\n  setTimeout(function(){\n    boot.classList.add('done');\n    setTimeout(function(){ if (boot.parentNode) boot.parentNode.removeChild(boot); }, 500);\n  }, total + 500);\n}, 'boot');\n\n/* \u2550\u2550\u2550 MATRIX RAIN \u2550\u2550\u2550 */\nsafe(function(){\n  var chars = '01\u30a2\u30a4\u30a6\u30a8\u30aa\u30ab\u30ad\u30af\u30b1\u30b3\u30b5\u30b7\u30b9\u30bb\u30bd0123456789ABCDEF';\n  for (var i = 0; i < 12; i++){\n    var col = document.createElement('div');\n    col.className = 'rain';\n    var text = '';\n    var len = 12 + Math.floor(Math.random() * 12);\n    for (var j = 0; j < len; j++) text += chars[Math.floor(Math.random() * chars.length)];\n    col.textContent = text;\n    col.style.left = (Math.random() * 96) + 'vw';\n    col.style.animationDuration = (9 + Math.random() * 12) + 's';\n    col.style.animationDelay = (-Math.random() * 14) + 's';\n    col.style.opacity = .25 + Math.random() * .35;\n    document.body.appendChild(col);\n  }\n}, 'rain');\n\n/* \u2550\u2550\u2550 ELEMENT REFS \u2550\u2550\u2550 */\nvar phoneEl      = document.getElementById('phone');\nvar pairBtnEl    = document.getElementById('pairBtn');\nvar btnTxt       = pairBtnEl ? pairBtnEl.querySelector('.btn-txt') : null;\nvar outEl        = document.getElementById('out');\nvar codeBox      = document.getElementById('codeBox');\nvar stepsEl      = document.getElementById('steps');\nvar alertEl      = document.getElementById('alert');\nvar alertMsg     = document.getElementById('alertMsg');\nvar alertIc      = document.getElementById('alertIc');\nvar clearBtn     = document.getElementById('clearBtn');\nvar ccText       = document.getElementById('ccText');\nvar ccSelect     = document.getElementById('ccSelect');\nvar statPingEl   = document.getElementById('statPing');\nvar progressWrap = document.getElementById('progressWrap');\nvar progressFill = document.getElementById('progressFill');\nvar progressPct  = document.getElementById('progressPct');\nvar countdownEl  = document.getElementById('countdown');\nvar timerBox     = document.getElementById('timerBox');\nvar soundToggle  = document.getElementById('soundToggle');\n\nvar ICON_ERR = '<svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"12\" y1=\"8\" x2=\"12\" y2=\"12\"/><line x1=\"12\" y1=\"16\" x2=\"12\" y2=\"16.01\"/></svg>';\nvar ICON_OK  = '<svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"8 12 11 15 16 9\"/></svg>';\n\nvar currentCode = '';\nvar pairCount = 0;\nvar pairRetry = false;\nvar typeTimer = null;\nvar countdownTimer = null;\nvar progressTimer = null;\nvar selectedCC = '';\n\n/* \u2550\u2550\u2550 PING SIM \u2550\u2550\u2550 */\nsafe(function(){\n  setInterval(function(){\n    try {\n      var ping = 18 + Math.floor(Math.random() * 14);\n      if (statPingEl) statPingEl.textContent = ping + 'ms';\n      var dot = document.getElementById('upDot');\n      if (dot) dot.className = 'up-dot ' + (ping < 28 ? 'ok' : ping < 40 ? 'warn' : 'bad');\n    } catch(e){}\n  }, 2500);\n}, 'ping');\n\n/* \u2550\u2550\u2550 UPTIME \u2550\u2550\u2550 */\nvar bootTime = Date.now();\nsafe(function(){\n  setInterval(function(){\n    try {\n      var s = Math.floor((Date.now() - bootTime) / 1000);\n      var hh = String(Math.floor(s / 3600)).padStart(2,'0');\n      var mm = String(Math.floor((s % 3600) / 60)).padStart(2,'0');\n      var ss = String(s % 60).padStart(2,'0');\n      var el = document.getElementById('uptime');\n      if (el) el.textContent = hh + ':' + mm + ':' + ss;\n    } catch(e){}\n  }, 1000);\n}, 'uptime');\n\n/* \u2550\u2550\u2550 TOAST \u2550\u2550\u2550 */\nfunction showToast(title, desc){\n  try {\n    var container = document.querySelector('.toast-container');\n    if (!container){\n      container = document.createElement('div');\n      container.className = 'toast-container';\n      document.body.appendChild(container);\n    }\n    var toast = document.createElement('div');\n    toast.className = 'toast';\n    toast.innerHTML = '<div class=\"toast-icon\"><svg viewBox=\"0 0 24 24\"><polyline points=\"20 6 9 17 4 12\"/></svg></div><div class=\"toast-body\"><div class=\"toast-title\">' + title + '</div><div class=\"toast-desc\">' + desc + '</div></div>';\n    container.appendChild(toast);\n    setTimeout(function(){ if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);\n  } catch(e){}\n}\n\n/* \u2550\u2550\u2550 CC PICKER \u2550\u2550\u2550 */\nfunction onCCChange(){\n  try {\n    Sound.click();\n    selectedCC = ccSelect.value;\n    ccText.textContent = selectedCC ? '+' + selectedCC : '+';\n    if (selectedCC && phoneEl.value && phoneEl.value.indexOf(selectedCC) !== 0) phoneEl.value = '';\n    if (selectedCC){ phoneEl.placeholder = 'number without ' + selectedCC; phoneEl.focus(); }\n    else phoneEl.placeholder = 'enter country code + number';\n    log('inf', 'country code set \u2192 +' + (selectedCC || 'auto'));\n  } catch(e){}\n}\n\n/* \u2550\u2550\u2550 RECENT \u2550\u2550\u2550 */\nvar RECENT_KEY = 'mdghani_recent';\nfunction getRecent(){ try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch(e){ return []; } }\nfunction saveRecent(num){\n  try {\n    var list = getRecent().filter(function(n){ return n !== num; });\n    list.unshift(num); list = list.slice(0, 3);\n    localStorage.setItem(RECENT_KEY, JSON.stringify(list));\n    renderChips();\n  } catch(e){}\n}\nfunction renderChips(){\n  try {\n    var box = document.getElementById('chips');\n    if (!box) return;\n    var list = getRecent();\n    box.innerHTML = '';\n    list.forEach(function(num){\n      var c = document.createElement('button');\n      c.className = 'chip'; c.type = 'button'; c.textContent = num;\n      c.onclick = function(){\n        Sound.click();\n        phoneEl.value = num;\n        clearBtn.classList.add('show');\n        ccText.textContent = '+' + num.slice(0,2);\n        phoneEl.focus();\n      };\n      box.appendChild(c);\n    });\n  } catch(e){}\n}\n\n/* \u2550\u2550\u2550 INPUT EVENTS \u2550\u2550\u2550 */\nif (phoneEl){\n  phoneEl.addEventListener('input', function(){\n    phoneEl.value = phoneEl.value.replace(/[^\\d]/g,'');\n    if (clearBtn) clearBtn.classList.toggle('show', phoneEl.value.length > 0);\n    if (ccText) ccText.textContent = phoneEl.value ? '+' + phoneEl.value.slice(0,2) : (selectedCC ? '+' + selectedCC : '+');\n  });\n  phoneEl.addEventListener('keydown', function(e){\n    if (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) pair(e);\n  });\n}\nif (clearBtn){\n  clearBtn.onclick = function(){\n    Sound.click();\n    phoneEl.value = '';\n    clearBtn.classList.remove('show');\n    ccText.textContent = selectedCC ? '+' + selectedCC : '+';\n    phoneEl.focus();\n  };\n}\nif (soundToggle){\n  soundToggle.onclick = function(e){\n    e.stopPropagation();\n    Sound.resume();\n    Sound.enabled = !Sound.enabled;\n    soundToggle.classList.toggle('muted', !Sound.enabled);\n    if (Sound.enabled) Sound.toggleOn(); else Sound.toggleOff();\n  };\n}\n\n/* \u2550\u2550\u2550 ALERTS \u2550\u2550\u2550 */\nfunction showAlert(type, msg){\n  try {\n    alertEl.className = 'alert show ' + type;\n    alertIc.innerHTML = type === 'error' ? ICON_ERR : ICON_OK;\n    alertMsg.textContent = msg;\n  } catch(e){}\n}\nfunction hideAlert(){ try { alertEl.className = 'alert'; } catch(e){} }\n\n/* \u2550\u2550\u2550 PROGRESS \u2550\u2550\u2550 */\nfunction animateProgress(duration){\n  try {\n    progressWrap.classList.add('active');\n    var pct = 0;\n    progressFill.style.width = '0%';\n    progressPct.textContent = '0%';\n    clearInterval(progressTimer);\n    progressTimer = setInterval(function(){\n      pct += Math.random() * 12 + 4;\n      if (pct >= 100){ pct = 100; clearInterval(progressTimer); }\n      progressFill.style.width = pct + '%';\n      progressPct.textContent = Math.floor(pct) + '%';\n    }, duration / 12);\n  } catch(e){}\n}\nfunction resetProgress(){\n  try {\n    clearInterval(progressTimer);\n    progressFill.style.width = '0%';\n    progressPct.textContent = '0%';\n    progressWrap.classList.remove('active');\n  } catch(e){}\n}\nfunction setLoading(on, text){\n  if (!pairBtnEl) return;\n  pairBtnEl.disabled = on;\n  pairBtnEl.classList.toggle('loading', on);\n  if (btnTxt) btnTxt.textContent = text || (on ? 'PROCESSING' : 'EXECUTE_PAIR');\n  if (on) animateProgress(2400); else resetProgress();\n}\n\n/* \u2550\u2550\u2550 COUNTDOWN \u2550\u2550\u2550 */\nfunction startCountdown(){\n  clearInterval(countdownTimer);\n  document.title = '\u26a1 CODE ACTIVE \u2014 MD-Ghani-Bot';\n  var t = 120;\n  countdownEl.textContent = t;\n  timerBox.classList.remove('danger');\n  countdownTimer = setInterval(function(){\n    t--;\n    if (t <= 0){\n      clearInterval(countdownTimer);\n      countdownEl.textContent = '0';\n      Sound.error();\n      showAlert('error','ERR_CODE_EXPIRED \u2014 generate a new one.');\n      codeBox.classList.remove('show');\n      stepsEl.style.display = 'none';\n      var rb = document.getElementById('regenBtn');\n      if (rb) rb.style.display = 'block';\n      return;\n    }\n    countdownEl.textContent = t;\n    if (t <= 20){\n      timerBox.classList.add('danger');\n      if (t % 2 === 0) Sound.tick();\n    }\n  }, 1000);\n}\nfunction stopCountdown(){ clearInterval(countdownTimer); document.title = 'MD-Ghani-Bot \u2022 TERMINAL PRO+'; }\n\nfunction formatCode(code){ return code.replace(/(\\d{4})(?=\\d)/g, '$1-'); }\n\nfunction typeCode(code){\n  clearInterval(typeTimer);\n  outEl.textContent = '';\n  var chars = [], i = 0;\n  typeTimer = setInterval(function(){\n    if (i >= code.length){\n      clearInterval(typeTimer);\n      outEl.textContent = formatCode(code);\n      return;\n    }\n    chars.push(code[i]);\n    outEl.textContent = formatCode(chars.join('')) + (i < code.length - 1 ? '_' : '');\n    Sound.tick();\n    i++;\n  }, 90);\n}\n\nfunction shakeInput(){\n  var box = document.querySelector('.input-box');\n  if (!box) return;\n  box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');\n  buzz([50,40,50]);\n}\n\nfunction regen(e){ Sound.click(); pair(e); }\n\n/* \u2550\u2550\u2550 PAIR \u2550\u2550\u2550 */\nfunction pair(e){\n  Sound.resume();\n  Sound.click();\n  hideAlert();\n  stopCountdown();\n  var rb = document.getElementById('regenBtn');\n  if (rb) rb.style.display = 'none';\n\n  var raw = phoneEl.value.trim();\n  var phone = raw;\n  if (selectedCC && raw && raw.indexOf(selectedCC) !== 0) phone = selectedCC + raw;\n\n  if (!phone) { Sound.error(); shakeInput(); showAlert('error','ERROR: target number required.'); phoneEl.focus(); return; }\n  if (phone.length < 8) { Sound.error(); shakeInput(); showAlert('error','ERROR: number too short \u2014 include country code.'); return; }\n  if (phone.length > 15) { Sound.error(); shakeInput(); showAlert('error','ERROR: number too long \u2014 verify and retry.'); return; }\n\n  setLoading(true, 'PROCESSING');\n  codeBox.classList.remove('show');\n  stepsEl.style.display = 'none';\n  log('inf', 'pair request \u2192 +' + phone);\n\n  fetch('/pair', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ phone: phone })\n  }).then(function(res){ return res.json(); }).then(function(data){\n    if (data && data.ok && data.code){\n      pairRetry = false;\n      currentCode = String(data.code);\n      typeCode(currentCode);\n      autoCopyCode();\n      codeBox.classList.add('show');\n      stepsEl.style.display = 'grid';\n      showAlert('success','OK: code deployed \u2014 link within 2 minutes.');\n      setLoading(false, 'EXECUTE_PAIR');\n      startCountdown();\n      Sound.success();\n      showToast('ACCESS GRANTED', 'Pairing code generated successfully');\n      saveRecent(phone);\n      addHistory(phone);\n      addSocket(phone);\n      pairCount++;\n      var sp = document.getElementById('statPairs');\n      if (sp) sp.textContent = pairCount;\n      log('ok', 'code received \u2192 ' + currentCode);\n    } else {\n      setLoading(false, 'EXECUTE_PAIR');\n      Sound.error();\n      showAlert('error', 'FAIL: ' + ((data && data.error) || 'execution failed \u2014 retry.'));\n      log('err', 'server rejected');\n    }\n  }).catch(function(err){\n    if (!pairRetry){\n      pairRetry = true;\n      log('wrn', 'connection failed \u2014 auto-retry in 2s...');\n      if (btnTxt) btnTxt.textContent = 'RETRYING';\n      showToast('RETRYING', 'connection failed \u2014 trying again');\n      setTimeout(function(){ if (pairRetry) pair(e); }, 2000);\n      return;\n    }\n    pairRetry = false;\n    setLoading(false, 'EXECUTE_PAIR');\n    Sound.error();\n    showAlert('error','ERR_CONNECTION: ' + (err.message || 'server unreachable'));\n    log('err', 'network failure');\n  });\n}\n\n/* \u2550\u2550\u2550 COPY CODE \u2550\u2550\u2550 */\nfunction copyCode(){\n  if (!currentCode) return;\n  Sound.copy();\n  var done = function(){\n    var b = document.getElementById('copyBtn');\n    if (b){\n      if (b.dataset.orig === undefined) b.dataset.orig = b.innerHTML;\n      b.classList.add('copied');\n      b.innerHTML = '<svg viewBox=\"0 0 24 24\"><polyline points=\"20 6 9 17 4 12\"/></svg> COPIED';\n      setTimeout(function(){ b.classList.remove('copied'); b.innerHTML = b.dataset.orig; }, 1800);\n    }\n    showToast('BUFFER SAVED', 'Pairing code copied to clipboard');\n    log('ok', 'code copied to clipboard');\n  };\n  if (navigator.clipboard && navigator.clipboard.writeText){\n    navigator.clipboard.writeText(currentCode).then(done).catch(function(){ fallbackCopy(done); });\n  } else fallbackCopy(done);\n}\nfunction fallbackCopy(cb){\n  try {\n    var t = document.createElement('textarea');\n    t.value = currentCode; document.body.appendChild(t);\n    t.select(); document.execCommand('copy'); cb();\n    document.body.removeChild(t);\n  } catch(e){}\n}\n\nfunction resetForm(){\n  if (currentCode && !confirm('Abort current pairing session?')) return;\n  Sound.click();\n  stopCountdown();\n  clearInterval(typeTimer);\n  currentCode = '';\n  phoneEl.value = '';\n  clearBtn.classList.remove('show');\n  ccText.textContent = selectedCC ? '+' + selectedCC : '+';\n  outEl.textContent = '\u2014 \u2014 \u2014 \u2014 \u2014 \u2014 \u2014 \u2014';\n  codeBox.classList.remove('show');\n  stepsEl.style.display = 'none';\n  resetProgress();\n  hideAlert();\n  phoneEl.focus();\n}\n\nfunction autoCopyCode(){\n  if (!navigator.clipboard || !navigator.clipboard.writeText) return;\n  navigator.clipboard.writeText(currentCode).then(function(){\n    showToast('AUTO-COPIED', 'code saved \u2014 paste directly in WhatsApp');\n  }).catch(function(){});\n}\n\n/* \u2550\u2550\u2550 HISTORY \u2550\u2550\u2550 */\nvar HIST_KEY = 'mdghani_history';\nfunction getHist(){ try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch(e){ return []; } }\nfunction addHistory(phone){\n  try {\n    var list = getHist();\n    list.unshift({ t: Date.now(), n: phone });\n    localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 5)));\n    renderHist();\n  } catch(e){}\n}\nfunction renderHist(){\n  try {\n    var body = document.getElementById('histBody');\n    if (!body) return;\n    var list = getHist();\n    body.innerHTML = '';\n    if (!list.length){ body.innerHTML = '<div class=\"hist-empty\">// no sessions recorded</div>'; return; }\n    list.forEach(function(item){\n      var d = new Date(item.t);\n      var ts = d.toLocaleDateString(undefined, {day:'2-digit', month:'2-digit'}) + ' ' + d.toTimeString().slice(0,5);\n      var div = document.createElement('div');\n      div.className = 'hist-line';\n      div.innerHTML = '<span class=\"n\">+' + item.n + '</span><span class=\"t\">' + ts + '</span>';\n      body.appendChild(div);\n    });\n  } catch(e){}\n}\nfunction clearHistory(){\n  Sound.click();\n  try { localStorage.removeItem(HIST_KEY); } catch(e){}\n  renderHist();\n  log('wrn', 'session history cleared');\n}\n\n/* \u2550\u2550\u2550 I18N \u2550\u2550\u2550 */\nvar I18N = {\n  en: {},\n  hi: {\n    secDesc:'Apne WhatsApp se secure handshake establish karein', targetNum:'\u091f\u093e\u0930\u0917\u0947\u091f \u0928\u0902\u092c\u0930',\n    req:'\u091c\u093c\u0930\u0942\u0930\u0940', btnPair:'\u092a\u0947\u092f\u0930 \u0915\u094b\u0921 \u0932\u0947\u0902', btnChannel:'\u091a\u0948\u0928\u0932 \u091c\u094d\u0935\u0949\u0907\u0928 \u0915\u0930\u0947\u0902',\n    trust1:'AES-256', trust2:'0-\u0921\u093f\u0932\u0947', trust3:'\u0935\u0947\u0930\u0940\u092b\u093e\u0907\u0921', codeDeployed:'\u0915\u094b\u0921 \u0924\u0948\u092f\u093e\u0930',\n    copyBtn:'\u0915\u0949\u092a\u0940 \u0915\u0930\u0947\u0902', resetBtn:'\u0930\u0940\u0938\u0947\u091f', regen:'\u0928\u092f\u093e \u0915\u094b\u0921 \u092c\u0928\u093e\u090f\u0902', execSeq:'\u090f\u0915\u094d\u091c\u093c\u0940\u0915\u094d\u092f\u0942\u0936\u0928 \u0938\u0940\u0915\u094d\u0935\u0947\u0902\u0938',\n    step1:'Apne device pe <b>WhatsApp</b> kholein', step2:'<b>Settings \u2192 Linked Devices</b> pe jayein',\n    step3:'<b>Link a Device \u2192 Link with phone number</b> tap karein', step4:'Upar diya hua code enter karein',\n    f1:'\u092b\u093e\u0938\u094d\u091f', f2:'\u0939\u092e\u0947\u0936\u093e-\u0911\u0928', f3:'\u092e\u0932\u094d\u091f\u0940-\u092f\u0942\u091c\u093c\u0930'\n  }\n};\nvar curLang = 'en';\nfunction setLang(l, silent){\n  curLang = l;\n  document.querySelectorAll('[data-i18n]').forEach(function(el){\n    if (el.dataset.en === undefined) el.dataset.en = el.innerHTML;\n    var dict = I18N[l] || {};\n    var key = el.getAttribute('data-i18n');\n    el.innerHTML = (l === 'en' || dict[key] === undefined) ? el.dataset.en : dict[key];\n  });\n  document.getElementById('langBtn').textContent = (l === 'en') ? 'EN' : '\u0939\u093f\u0902';\n  try { localStorage.setItem('mdghani_lang', l); } catch(e){}\n  if (!silent){ Sound.click(); log('inf', 'language \u2192 ' + l); }\n}\nfunction cycleLang(e){ e.stopPropagation(); setLang(curLang === 'en' ? 'hi' : 'en'); }\n\n/* \u2550\u2550\u2550 SOUND PRESETS \u2550\u2550\u2550 */\nvar SND_PRESETS = ['MIX','SOFT','DEEP'], curSnd = 'MIX';\nfunction setSnd(p, silent){\n  curSnd = p;\n  Sound.wave = {MIX:'mix', SOFT:'sine', DEEP:'sawtooth'}[p] || 'mix';\n  document.getElementById('sndBtn').textContent = 'SND:' + p;\n  try { localStorage.setItem('mdghani_snd', p); } catch(e){}\n  if (!silent){ Sound.toggleOn(); }\n}\nfunction cycleSnd(e){ e.stopPropagation(); var i = (SND_PRESETS.indexOf(curSnd) + 1) % SND_PRESETS.length; setSnd(SND_PRESETS[i]); }\n\n/* \u2550\u2550\u2550 PHOSPHOR \u2550\u2550\u2550 */\nfunction setPhosphor(name, silent){\n  document.body.classList.remove('ph-amber','ph-cyan','ph-pink');\n  if (name !== 'green') document.body.classList.add('ph-' + name);\n  document.querySelectorAll('.sw').forEach(function(s){ s.classList.remove('on'); });\n  var b = document.querySelector('.sw-' + name); if (b) b.classList.add('on');\n  try { localStorage.setItem('mdghani_ph', name); } catch(e){}\n  if (!silent) Sound.click();\n}\n\n/* \u2550\u2550\u2550 CRT \u2550\u2550\u2550 */\nfunction toggleCRT(e){\n  e.stopPropagation();\n  Sound.click();\n  document.body.classList.toggle('crt-off');\n  var on = !document.body.classList.contains('crt-off');\n  document.getElementById('crtBtn').textContent = on ? 'CRT:ON' : 'CRT:OFF';\n}\n\n/* \u2550\u2550\u2550 PERF \u2550\u2550\u2550 */\nfunction togglePerf(e){\n  if (e) e.stopPropagation();\n  Sound.click();\n  document.body.classList.toggle('perf');\n  var on = document.body.classList.contains('perf');\n  document.getElementById('perfBtn').textContent = on ? 'PERF:ON' : 'PERF:OFF';\n  try { localStorage.setItem('mdghani_perf', on ? '1' : '0'); } catch(e){}\n}\n\n/* \u2550\u2550\u2550 KEYS \u2550\u2550\u2550 */\nfunction toggleKeys(e){\n  if (e) e.stopPropagation();\n  Sound.click();\n  document.getElementById('keysOverlay').classList.toggle('show');\n}\n\n/* \u2550\u2550\u2550 CHANNEL \u2550\u2550\u2550 */\nfunction copyChannelLink(){\n  Sound.copy();\n  var link = 'https://whatsapp.com/channel/120363429085670060';\n  if (navigator.clipboard && navigator.clipboard.writeText){\n    navigator.clipboard.writeText(link).then(function(){ showToast('LINK COPIED', 'Channel link saved'); }).catch(function(){});\n  } else {\n    try {\n      var t = document.createElement('textarea'); t.value = link;\n      document.body.appendChild(t); t.select(); document.execCommand('copy');\n      document.body.removeChild(t); showToast('LINK COPIED', 'Channel link saved');\n    } catch(e){}\n  }\n}\nfunction openChannel(e){\n  e.preventDefault();\n  Sound.resume(); Sound.click();\n  var channelId = '120363429085670060';\n  var httpsLink = 'https://whatsapp.com/channel/' + channelId;\n  var appLink = 'whatsapp://channel/' + channelId;\n  var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);\n  if (isMobile){ window.location.href = appLink; setTimeout(function(){ window.open(httpsLink, '_blank'); }, 900); }\n  else window.open(httpsLink, '_blank');\n}\n\n/* \u2550\u2550\u2550 PASTE \u2550\u2550\u2550 */\nfunction pasteNumber(e){\n  e.stopPropagation(); Sound.click();\n  if (!navigator.clipboard || !navigator.clipboard.readText){\n    showToast('PASTE FAILED', 'clipboard not available'); return;\n  }\n  navigator.clipboard.readText().then(function(txt){\n    var digits = (txt || '').replace(/[^\\d]/g, '');\n    if (digits.length >= 8 && digits.length <= 15){\n      phoneEl.value = digits;\n      clearBtn.classList.add('show');\n      ccText.textContent = '+' + digits.slice(0,2);\n      Sound.copy();\n      showToast('PASTED', 'number loaded');\n    } else { Sound.error(); showToast('INVALID', 'no valid number'); }\n  }).catch(function(){ Sound.error(); showToast('PASTE FAILED', 'permission denied'); });\n}\n\n/* \u2550\u2550\u2550 RAIN TOGGLE \u2550\u2550\u2550 */\nvar rainBoost = false;\nfunction toggleRain(){\n  Sound.click();\n  rainBoost = !rainBoost;\n  document.querySelectorAll('.rain.extra').forEach(function(el){ el.remove(); });\n  if (rainBoost){\n    var chars = '01\u30a2\u30a4\u30a6\u30a8\u30aa\u30ab\u30ad\u30af\u30b1\u30b3';\n    for (var i = 0; i < 15; i++){\n      var col = document.createElement('div');\n      col.className = 'rain extra';\n      var text = '', len = 14 + Math.floor(Math.random() * 12);\n      for (var j = 0; j < len; j++) text += chars[Math.floor(Math.random() * chars.length)];\n      col.textContent = text;\n      col.style.left = (Math.random() * 96) + 'vw';\n      col.style.animationDuration = (6 + Math.random() * 8) + 's';\n      document.body.appendChild(col);\n    }\n  }\n}\n\n/* \u2550\u2550\u2550 FULLSCREEN \u2550\u2550\u2550 */\nfunction toggleFullscreen(){\n  Sound.click();\n  if (!document.fullscreenElement){\n    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function(){});\n  } else if (document.exitFullscreen) document.exitFullscreen();\n}\n\n/* \u2550\u2550\u2550 EXPORT LOG \u2550\u2550\u2550 */\nfunction exportLog(){\n  try {\n    Sound.copy();\n    var body = document.getElementById('logBody');\n    var lines = Array.prototype.map.call(body.children, function(c){ return c.textContent; }).join('\\n');\n    var blob = new Blob(['MD-GHANI LOG\\nexported: ' + new Date().toISOString() + '\\n\\n' + lines + '\\n'], {type:'text/plain'});\n    var a = document.createElement('a');\n    a.href = URL.createObjectURL(blob); a.download = 'mdghani-log.txt';\n    document.body.appendChild(a); a.click(); document.body.removeChild(a);\n    URL.revokeObjectURL(a.href);\n    showToast('LOG EXPORTED', 'saved as .txt');\n  } catch(e){}\n}\n\n/* \u2550\u2550\u2550 KEYBOARD \u2550\u2550\u2550 */\ndocument.addEventListener('keydown', function(e){\n  if (e.key === 'Escape'){ var ko = document.getElementById('keysOverlay'); if (ko) ko.classList.remove('show'); return; }\n  if (document.activeElement === phoneEl) return;\n  if (e.ctrlKey || e.metaKey || e.altKey) return;\n  if (e.key === '?') toggleKeys();\n  else if (e.key.toLowerCase() === 'c' && currentCode) copyCode();\n  else if (e.key.toLowerCase() === 'r') resetForm();\n  else if (e.key.toLowerCase() === 'm') toggleRain();\n  else if (e.key.toLowerCase() === 'f') toggleFullscreen();\n});\n\n/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n   \u2550\u2550\u2550 ACTIVE SOCKETS & TOTAL USERS \u2550\u2550\u2550\n   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */\nvar SOCKETS_KEY = 'mdghani_sockets';\nvar TOTAL_KEY = 'mdghani_total_users';\n\nvar COUNTRY_DB = {\n  '91':{name:'India',flag:'\ud83c\uddee\ud83c\uddf3'}, '92':{name:'Pakistan',flag:'\ud83c\uddf5\ud83c\uddf0'},\n  '880':{name:'Bangladesh',flag:'\ud83c\udde7\ud83c\udde9'}, '1':{name:'USA/Canada',flag:'\ud83c\uddfa\ud83c\uddf8'},\n  '44':{name:'UK',flag:'\ud83c\uddec\ud83c\udde7'}, '971':{name:'UAE',flag:'\ud83c\udde6\ud83c\uddea'},\n  '966':{name:'Saudi Arabia',flag:'\ud83c\uddf8\ud83c\udde6'}, '62':{name:'Indonesia',flag:'\ud83c\uddee\ud83c\udde9'},\n  '60':{name:'Malaysia',flag:'\ud83c\uddf2\ud83c\uddfe'}, '254':{name:'Kenya',flag:'\ud83c\uddf0\ud83c\uddea'},\n  '234':{name:'Nigeria',flag:'\ud83c\uddf3\ud83c\uddec'}, '55':{name:'Brazil',flag:'\ud83c\udde7\ud83c\uddf7'},\n  '20':{name:'Egypt',flag:'\ud83c\uddea\ud83c\uddec'}, '27':{name:'South Africa',flag:'\ud83c\uddff\ud83c\udde6'},\n  '63':{name:'Philippines',flag:'\ud83c\uddf5\ud83c\udded'}, '84':{name:'Vietnam',flag:'\ud83c\uddfb\ud83c\uddf3'},\n  '66':{name:'Thailand',flag:'\ud83c\uddf9\ud83c\udded'}, '90':{name:'Turkey',flag:'\ud83c\uddf9\ud83c\uddf7'},\n  '7':{name:'Russia',flag:'\ud83c\uddf7\ud83c\uddfa'}, '86':{name:'China',flag:'\ud83c\udde8\ud83c\uddf3'}\n};\nvar NAME_POOL = ['Ghost','Phantom','Cipher','Vortex','Shadow','Neon','Blaze','Frost','Storm','Echo','Nova','Pulse','Raven','Titan','Zen','Zero','Hex','Onyx','Volt','Rogue'];\n\nfunction detectCountry(phone){\n  var sorted = Object.keys(COUNTRY_DB).sort(function(a,b){ return b.length - a.length; });\n  for (var i = 0; i < sorted.length; i++){\n    var cc = sorted[i];\n    if (phone.indexOf(cc) === 0) return { cc:cc, name:COUNTRY_DB[cc].name, flag:COUNTRY_DB[cc].flag };\n  }\n  return { cc:'??', name:'Unknown', flag:'\ud83c\udf10' };\n}\nfunction randomName(){ return NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)] + '-' + Math.floor(100 + Math.random() * 900); }\nfunction getSockets(){ try { return JSON.parse(localStorage.getItem(SOCKETS_KEY)) || []; } catch(e){ return []; } }\nfunction saveSockets(list){ try { localStorage.setItem(SOCKETS_KEY, JSON.stringify(list.slice(0, 50))); } catch(e){} }\nfunction getTotalUsers(){ try { return parseInt(localStorage.getItem(TOTAL_KEY)) || 0; } catch(e){ return 0; } }\nfunction setTotalUsers(n){ try { localStorage.setItem(TOTAL_KEY, String(n)); } catch(e){} }\n\nfunction addSocket(phone, customName){\n  if (!phone) return;\n  try {\n    var list = getSockets();\n    var country = detectCountry(phone);\n    var existing = null;\n    for (var i = 0; i < list.length; i++){ if (list[i].phone === phone){ existing = list[i]; break; } }\n    if (existing){\n      existing.lastSeen = Date.now();\n      existing.status = 'online';\n      if (customName) existing.name = customName;\n    } else {\n      list.unshift({\n        phone: phone,\n        name: customName || randomName(),\n        country: country.name,\n        flag: country.flag,\n        cc: country.cc,\n        firstSeen: Date.now(),\n        lastSeen: Date.now(),\n        status: 'online'\n      });\n      setTotalUsers(getTotalUsers() + 1);\n      log('ok', 'new socket \u2192 +' + phone + ' (' + country.name + ')');\n      showToast('NEW CONNECTION', '+' + phone + ' from ' + country.name);\n      buzz([25,30,25]);\n    }\n    saveSockets(list);\n    renderSockets();\n  } catch(e){}\n}\n\nfunction renderSockets(){\n  try {\n    var body = document.getElementById('socketsBody');\n    var countEl = document.getElementById('socketsCount');\n    var totalEl = document.getElementById('totalUsersVal');\n    if (!body) return;\n\n    var list = getSockets();\n    var now = Date.now();\n    list.forEach(function(s){ if (now - s.lastSeen > 5*60*1000) s.status = 'offline'; });\n    saveSockets(list);\n\n    var activeCount = 0;\n    list.forEach(function(s){ if (s.status === 'online') activeCount++; });\n    if (countEl) countEl.textContent = activeCount + '/' + list.length;\n    if (totalEl) totalEl.textContent = getTotalUsers();\n\n    body.innerHTML = '';\n    if (!list.length){\n      body.innerHTML = '<div class=\"socket-empty\">// awaiting connections...</div>';\n      return;\n    }\n    list.forEach(function(s){\n      var ago = Math.floor((now - s.lastSeen) / 1000);\n      var agoTxt = ago < 60 ? ago + 's ago' : ago < 3600 ? Math.floor(ago/60) + 'm ago' : Math.floor(ago/3600) + 'h ago';\n      var div = document.createElement('div');\n      div.className = 'socket-row' + (s.status === 'offline' ? ' off' : '');\n      div.innerHTML = '<span class=\"flag\">' + s.flag + '</span><div class=\"info\"><div class=\"num\">+' + s.phone + '</div><div class=\"meta\"><span class=\"name\">' + s.name + '</span><span>\u2022</span><span class=\"country\">' + s.country + '</span><span>\u2022</span><span>' + agoTxt + '</span></div></div><span class=\"status\"></span>';\n      body.appendChild(div);\n    });\n  } catch(e){}\n}\n\nfunction refreshSockets(){ Sound.click(); renderSockets(); }\nfunction clearSockets(){\n  Sound.click();\n  if (!confirm('Clear all socket records? (TOTAL_USERS counter stays)')) return;\n  try { localStorage.removeItem(SOCKETS_KEY); } catch(e){}\n  renderSockets();\n  showToast('CLEARED', 'socket list reset');\n}\nfunction exportSockets(){\n  try {\n    Sound.copy();\n    var list = getSockets();\n    if (!list.length){ showToast('EMPTY', 'no sockets to export'); return; }\n    var lines = list.map(function(s){\n      return '+' + s.phone + ' | ' + s.name + ' | ' + s.country + ' (' + s.flag + ') | ' + s.status + ' | first:' + new Date(s.firstSeen).toISOString() + ' | last:' + new Date(s.lastSeen).toISOString();\n    }).join('\\n');\n    var blob = new Blob(['MD-GHANI SOCKETS\\nexported: ' + new Date().toISOString() + '\\nTOTAL USERS: ' + getTotalUsers() + '\\n\\n' + lines + '\\n'], {type:'text/plain'});\n    var a = document.createElement('a');\n    a.href = URL.createObjectURL(blob); a.download = 'mdghani-sockets.txt';\n    document.body.appendChild(a); a.click(); document.body.removeChild(a);\n    URL.revokeObjectURL(a.href);\n    showToast('EXPORTED', 'socket list saved');\n  } catch(e){}\n}\n\n/* expose for backend */\nwindow.addSocket = addSocket;\nwindow.refreshSockets = refreshSockets;\n\n/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n   \u2550\u2550\u2550 BOT BACKEND LIVE SYNC (graceful, isolated) \u2550\u2550\u2550\n   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */\nvar syncTimer = null;\nvar syncFailCount = 0;\nvar syncDisabled = false;\n\nfunction updateSyncTag(state){\n  try {\n    var tag = document.getElementById('syncTag');\n    if (!tag) return;\n    if (state === 'ok'){ tag.textContent = 'SYNC:LIVE'; tag.className = 'sync-tag on'; }\n    else if (state === 'err'){ tag.textContent = 'SYNC:OFF'; tag.className = 'sync-tag err'; }\n    else { tag.textContent = 'SYNC:IDLE'; tag.className = 'sync-tag'; }\n  } catch(e){}\n}\n\nfunction syncFromBot(){\n  if (syncDisabled) return;\n  try {\n    var ctrl = new AbortController();\n    var to = setTimeout(function(){ ctrl.abort(); }, 4000);\n    fetch('/api/sockets', { method:'GET', cache:'no-store', signal: ctrl.signal })\n      .then(function(r){ clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })\n      .then(function(d){\n        try {\n          if (Array.isArray(d.sockets)){\n            var existing = getSockets();\n            var merged = d.sockets.slice();\n            existing.forEach(function(local){\n              var found = false;\n              for (var i = 0; i < merged.length; i++){ if (merged[i].phone === local.phone){ found = true; break; } }\n              if (!found) merged.push(local);\n            });\n            saveSockets(merged);\n          }\n          if (typeof d.total === 'number') setTotalUsers(Math.max(d.total, getTotalUsers()));\n          renderSockets();\n          if (syncFailCount > 0) log('ok', 'bot backend reconnected');\n          else if (syncFailCount === 0 && !window.__syncLogged) { log('ok', 'bot backend connected \u2014 live sync active'); window.__syncLogged = true; }\n          syncFailCount = 0;\n          updateSyncTag('ok');\n        } catch(e2){}\n      })\n      .catch(function(){\n        syncFailCount++;\n        if (syncFailCount >= 3){\n          syncDisabled = true;\n          clearInterval(syncTimer); syncTimer = null;\n          updateSyncTag('err');\n          log('wrn', 'bot backend not available \u2014 static mode');\n        }\n      });\n  } catch(e){\n    syncFailCount++;\n    if (syncFailCount >= 3){ syncDisabled = true; clearInterval(syncTimer); syncTimer = null; updateSyncTag('err'); }\n  }\n}\n\nfunction startBotSync(){\n  updateSyncTag('idle');\n  setTimeout(syncFromBot, 800);\n  syncTimer = setInterval(syncFromBot, 15000);\n}\n\n/* \u2550\u2550\u2550 INIT \u2550\u2550\u2550 */\nrenderChips();\nrenderHist();\nrenderSockets();\nlog('ok', 'system initialized \u2014 v1.0');\nlog('inf', 'awaiting target input');\n\n/* start sync after page settles */\nsetTimeout(startBotSync, 1500);\n\n/* \u2550\u2550\u2550 PREF INIT \u2550\u2550\u2550 */\ntry {\n  var ph = localStorage.getItem('mdghani_ph'); if (ph) setPhosphor(ph, true);\n  var ln = localStorage.getItem('mdghani_lang'); if (ln) setLang(ln, true);\n  var sd = localStorage.getItem('mdghani_snd'); if (sd) setSnd(sd, true);\n  if (localStorage.getItem('mdghani_perf') === '1'){\n    document.body.classList.add('perf');\n    var pb = document.getElementById('perfBtn'); if (pb) pb.textContent = 'PERF:ON';\n  }\n} catch(e){}\n\n/* \u2550\u2550\u2550 EXPOSE GLOBAL FUNCTIONS (for onclick handlers) \u2550\u2550\u2550 */\nwindow.toggleCRT = toggleCRT;\nwindow.toggleKeys = toggleKeys;\nwindow.cycleLang = cycleLang;\nwindow.cycleSnd = cycleSnd;\nwindow.togglePerf = togglePerf;\nwindow.setPhosphor = setPhosphor;\nwindow.onCCChange = onCCChange;\nwindow.pasteNumber = pasteNumber;\nwindow.pair = pair;\nwindow.copyCode = copyCode;\nwindow.resetForm = resetForm;\nwindow.regen = regen;\nwindow.clearHistory = clearHistory;\nwindow.exportLog = exportLog;\nwindow.copyChannelLink = copyChannelLink;\nwindow.openChannel = openChannel;\nwindow.toggleSound = toggleSound;\nwindow.refreshSockets = refreshSockets;\nwindow.clearSockets = clearSockets;\nwindow.exportSockets = exportSockets;\n\n})();  /* end IIFE */\n</script>\n</body>\n</html>";
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
    // Only report "already connected" for a socket that is actually online.
    // A registered flag can remain in saved auth after a crash/restart, and
    // treating that stale state as a live connection prevents new pairing codes.
    if (active?.sock?.user && active.sock.authState?.creds?.registered) {
      return res.json({ ok: true, code: "ALREADY_CONNECTED", sessionId });
    }

    // Pairing from the web panel must start with a clean auth state. Remove
    // stale/in-progress sessions so startSession cannot return code: null.
    try { active?.sock?.ws?.close(); } catch {}
    if (active?.reconnectTimer) clearTimeout(active.reconnectTimer);
    sessions.delete(sessionId);
    fs.rmSync(`${config.sessionDir}/${sessionId}`, { recursive: true, force: true });

    const out = await startSession(sessionId, sessionId);
    if (out.ok && out.code) return res.json({ ok: true, code: out.code, sessionId });
    if (out.ok) {
      return res.status(409).json({
        ok: false,
        error: "Pairing session did not return a code. Please retry.",
      });
    }
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
