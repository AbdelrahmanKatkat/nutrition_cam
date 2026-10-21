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
import * as store from './services/storage.js';

/** In-memory state for the current visit. */
const state = {
  mode: 'name',        // 'name' | 'ingredient'
  query: '',
  results: [],
  recipe: null,
  analysis: null,
  servings: 4,
  messages: [],        // chat history sent to Gemini
  chatBusy: false,
  searchToken: 0,      // lets a newer search/selection win over a slower older one
  selectToken: 0,
};

/** Timestamp (ms) before which another AI request is refused (cooldown, or after a 429). */
let blockedUntil = 0;
const secondsToWait = () => Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000));
const startCooldown = () => { blockedUntil = Date.now() + CONFIG.chef.cooldownMs; };

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

function showResults(list, note) {
  state.results = list;
  ui.renderResults(list, state.recipe?.id);
  ui.setSearchNote(note);
  // The free database is small (about 790 recipes): offer Gemini whenever a search leaves few results.
  ui.showFallback(Boolean(state.query) && list.length < 5);
}

async function runSearch(rawQuery) {
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
  ui.setSearchNote('Gemini is working out what to search for…');
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
      ui.setSearchNote('Still nothing in the database. You can have Gemini create this recipe.', true);
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
  ui.setSearchNote('Gemini is writing the recipe…');
  startCooldown();
  try {
    const raw = await createRecipe(state.query);
    const recipe = fromGenerated(raw);
    if (!recipe.ingredients.length || !recipe.instructions) throw new Error('Gemini could not create a recipe for that request. Try describing a dish.');
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
  state.messages = [];
  state.servings = recipe.servings > 0 ? recipe.servings : 4;

  ui.markActiveResult(recipe.id);
  ui.renderSelected(recipe);
  ui.renderSteps(recipe, null); // the database's own steps show immediately, before the AI answers
  ui.resetChat(recipe.title);
  history.replaceState(null, '', recipe.generated ? location.pathname : `?r=${encodeURIComponent(recipe.id)}`);
  if (window.matchMedia('(max-width: 999px)').matches) $('profile-title').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const cached = recipe.generated ? null : store.getChefAnalysis(recipe.id);
  if (cached) { applyAnalysis(cached); return; }
  await runAnalysis(token);
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
    if (!analysis.totals.kcal && !analysis.steps.length) throw new Error('Gemini returned an empty analysis. Please try again.');
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
/* Chat                                                                */
/* ------------------------------------------------------------------ */

async function sendChat(rawText) {
  const text = rawText.trim().slice(0, CONFIG.chef.maxMessageChars);
  if (!text || !state.recipe || state.chatBusy) return;
  const wait = secondsToWait();
  if (wait) return ui.setStatus(`Please wait ${wait}s before the next question.`, true);

  ui.setStatus('');
  state.chatBusy = true;
  ui.setChatBusy(true);
  state.messages.push({ role: 'user', text });
  ui.appendMessage('user', text);
  $('chat-input').value = '';
  ui.renderChatChips([]);
  ui.setTyping(true);
  startCooldown();

  try {
    const per = state.analysis ? perServing(state.analysis, state.servings) : null;
    const reply = await chatAboutRecipe({
      title: state.recipe.title,
      ingredients: state.recipe.ingredients,
      nutrition: per ? { servings: state.servings, kcal: per.kcal, proteinG: per.proteinG, carbsG: per.carbsG, fatG: per.fatG } : undefined,
    }, state.messages);
    ui.setTyping(false);
    state.messages.push({ role: 'assistant', text: reply.reply });
    ui.appendMessage('ai', reply.reply);
    ui.renderChatChips(reply.suggestions.length ? reply.suggestions : ui.DEFAULT_CHAT_CHIPS);
  } catch (err) {
    ui.setTyping(false);
    state.messages.pop(); // keep the history strictly user/assistant alternating
    ui.appendMessage('ai', `Sorry, I couldn't answer that. ${aiErrorText(err)} Please send your question again.`);
    ui.renderChatChips(ui.DEFAULT_CHAT_CHIPS);
  } finally {
    state.chatBusy = false;
    ui.setChatBusy(false);
  }
}

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
  const btn = e.target.closest('.result[data-id]');
  if (btn) selectRecipe(btn.dataset.id);
});

$('smart-btn').addEventListener('click', smartSearch);
$('create-btn').addEventListener('click', createFromQuery);
$('retry-btn').addEventListener('click', () => runAnalysis());

const adjustServings = (delta) => {
  state.servings = Math.min(24, Math.max(1, state.servings + delta));
  refreshProfile();
};
$('servings-minus').addEventListener('click', () => adjustServings(-1));
$('servings-plus').addEventListener('click', () => adjustServings(1));

$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  sendChat($('chat-input').value);
});
$('chat-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-q]');
  if (chip) sendChat(chip.dataset.q);
});
$('chat-input').maxLength = CONFIG.chef.maxMessageChars;

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

ui.resetChat('');
ui.showProfile('empty');
listCategories().then(ui.renderCategories).catch(() => { /* categories are a convenience */ });

const linked = new URLSearchParams(location.search).get('r'); // shareable link: chef.html?r=52772
if (linked && /^\d{1,8}$/.test(linked)) selectRecipe(linked);
