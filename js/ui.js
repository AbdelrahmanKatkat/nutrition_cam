/**
 * DOM rendering. No network or storage logic lives here – it only turns data into pixels.
 * @module ui
 */

import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

/** Escape text before putting it in innerHTML (OFF data is user-contributed). */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Show the chosen photo in the dropzone. */
export function showPreview(dataUrl) {
  $('preview').src = dataUrl;
  $('preview').hidden = false;
  $('dropzone-hint').hidden = true;
}

/**
 * Update the footer status line.
 * @param {string} title
 * @param {string} text
 * @param {boolean} [isError]
 */
export function setStatus(title, text, isError = false) {
  $('status-title').textContent = title;
  $('status-text').textContent = text;
  document.querySelector('.footer__status').classList.toggle('is-error', isError);
}

export function setBusy(busy) {
  const btn = $('scan-btn');
  btn.disabled = busy;
  btn.textContent = busy ? 'Scanning…' : 'Scan Now';
}

/** Put the photo box back to its empty state. */
export function resetPreview() {
  $('preview').removeAttribute('src');
  $('preview').hidden = true;
  $('dropzone-hint').hidden = false;
}

/** Clear every result card (keeps the chosen photo in the capture box). */
export function resetResults() {
  $('result-photo').removeAttribute('src');
  $('result-photo').hidden = true;
  $('result-placeholder').hidden = false;
  for (const id of ['meal-name', 'meal-items', 'meal-notes', 'confidence-pct', 'breakdown-basis']) $(id).textContent = '';
  $('meal-name').textContent = '—';
  $('kcal').textContent = '—';
  $('confidence-bar').style.width = '0';
  for (const key of ['cal', 'pro', 'carb', 'fat']) {
    $(`b-${key}`).textContent = '—';
    $(`bar-${key}`).style.width = '0';
  }
  $('grade').textContent = '—';
  $('grade').dataset.grade = '';
  $('off-product').textContent = 'No product looked up yet.';
  $('badges').innerHTML = '';
  $('barcode-info').textContent = '—';
}

/** @param {import('./services/gemini.js').MealPrediction|null} meal */
export function renderMeal(meal, photoUrl) {
  if (photoUrl) {
    $('result-photo').src = photoUrl;
    $('result-photo').hidden = false;
    $('result-placeholder').hidden = true;
  }
  if (!meal) return;
  $('meal-name').textContent = meal.mealName;
  $('kcal').textContent = meal.calories;
  const pct = Math.round(meal.confidence * 100);
  $('confidence-pct').textContent = `${pct}%`;
  $('confidence-bar').style.width = `${pct}%`;
  $('meal-items').textContent = meal.items?.length
    ? meal.items.map((i) => `${i.name} ~${i.grams} g (${i.calories} kcal)`).join(' · ')
    : '';
  $('meal-notes').textContent = meal.notes;
}

/**
 * Render the breakdown bars. `basis` tells the user whether the numbers are
 * the whole meal (AI estimate) or per-100g (Open Food Facts product).
 */
export function renderBreakdown(values, basis) {
  const dv = CONFIG.dailyValues;
  const rows = [
    ['cal', values.kcal, dv.kcal, ''],
    ['pro', values.protein, dv.protein, 'g'],
    ['carb', values.carbs, dv.carbs, 'g'],
    ['fat', values.fat, dv.fat, 'g'],
  ];
  for (const [key, value, daily, unit] of rows) {
    $(`b-${key}`).textContent = `${value}${unit}`;
    $(`bar-${key}`).style.width = `${Math.min(100, (value / daily) * 100)}%`;
  }
  $('breakdown-basis').textContent = basis ? `(${basis})` : '';
}

/** @param {import('./services/openfoodfacts.js').FoodProduct|null} product */
export function renderProduct(product, barcode) {
  const grade = $('grade');
  $('barcode-info').textContent = barcode || product?.code || '—';

  if (!product) {
    grade.textContent = '—';
    grade.dataset.grade = '';
    $('off-product').textContent = 'No matching product found in Open Food Facts.';
    $('badges').innerHTML = '';
    return;
  }
  grade.textContent = product.nutriScore ? `Grade ${product.nutriScore.toUpperCase()}` : 'N/A';
  grade.dataset.grade = product.nutriScore || '';
  $('off-product').textContent = [product.name, product.brand].filter(Boolean).join(' – ');
  $('badges').innerHTML = product.labels.map((l) => `<span class="badge">${esc(l)}</span>`).join('');
}

/** Fill the history dialog list. */
export function renderHistory(items) {
  $('history-list').innerHTML = items.length
    ? items.map((h) => `
        <li>
          ${h.thumb ? `<img src="${esc(h.thumb)}" alt="">` : '<img alt="">'}
          <div>
            <strong>${esc(h.mealName || h.productName || 'Scan')}</strong>
            <small>${h.calories != null ? `${esc(h.calories)} kcal · ` : ''}${new Date(h.at).toLocaleString()}</small>
          </div>
        </li>`).join('')
    : '<li>No scans yet.</li>';
}
