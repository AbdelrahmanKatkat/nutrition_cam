/**
 * Open Food Facts client (free, no API key, CORS-enabled).
 * Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/
 *
 * @module services/openfoodfacts
 */

import { CONFIG } from '../config.js';

/**
 * @typedef {Object} FoodProduct
 * @property {string}      code
 * @property {string}      name
 * @property {string}      brand
 * @property {string|null} nutriScore   'a'..'e' or null
 * @property {{kcal:number, protein:number, carbs:number, fat:number}} per100g
 * @property {string[]}    labels       human-readable label names
 * @property {string}      image
 */

const { baseUrl, fields } = CONFIG.openFoodFacts;

/**
 * Look a product up by barcode (EAN/UPC).
 * @param {string} barcode digits only
 * @returns {Promise<FoodProduct|null>} null when the product is unknown
 */
export async function getProductByBarcode(barcode) {
  const clean = String(barcode).replace(/\D/g, '');
  if (!clean) return null;
  const data = await getJson(`${baseUrl}/api/v2/product/${clean}.json?fields=${fields}`);
  return data.status === 1 && data.product ? normalize(data.product) : null;
}

/**
 * Text search – used to find a matching product for a meal name from Gemini.
 * @param {string} query
 * @returns {Promise<FoodProduct|null>} best match or null
 */
export async function searchProduct(query) {
  const params = new URLSearchParams({
    search_terms: query, search_simple: '1', action: 'process',
    json: '1', page_size: '1', fields,
  });
  const data = await getJson(`${baseUrl}/cgi/search.pl?${params}`);
  const hit = data.products?.[0];
  return hit ? normalize(hit) : null;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open Food Facts request failed (${res.status}).`);
  return res.json();
}

/** Map the raw OFF payload to the small shape the UI needs. */
function normalize(p) {
  const n = p.nutriments || {};
  const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0);
  const grade = String(p.nutriscore_grade || '').toLowerCase();
  return {
    code: p.code || '',
    name: p.product_name || 'Unnamed product',
    brand: p.brands || '',
    nutriScore: /^[a-e]$/.test(grade) ? grade : null,
    per100g: {
      kcal: num(n['energy-kcal_100g']),
      protein: num(n.proteins_100g),
      carbs: num(n.carbohydrates_100g),
      fat: num(n.fat_100g),
    },
    labels: (p.labels_tags || []).map(prettyLabel).slice(0, 6),
    image: p.image_front_small_url || '',
  };
}

/** "en:no-added-sugar" -> "No added sugar" */
function prettyLabel(tag) {
  const text = tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
