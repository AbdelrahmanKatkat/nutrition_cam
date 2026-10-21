/**
 * NutriChef entry point: search recipes (TheMealDB), pick one, get a Gemini analysis
 * (nutrition, vitamins, food science, steps) and chat about making it healthier.
 *
 * Flow:
 *   search ──► results ──► select recipe ──► [cached? use it : Gemini analysis] ──► profile + steps
 *                                      └───► chat (Gemini, with the recipe as context)
 *   empty search ──► optional: smart search / create a recipe with Gemini
 *
 * @module chef
 */

import { $ } from './dom.js';
import { CONFIG } from './config.js';
import * as ui from './chef-ui.js';
import {
  searchByName, searchByIngredient, filterByCategory, getRecipe, randomRecipe, listCategories, fromGenerated,
} from './services/mealdb.js';
import { analyseRecipe, perServing, chatAboutRecipe, interpretSearch, createRecipe } from './services/chef-ai.js';
import { RateLimitError } from './services/proxy.js';
import { findDishPhoto } from './services/photo.js';
import { setupChat } from './chat.js';
import * as store from './services/storage.js';

/** In-memory state for the current visit. */
const state = {
  mode: 'name',        // 'name' | 'ingredient'
  query: '',
  results: [],
  shown: 10,           // how many results are visible (the rest sit behind "Show more")
  recipe: null,
  analysis: null,
  servings: 4,
  searchToken: 0,      // lets a newer search/selection win over a slower older one
  selectToken: 0,
};

/** Timestamp (ms) before which another AI request is refused (cooldown, or after a 429). */
let blockedUntil = 0;
const secondsToWait = () => Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000));
const startCooldown = () => { blockedUntil = Date.now() + CONFIG.chat.cooldownMs; };

