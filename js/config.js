/**
 * Central configuration. Change values here instead of hunting through modules.
 * @module config
 */

export const CONFIG = {
  /**
   * Proxy that holds the Gemini key (see proxy/README.md). Paste your deployed Worker URL here.
   * The key itself is NEVER stored in this repo or in the browser.
   */
  proxy: {
    url: 'https://nutrisnap-proxy.abdelrahman-katkat.workers.dev',
    /** Abort if the proxy hasn't answered in this many ms. Covers the Worker's retries (see proxy/src/index.js). */
    timeoutMs: 60000,
  },

  /** Client-side throttling so rapid taps can't burn through the Gemini quota. */
  scan: {
    /** Minimum gap between two live scans. */
    cooldownMs: 8000,
    /** Fallback wait after a 429 when the server sends no Retry-After. */
    defaultRetryAfterS: 30,
  },

  openFoodFacts: {
    baseUrl: 'https://world.openfoodfacts.org',
    /** Only request the fields we use â€“ keeps responses small. */
    fields: [
      'code', 'product_name', 'brands', 'nutriscore_grade',
      'nutriments', 'labels_tags', 'image_front_small_url',
    ].join(','),
  },

  image: {
    /** Longest side (px) after downscaling. Smaller = faster + cheaper requests. */
    maxSide: 1024,
    jpegQuality: 0.85,
  },

  /** Reference daily values used to scale the breakdown bars (adult, 2000 kcal diet). */
  dailyValues: { kcal: 2000, protein: 50, carbs: 275, fat: 78 },

  /**
   * Cloudflare Web Analytics: cookie-free visit, country and device stats.
   * Create a site in Cloudflare dashboard â†’ Analytics & Logs â†’ Web Analytics, then paste its token here.
   * Leave empty to load no analytics script at all.
   */
  webAnalyticsToken: '4656c232b8a843d0b1d1fb63df114a40',

  /** NutriChef: free recipe database (TheMealDB, test key 1) and chat/analysis limits. */
  chef: {
    mealdbBase: 'https://www.themealdb.com/api/json/v1/1',
    /** How many analysed recipes are remembered in this browser (saves AI calls). */
    cacheSize: 12,
  },

  /** NutriMap: where the map opens when the visitor's location is not available. Change to your city. */
  map: { fallback: { lat: 30.0444, lon: 31.2357, zoom: 15 } },

  /** NutriChat (both pages): gap between AI requests, and the longest message a user can send. */
  chat: { cooldownMs: 3000, maxMessageChars: 400 },

  /** Max items kept in the local scan history. */
  historyLimit: 20,
};
