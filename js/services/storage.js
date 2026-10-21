/**
 * Thin wrapper around localStorage for settings and scan history.
 * All access is try/catch-guarded (private mode / blocked storage must not break the app).
 * @module services/storage
 */

import { CONFIG } from '../config.js';

const KEYS = { settings: 'nutrisnap.settings', history: 'nutrisnap.history', chefCache: 'nutrisnap.chef.cache' };

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

/** @returns {{useAi:boolean, useOff:boolean}} */
export function loadSettings() {
  return { useAi: true, useOff: true, ...read(KEYS.settings, {}) };
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

/* ---- NutriChef: remember analysed recipes so reopening one costs no AI call ---- */

const CHEF_CACHE_VERSION = 2; // bump when the analysis shape changes

/** @returns {object|null} the saved analysis for a recipe id */
export function getChefAnalysis(id) {
  const cache = read(KEYS.chefCache, { v: CHEF_CACHE_VERSION, items: [] });
  if (cache.v !== CHEF_CACHE_VERSION) return null;
  return cache.items.find((entry) => entry.id === id)?.analysis ?? null;
}

export function setChefAnalysis(id, analysis) {
  const cache = read(KEYS.chefCache, { v: CHEF_CACHE_VERSION, items: [] });
  const items = cache.v === CHEF_CACHE_VERSION ? cache.items : [];
  const next = [{ id, analysis }, ...items.filter((entry) => entry.id !== id)].slice(0, CONFIG.chef.cacheSize);
  while (next.length && !write(KEYS.chefCache, { v: CHEF_CACHE_VERSION, items: next })) next.pop();
}
