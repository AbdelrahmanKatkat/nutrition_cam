/**
 * Thin wrapper around localStorage for settings and scan history.
 * All access is try/catch-guarded (private mode / blocked storage must not break the app).
 * @module services/storage
 */

import { CONFIG } from '../config.js';

const KEYS = { settings: 'nutrisnap.settings', history: 'nutrisnap.history' };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota exceeded or storage unavailable
  }
}

/** @returns {{apiMode:boolean, useGemini:boolean, useOff:boolean}} */
export function loadSettings() {
  return { apiMode: false, useGemini: true, useOff: true, ...read(KEYS.settings, {}) };
}

/** @param {Partial<ReturnType<typeof loadSettings>>} patch */
export function saveSettings(patch) {
  write(KEYS.settings, { ...loadSettings(), ...patch });
}

/** @returns {Array<object>} newest first */
export function loadHistory() {
  return read(KEYS.history, []);
}

/**
 * Prepend a scan result. A small thumbnail (not the full photo) is stored to stay under quota.
 * @param {object} entry
 */
export function addHistory(entry) {
  const list = [entry, ...loadHistory()].slice(0, CONFIG.historyLimit);
  // Retry with fewer items if the quota is hit.
  while (list.length && !write(KEYS.history, list)) list.pop();
}

export function clearHistory() {
  write(KEYS.history, []);
}
