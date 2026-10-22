/**
 * Place search for the map (OpenStreetMap Nominatim).
 * Usage policy: one request per user action, never in bulk, and identify the app.
 * https://operations.osmfoundation.org/policies/nominatim/
 *
 * @module services/geocode
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * @param {string} query  a place name such as "Zamalek, Cairo"
 * @returns {Promise<{lat:number, lon:number, label:string}|null>} null when nothing matches
 */
export async function findPlace(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return null;
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', q });
  let res;
  try {
    res = await fetch(`${ENDPOINT}?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Error('Could not reach the place search. Check your internet connection.');
  }
  if (!res.ok) throw new Error(`Place search failed (${res.status}).`);
  const hit = (await res.json())[0];
  if (!hit) return null;
  return { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name || q };
}
