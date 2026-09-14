import { register } from "./_registry.js";
import axios from "axios";

const mk = (n, fn) => register(n, { toggle: null, run: fn });

mk("ytmp4", async ({ sock, from, args }) => {
  if (!args[0]) return;
  const { data } = await axios.get(`https://api.akuari.my.id/downloader/youtube?link=${args[0]}`);
  await sock.sendMessage(from, { video: { url: data?.result?.video }, caption: "🎬 MD-Ghani-Bot" });
});

mk("ytmp3", async ({ sock, from, args }) => {
  if (!args[0]) return;
  const { data } = await axios.get(`https://api.akuari.my.id/downloader/youtube?link=${args[0]}`);
  await sock.sendMessage(from, { audio: { url: data?.result?.mp3 }, mimetype: "audio/mpeg" });
});

mk("song", async ({ sock, from, args }) => {
  const q = args.join(" ");
  if (!q) return;
  const { data } = await axios.get(`https://api.akuari.my.id/search/youtube?query=${encodeURIComponent(q)}`);
  const vid = data?.result?.[0]?.url;
  if (!vid) return;
  const { data: dl } = await axios.get(`https://api.akuari.my.id/downloader/youtube?link=${vid}`);
  await sock.sendMessage(from, { audio: { url: dl.result.mp3 }, mimetype: "audio/mpeg" });
});

mk("song2", async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("song").run(p);
});

mk("play", async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("song").run(p);
});

mk("video", async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("ytmp4").run(p);
});

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