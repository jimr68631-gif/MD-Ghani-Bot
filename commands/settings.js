import { register } from "./_registry.js";

const store = {};

register("setwelcome", { toggle: null, run: async ({ sock, from, args }) => {
  store.welcome = args.join(" ");
  await sock.sendMessage(from, { text: `✅ Welcome set: ${store.welcome}` });
}});

register("setgoodbye", { toggle: null, run: async ({ sock, from, args }) => {
  store.goodbye = args.join(" ");
  await sock.sendMessage(from, { text: `✅ Goodbye set: ${store.goodbye}` });
}});

register("setprefix", { toggle: null, run: async ({ sock, from, args }) => {
  await sock.sendMessage(from, { text: `✅ Prefix set: ${args[0]}` });
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

register("getid", { toggle: null, run: async ({ sock, from, msg }) => {
  const t = msg.message?.extendedTextMessage?.contextInfo?.participant || from;
  await sock.sendMessage(from, { text: `🆔 ${t}` });
}});

register("dp", { toggle: null, run: async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("getdp").run(p);
}});

register("profile", { toggle: null, run: async ({ sock, from }) => {
  await sock.sendMessage(from, { text: `👤 ${from}` });
}});

register("setgrouppp", { toggle: null, run: async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.updateProfilePicture(from, buf);
  await sock.sendMessage(from, { text: "✅ Group PP updated" });
}});

register("opentime", { toggle: null, run: async ({ sock, from, args }) => {
  await sock.sendMessage(from, { text: `⏰ Group open time: ${args.join(" ")}` });
}});

register("hidetag", { toggle: null, run: async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  await sock.sendMessage(from, { text: args.join(" ") || " ", mentions: md.participants.map(p=>p.id) });
}});