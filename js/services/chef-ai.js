/**
 * NutriChef's AI client: recipe analysis, chat, smart search and recipe creation.
 * Every call goes through the Worker (js/services/proxy.js); the prompts live in proxy/src/prompts/chef.js.
 *
 * @module services/chef-ai
 */

import { askProxy } from './proxy.js';

const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
const int = (v) => Math.round(num(v));
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const cToF = (c) => Math.round((c * 9) / 5 + 32);
const fToC = (f) => Math.round(((f - 32) * 5) / 9);

/** Fill in whichever of °C/°F is missing; 0 means "not applicable". */
function temps(c, f) {
  const tc = int(c);
  const tf = int(f);
  if (tc && !tf) return { tempC: tc, tempF: cToF(tc) };
  if (tf && !tc) return { tempC: fToC(tf), tempF: tf };
  return { tempC: tc, tempF: tf };
}

/**
 * @typedef {Object} Analysis
 * @property {number} baseServings     servings the AI assumed (nutrition totals are for the whole recipe)
 * @property {number} yieldGrams       total weight of the finished dish
 * @property {string} servingLabel     plain-language picture of one serving, e.g. "about 1 bowl (300 g)"
 * @property {number} prepMinutes
 * @property {number} cookMinutes
 * @property {string} difficulty
 * @property {string[]} tags
 * @property {{kcal:number, proteinG:number, carbsG:number, fatG:number, fiberG:number}} totals  whole recipe
 * @property {{name:string, percentDV:number, role:string}[]} vitamins   percentDV is per base serving
 * @property {{title:string, text:string, tempC:number, tempF:number, minutes:number}[]} steps
 * @property {{topic:string, chemistry:string, whyItMatters:string}[]} science
 * @property {{principle:string, explanation:string, tempC:number, tempF:number, tip:string}[]} theory
 * @property {string} safety
 * @property {string} assumptions
 */

/**
 * Ask Gemini for the full analysis of one recipe.
 * @param {{title:string, category?:string, area?:string, servings?:number, ingredients:{name:string,measure:string}[], instructions:string}} recipe
 * @returns {Promise<Analysis>}
 */
export async function analyseRecipe(recipe) {
  const raw = await askProxy('recipe_analyse', {
    recipe: {
      title: recipe.title,
      category: recipe.category,
      area: recipe.area,
      servings: recipe.servings || '',
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
    },
  });
  return normalizeAnalysis(raw);
}

/** Clamp and coerce the model's answer so the page never has to defend against odd values. */
export function normalizeAnalysis(raw) {
  const items = (Array.isArray(raw.items) ? raw.items : []);
  // Models are unreliable at arithmetic: total the per-ingredient values ourselves.
  const sum = (key) => items.reduce((t, i) => t + num(i?.[key]), 0);

  return {
    baseServings: Math.min(24, Math.max(1, int(raw.servings) || 4)),
    // Finished weight; fall back to the raw ingredient weight if the model left it out.
    yieldGrams: int(raw.yieldGrams) || Math.round(sum('grams')),
    servingLabel: str(raw.servingLabel, 120),
    prepMinutes: int(raw.prepMinutes),
    cookMinutes: int(raw.cookMinutes),
    difficulty: ['Easy', 'Medium', 'Hard'].includes(raw.difficulty) ? raw.difficulty : 'Medium',
    tags: (Array.isArray(raw.tags) ? raw.tags : []).map((t) => str(t, 30)).filter(Boolean).slice(0, 4),
    totals: {
      kcal: Math.round(sum('calories')),
      proteinG: Math.round(sum('proteinG')),
      carbsG: Math.round(sum('carbsG')),
      fatG: Math.round(sum('fatG')),
      fiberG: Math.round(sum('fiberG')),
    },
    vitamins: (Array.isArray(raw.vitamins) ? raw.vitamins : [])
      .map((v) => ({ name: cap(str(v?.name, 40)), percentDV: Math.min(300, Math.round(num(v?.percentDV))), role: str(v?.role, 160) }))
      .filter((v) => v.name)
      .slice(0, 6),
    steps: (Array.isArray(raw.steps) ? raw.steps : []).map((s) => ({
      title: str(s?.title, 80), text: str(s?.text, 400), minutes: int(s?.minutes), ...temps(s?.tempC, s?.tempF),
    })).filter((s) => s.text),
    science: (Array.isArray(raw.science) ? raw.science : []).map((s) => ({
      topic: str(s?.topic, 80), chemistry: str(s?.chemistry, 400), whyItMatters: str(s?.whyItMatters, 300),
    })).filter((s) => s.topic),
    theory: (Array.isArray(raw.theory) ? raw.theory : []).map((t) => ({
      principle: str(t?.principle, 100), explanation: str(t?.explanation, 400), tip: str(t?.tip, 250), ...temps(t?.tempC, t?.tempF),
    })).filter((t) => t.principle),
    safety: str(raw.safety, 400),
    assumptions: str(raw.assumptions, 400),
  };
}

/**
 * Nutrition for the number of servings the user chose.
 * Totals are for the whole recipe; vitamins are per base serving, so they scale by base / chosen.
 */
export function perServing(analysis, servings) {
  const n = Math.max(1, servings);
  const t = analysis.totals;
  return {
    kcal: Math.round(t.kcal / n),
    proteinG: Math.round(t.proteinG / n),
    carbsG: Math.round(t.carbsG / n),
    fatG: Math.round(t.fatG / n),
    fiberG: Math.round(t.fiberG / n),
    servingGrams: analysis.yieldGrams ? Math.round(analysis.yieldGrams / n) : 0,
    vitamins: analysis.vitamins.map((v) => ({ ...v, percentDV: Math.min(300, Math.round((v.percentDV * analysis.baseServings) / n)) })),
  };
}

/**
 * One chat turn about the selected recipe.
 * @param {object} recipe  {title, ingredients, nutrition:{servings,kcal,proteinG,carbsG,fatG}}
 * @param {{role:'user'|'assistant', text:string}[]} messages  history, ending with the user's new message
 * @returns {Promise<{reply:string, suggestions:string[]}>}
 */
export async function chatAboutRecipe(recipe, messages) {
  const raw = await askProxy('recipe_chat', { recipe, messages });
  return {
    reply: str(raw.reply, 1500) || 'Sorry, I could not come up with an answer. Please try rephrasing.',
    suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : []).map((s) => str(s, 60)).filter(Boolean).slice(0, 3),
  };
}

/**
 * Turn a natural request ("high protein chicken dinner") into database searches.
 * @returns {Promise<{dishNames:string[], ingredients:string[], category:string, interpretation:string}>}
 */
export async function interpretSearch(query) {
  const raw = await askProxy('recipe_search', { query });
  const list = (v, n) => (Array.isArray(v) ? v : []).map((x) => str(x, 40)).filter(Boolean).slice(0, n);
  return {
    dishNames: list(raw.dishNames, 3),
    ingredients: list(raw.ingredients, 3),
    category: str(raw.category, 30),
    interpretation: str(raw.interpretation, 120),
  };
}

/** Ask Gemini to write a recipe when the database has none. Returns the raw object (see mealdb.fromGenerated). */
export async function createRecipe(query) {
  return askProxy('recipe_create', { query });
}
