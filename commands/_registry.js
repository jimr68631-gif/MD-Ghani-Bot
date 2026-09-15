// Shared registry bridge for command modules.
// Keeps the modular command loader compatible with the main bot entrypoint.
export { commands, register, getCommand, listCommands } from "./registry.js";
