/**
 * NutriMap view: pins, the top-cuisine strip, the result cards and their selected detail.
 * Renders only; no network calls here.
 * @module map-ui
 */

import { $, esc } from './dom.js';
import { bandFor, UNRATED } from './services/ratings.js';
import { cuisineLabel, formatDistance } from './services/places.js';

/* Both styles use the OpenStreetMap tiles (no key needed). "Dark" is the same tiles with a colour filter. */
const TILE = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attr: '© OpenStreetMap contributors',
};

/* ---------------- map and pins ---------------- */

/** Create the Leaflet map and its tile layers. */
export function createMap(centre, zoom) {
  const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([centre.lat, centre.lon], zoom);
  const layers = {
    dark: L.tileLayer(TILE.url, { maxZoom: 19, attribution: TILE.attr, className: 'nm-tiles-dark' }),
    light: L.tileLayer(TILE.url, { maxZoom: 19, attribution: TILE.attr }),
  };
  layers.dark.addTo(map);
  return { map, layers, pins: L.layerGroup().addTo(map), current: 'dark' };
}

export function setTiles(view, name) {
  if (view.current === name) return;
  view.map.removeLayer(view.layers[view.current]);
  view.layers[name].addTo(view.map);
  view.current = name;
  document.getElementById('layer-dark').setAttribute('aria-pressed', String(name === 'dark'));
  document.getElementById('layer-light').setAttribute('aria-pressed', String(name === 'light'));
}

function pinIcon(band, label, selected) {
  return L.divIcon({
    className: 'nm-pin-wrap',
    html: `<span class="nm-pin${selected ? ' is-selected' : ''}" style="--pin:${band.color}">${esc(label)}</span>`,
    iconSize: [46, 46],
    iconAnchor: [23, 42],
  });
}

/**
 * Draw one pin per visible place. Pins show the rating when there is one, or a dot when not.
 * @param {Map} view
 * @param {Array<{place: object, rating?: {rating:number}}>} items
 * @param {string|null} selectedId
 * @param {(id:string)=>void} onSelect
 * @returns {Map<string, L.Marker>}
 */
export function renderPins(view, items, selectedId, onSelect) {
  view.pins.clearLayers();
  const markers = new Map();
  for (const { place, rating } of items) {
    const score = rating?.rating;
    const band = Number.isFinite(score) ? bandFor(score) : UNRATED;
    const label = Number.isFinite(score) ? score.toFixed(1) : '•';
    const marker = L.marker([place.lat, place.lon], {
      icon: pinIcon(band, label, place.id === selectedId),
      keyboard: true,
      title: place.name,
      alt: place.name,
    });
    marker.on('click', () => onSelect(place.id));
    marker.addTo(view.pins);
    markers.set(place.id, marker);
  }
  return markers;
}

/** Re-draw only the selected state, without rebuilding every pin. */
export function markSelectedPin(view, markers, prevId, nextId, items) {
  const byId = new Map(items.map((i) => [i.place.id, i]));
  for (const id of [prevId, nextId]) {
    const marker = markers.get(id);
    const item = byId.get(id);
    if (!marker || !item) continue;
    const score = item.rating?.rating;
    const band = Number.isFinite(score) ? bandFor(score) : UNRATED;
    marker.setIcon(pinIcon(band, Number.isFinite(score) ? score.toFixed(1) : '•', id === nextId));
  }
}

/* ---------------- cuisine strip ---------------- */

/** @param {{key:string, count:number, photo:{url:string}|null}[]} tops */
export function renderStrip(tops) {
  $('cuisine-strip').innerHTML = tops.length
    ? tops.map((t) => `
        <button type="button" class="nm-tile" data-cuisine="${esc(t.key)}" aria-label="Show ${esc(cuisineLabel(t.key))}, ${t.count} places">
          <span class="nm-tile__img">${t.photo
            ? `<img src="${esc(t.photo.url)}" alt="" loading="lazy">`
            : `<span class="nm-tile__letter" aria-hidden="true">${esc(cuisineLabel(t.key).charAt(0))}</span>`}</span>
          <span class="nm-tile__name">${esc(cuisineLabel(t.key))}</span>
          <small>${t.count} place${t.count === 1 ? '' : 's'}</small>
        </button>`).join('')
    : '<p class="nm-muted">Zoom in to see cuisines around you.</p>';
}

