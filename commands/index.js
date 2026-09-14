/* ============================================================
 *  MD-Ghani-Bot — Command Registry (Auto Loader)
 *  Ye file automatically commands/ folder ki saari .js files
 *  load kar leti hai (except index.js aur _registry.js).
 * ============================================================ */

import { commands } from "./_registry.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* -------- __dirname resolve (ESM) -------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------- Files List -------- */
const SKIP = ["index.js", "_registry.js"];

let loaded = 0;
let failed = 0;

try {
  const files = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith(".js") && !SKIP.includes(f))
    .sort();

  if (files.length === 0) {
    console.log("⚠️  commands/ folder mein koi command file nahi mili.");
  }

  for (const file of files) {
    try {
      await import(path.join(__dirname, file));
      loaded++;
      console.log(`✅ Loaded: commands/${file}`);
    } catch (err) {
      failed++;
      console.error(`❌ Failed to load commands/${file}:`);
      console.error(`   → ${err?.message || err}`);
    }
  }
} catch (err) {
  console.error("❌ commands/ folder read error:", err?.message || err);
}

/* -------- Summary -------- */
console.log("");
console.log("╭─────────────────────────────────────────╮");
console.log("│  📦 MD-Ghani-Bot — Command Registry     │");
console.log("├─────────────────────────────────────────┤");
console.log(`│  ✅ Files Loaded   : ${String(loaded).padEnd(19)}│`);
console.log(`│  ❌ Files Failed   : ${String(failed).padEnd(19)}│`);
console.log(`│  🎯 Commands Total : ${String(commands.size).padEnd(19)}│`);
console.log("╰─────────────────────────────────────────╯");
console.log("");

/* -------- Exports -------- */
export { commands };