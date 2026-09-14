import { register } from "./_registry.js";
import axios from "axios";
import os from "os";

const mk = (n, fn) => register(n, { toggle: null, run: fn });

mk("time", async ({ sock, from }) =>
  sock.sendMessage(from, { text: `🕐 ${new Date().toLocaleString("en-PK", { timeZone: "Asia/Karachi" })}` }));

mk("date", async ({ sock, from }) =>
  sock.sendMessage(from, { text: `📅 ${new Date().toDateString()}` }));

mk("uptime", async ({ sock, from }) => {
  const u = process.uptime();
  const h = Math.floor(u/3600), m = Math.floor((u%3600)/60), s = Math.floor(u%60);
  await sock.sendMessage(from, { text: `⏱️ Uptime: *${h}h ${m}m ${s}s*` });
});

mk("runtime", async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("uptime").run(p);
});

mk("ping", async ({ sock, from }) => {
  const t = Date.now();
  const m = await sock.sendMessage(from, { text: "🏓 Pinging..." });
  await sock.sendMessage(from, { text: `🏓 Pong! *${Date.now()-t}ms*`, edit: m.key });
});

mk("speedtest", async ({ sock, from }) => {
  const t = Date.now();
  await axios.get("https://www.google.com");
  await sock.sendMessage(from, { text: `⚡ Latency: ${Date.now()-t}ms` });
});

mk("serverinfo", async ({ sock, from }) => {
  await sock.sendMessage(from, {
    text: `🖥️ *Server Info*\nOS: ${os.platform()}\nCPU: ${os.cpus()[0].model}\nRAM: ${(os.totalmem()/1e9).toFixed(1)}GB\nNode: ${process.version}`
  });
});

mk("ipinfo", async ({ sock, from, args }) => {
  const ip = args[0] || "";
  const { data } = await axios.get(`http://ip-api.com/json/${ip}`);
  await sock.sendMessage(from, { text: `🌐 ${data.query}\nCountry: ${data.country}\nCity: ${data.city}\nISP: ${data.isp}` });
});

mk("weather", async ({ sock, from, args }) => {
  const q = args.join(" ");
  const { data } = await axios.get(`https://wttr.in/${encodeURIComponent(q)}?format=j1`);
  const c = data.current_condition[0];
  await sock.sendMessage(from, { text: `🌤️ *${q}*\nTemp: ${c.temp_C}°C\nHumidity: ${c.humidity}%\nWind: ${c.windspeedKmph}km/h` });
});

mk("cityinfo", async (p) => {
  const { commands } = await import("./index.js");
  await commands.get("weather").run(p);
});

mk("news", async ({ sock, from }) => {
  const { data } = await axios.get("https://newsapi.org/v2/top-headlines?country=us&apiKey=demo");
  const articles = (data.articles || []).slice(0, 5);
  await sock.sendMessage(from, { text: articles.map((a,i)=>`${i+1}. ${a.title}`).join("\n\n") || "No news" });
});

mk("tempmail", async ({ sock, from }) => {
  const { data } = await axios.get("https://api.mail.tm/domains");
  const domain = data["hydra:member"][0].domain;
  await sock.sendMessage(from, { text: `📧 Domain: ${domain}` });
});

mk("define", async ({ sock, from, args }) => {
  const { data } = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${args[0]}`);
  const d = data[0]?.meanings?.[0]?.definitions?.[0]?.definition;
  await sock.sendMessage(from, { text: `📖 *${args[0]}*: ${d || "Not found"}` });
});

mk("device", async ({ sock, from }) => {
  await sock.sendMessage(from, { text: `📱 Device: Ubuntu + Chrome 20.0.04` });
});

mk("fakeinfo", async ({ sock, from }) => {
  await sock.sendMessage(from, { text: `📋 Fake report generated for demo.` });
});

mk("link", async ({ sock, from }) => {
  await sock.sendMessage(from, { text: `🔗 ${config.channelLink}` });
});