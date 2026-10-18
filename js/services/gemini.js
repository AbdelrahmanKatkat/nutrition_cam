/**
 * Meal photo -> structured calorie estimate, via the key-holding proxy.
 * Also exposes a mock predictor so the UI can be tested without an API key.
 *
 * Swap-point for the future: `predictMeal` is the only function the app calls. The call goes
 * through the proxy (proxy/); to use an agent instead (docs/AGENTIC_AI.md) only this file changes.
 *
 * @module services/gemini
 */

import { CONFIG } from '../config.js';

/**
 * @typedef {Object} MealPrediction
 * @property {string}   mealName
 * @property {number}   calories     total kcal for the visible portion
 * @property {number}   confidence   0..1
 * @property {number}   proteinG
 * @property {number}   carbsG
 * @property {number}   fatG
 * @property {{name:string, grams:number, calories:number}[]} items  per-item estimate
 * @property {string[]} ingredients  item names
 * @property {string}   notes        assumptions (portion size etc.)
 */

/** Thrown on HTTP 429 so the UI can show a countdown instead of a generic error. */
export class RateLimitError extends Error {
  constructor(retryAfterS) {
    super(`Rate limit reached. Try again in ${retryAfterS}s.`);
    this.name = 'RateLimitError';
    this.retryAfterS = retryAfterS;
  }
}

/**
 * Ask the proxy (which calls Gemini with the secret key) to analyse a meal photo.
 * The prompt and response schema live in proxy/src/index.js.
 * @param {{base64:string, mimeType:string}} image
 * @param {string} [hint] optional user description of the components ("2 eggs, toast, olive oil")
 * @returns {Promise<MealPrediction>}
 * @throws {RateLimitError} on HTTP 429
 */
export async function predictMeal(image, hint = '') {
  const { url, timeoutMs } = CONFIG.proxy;
  if (!url) throw new Error('Proxy URL not set. Deploy the proxy (proxy/README.md) and set proxy.url in js/config.js.');

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: image.base64, mimeType: image.mimeType, hint }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`The request timed out after ${Math.round(timeoutMs / 1000)}s. Please try again.`);
    }
    throw new Error('Could not reach the proxy. Check your connection and proxy.url.');
  }

  if (res.status === 429) {
    const wait = parseInt(res.headers.get('Retry-After'), 10);
    throw new RateLimitError(Number.isFinite(wait) ? wait : CONFIG.scan.defaultRetryAfterS);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return normalize(data.prediction || {});
}

/** Clamp / coerce model output so the UI never has to defend against odd values. */
function normalize(raw) {
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  const items = (Array.isArray(raw.items) ? raw.items : []).map((i) => ({
    name: String(i.name || 'item'), grams: Math.round(num(i.grams)), calories: Math.round(num(i.calories)),
  }));
  // Models are unreliable at arithmetic: prefer the sum of the per-item calories over their own total.
  const itemSum = items.reduce((t, i) => t + i.calories, 0);
  return {
    mealName: String(raw.mealName || 'Unknown meal'),
    items,
    calories: itemSum > 0 ? itemSum : Math.round(num(raw.calories)),
    // "No food detected" must not show a high confidence bar (models sometimes report confidence in the *absence*).
    confidence: itemSum > 0 || num(raw.calories) > 0 ? Math.min(1, num(raw.confidence)) : 0,
    proteinG: Math.round(num(raw.proteinG)),
    carbsG: Math.round(num(raw.carbsG)),
    fatG: Math.round(num(raw.fatG)),
    ingredients: items.map((i) => i.name),
    notes: String(raw.notes || ''),
  };
}

/**
 * Fake prediction for demo mode – lets you test the whole flow without a key.
 * @returns {Promise<MealPrediction>}
 */
export async function mockPredictMeal() {
  await new Promise((r) => setTimeout(r, 900)); // simulate latency
  return {
    mealName: 'Mixed veggie power bowl (demo)',
    calories: 450,
    confidence: 0.82,
    proteinG: 18,
    carbsG: 32,
    fatG: 14,
    items: [
      { name: 'quinoa', grams: 120, calories: 144 },
      { name: 'roasted vegetables', grams: 150, calories: 110 },
      { name: 'chickpeas', grams: 80, calories: 100 },
      { name: 'avocado', grams: 50, calories: 80 },
      { name: 'hummus', grams: 30, calories: 16 },
    ],
    ingredients: ['quinoa', 'roasted vegetables', 'chickpeas', 'avocado', 'hummus'],
    notes: 'Demo data – turn on API Mode and add a Gemini key for a real estimate.',
  };
}
