import { register } from "./_registry.js";

register("statuspost", {
  toggle: null,
  run: async ({ sock, from, args }) => {
    const text = args.join(" ");
    if (!text) return sock.sendMessage(from, { text: "Usage: .statuspost <text>" });
    await sock.sendMessage("status@broadcast", {
      text,
      backgroundColor: "#7c5cff",
      font: 3
    }, { statusJidList: [from, ...(await sock.groupMetadata(from).then(m=>m.participants.map(p=>p.id)))] });
    await sock.sendMessage(from, { text: "✅ Story posted" });
  }
});

register("gcstatus", {
  toggle: null,
  run: async (p) => {
    const { commands } = await import("./index.js");
    await commands.get("statuspost").run(p);
  }
});

register("statuslink", {
  toggle: null,
  run: async ({ sock, from, args }) => {
    const link = args[0];
    if (!link) return;
    await sock.sendMessage("status@broadcast", {
      text: `🔗 Check this: ${link}`,
    }, { statusJidList: [from] });
    await sock.sendMessage(from, { text: "✅ Story with link posted" });
  }
});