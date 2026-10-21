/**
 * NutriChef view code: turns data into DOM. No network and no storage here.
 * @module chef-ui
 */

import { CONFIG } from './config.js';
import { $, esc, mdLite } from './dom.js';
import { imageUrl } from './services/mealdb.js';

/* ---------------------------------------------------------------- */
/* Search column                                                    */
/* ---------------------------------------------------------------- */

export function renderCategories(names) {
  $('category-chips').innerHTML = names
    .map((n) => `<button type="button" class="chip" data-category="${esc(n)}">${esc(n)}</button>`)
    .join('');
}

export function setActiveCategory(name) {
  document.querySelectorAll('#category-chips .chip').forEach((c) => c.classList.toggle('is-on', c.dataset.category === name));
}

export function setMode(mode) {
  document.querySelectorAll('.seg[data-mode]').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('search-input').placeholder = mode === 'ingredient' ? 'e.g. chicken breast' : 'e.g. Glazed Salmon';
}

export function setSearchNote(text, isError = false) {
  const note = $('search-note');
  note.textContent = text;
  note.classList.toggle('is-error', isError);
}

export function showFallback(show) {
  $('fallback-box').hidden = !show;
}

export function setFallbackBusy(busy) {
  for (const id of ['smart-btn', 'create-btn']) $(id).disabled = busy;
}

export const RESULTS_PAGE = 10;

/** Show the first `shown` results; the rest sit behind a "Show more" button (no nested scrolling). */
export function renderResults(list, activeId, shown = RESULTS_PAGE) {
  const rows = list.slice(0, shown).map((r) => `
    <li>
      <button type="button" class="result${r.id === activeId ? ' is-active' : ''}" data-id="${esc(r.id)}">
        ${r.thumb ? `<img src="${esc(imageUrl(r.thumb, 'small'))}" alt="" loading="lazy" width="56" height="56">` : '<span class="result__ph" aria-hidden="true"></span>'}
        <span class="result__text">
          <strong>${esc(r.title)}</strong>
          <small>${esc([r.category, r.area].filter(Boolean).join(' · '))}</small>
        </span>
      </button>
    </li>`).join('');
  const left = list.length - shown;
  $('results').innerHTML = rows + (left > 0
    ? `<li><button type="button" class="btn btn--light more-btn" data-more>Show ${Math.min(RESULTS_PAGE, left)} more (${left} left)</button></li>`
    : '');
}

export function markActiveResult(id) {
  document.querySelectorAll('#results .result').forEach((b) => b.classList.toggle('is-active', b.dataset.id === id));
}

/* ---------------------------------------------------------------- */
/* Selected recipe card (left column)                               */
/* ---------------------------------------------------------------- */

/** @param {object} recipe  @param {object|null} analysis */
export function renderSelected(recipe, analysis = null) {
  $('selected-card').hidden = false;
  const img = $('selected-img');
  const photo = recipe.photo || (recipe.thumb ? imageUrl(recipe.thumb, 'medium') : '');
  if (photo) { img.src = photo; img.alt = recipe.title; img.hidden = false; }
  else { img.removeAttribute('src'); img.alt = ''; img.hidden = true; }

  $('selected-title').textContent = recipe.title;
  const tags = [recipe.category, recipe.area, ...(analysis?.tags || [])].filter(Boolean);
  $('selected-tags').innerHTML = [...new Set(tags)].map((t) => `<span class="badge">${esc(t)}</span>`).join('');

  $('selected-meta').textContent = analysis
    ? [analysis.prepMinutes && `Prep ${analysis.prepMinutes} min`, analysis.cookMinutes && `Cook ${analysis.cookMinutes} min`].filter(Boolean).join(' · ')
    : '';

  $('ingredients-list').innerHTML = recipe.ingredients
    .map((i) => `<li><span>${esc(i.name)}</span><em>${esc(i.measure)}</em></li>`).join('');

  const links = [];
  if (recipe.youtube) links.push(`<a href="${esc(recipe.youtube)}" target="_blank" rel="noopener noreferrer">Watch video</a>`);
  if (recipe.source) links.push(`<a href="${esc(recipe.source)}" target="_blank" rel="noopener noreferrer">Original recipe</a>`);
  const credit = recipe.photoCredit
    ? ` Photo: <a href="${esc(recipe.photoCredit.url)}" target="_blank" rel="noopener noreferrer">Wikipedia, ${esc(recipe.photoCredit.title)}</a>.`
    : '';
  $('selected-source').innerHTML = recipe.generated
    ? `Created by Gemini. ${esc(recipe.note || '')}${credit}`
    : links.join(' · ');
}

