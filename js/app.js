/**
 * App entry point: wires the DOM events to the services and the UI.
 *
 * Flow of "Scan Now":
 *   photo (+ optional description) -> NutriAI via proxy -> meal estimate
 *         -> (Open Food Facts by barcode, else by meal name) -> product facts
 *         -> render + save to history
 *
 * @module app
 */

import { predictMeal, chatAboutMeal, RateLimitError } from './services/gemini.js';
import { setupChat } from './chat.js';
import { CONFIG } from './config.js';
import { getProductByBarcode, searchProduct } from './services/openfoodfacts.js';
import { prepareImage, makeThumbnail, detectBarcode } from './services/image.js';
import * as store from './services/storage.js';
import * as ui from './ui.js';

const $ = (id) => document.getElementById(id);

/** In-memory state for the current scan. */
const state = { image: null, file: null, meal: null, product: null };
const settings = store.loadSettings();

// ---------- init ----------
loadWebAnalytics(CONFIG.webAnalyticsToken);
$('use-ai').checked = settings.useAi;
$('use-off').checked = settings.useOff;

/** Timestamp (ms) before which a live NutriAI call is not allowed (cooldown / 429 back-off). */
let blockedUntil = 0;

// ---------- NutriChat: ask about the scanned meal (or about healthy eating in general) ----------
const GENERAL_CHIPS = ['Healthy breakfast ideas', 'High-protein snacks', 'How do I read a food label?'];
const MEAL_CHIPS = ['Suggest high-protein swaps', 'Make it lower in calories', 'Is this a balanced meal?', 'Adjust the portion size'];

let chatBlockedUntil = 0;
const chat = setupChat({
  ask: (history) => chatAboutMeal(mealContext(), history),
  secondsToWait: () => Math.max(0, Math.ceil((chatBlockedUntil - Date.now()) / 1000)),
  startCooldown: () => { chatBlockedUntil = Date.now() + CONFIG.chat.cooldownMs; },
  errorText: (err) => {
    if (err instanceof RateLimitError) {
      chatBlockedUntil = Date.now() + err.retryAfterS * 1000;
      return `Too many AI requests. Try again in ${err.retryAfterS}s.`;
    }
    return err.message || 'Something went wrong.';
  },
  notify: (message, isError) => { if (message) ui.setStatus('Please wait.', message, isError); },
  maxChars: CONFIG.chat.maxMessageChars,
});

/** What the chat knows about the current result (nothing before the first scan). */
function mealContext() {
  const { meal, product } = state;
  if (!meal && !product) return undefined;
  return {
    meal: meal ? { name: meal.mealName, calories: meal.calories, proteinG: meal.proteinG, carbsG: meal.carbsG, fatG: meal.fatG, items: meal.items } : undefined,
    product: product ? { name: product.name, brand: product.brand, nutriScore: product.nutriScore, per100g: product.per100g } : undefined,
  };
}

function resetChat() {
  chat.reset({
    subtitle: 'Ask about your meal or about healthy eating.',
    greeting: "Hey there! Upload a photo or ask me to analyse your meal's nutrition, suggest healthier swaps, or adjust portion sizes.",
    chips: GENERAL_CHIPS,
  });
}

/** A new result means a new conversation, framed around what was found. */
function startChatForResult() {
  const { meal, product } = state;
  const greeting = meal
    ? `I can see **${meal.mealName}**, about ${meal.calories} kcal. Want ideas to make it lighter, higher in protein, or a different portion size?`
    : `That is **${product.name}**${product.nutriScore ? ` (Nutri-Score ${product.nutriScore.toUpperCase()})` : ''}. Ask me how it fits into your day, or for healthier alternatives.`;
  chat.reset({ subtitle: `Chatting about ${meal ? meal.mealName : product.name}`, greeting, chips: MEAL_CHIPS });
}
resetChat();

// ---------- events ----------
// Two ways in: the camera input opens the rear camera on phones; the upload input opens the gallery or files.
$('camera-btn').addEventListener('click', () => $('camera-input').click());
$('upload-btn').addEventListener('click', () => $('upload-input').click());
$('camera-input').addEventListener('change', onPhotoChosen);
$('upload-input').addEventListener('change', onPhotoChosen);
$('scan-btn').addEventListener('click', onScan);

// Meal description: live counter, quick-add chips, clear
const hintBox = $('meal-hint');
const syncHint = () => {
  $('hint-count').textContent = `${hintBox.value.length} / ${hintBox.maxLength}`;
  const text = hintBox.value.toLowerCase();
  document.querySelectorAll('.hint-chips .chip').forEach((c) => c.classList.toggle('is-on', text.includes(c.dataset.add.toLowerCase())));
};
hintBox.addEventListener('input', syncHint);
$('hint-clear').addEventListener('click', () => { hintBox.value = ''; syncHint(); hintBox.focus(); });
document.querySelector('.hint-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip || hintBox.value.toLowerCase().includes(chip.dataset.add.toLowerCase())) return;
  const sep = hintBox.value.trim() ? ', ' : '';
  hintBox.value = `${hintBox.value.trim()}${sep}${chip.dataset.add.toLowerCase()}`.slice(0, hintBox.maxLength);
  syncHint();
});

$('use-ai').addEventListener('change', (e) => store.saveSettings({ useAi: e.target.checked }));
$('use-off').addEventListener('change', (e) => store.saveSettings({ useOff: e.target.checked }));

