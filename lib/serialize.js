export function serialize(sock, msg) {
  if (!msg.message) return null;
  const m = msg.message;
  const type = Object.keys(m)[0];
  const content =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    "";
  return {
    key: msg.key,
    from: msg.key.remoteJid,
    sender: msg.key.participant || msg.key.remoteJid,
    isGroup: msg.key.remoteJid?.endsWith("@g.us"),
    type,
    text: content,
    msg,
    raw: m,
  };
}