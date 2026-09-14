import { config } from "../config.js";

export async function runAuto(sock, msg, sessionId, toggles) {
  const from = msg.key.remoteJid;

  if (toggles.autoseen) sock.readMessages([msg.key]).catch(()=>{});
  if (toggles.autotyping && !msg.key.fromMe) {
    sock.sendPresenceUpdate("composing", from).catch(()=>{});
    setTimeout(()=>sock.sendPresenceUpdate("paused", from).catch(()=>{}), 1500);
  }
  if (toggles.autorecording && !msg.key.fromMe) {
    sock.sendPresenceUpdate("recording", from).catch(()=>{});
    setTimeout(()=>sock.sendPresenceUpdate("paused", from).catch(()=>{}), 1500);
  }
  if (toggles.autoreact && !msg.key.fromMe) {
    const emojis = ["❤️","🔥","👍","😍","💯","⚡","✨","🎯"];
    const e = emojis[Math.floor(Math.random()*emojis.length)];
    sock.sendMessage(from, { react: { text: e, key: msg.key } }).catch(()=>{});
  }
  if (toggles.autosavestatus && from === "status@broadcast") {
    // save status logic
  }
  if (toggles.autoviewstatus && from === "status@broadcast") {
    sock.readMessages([msg.key]).catch(()=>{});
  }
  if (toggles.autoreactstatus && from === "status@broadcast") {
    sock.sendMessage("status@broadcast", {
      react: { text: "❤️", key: msg.key }
    }, { statusJidList: [msg.key.participant] }).catch(()=>{});
  }
}