/* ---------------- filter selects ---------------- */

/** @param {{key:string, count:number}[]} options  @param {string} a  @param {string} b */
export function renderFilters(options, a, b) {
  const build = (selected) => [
    `<option value="">Any cuisine</option>`,
    ...options.map((o) => `<option value="${esc(o.key)}"${o.key === selected ? ' selected' : ''}>${esc(cuisineLabel(o.key))} (${o.count})</option>`),
  ].join('');
  $('cuisine-a').innerHTML = build(a);
  $('cuisine-b').innerHTML = build(b);
}

/* ---------------- result cards ---------------- */

function ratingBadge(rating) {
  if (!rating) return `<span class="nm-rating nm-rating--none" style="--pin:${UNRATED.color}" title="${UNRATED.label}">—</span>`;
  const band = bandFor(rating.rating);
  return `<span class="nm-rating" style="--pin:${band.color}" title="${esc(band.label)}">${rating.rating.toFixed(1)}</span>`;
}

function detailsList(place, distance) {
  const rows = [
    ['Cuisine', place.cuisines.length ? place.cuisines.map(cuisineLabel).join(', ') : 'Not tagged'],
    ['Type', place.amenity.replace('_', ' ')],
    ['Distance', distance ? formatDistance(distance) : '—'],
    ['Hours', place.hours || 'Not listed'],
    ['Phone', place.phone || 'Not listed'],
  ];
  const website = place.website
    ? `<a href="${esc(place.website)}" target="_blank" rel="noopener noreferrer">${esc(place.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`
    : 'Not listed';
  return `<dl class="nm-details">
      ${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}
      <div><dt>Website</dt><dd>${website}</dd></div>
    </dl>`;
}

/**
 * @param {{place:object, rating?:object, distance:number|null, photo?:object|null}[]} items  already sorted
 * @param {string|null} selectedId
 */
export function renderResults(items, selectedId) {
  $('list-count').textContent = `Results (${items.length})`;
  $('results').innerHTML = items.map(({ place, rating, distance, photo }) => {
    const selected = place.id === selectedId;
    const img = photo
      ? `<img src="${esc(photo.url)}" alt="" loading="lazy">`
      : `<span class="nm-card__letter" aria-hidden="true">${esc(cuisineLabel(place.cuisine).charAt(0))}</span>`;
    const dirs = `https://www.openstreetmap.org/directions?to=${place.lat}%2C${place.lon}`;
    return `
      <li>
        <article class="nm-card${selected ? ' is-selected' : ''}" data-id="${esc(place.id)}">
          <button type="button" class="nm-card__head" aria-expanded="${selected}" data-select="${esc(place.id)}">
            <span class="nm-card__text">
              <strong>${esc(place.name)}</strong>
              <small>${esc(cuisineLabel(place.cuisine))}${place.address ? ` · ${esc(place.address)}` : ''}</small>
            </span>
            ${ratingBadge(rating)}
          </button>
          ${selected ? `
            <div class="nm-card__body">
              <div class="nm-card__media">
                <span class="nm-card__img">${img}</span>
                ${photo ? `<a class="nm-credit" href="${esc(photo.pageUrl)}" target="_blank" rel="noopener noreferrer">Photo: Wikipedia</a>` : ''}
              </div>
              <p class="nm-card__rating-line">${rating
                ? `<b>${rating.rating.toFixed(1)}</b> · ${rating.count ? `${rating.count} ratings` : 'rated'}`
                : `<span class="nm-muted">${UNRATED.label}. Ratings come from a rating source (not connected yet).</span>`}</p>
              <details class="nm-detail" open>
                <summary>Details</summary>
                ${detailsList(place, distance)}
              </details>
              <div class="nm-card__actions">
                <a class="btn btn--light" href="${dirs}" target="_blank" rel="noopener noreferrer">Get directions</a>
              </div>
            </div>` : ''}
        </article>
      </li>`;
  }).join('');
}

export function setStatus(text, isError = false) {
  const el = $('nm-status');
  el.textContent = text || '';
  el.classList.toggle('is-error', isError);
}

export function setHint(text) {
  $('map-hint').textContent = text || '';
  $('map-hint').hidden = !text;
}
