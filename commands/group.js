/* ============================================================
 *  MD-Ghani-Bot — Group Commands
 * ============================================================ */
import { register } from "./_registry.js";

const mk = (n, fn) => register(n, { toggle: null, run: fn });

/* -------- Kick / Promote / Demote -------- */
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

/* -------- Bulk Actions -------- */
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

/* -------- Tagging -------- */
mk("tagall", async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  const txt = args.join(" ") || "📢 Attention";
  const mentions = md.participants.map((p) => p.id);
  await sock.sendMessage(from, {
    text: `*${txt}*\n\n${mentions.map((m) => `@${m.split("@")[0]}`).join(" ")}`,
    mentions,
  });
});

mk("hidetag", async ({ sock, from, args }) => {
  const md = await sock.groupMetadata(from);
  await sock.sendMessage(from, {
    text: args.join(" ") || " ",
    mentions: md.participants.map((p) => p.id),
  });
});

mk("tagme", async ({ sock, from }) => {
  await sock.sendMessage(from, {
    text: `@${from.split("@")[0]}`,
    mentions: [from],
  });
});

mk("mention", async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("tagall").run(p);
});

/* -------- Open / Close -------- */
mk("open", async ({ sock, from }) =>
  sock.groupSettingUpdate(from, "not_announcement"));
mk("close", async ({ sock, from }) =>
  sock.groupSettingUpdate(from, "announcement"));

/* -------- Info -------- */
mk("groupinfo", async ({ sock, from }) => {
  const md = await sock.groupMetadata(from);
  const admins = md.participants
    .filter((p) => p.admin)
    .map((p) => `@${p.id.split("@")[0]}`)
    .join(", ");
  await sock.sendMessage(from, {
    text: `📛 *${md.subject}*\n🆔 ${md.id}\n👥 Members: ${md.participants.length}\n👑 Admins: ${admins || "None"}\n📝 ${md.desc?.toString() || "No description"}`,
    mentions: md.participants.map((p) => p.id),
  });
});

mk("totalmembers", async ({ sock, from }) => {
  const md = await sock.groupMetadata(from);
  await sock.sendMessage(from, { text: `👥 Total: *${md.participants.length}*` });
});

/* -------- Lists -------- */
mk("listonline", async ({ sock, from }) =>
  sock.sendMessage(from, { text: "🟢 List feature active" }));
mk("listoffline", async ({ sock, from }) =>
  sock.sendMessage(from, { text: "⚫ List feature active" }));
mk("listblocked", async ({ sock, from }) => {
  const bl = await sock.fetchBlocklist();
  await sock.sendMessage(from, {
    text: `🚫 Blocked: ${bl.length}\n${bl.map((b) => b.split("@")[0]).join(", ")}`,
  });
});
mk("listinactive", async ({ sock, from }) =>
  sock.sendMessage(from, { text: "📋 Inactive list" }));
mk("listrequest", async ({ sock, from }) =>
  sock.sendMessage(from, { text: "📥 Pending requests" }));

/* -------- Group PP -------- */
mk("delgrouppp", async ({ sock, from }) => {
  await sock.removeProfilePicture(from);
  await sock.sendMessage(from, { text: "🗑️ Group PP deleted" });
});

mk("setgrouppp", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.updateProfilePicture(from, buf);
  await sock.sendMessage(from, { text: "✅ Group PP updated" });
});

/* -------- Leave -------- */
mk("leave", async ({ sock, from }) => sock.groupLeave(from));

/* -------- Set Name / Desc -------- */
mk("setname", async ({ sock, from, args }) =>
  sock.groupUpdateSubject(from, args.join(" ")));
mk("setdesc", async ({ sock, from, args }) =>
  sock.groupUpdateDescription(from, args.join(" ")));