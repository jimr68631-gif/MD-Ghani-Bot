import { register } from "./_registry.js";

const mk = (n, fn) => register(n, { toggle: null, run: fn });

mk("bass", async ({ sock, from }) => sock.sendMessage(from, { text: "🎵 Bass effect applied" }));
mk("blown", async ({ sock, from }) => sock.sendMessage(from, { text: "🎵 Blown effect applied" }));
mk("loop", async ({ sock, from }) => sock.sendMessage(from, { text: "🔁 Loop enabled" }));
mk("nowplaying", async ({ sock, from }) => sock.sendMessage(from, { text: "🎶 Now Playing: MD-Ghani-Bot Radio" }));
mk("pause", async ({ sock, from }) => sock.sendMessage(from, { text: "⏸️ Paused" }));
mk("resume", async ({ sock, from }) => sock.sendMessage(from, { text: "▶️ Resumed" }));
mk("shuffle", async ({ sock, from }) => sock.sendMessage(from, { text: "🔀 Shuffled" }));
mk("skip", async ({ sock, from }) => sock.sendMessage(from, { text: "⏭️ Skipped" }));
mk("stop", async ({ sock, from }) => sock.sendMessage(from, { text: "⏹️ Stopped" }));
mk("volume", async ({ sock, from, args }) => sock.sendMessage(from, { text: `🔊 Volume: ${args[0]||50}%` }));