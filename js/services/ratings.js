/**
 * Ratings for NutriMap: the colour scale, and the one place a rating provider plugs in.
 *
 * OpenStreetMap has no ratings, and the providers that have them (Foursquare, Google, Yelp) need an
 * account key and have terms on caching and display. So until one is connected, every place is
 * unrated and its pin is grey. Nothing here invents a rating.
 *
 * To connect a provider: add a route in proxy/src/ that holds its key and returns
 * { [placeId]: { rating, count } }, then make loadRatings() call it. The colours need no change.
 *
 * @module services/ratings
 */

/** Pin colours, the mock-up's scale: dark green for the best, orange for the lowest. */
export const RATING_BANDS = [
  { min: 4.7, color: '#1b4d32', label: 'Excellent' },
  { min: 4.4, color: '#2fa35a', label: 'Very good' },
  { min: 4.0, color: '#c9c930', label: 'Good' },
  { min: 0, color: '#ee8100', label: 'Fair' },
];

export const UNRATED = { color: '#9aa59d', label: 'No rating yet' };

/** @returns {{color:string, label:string}} */
export function bandFor(rating) {
  if (!Number.isFinite(rating)) return UNRATED;
  return RATING_BANDS.find((b) => rating >= b.min) || RATING_BANDS[RATING_BANDS.length - 1];
}

/**
 * Ratings for the given place ids. Returns a Map of id -> { rating, count }.
 * Empty until a provider is connected.
 * @param {string[]} placeIds
 * @returns {Promise<Map<string, {rating:number, count:number}>>}
 */
export async function loadRatings(placeIds) {
  void placeIds; // provider not connected yet
  return new Map();
}
