import { config } from "../config.js";

const LINK_RE = /(https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/|t\.me\/)/i;
const BAD_WORDS = ["madarchod","bhenchod","bhosdi","gandu","chutiya","randi","loda","lund"];

export async function runAnti(sock, msg, sessionId, toggles) {
  const from = msg.key.remoteJid;
  if (!from?.endsWith("@g.us")) return;

  const sender = msg.key.participant || from;
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || "";

  const isBot = msg.key.fromMe;
  const isAdmin = await isUserAdmin(sock, from, sender);
  if (isBot || isAdmin) return;

  const checks = [
    ["antilink",       () => LINK_RE.test(text)],
    ["antibadword",    () => BAD_WORDS.some(w => text.toLowerCase().includes(w))],
    ["antisticker",    () => !!msg.message?.stickerMessage],
    ["antiimage",      () => !!msg.message?.imageMessage],
    ["antivideo",      () => !!msg.message?.videoMessage],
    ["antiaudio",      () => !!msg.message?.audioMessage],
    ["antivoice",      () => !!msg.message?.audioMessage?.ptt],
    ["antidocument",   () => !!msg.message?.documentMessage],
    ["antigif",        () => !!msg.message?.videoMessage?.gifPlayback],
    ["antilocation",   () => !!msg.message?.locationMessage],
    ["anticontact",    () => !!msg.message?.contactMessage],
    ["antipoll",       () => !!msg.message?.pollCreationMessage],
    ["antiforward",    () => !!msg.message?.extendedTextMessage?.contextInfo?.forwardingScore],
    ["antiviewonce",   () => !!(msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2)],
    ["antistatus",     () => from === "status@broadcast"],
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
    await sock.sendMessage(group, { delete: msg.key });
    await sock.sendMessage(group, {
      text: `⚠️ @${user.split("@")[0]} — *${key.toUpperCase()}* violation!`,
      mentions: [user],
    });
    await sock.groupParticipantsUpdate(group, [user], "remove");
  } catch (e) { console.log("anti err:", e.message); }
}

async function isUserAdmin(sock, group, user) {
  try {
    const md = await sock.groupMetadata(group);
    return md.participants.find(p => p.id === user)?.admin != null;
  } catch { return false; }
}