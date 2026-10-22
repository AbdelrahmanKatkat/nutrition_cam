/**
 * NutriMap entry point: loads restaurants for the visible map area, filters by cuisine, shows
 * top cuisines with photos, and keeps the selected restaurant in sync between list and map.
 *
 * Flow:
 *   move the map (zoom >= 14) -> Overpass query for that box (cached) -> places
 *   -> ratings (none connected yet) -> filter -> pins + strip + list
 *
 * @module map
 */

import { $ } from './dom.js';
import { CONFIG } from './config.js';
import * as ui from './map-ui.js';
import { cellsFor, fetchCell, distanceM } from './services/places.js';
import { loadRatings } from './services/ratings.js';
import { getCuisinePhoto, hasCuisinePhoto } from './services/cuisine-images.js';
import { findPlace } from './services/geocode.js';

const MIN_ZOOM = 15;          // below this the view covers too many cells to load quickly
const MAX_CELLS = 16;         // a view wider than this asks the user to zoom in
const TOP_CUISINES = 6;

/** All places seen this visit, by id. */
const known = new Map();
/** Rating per place id. */
const ratings = new Map();
/** Grid cells already fetched (cell key -> true). Cells are reused across views and moves. */
const fetched = new Map();
const state = { selected: null, a: '', b: '', items: [], markers: new Map() };

const fb = CONFIG.map.fallback;
const view = ui.createMap({ lat: fb.lat, lon: fb.lon }, fb.zoom);
const { map } = view;

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

