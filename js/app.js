/**
 * App entry point: wires the DOM events to the services and the UI.
 *
 * Flow of "Scan Now":
 *   photo -> (Gemini | mock) -> meal estimate
 *         -> (Open Food Facts by barcode, else by meal name) -> product facts
 *         -> render + save to history
 *
 * @module app
 */

import { predictMeal, mockPredictMeal, RateLimitError } from './services/gemini.js';
import { CONFIG } from './config.js';
import { getProductByBarcode, searchProduct } from './services/openfoodfacts.js';
import { prepareImage, makeThumbnail, detectBarcode } from './services/image.js';
import * as store from './services/storage.js';
import * as ui from './ui.js';

const $ = (id) => document.getElementById(id);

/** In-memory state for the current scan. */
const state = { image: null, file: null };
const settings = store.loadSettings();

// ---------- init ----------
$('api-toggle').checked = settings.apiMode;
$('use-gemini').checked = settings.useGemini;
$('use-off').checked = settings.useOff;
ui.setModeText(settings.apiMode);

/** Timestamp (ms) before which a live Gemini call is not allowed (cooldown / 429 back-off). */
let blockedUntil = 0;

// ---------- events ----------
$('photo-btn').addEventListener('click', () => $('photo-input').click());
$('photo-input').addEventListener('change', onPhotoChosen);
$('scan-btn').addEventListener('click', onScan);

// Meal description: live counter, quick-add chips, clear
const hintBox = $('meal-hint');
const syncHint = () => {
  $('hint-count').textContent = `${hintBox.value.length} / ${hintBox.maxLength}`;
  const text = hintBox.value.toLowerCase();
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', text.includes(c.dataset.add.toLowerCase())));
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

$('api-toggle').addEventListener('change', (e) => {
  settings.apiMode = e.target.checked;
  store.saveSettings({ apiMode: settings.apiMode });
  ui.setModeText(settings.apiMode);
});
$('use-gemini').addEventListener('change', (e) => store.saveSettings({ useGemini: e.target.checked }));
$('use-off').addEventListener('change', (e) => store.saveSettings({ useOff: e.target.checked }));

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
    ui.setStatus('Could not read photo.', err.message, true);
  }
}

async function onScan() {
  let barcode = $('barcode').value.trim();
  const hint = $('meal-hint').value.trim();
  const useGemini = $('use-gemini').checked;
  const useOff = $('use-off').checked;
  const live = settings.apiMode;

  if (!state.image && !barcode && !(hint && useOff)) {
    return ui.setStatus('Nothing to scan.', 'Add a photo, type a barcode or describe the food first.', true);
  }
  const callsGemini = live && useGemini && state.image;
  if (callsGemini && Date.now() < blockedUntil) {
    const s = Math.ceil((blockedUntil - Date.now()) / 1000);
    return ui.setStatus('Please wait.', `Next scan available in ${s}s (protects the AI quota).`, true);
  }

  ui.setBusy(true);
  ui.setStatus('Scanning…', live ? 'Contacting the services.' : 'Using demo data.');

  try {
    // Barcode lookup with no Gemini: make sure we tried to read the photo first.
    if (useOff && !barcode && state.file) {
      barcode = (await detectBarcode(state.file)) || '';
      if (barcode) $('barcode').value = barcode;
    }

    let meal = null;
    let product = null;

    // 1) Meal estimate (needs a photo)
    if (useGemini && state.image) {
      if (live) blockedUntil = Date.now() + CONFIG.scan.cooldownMs;
      meal = live
        ? await predictMeal(state.image, hint)
        : await mockPredictMeal();
      ui.renderMeal(meal, state.image.dataUrl);
    } else if (state.image) {
      ui.renderMeal(null, state.image.dataUrl);
    }

    // 2) Product facts: barcode wins, otherwise search by the AI's meal name
    let offFailed = false;
    if (useOff) {
      try {
        if (!live) {
          product = mockProduct(barcode);
        } else if (barcode) {
          product = await getProductByBarcode(barcode);
        } else if (meal && meal.calories > 0) {
          product = await searchProduct(meal.mealName);
        } else if (hint) {
          product = await searchProduct(hint); // Gemini off: the description narrows the database search
        }
      } catch (err) {
        console.warn(err); // Open Food Facts is community-run and sometimes returns 5xx
        offFailed = true;
      }
      ui.renderProduct(product, barcode);
    }

    // 3) Breakdown: prefer the meal estimate, fall back to per-100g product data
    if (meal) {
      ui.renderBreakdown(
        { kcal: meal.calories, protein: meal.proteinG, carbs: meal.carbsG, fat: meal.fatG },
        'AI estimate, whole meal',
      );
    } else if (product) {
      ui.renderBreakdown(product.per100g, 'per 100 g');
    }

    if (meal || product) await saveToHistory(meal, product);

    if (meal) {
      ui.setStatus('Done.', `${meal.mealName}: ${meal.calories} kcal${offFailed ? ' (Open Food Facts is unavailable right now)' : ''}`);
    } else if (product) {
      ui.setStatus('Product found.', product.name);
    } else if (offFailed) {
      ui.setStatus('Open Food Facts unavailable.', 'The food database did not respond. Try again in a moment.', true);
    } else if (useOff && !barcode) {
      ui.setStatus('No barcode found.', 'Could not read a barcode from the photo. Type the digits, or tick Gemini AI to identify the meal.', true);
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

/** Demo product so the Open Food Facts card can be styled/tested offline. */
function mockProduct(barcode) {
  return {
    code: barcode || '0000000000000',
    name: 'Demo granola bar',
    brand: 'NutriSnap Demo',
    nutriScore: 'a',
    per100g: { kcal: 380, protein: 9, carbs: 58, fat: 12 },
    labels: ['Organic', 'No added sugar', 'High fibre'],
    image: '',
  };
}