// "New item": drop the photo, description, barcode and results so the next meal starts clean.
$('new-btn').addEventListener('click', () => {
  state.image = null;
  state.file = null;
  $('camera-input').value = ''; // lets the same file be picked again
  $('upload-input').value = '';
  $('barcode').value = '';
  hintBox.value = '';
  syncHint();
  state.meal = null;
  state.product = null;
  ui.resetPreview();
  ui.resetResults();
  resetChat();
  ui.setStatus('Ready to scan.', 'Snap your meal or look up a barcode.');
});

$('help-btn').addEventListener('click', () => $('settings-dialog').showModal());
$('history-btn').addEventListener('click', () => {
  ui.renderHistory(store.loadHistory());
  $('history-dialog').showModal();
});
$('clear-history').addEventListener('click', () => {
  store.clearHistory();
  ui.renderHistory([]);
});

// ---------- handlers ----------
async function onPhotoChosen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    state.file = file;
    state.image = await prepareImage(file);
    ui.showPreview(state.image.dataUrl);
    ui.setStatus('Photo ready.', 'Press Scan Now to analyse your meal.');

    // Convenience: if the photo shows a barcode, prefill the field.
    $('barcode').value = '';
    const code = await detectBarcode(file);
    if (code) {
      $('barcode').value = code;
      ui.setStatus('Barcode detected.', `${code} – press Scan Now to look it up.`);
    }
  } catch (err) {
    state.image = null; // never scan a half-loaded photo
    ui.resetPreview();
    ui.setStatus('Could not read photo.', err.message, true);
  }
}

async function onScan() {
  let barcode = $('barcode').value.trim();
  const hint = $('meal-hint').value.trim();
  const useAi = $('use-ai').checked;
  const useOff = $('use-off').checked;

  if (!state.image && !barcode && !(hint && useOff)) {
    return ui.setStatus('Nothing to scan.', 'Add a photo, type a barcode or describe the food first.', true);
  }
  const callsAi = useAi && state.image;
  if (callsAi && Date.now() < blockedUntil) {
    const s = Math.ceil((blockedUntil - Date.now()) / 1000);
    return ui.setStatus('Please wait.', `Next scan available in ${s}s (protects the AI quota).`, true);
  }

  ui.setBusy(true);
  ui.setStatus('Scanning…', 'Contacting the services.');
  ui.resetResults(); // a re-run must not leave stale results behind (the photo stays loaded)
  state.meal = null;
  state.product = null;

  try {
    let meal = null;
    let product = null;

    // 1) Meal estimate (needs a photo)
    if (useAi && state.image) {
      blockedUntil = Date.now() + CONFIG.scan.cooldownMs;
      meal = await predictMeal(state.image, hint);
      ui.renderMeal(meal, state.image.dataUrl);
    } else if (state.image) {
      ui.renderMeal(null, state.image.dataUrl);
    }

    // 2) Product facts: barcode wins, otherwise search by the AI's meal name
    let offFailed = false;
    if (useOff) {
      try {
        if (barcode) {
          product = await getProductByBarcode(barcode);
        } else if (meal && meal.calories > 0) {
          product = await searchProduct(meal.mealName);
        } else if (hint) {
          product = await searchProduct(hint); // NutriAI off: the description narrows the database search
        }
      } catch (err) {
        console.warn(err); // Open Food Facts is community-run and sometimes returns 5xx
        offFailed = true;
      }
      ui.renderProduct(product, barcode);
    }

    // 3) Breakdown: prefer the meal estimate, fall back to per-100g product data
    if (meal && meal.isFood) {
      ui.renderBreakdown(
        { kcal: meal.calories, protein: meal.proteinG, carbs: meal.carbsG, fat: meal.fatG },
        'AI estimate, whole meal',
      );
    } else if (product) {
      ui.renderBreakdown(product.per100g, 'per 100 g');
    }

    if ((meal && meal.isFood) || product) await saveToHistory(meal, product);

    // Give NutriChat this result as context (a non-food photo gives it nothing to talk about).
    state.meal = meal && meal.isFood ? meal : null;
    state.product = product;
    if (state.meal || state.product) startChatForResult();

    if (meal && !meal.isFood) {
      ui.setStatus('No food detected.', meal.notes || 'Upload a photo of a meal, drink or food package.', true);
    } else if (meal) {
      ui.setStatus('Done.', `${meal.mealName}: ${meal.calories} kcal${offFailed ? ' (Open Food Facts is unavailable right now)' : ''}`);
    } else if (product) {
      ui.setStatus('Product found.', product.name);
    } else if (offFailed) {
      ui.setStatus('Open Food Facts unavailable.', 'The food database did not respond. Try again in a moment.', true);
    } else if (useOff && !barcode) {
      ui.setStatus('No barcode found.', 'Could not read a barcode from the photo. Type the digits, or tick NutriAI AI to identify the meal.', true);
    } else {
      ui.setStatus('Not found.', `Open Food Facts has no product for ${barcode}.`, true);
    }
  } catch (err) {
    console.error(err);
    if (err instanceof RateLimitError) {
      blockedUntil = Date.now() + err.retryAfterS * 1000;
      ui.setStatus('Rate limit reached.', `Too many AI requests. Try again in ${err.retryAfterS}s.`, true);
    } else {
      ui.setStatus('Something went wrong.', err.message, true);
    }
  } finally {
    ui.setBusy(false);
  }
}

/** Cookie-free page analytics. Loads nothing unless a token is configured. */
function loadWebAnalytics(token) {
  if (!token) return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.head.appendChild(script);
}

async function saveToHistory(meal, product) {
  const thumb = state.image ? await makeThumbnail(state.image.dataUrl).catch(() => '') : '';
  store.addHistory({
    at: Date.now(),
    thumb,
    mealName: meal?.mealName,
    calories: meal?.calories,
    productName: product?.name,
  });
}
