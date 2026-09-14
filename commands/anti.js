/* ============================================================
 *  MD-Ghani-Bot — Anti Commands (All toggleable)
 * ============================================================ */
import { register } from "./_registry.js";
import { setToggle, getToggles } from "../lib/toggle.js";

const ANTI_LIST = [
  "antibadword", "antibot", "antibug", "anticontact", "antidelete", "antidemote",
  "antipromote", "antidocument", "antiedit", "antiforward", "antigif", "antiimage",
  "antilink", "antilocation", "antimessage", "antipoll", "antistatus", "antisticker",
  "antitag", "antitagadmin", "antivideo", "antivoice", "antistatuslinkkick",
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
      await sock.sendMessage(from, {
        text: ok
          ? `✅ *${name}* = ${args[0].toUpperCase()}`
          : `❌ Unknown toggle: ${name}`,
      });
    },
  });
}

/* -------- Alias: autostatuslinkkick -------- */
register("autostatuslinkkick", {
  toggle: null,
  run: async ({ sock, from, args, sessionId }) => {
    if (!args[0]) {
      const t = getToggles(sessionId);
      return sock.sendMessage(from, {
        text: `📌 autostatuslinkkick = ${t.antistatuslinkkick ? "ON" : "OFF"}`,
      });
    }
    setToggle(sessionId, "antistatuslinkkick", args[0]);
    await sock.sendMessage(from, { text: `✅ autostatuslinkkick set` });
  },
});

/* -------- Generic toggle setter -------- */
register("set", {
  toggle: null,
  run: async ({ sock, from, args, sessionId }) => {
    if (args.length < 2)
      return sock.sendMessage(from, { text: "Usage: .set <key> on/off" });
    const ok = setToggle(sessionId, args[0], args[1]);
    await sock.sendMessage(from, {
      text: ok
        ? `✅ ${args[0]} = ${args[1]}`
        : `❌ Unknown key: ${args[0]}`,
    });
  },
});

/* -------- Story link kick -------- */
register("statuslink", {
  toggle: null,
  run: async ({ sock, from, args }) => {
    const link = args[0];
    if (!link) return;
    await sock.sendMessage(
      "status@broadcast",
      { text: `🔗 Check this: ${link}` },
      { statusJidList: [from] }
    );
    await sock.sendMessage(from, { text: "✅ Story with link posted" });
  },
});

/* -------- Status / Story post -------- */
register("statuspost", {
  toggle: null,
  run: async ({ sock, from, args }) => {
    const text = args.join(" ");
    if (!text)
      return sock.sendMessage(from, { text: "Usage: .statuspost <text>" });
    try {
      const md = await sock.groupMetadata(from);
      const statusJidList = [from, ...md.participants.map((p) => p.id)];
      await sock.sendMessage(
        "status@broadcast",
        { text, backgroundColor: "#7c5cff", font: 3 },
        { statusJidList }
      );
      await sock.sendMessage(from, { text: "✅ Story posted" });
    } catch {
      await sock.sendMessage(from, { text: "❌ Failed to post story" });
    }
  },
});

register("gcstatus", {
  toggle: null,
  run: async (p) => {
    const { commands } = await import("./index.js");
    await commands.get("statuspost").run(p);
  },
});