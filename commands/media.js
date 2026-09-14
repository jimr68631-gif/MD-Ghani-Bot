/* ============================================================
 *  MD-Ghani-Bot — Media Commands
 * ============================================================ */
import { register } from "./_registry.js";
import sharp from "sharp";
import axios from "axios";

const mk = (n, fn) => register(n, { toggle: null, run: fn });

/* -------- Sticker -------- */
mk("sticker", async ({ sock, from, msg }) => {
  const media = msg.message?.imageMessage || msg.message?.videoMessage;
  if (!media) return;
  const buf = await sock.downloadMediaMessage(msg);
  const webp = await sharp(buf).webp().toBuffer();
  await sock.sendMessage(from, { sticker: webp });
});

mk("tosticker", async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("sticker").run(p);
});

/* -------- GIF -------- */
mk("togif", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.sendMessage(from, { video: buf, gifPlayback: true });
});

/* -------- To Image -------- */
mk("toimg", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  const png = await sharp(buf).png().toBuffer();
  await sock.sendMessage(from, { image: png });
});

mk("sticker2img", async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("toimg").run(p);
});

/* -------- To Audio -------- */
mk("toaudio", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.sendMessage(from, { audio: buf, mimetype: "audio/mpeg" });
});

/* -------- To PDF -------- */
mk("topdf", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  await sock.sendMessage(from, {
    document: buf,
    mimetype: "application/pdf",
    fileName: "file.pdf",
  });
});

/* -------- View Once -------- */
mk("vv", async ({ sock, from, msg }) => {
  const ctx = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!ctx) return;
  const viewOnce = ctx.viewOnceMessageV2 || ctx.viewOnceMessage;
  if (!viewOnce) return;
  await sock.sendMessage(from, viewOnce.message);
});

/* -------- Blur / Crop -------- */
mk("blur", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  const blurred = await sharp(buf).blur(15).toBuffer();
  await sock.sendMessage(from, { image: blurred });
});

mk("crop", async ({ sock, from, msg }) => {
  const buf = await sock.downloadMediaMessage(msg);
  const cropped = await sharp(buf).resize(500, 500, { fit: "cover" }).toBuffer();
  await sock.sendMessage(from, { image: cropped });
});

/* -------- Setfont -------- */
mk("setfont", async ({ sock, from, args }) => {
  const t = args.join(" ");
  await sock.sendMessage(from, {
    text: `*${t}*\n_${t}_\n~${t}~\n\`\`\`${t}\`\`\``,
  });
});

/* -------- TTS -------- */
mk("tts", async ({ sock, from, args }) => {
  const text = args.join(" ");
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
  await sock.sendMessage(from, { audio: { url }, mimetype: "audio/mpeg" });
});

/* ============================================================
 *  Downloads
 * ============================================================ */
mk("ytmp4", async ({ sock, from, args }) => {
  if (!args[0]) return;
  const { data } = await axios.get(
    `https://api.akuari.my.id/downloader/youtube?link=${args[0]}`
  );
  await sock.sendMessage(from, {
    video: { url: data?.result?.video },
    caption: "🎬 MD-Ghani-Bot",
  });
});

mk("ytmp3", async ({ sock, from, args }) => {
  if (!args[0]) return;
  const { data } = await axios.get(
    `https://api.akuari.my.id/downloader/youtube?link=${args[0]}`
  );
  await sock.sendMessage(from, {
    audio: { url: data?.result?.mp3 },
    mimetype: "audio/mpeg",
  });
});

mk("song", async ({ sock, from, args }) => {
  const q = args.join(" ");
  if (!q) return;
  const { data } = await axios.get(
    `https://api.akuari.my.id/search/youtube?query=${encodeURIComponent(q)}`
  );
  const vid = data?.result?.[0]?.url;
  if (!vid) return;
  const { data: dl } = await axios.get(
    `https://api.akuari.my.id/downloader/youtube?link=${vid}`
  );
  await sock.sendMessage(from, {
    audio: { url: dl.result.mp3 },
    mimetype: "audio/mpeg",
  });
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
  const { data } = await axios.get(
    `https://api.akuari.my.id/downloader/tiktok?link=${args[0]}`
  );
  await sock.sendMessage(from, {
    video: { url: data?.result?.video },
    caption: "🎵 TikTok",
  });
});

mk("spotify", async ({ sock, from, args }) => {
  if (!args[0]) return;
  const { data } = await axios.get(
    `https://api.akuari.my.id/downloader/spotify?link=${args[0]}`
  );
  await sock.sendMessage(from, {
    audio: { url: data?.result?.audio },
    mimetype: "audio/mpeg",
  });
});

mk("pinterest", async ({ sock, from, args }) => {
  const q = args.join(" ");
  const { data } = await axios.get(
    `https://api.akuari.my.id/search/pinterest?query=${encodeURIComponent(q)}`
  );
  await sock.sendMessage(from, {
    image: { url: data?.result?.[0] },
    caption: "📌 Pinterest",
  });
});

mk("itune", async ({ sock, from, args }) => {
  const q = args.join(" ");
  const { data } = await axios.get(
    `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&limit=1`
  );
  const t = data?.results?.[0];
  if (t)
    await sock.sendMessage(from, {
      text: `🎵 *${t.trackName}*\n👤 ${t.artistName}\n🔗 ${t.trackViewUrl}`,
    });
});

mk("facebook", async ({ sock, from, args }) => {
  const { data } = await axios.get(
    `https://api.akuari.my.id/downloader/fb?link=${args[0]}`
  );
  await sock.sendMessage(from, {
    video: { url: data?.result?.url },
    caption: "📘 Facebook",
  });
});

mk("twitter", async ({ sock, from, args }) => {
  const { data } = await axios.get(
    `https://api.akuari.my.id/downloader/twitter?link=${args[0]}`
  );
  await sock.sendMessage(from, {
    video: { url: data?.result?.url },
    caption: "🐦 Twitter",
  });
});

mk("instagram", async ({ sock, from, args }) => {
  const { data } = await axios.get(
    `https://api.akuari.my.id/downloader/ig?link=${args[0]}`
  );
  await sock.sendMessage(from, {
    video: { url: data?.result?.[0]?.url },
    caption: "📷 Instagram",
  });
});