/* ---------------------------------------------------------------- */
/* Profile (center)                                                 */
/* ---------------------------------------------------------------- */

/** @param {'empty'|'loading'|'error'|'ready'} state */
export function showProfile(state, info = {}) {
  for (const s of ['empty', 'loading', 'error']) $(`profile-${s}`).hidden = s !== state;
  $('profile-content').hidden = state !== 'ready';
  if (state === 'loading') $('loading-title').textContent = `Analysing ${info.title || 'recipe'}…`;
  if (state === 'error') {
    $('error-title').textContent = info.title || 'Could not analyse this recipe.';
    $('error-text').textContent = info.text || '';
    $('retry-btn').hidden = !info.canRetry;
  }
}

/** Page-level message (rate limit, busy) shown above the profile. */
export function setStatus(text, isError = false) {
  const el = $('chef-status');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('is-error', isError);
}

const C = 2 * Math.PI * 42; // circle circumference for r = 42

function ring({ value, max, color, label, unit }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  return `
    <div class="ring" style="--c:${color}">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="ring__track" cx="50" cy="50" r="42"/>
        <circle class="ring__fill" cx="50" cy="50" r="42" transform="rotate(-90 50 50)"
                stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/>
      </svg>
      <div class="ring__label"><strong>${esc(value)}${esc(unit)}</strong><span>${esc(label)}</span></div>
    </div>`;
}

const tempText = (c, f) => (c || f ? `${c}°C / ${f}°F` : '');

/**
 * @param {object} analysis
 * @param {{kcal:number, proteinG:number, carbsG:number, fatG:number, vitamins:object[]}} per  per-serving values
 * @param {number} servings
 */
export function renderProfile(analysis, per, servings) {
  showProfile('ready');
  const dv = CONFIG.dailyValues;

  $('meta-chips').innerHTML = [
    analysis.prepMinutes && `Prep ${analysis.prepMinutes} min`,
    analysis.cookMinutes && `Cook ${analysis.cookMinutes} min`,
    analysis.difficulty,
  ].filter(Boolean).map((t) => `<span class="badge">${esc(t)}</span>`).join('');

  $('servings-value').textContent = servings;

  // Make "serving" concrete: how heavy is one, and what does it look like?
  const grams = per.servingGrams;
  $('facts-basis').textContent = grams ? `per serving ≈ ${grams}\u00a0g` : 'per serving';
  const bits = [];
  if (analysis.yieldGrams) bits.push(`Whole dish ≈ ${analysis.yieldGrams.toLocaleString()} g`);
  if (grams) bits.push(`1 serving ≈ ${grams} g`);
  if (analysis.servingLabel && servings === analysis.baseServings) bits.push(analysis.servingLabel);
  $('serving-info').textContent = bits.join(' · ');
  $('serving-info').hidden = bits.length === 0;
  $('rings').innerHTML = [
    ring({ value: per.kcal, max: dv.kcal, color: 'var(--green-800)', label: 'kcal', unit: '' }),
    ring({ value: per.proteinG, max: dv.protein, color: 'var(--blue)', label: 'Protein', unit: 'g' }),
    ring({ value: per.carbsG, max: dv.carbs, color: 'var(--green-500)', label: 'Carbs', unit: 'g' }),
    ring({ value: per.fatG, max: dv.fat, color: 'var(--yellow)', label: 'Fats', unit: 'g' }),
  ].join('');

  const tones = ['is-yellow', 'is-green', 'is-gray', 'is-orange', 'is-green', 'is-yellow'];
  $('vitamins').innerHTML = per.vitamins.length
    ? per.vitamins.map((v, i) => `
        <li title="${esc(v.role)}">
          <span class="vit__name ${tones[i % tones.length]}">${esc(v.name)}</span>
          <span class="vit__pill"><i style="width:${Math.min(100, v.percentDV)}%"></i><b>${v.percentDV}%</b></span>
          <small>${esc(v.role)}</small>
        </li>`).join('')
    : '<li class="muted">No standout vitamins or minerals for this recipe.</li>';

  $('science').innerHTML = analysis.science.length
    ? analysis.science.map((s) => `
        <li class="insight">
          <h5>${esc(s.topic)}</h5>
          <p>${esc(s.chemistry)}</p>
          <p class="insight__why"><b>Why it matters:</b> ${esc(s.whyItMatters)}</p>
        </li>`).join('')
    : '<li class="muted">No chemistry notes were returned.</li>';

  $('theory').innerHTML = analysis.theory.length
    ? analysis.theory.map((t) => `
        <li class="insight">
          <div class="insight__head">
            <h5>${esc(t.principle)}</h5>
            ${tempText(t.tempC, t.tempF) ? `<span class="temp">${esc(tempText(t.tempC, t.tempF))}</span>` : ''}
          </div>
          <p>${esc(t.explanation)}</p>
          ${t.tip ? `<p class="insight__tip"><b>Tip:</b> ${esc(t.tip)}</p>` : ''}
        </li>`).join('')
    : '<li class="muted">No cooking-theory notes were returned.</li>';

  $('safety').textContent = analysis.safety ? `Food safety: ${analysis.safety}` : '';
  $('safety').hidden = !analysis.safety;
  $('assumptions').textContent = analysis.assumptions
    ? `Estimates by Gemini. ${analysis.assumptions} Not medical advice.`
    : 'Estimates by Gemini. Not medical advice.';
}

