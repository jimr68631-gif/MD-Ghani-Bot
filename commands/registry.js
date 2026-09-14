/* ============================================================
 *  MD-Ghani-Bot — Shared Command Registry
 *  Saari command files yahan se `register()` import karti hain.
 * ============================================================ */

export const commands = new Map();

/**
 * Command register karo
 * @param {string} name - Command naam (bina prefix ke, e.g. "kick")
 * @param {object} opts - { toggle: string|null, run: async function }
 */
export function register(name, opts) {
  if (!name || typeof name !== "string") return;
  if (!opts || typeof opts.run !== "function") {
    console.warn(`⚠️ Invalid register call for command: ${name}`);
    return;
  }
  const key = name.toLowerCase().trim();
  if (commands.has(key)) {
    console.warn(`⚠️ Duplicate command skipped: ${key}`);
    return;
  }
  commands.set(key, opts);
}

/**
 * Command lo
 */
export function getCommand(name) {
  return commands.get(String(name).toLowerCase().trim());
}

/**
 * Saare commands list
 */
export function listCommands() {
  return [...commands.keys()].sort();
}