/** Friendly text for any AI error; a 429 also blocks further requests for the advised time. */
function aiErrorText(err) {
  if (err instanceof RateLimitError) {
    blockedUntil = Date.now() + err.retryAfterS * 1000;
    return `Too many AI requests. Try again in ${err.retryAfterS}s.`;
  }
  return err.message || 'Something went wrong.';
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** Picked = a recipe is chosen, so the result list, helper buttons and search note step aside. */
function setPicked(on) {
  $('chef-left').classList.toggle('is-picked', on);
  $('show-results').hidden = !(on && state.results.length);
  $('show-results').textContent = `← Back to ${state.results.length} results`;
}

function showResults(list, note) {
  state.results = list;
  setPicked(false);
  state.shown = ui.RESULTS_PAGE;
  ui.renderResults(list, state.recipe?.id, state.shown);
  ui.setSearchNote(note);
  // The free database is small (about 790 recipes): offer Gemini whenever a search leaves few results.
  ui.showFallback(Boolean(state.query) && list.length < 5);
}

async function runSearch(rawQuery) {
  setPicked(false);
  const query = rawQuery.trim();
  state.query = query;
  const token = ++state.searchToken;
  ui.setActiveCategory('');
  if (query.length < 2) {
    ui.showFallback(false);
    ui.setSearchNote(query ? 'Type at least 2 letters.' : 'Search by dish, or pick a category.');
    return;
  }
  ui.setSearchNote('Searching…');
  try {
    let list = state.mode === 'ingredient' ? await searchByIngredient(query) : await searchByName(query);
    // "chicken" is a dish word and an ingredient: if the dish search is empty, the ingredient search often is not.
    if (!list.length && state.mode === 'name') list = await searchByIngredient(query);
    if (token !== state.searchToken) return;
    if (list.length) {
      showResults(list, `${list.length} recipe${list.length === 1 ? '' : 's'} found`);
    } else {
      showResults([], `No recipes found for "${query}".`);
      ui.showFallback(true);
    }
  } catch (err) {
    if (token !== state.searchToken) return;
    ui.setSearchNote(err.message, true);
  }
}

async function browseCategory(name) {
  setPicked(false);
  const token = ++state.searchToken;
  state.query = '';
  $('search-input').value = '';
  ui.setActiveCategory(name);
  ui.setSearchNote(`Loading ${name}…`);
  try {
    const list = await filterByCategory(name);
    if (token !== state.searchToken) return;
    showResults(list, `${list.length} ${name} recipes`);
  } catch (err) {
    if (token === state.searchToken) ui.setSearchNote(err.message, true);
  }
}

/** Gemini turns a natural request ("high protein chicken dinner") into several database searches. */
async function smartSearch() {
  const wait = secondsToWait();
  if (wait) return ui.setSearchNote(`Please wait ${wait}s before the next AI request.`, true);
  ui.setFallbackBusy(true);
  ui.setSearchNote('NutriAI is working out what to search for…');
  startCooldown();
  try {
    const plan = await interpretSearch(state.query);
    const jobs = [
      ...plan.dishNames.map((n) => searchByName(n)),
      ...plan.ingredients.map((n) => searchByIngredient(n)),
      ...(plan.category ? [filterByCategory(plan.category)] : []),
    ];
    const settled = await Promise.allSettled(jobs);
    const seen = new Map();
    for (const r of settled) if (r.status === 'fulfilled') for (const item of r.value) if (!seen.has(item.id)) seen.set(item.id, item);
    const list = [...seen.values()].slice(0, 30);
    if (list.length) {
      showResults(list, plan.interpretation ? `${plan.interpretation} – ${list.length} recipes` : `${list.length} recipes`);
    } else {
      ui.setSearchNote('Still nothing in the database. You can have NutriAI create this recipe.', true);
    }
  } catch (err) {
    ui.setSearchNote(aiErrorText(err), true);
  } finally {
    ui.setFallbackBusy(false);
  }
}

/** The database has no match: ask Gemini to write one, then analyse it like any other recipe. */
async function createFromQuery() {
  const wait = secondsToWait();
  if (wait) return ui.setSearchNote(`Please wait ${wait}s before the next AI request.`, true);
  ui.setFallbackBusy(true);
  ui.setSearchNote('NutriAI is writing the recipe…');
  startCooldown();
  try {
    const raw = await createRecipe(state.query);
    const recipe = fromGenerated(raw);
    if (!recipe.ingredients.length || !recipe.instructions) throw new Error('NutriAI could not create a recipe for that request. Try describing a dish.');
    ui.setSearchNote(`Created "${recipe.title}".`);
    ui.showFallback(false);
    await selectRecipe(recipe);
  } catch (err) {
    ui.setSearchNote(aiErrorText(err), true);
  } finally {
    ui.setFallbackBusy(false);
  }
}

/* ------------------------------------------------------------------ */
/* Selecting and analysing a recipe                                    */
/* ------------------------------------------------------------------ */

async function selectRecipe(source) {
  const token = ++state.selectToken;
  ui.setStatus('');
  let recipe;
  try {
    recipe = typeof source === 'string' ? await getRecipe(source) : source;
  } catch (err) {
    ui.setStatus(err.message, true);
    return;
  }
  if (token !== state.selectToken) return;
  if (!recipe) { ui.setStatus('That recipe could not be found.', true); return; }

  state.recipe = recipe;
  state.analysis = null;
  setPicked(true);
  state.servings = recipe.servings > 0 ? recipe.servings : 4;

  ui.markActiveResult(recipe.id);
  ui.renderSelected(recipe);
  if (recipe.generated) attachPhoto(recipe, token);
  ui.renderSteps(recipe, null); // the database's own steps show immediately, before the AI answers
  chat.reset({
    subtitle: `Chatting about ${recipe.title}`,
    greeting: `Hi! I can help you make **${recipe.title}** healthier, higher in protein or lower in calories, or explain the science behind it. What would you like?`,
    chips: CHEF_CHIPS,
  });
  history.replaceState(null, '', recipe.generated ? location.pathname : `?r=${encodeURIComponent(recipe.id)}`);
  if (window.matchMedia('(max-width: 999px)').matches) $('profile-title').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const cached = recipe.generated ? null : store.getChefAnalysis(recipe.id);
  if (cached) { applyAnalysis(cached); return; }
  await runAnalysis(token);
}

/** Gemini-written recipes have no picture: look the dish up on Wikipedia (silently skipped if nothing fits). */
async function attachPhoto(recipe, token) {
  const photo = await findDishPhoto(recipe.imageQuery || recipe.title);
  if (!photo || token !== state.selectToken) return;
  recipe.photo = photo.url;
  recipe.photoCredit = { title: photo.title, url: photo.pageUrl };
  ui.renderSelected(recipe, state.analysis);
}

async function runAnalysis(token = state.selectToken) {
  const recipe = state.recipe;
  if (!recipe) return;
  const wait = secondsToWait();
  if (wait) {
    ui.showProfile('error', { title: 'Please wait a moment.', text: `The next AI request is available in ${wait}s. This protects the free quota.`, canRetry: true });
    return;
  }
  ui.showProfile('loading', { title: recipe.title });
  startCooldown();
  try {
    const analysis = await analyseRecipe(recipe);
    if (token !== state.selectToken) return; // the user picked another recipe meanwhile
    if (!analysis.totals.kcal && !analysis.steps.length) throw new Error('NutriAI returned an empty analysis. Please try again.');
    if (!recipe.generated) store.setChefAnalysis(recipe.id, analysis);
    applyAnalysis(analysis);
  } catch (err) {
    if (token !== state.selectToken) return;
    ui.showProfile('error', { title: 'Could not analyse this recipe.', text: aiErrorText(err), canRetry: true });
  }
}

function applyAnalysis(analysis) {
  state.analysis = analysis;
  if (!(state.recipe.servings > 0)) state.servings = analysis.baseServings;
  ui.renderSelected(state.recipe, analysis);
  ui.renderSteps(state.recipe, analysis);
  refreshProfile();
}

function refreshProfile() {
  if (!state.analysis) return;
  ui.renderProfile(state.analysis, perServing(state.analysis, state.servings), state.servings);
}

/* ------------------------------------------------------------------ */
/* NutriChat (the shared chat panel, with this page's recipe as context) */
/* ------------------------------------------------------------------ */

const CHEF_CHIPS = ['Make it higher in protein', 'Make it healthier', 'Lower the calories', 'Explain the science'];

const chat = setupChat({
  ask: (history) => {
    const per = state.analysis ? perServing(state.analysis, state.servings) : null;
    return chatAboutRecipe({
      title: state.recipe.title,
      ingredients: state.recipe.ingredients,
      nutrition: per ? { servings: state.servings, kcal: per.kcal, proteinG: per.proteinG, carbsG: per.carbsG, fatG: per.fatG } : undefined,
    }, history);
  },
  secondsToWait,
  startCooldown,
  errorText: aiErrorText,
  notify: (message, isError) => ui.setStatus(message, isError),
  maxChars: CONFIG.chat.maxMessageChars,
});

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

let debounce;
$('search-input').addEventListener('input', (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => runSearch(e.target.value), 400);
});
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(debounce);
  runSearch($('search-input').value);
});