/* ---------------------------------------------------------------- */
/* Steps (right column)                                             */
/* ---------------------------------------------------------------- */

/** Break the database's free-text instructions into readable steps (used before/without the AI analysis). */
export function splitInstructions(text) {
  let lines = String(text || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 2);
  lines = lines.map((l) => l.replace(/^(step\s*\d+[:.)-]?\s*|\d+[.)]\s+)/i, '')).filter(Boolean);
  if (lines.length >= 3) return lines;
  const sentences = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < sentences.length; i += 2) chunks.push(sentences.slice(i, i + 2).join(' '));
  return chunks.length ? chunks : lines;
}

export function renderSteps(recipe, analysis) {
  const ol = $('steps');
  if (analysis?.steps.length) {
    ol.innerHTML = analysis.steps.map((s, i) => `
      <li class="step">
        <span class="step__n">${i + 1}</span>
        <div>
          ${s.title ? `<h4>${esc(s.title)}</h4>` : ''}
          <p>${esc(s.text)}</p>
          ${(tempText(s.tempC, s.tempF) || s.minutes) ? `
            <div class="step__meta">
              ${tempText(s.tempC, s.tempF) ? `<span class="temp">${esc(tempText(s.tempC, s.tempF))}</span>` : ''}
              ${s.minutes ? `<span class="time">${s.minutes} min</span>` : ''}
            </div>` : ''}
        </div>
      </li>`).join('');
    return;
  }
  const steps = splitInstructions(recipe?.instructions);
  ol.innerHTML = steps.length
    ? steps.map((t, i) => `<li class="step"><span class="step__n">${i + 1}</span><div><p>${esc(t)}</p></div></li>`).join('')
    : '<li class="steps__empty">Select a recipe to see the steps.</li>';
}

/* ---------------------------------------------------------------- */
/* Chat                                                             */
/* ---------------------------------------------------------------- */

export const DEFAULT_CHAT_CHIPS = [
  'Make it higher in protein',
  'Make it healthier',
  'Lower the calories',
  'Explain the science',
];

export function resetChat(title) {
  $('chat-log').innerHTML = '';
  $('chat-sub').textContent = title ? `Chatting about ${title}` : 'Select a recipe, then ask how to make it healthier.';
  const on = Boolean(title);
  $('chat-input').disabled = !on;
  $('chat-send').disabled = !on;
  $('chat-input').value = '';
  renderChatChips(on ? DEFAULT_CHAT_CHIPS : []);
  if (on) {
    appendMessage('ai', `Hi! I can help you make **${title}** healthier, higher in protein or lower in calories, or explain the science behind it. What would you like?`);
  }
}

export function renderChatChips(list) {
  $('chat-chips').innerHTML = list.map((t) => `<button type="button" class="chip" data-q="${esc(t)}">${esc(t)}</button>`).join('');
}

export function appendMessage(role, text) {
  const log = $('chat-log');
  const el = document.createElement('div');
  el.className = `msg msg--${role}`;
  el.innerHTML = role === 'user'
    ? `<p><b>You:</b> ${esc(text)}</p>`
    : `<span class="msg__avatar" aria-hidden="true">AI</span><div class="msg__text">${mdLite(text)}</div>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

export function setTyping(on) {
  const existing = $('chat-typing');
  if (!on) { existing?.remove(); return; }
  if (existing) return;
  const el = document.createElement('div');
  el.id = 'chat-typing';
  el.className = 'msg msg--ai';
  el.innerHTML = '<span class="msg__avatar" aria-hidden="true">AI</span><div class="msg__text typing"><span></span><span></span><span></span></div>';
  $('chat-log').appendChild(el);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}

export function setChatBusy(busy) {
  $('chat-send').disabled = busy || $('chat-input').disabled;
  $('chat-input').readOnly = busy;
}
