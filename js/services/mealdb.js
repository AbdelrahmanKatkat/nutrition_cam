/**
 * TheMealDB client: a free, key-less recipe database (test key "1") with photos, ingredients and
 * instructions for a few hundred classic dishes. CORS is open, so the browser calls it directly.
 * Docs: https://www.themealdb.com/api.php
 *
 * Two shapes are used:
 *  - RecipeSummary  {id, title, thumb}                    cheap, returned by list/filter endpoints
 *  - Recipe         summary + category, area, tags, ingredients[], instructions, source, youtube
 *
 * @module services/mealdb
 */

import { CONFIG } from '../config.js';

const BASE = CONFIG.chef.mealdbBase;

/** Full recipes already fetched this visit, keyed by id (saves lookups when the user re-clicks). */
const recipeCache = new Map();

async function get(path) {
  let res;
  try {
    res = await fetch(`${BASE}/${path}`);
  } catch {
    throw new Error('Could not reach the recipe database. Check your internet connection.');
  }
  if (!res.ok) throw new Error(`The recipe database returned an error (${res.status}).`);
  return res.json();
}

/** Image URL at a given size ("small" 100px, "medium" 350px, "large" 700px). */
export const imageUrl = (thumb, size = 'medium') => (thumb ? `${thumb}/${size}` : '');

/** TheMealDB lists ingredients as strIngredient1..20 + strMeasure1..20. */
function toRecipe(m) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = (m[`strIngredient${i}`] || '').trim();
    if (name) ingredients.push({ name, measure: (m[`strMeasure${i}`] || '').trim() });
  }
  const recipe = {
    id: String(m.idMeal),
    title: m.strMeal || 'Untitled recipe',
    thumb: m.strMealThumb || '',
    category: m.strCategory || '',
    area: m.strArea || '',
    tags: (m.strTags || '').split(',').map((t) => t.trim()).filter(Boolean),
    ingredients,
    instructions: (m.strInstructions || '').replace(/\r\n?/g, '\n').trim(),
    source: m.strSource || '',
    youtube: m.strYoutube || '',
  };
  recipeCache.set(recipe.id, recipe);
  return recipe;
}

const toSummary = (m) => ({ id: String(m.idMeal), title: m.strMeal, thumb: m.strMealThumb || '' });

/** Search dishes by name ("salmon", "arrabiata"). */
export async function searchByName(query) {
  const data = await get(`search.php?s=${encodeURIComponent(query)}`);
  return (data.meals || []).map(toRecipe).map(({ id, title, thumb, category, area }) => ({ id, title, thumb, category, area }));
}

/** Dishes that use one main ingredient ("chicken breast" -> chicken_breast). */
export async function searchByIngredient(ingredient) {
  const key = ingredient.trim().toLowerCase().replace(/\s+/g, '_');
  const data = await get(`filter.php?i=${encodeURIComponent(key)}`);
  return (data.meals || []).map(toSummary);
}

export async function filterByCategory(category) {
  const data = await get(`filter.php?c=${encodeURIComponent(category)}`);
  return (data.meals || []).map(toSummary);
}

/** One full recipe by id (uses the in-memory cache when it has it). */
export async function getRecipe(id) {
  if (recipeCache.has(id)) return recipeCache.get(id);
  const data = await get(`lookup.php?i=${encodeURIComponent(id)}`);
  return data.meals?.[0] ? toRecipe(data.meals[0]) : null;
}

export async function randomRecipe() {
  const data = await get('random.php');
  return data.meals?.[0] ? toRecipe(data.meals[0]) : null;
}

/** @returns {Promise<string[]>} category names (Beef, Chicken, Seafood...) */
export async function listCategories() {
  const data = await get('categories.php');
  return (data.categories || []).map((c) => c.strCategory);
}

/** A recipe written by Gemini, shaped like a database recipe so the rest of the page treats it the same. */
export function fromGenerated(raw) {
  return {
    id: `ai-${Date.now()}`,
    title: String(raw.title || 'Generated recipe').slice(0, 120),
    thumb: '',
    category: String(raw.category || ''),
    area: String(raw.area || ''),
    tags: ['Created by NutriAI'],
    ingredients: (Array.isArray(raw.ingredients) ? raw.ingredients : [])
      .map((i) => ({ name: String(i?.name || '').trim(), measure: String(i?.measure || '').trim() }))
      .filter((i) => i.name),
    instructions: String(raw.instructions || '').trim(),
    servings: Number(raw.servings) || 0,
    imageQuery: String(raw.imageQuery || '').trim(),
    note: String(raw.note || ''),
    source: '',
    youtube: '',
    generated: true,
  };
}
