/**
 * Restaurants from OpenStreetMap (Overpass API): free, no key, CORS open.
 * Covers only the map area the user is looking at, so the query is always a bounding box.
 *
 * OpenStreetMap has cuisine tags but no ratings, so ratings come from ./ratings.js (separate source).
 *
 * @module services/places
 */

/** Public Overpass servers, tried in order. They are shared and sometimes busy, so a second one is kept. */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const TYPES = 'restaurant|fast_food|cafe';
const CELL = 0.02;        // degrees (about 2 km): small queries finish faster and can be cached one by one
const MAX_PER_CELL = 200;
const TIMEOUT_MS = 25000;
const BACKOFF_MS = [2000, 4000];   // waits before the 2nd and 3rd pass over the servers

/** @typedef {{south:number, west:number, north:number, east:number}} Box */

/**
 * Split a box into grid cells of about 2 km, aligned to the grid so neighbouring views share cells.
 * @param {Box} box
 * @returns {{key:string, box:Box}[]}
 */
export function cellsFor(box) {
  const out = [];
  for (let lat = Math.floor(box.south / CELL) * CELL; lat < box.north; lat += CELL) {
    for (let lon = Math.floor(box.west / CELL) * CELL; lon < box.east; lon += CELL) {
      const cell = { south: lat, west: lon, north: lat + CELL, east: lon + CELL };
      out.push({ key: [cell.south, cell.west].map((v) => v.toFixed(2)).join(','), box: cell });
    }
  }
  return out;
}

/**
 * Fetch the named eating places in one cell, trying each server in turn.
 * @param {Box} box
 * @returns {Promise<{places: Place[], truncated: boolean}>}
 */
export async function fetchCell(box) {
  const { south, west, north, east } = box;
  const query = `[out:json][timeout:25];(node["amenity"~"^(${TYPES})$"](${south},${west},${north},${east}););out body ${MAX_PER_CELL};`;
  let lastError = null;
  // The public servers answer "at capacity" at busy times. Overpass asks clients to back off and retry.
  for (let round = 0; round < BACKOFF_MS.length + 1; round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS[round - 1]));
    const found = await tryEndpoints(query);
    if (found.ok) return found.value;
    lastError = found.error;
  }
  if (lastError?.name === 'TimeoutError' || lastError?.name === 'AbortError') {
    throw new Error('The restaurant database is slow right now. Try again in a moment.');
  }
  throw new Error('The restaurant database is busy right now. Try again in a moment, or zoom in to a smaller area.');
}

/** One pass over the servers. Returns the first success, or the last error. */
async function tryEndpoints(query) {
  let error = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) { error = new Error(`Restaurant database error (${res.status}).`); continue; }
      const data = await res.json();
      const elements = Array.isArray(data.elements) ? data.elements : [];
      return { ok: true, value: { places: normalizePlaces(elements), truncated: elements.length >= MAX_PER_CELL } };
    } catch (err) {
      error = err;
    }
  }
  return { ok: false, error };
}

/** Cuisine keys that read badly when shown raw. */
const LABELS = { burger: 'Burgers', coffee_shop: 'Coffee', fast_food: 'Fast food', steak_house: 'Steakhouse' };

/** Keep named places only and map OpenStreetMap tags to the shape the page uses. */
export function normalizePlaces(elements) {
  return elements
    .filter((e) => e && typeof e.lat === 'number' && typeof e.lon === 'number' && e.tags?.name)
    .map((e) => {
      const t = e.tags;
      const cuisines = String(t.cuisine || '').split(';').map((c) => c.trim().toLowerCase()).filter(Boolean);
      return {
        id: `osm-${e.id}`,
        name: t.name,
        lat: e.lat,
        lon: e.lon,
        cuisine: cuisines[0] || 'unknown',
        cuisines,
        amenity: t.amenity || 'restaurant',
        address: formatAddress(t),
        phone: t.phone || t['contact:phone'] || '',
        website: t.website || t['contact:website'] || '',
        hours: t.opening_hours || '',
      };
    });
}

function formatAddress(t) {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return [street, t['addr:city']].filter(Boolean).join(', ');
}

/** "pizza" -> "Pizza", "coffee_shop" -> "Coffee", "unknown" -> "Other". */
export function cuisineLabel(key) {
  if (!key || key === 'unknown') return 'Other';
  if (LABELS[key]) return LABELS[key];
  const text = key.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Great-circle distance in metres. */
export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Human distance: "350 m" or "1.4 km". */
export function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