document.querySelector('.segmented').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg[data-mode]');
  if (!btn) return;
  state.mode = btn.dataset.mode;
  ui.setMode(state.mode);
  if ($('search-input').value.trim().length >= 2) runSearch($('search-input').value);
});

$('surprise-btn').addEventListener('click', async () => {
  ui.setSearchNote('Picking something for you…');
  try {
    const recipe = await randomRecipe();
    if (recipe) { ui.setSearchNote(`Surprise: ${recipe.title}`); await selectRecipe(recipe); }
  } catch (err) {
    ui.setSearchNote(err.message, true);
  }
});

$('category-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-category]');
  if (chip) browseCategory(chip.dataset.category);
});
$('results').addEventListener('click', (e) => {
  if (e.target.closest('[data-more]')) {
    state.shown += ui.RESULTS_PAGE;
    ui.renderResults(state.results, state.recipe?.id, state.shown);
    return;
  }
  const btn = e.target.closest('.result[data-id]');
  if (btn) selectRecipe(btn.dataset.id);
});

$('show-results').addEventListener('click', () => setPicked(false));
$('smart-btn').addEventListener('click', smartSearch);
$('create-btn').addEventListener('click', createFromQuery);
$('retry-btn').addEventListener('click', () => runAnalysis());

const adjustServings = (delta) => {
  state.servings = Math.min(24, Math.max(1, state.servings + delta));
  refreshProfile();
};
$('servings-minus').addEventListener('click', () => adjustServings(-1));
$('servings-plus').addEventListener('click', () => adjustServings(1));


/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

chat.reset({ enabled: false, subtitle: 'Select a recipe, then ask how to make it healthier.' });
ui.showProfile('empty');
listCategories().then(ui.renderCategories).catch(() => { /* categories are a convenience */ });

const linked = new URLSearchParams(location.search).get('r'); // shareable link: chef.html?r=52772
if (linked && /^\d{1,8}$/.test(linked)) selectRecipe(linked);
