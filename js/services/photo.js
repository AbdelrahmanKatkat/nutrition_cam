/**
 * Dish photo lookup for recipes that have no picture (the ones Gemini writes).
 *
 * Source: Wikipedia's lead images (free to use, open CORS, no key). Google Images has no free
 * official API and scraping it is against its terms, so it is not used.
 *
 * A wrong photo is worse than none, so a result is accepted only if its title shares a word with
 * the dish name; otherwise the page keeps its illustration.
 *
 * @module services/photo
 */

const API = 'https://en.wikipedia.org/w/api.php';
const TIMEOUT_MS = 8000;

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/** Same word, or the same first four letters (koshari / koshary). */
const sameWord = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));

/**
 * @param {string} dish  a clean dish name such as "Ful medames" (not "Classic healthy foul medames bowl")
 * @returns {Promise<{url:string, title:string, pageUrl:string}|null>}
 */
export async function findDishPhoto(dish) {
  const query = String(dish || '').trim();
  if (query.length < 3) return null;

  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '0', gsrlimit: '5',
    gsrsearch: query, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '700',
  });
  let pages;
  try {
    const res = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    pages = Object.values((await res.json()).query?.pages || {}).sort((a, b) => (a.index || 99) - (b.index || 99));
  } catch {
    return null; // a missing photo is never an error
  }

  const wanted = words(query);
  const hit = pages.find((p) => p.thumbnail?.source && words(p.title).some((t) => wanted.some((w) => sameWord(t, w))));
  if (!hit) return null;
  return {
    url: hit.thumbnail.source,
    title: hit.title,
    pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
  };
}
