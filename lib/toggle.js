/* ============================================================
 *  MD-Ghani-Bot — Toggle System (per session)
 * ============================================================ */
import { defaultToggles } from "../config.js";

const state = new Map();

export function getToggles(sessionId) {
  if (!state.has(sessionId)) state.set(sessionId, { ...defaultToggles });
  return state.get(sessionId);
}

export function setToggle(sessionId, key, val) {
  const t = getToggles(sessionId);
  if (!(key in t)) return false;
  t[key] = val === true || val === "true" || val === "on";
  return true;
}

export function isOn(sessionId, key) {
  return !!getToggles(sessionId)[key];
}

export function allToggles(sessionId) {
  return getToggles(sessionId);
}

export function deleteSession(sessionId) {
  state.delete(sessionId);
}