/**
 * Meal photo -> structured calorie estimate, via the key-holding proxy.
 *
 * Swap-point for the future: `predictMeal` is the only function the app calls. The call goes
 * through the proxy (proxy/); to use an agent instead (docs/AGENTIC_AI.md) only this file changes.
 *
 * @module services/gemini
 */

import { askProxy } from './proxy.js';
import { askChat } from './chat-ai.js';

/**
 * @typedef {Object} MealPrediction
 * @property {boolean}  isFood       false when the photo shows no food, drink or food package
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

export { RateLimitError } from './proxy.js';

/**
 * Ask the proxy (which calls Gemini with the secret key) to analyse a meal photo.
 * The prompt and response schema live in proxy/src/prompts/scan.js.
 * @param {{base64:string, mimeType:string}} image
 * @param {string} [hint] optional user description of the components ("2 eggs, toast, olive oil")
 * @returns {Promise<MealPrediction>}
 * @throws {RateLimitError} on HTTP 429
 */
export async function predictMeal(image, hint = '') {
  const raw = await askProxy('scan', { image: image.base64, mimeType: image.mimeType, hint });
  return normalize(raw);
}

/**
 * NutriChat on the NutriSnap page: ask about the scanned meal or product (or nutrition in general).
 * @param {{meal?:object, product?:object}|undefined} context  what the last scan found
 * @param {{role:'user'|'assistant', text:string}[]} messages  history ending with the user's new message
 */
export function chatAboutMeal(context, messages) {
  return askChat('meal_chat', { context, messages });
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
    isFood: raw.isFood !== false,
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