async function loadView() {
  const zoom = map.getZoom();
  if (zoom < MIN_ZOOM) {
    ui.setHint(`Zoom in to load restaurants (zoom ${MIN_ZOOM} or closer).`);
    return;
  }
  const b = map.getBounds();
  const cells = cellsFor({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
  if (cells.length > MAX_CELLS) {
    ui.setHint('This area is too big. Zoom in to see restaurants.');
    return;
  }
  ui.setHint('');

  const missing = cells.filter((c) => !fetched.has(c.key));
  if (missing.length) {
    let failure = null;
    let done = 0;
    for (const cell of missing) {
      ui.setStatus(missing.length > 1 ? `Looking for restaurants… (area ${done + 1} of ${missing.length})` : 'Looking for restaurants here…');
      try {
        const { places, truncated } = await fetchCell(cell.box);
        fetched.set(cell.key, true);
        for (const p of places) known.set(p.id, p);
        if (truncated) ui.setHint('Some areas have more places than shown. Zoom in for the rest.');
      } catch (err) {
        failure = err;
      }
      done += 1;
    }
    if (failure) ui.setStatus(failure.message, true);
    if (failure && !missing.some((c) => fetched.has(c.key))) return;
  }
  const ids = [...known.keys()];
  for (const [id, r] of await loadRatings(ids)) ratings.set(id, r);
  ui.setStatus('');
  refresh();
}

/* ------------------------------------------------------------------ */
/* Deriving what to show                                               */
/* ------------------------------------------------------------------ */

/** Places inside the current map view, with rating and distance from the centre. */
function inView() {
  const b = map.getBounds();
  const c = map.getCenter();
  const out = [];
  for (const place of known.values()) {
    if (!b.contains([place.lat, place.lon])) continue;
    out.push({
      place,
      rating: ratings.get(place.id),
      distance: distanceM(c.lat, c.lng, place.lat, place.lon),
    });
  }
  return out;
}

function cuisineCounts(items) {
  const counts = new Map();
  for (const { place } of items) counts.set(place.cuisine, (counts.get(place.cuisine) || 0) + 1);
  return [...counts].map(([key, count]) => ({ key, count })).sort((x, y) => y.count - x.count);
}

/** Best rating first, then the nearest; unrated places sort after rated ones. */
function sortItems(items) {
  return [...items].sort((x, y) => {
    const rx = x.rating?.rating ?? -1;
    const ry = y.rating?.rating ?? -1;
    if (rx !== ry) return ry - rx;
    return x.distance - y.distance;
  });
}

function refresh() {
  const all = inView();
  const counts = cuisineCounts(all);

  // The two dropdowns only offer cuisines that exist here. A pick that is no longer present is cleared.
  if (state.a && !counts.some((c) => c.key === state.a)) state.a = '';
  if (state.b && !counts.some((c) => c.key === state.b)) state.b = '';
  ui.renderFilters(counts, state.a, state.b);

  const filtered = (state.a || state.b)
    ? all.filter(({ place }) => place.cuisine === state.a || place.cuisine === state.b)
    : all;
  state.items = sortItems(filtered);

  if (state.selected && !state.items.some((i) => i.place.id === state.selected)) state.selected = null;

  state.markers = ui.renderPins(view, state.items, state.selected, select);
  renderList();
  renderStrip(counts);
}

async function renderStrip(counts) {
  const top = counts.filter((c) => c.key !== 'unknown').slice(0, TOP_CUISINES);
  const tops = await Promise.all(top.map(async (c) => ({
    ...c,
    photo: hasCuisinePhoto(c.key) ? await getCuisinePhoto(c.key) : null,
  })));
  ui.renderStrip(tops);
}

async function renderList() {
  const withPhotos = await Promise.all(state.items.map(async (item) => {
    const photo = item.place.id === state.selected && hasCuisinePhoto(item.place.cuisine)
      ? await getCuisinePhoto(item.place.cuisine)
      : null;
    return { ...item, photo };
  }));
  ui.renderResults(withPhotos, state.selected);
  if (!state.items.length && known.size) {
    ui.setStatus(state.a || state.b ? 'No restaurants match these cuisines here. Try another pair or move the map.' : '');
  }
}

/* ------------------------------------------------------------------ */
/* Selection (list and map stay in step)                               */
/* ------------------------------------------------------------------ */

function select(id) {
  const prev = state.selected;
  state.selected = state.selected === id ? null : id;
  ui.markSelectedPin(view, state.markers, prev, state.selected, state.items);
  renderList();
  if (state.selected) {
    const place = known.get(state.selected);
    if (place) map.panTo([place.lat, place.lon], { animate: true });
    // Bring the chosen card into view in the list.
    requestAnimationFrame(() => document.querySelector(`.nm-card.is-selected`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

let debounce;
map.on('moveend', () => {
  clearTimeout(debounce);
  debounce = setTimeout(loadView, 450);
});

$('results').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-select]');
  if (btn) select(btn.dataset.select);
});

$('cuisine-strip').addEventListener('click', (e) => {
  const tile = e.target.closest('[data-cuisine]');
  if (!tile) return;
  // A top-cuisine tile fills the first dropdown (or clears it if already chosen).
  state.a = state.a === tile.dataset.cuisine ? '' : tile.dataset.cuisine;
  refresh();
});

$('cuisine-a').addEventListener('change', (e) => { state.a = e.target.value; refresh(); });
$('cuisine-b').addEventListener('change', (e) => { state.b = e.target.value; refresh(); });

$('zoom-in').addEventListener('click', () => map.zoomIn());
$('zoom-out').addEventListener('click', () => map.zoomOut());
$('layer-dark').addEventListener('click', () => ui.setTiles(view, 'dark'));
$('layer-light').addEventListener('click', () => ui.setTiles(view, 'light'));

$('locate').addEventListener('click', () => locateMe(true));

$('place-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('place-input').value.trim();
  if (q.length < 2) return;
  ui.setStatus('Searching…');
  try {
    const hit = await findPlace(q);
    if (!hit) return ui.setStatus(`No place found for "${q}".`, true);
    map.setView([hit.lat, hit.lon], Math.max(map.getZoom(), MIN_ZOOM));
    ui.setStatus(`Showing ${hit.label.split(',')[0]}.`);
  } catch (err) {
    ui.setStatus(err.message, true);
  }
});

/** Centre on the visitor's location. Quiet on startup (no prompt when declined or unavailable). */
function locateMe(explicit) {
  if (!('geolocation' in navigator)) return explicit && ui.setStatus('Location is not available in this browser.', true);
  navigator.geolocation.getCurrentPosition(
    (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], MIN_ZOOM),
    () => explicit && ui.setStatus('Could not get your location. Search for a place instead.', true),
    { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 },
  );
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

ui.renderFilters([], '', '');
ui.renderStrip([]);
ui.setHint(`Zoom in to load restaurants (zoom ${MIN_ZOOM} or closer).`);
locateMe(false);
// Load once after the first layout, so the map knows its size.
setTimeout(() => { map.invalidateSize(); loadView(); }, 300);
