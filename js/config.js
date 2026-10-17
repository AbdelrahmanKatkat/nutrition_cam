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
    /** Abort the request if the proxy/Gemini hasn't answered in this many ms. */
    timeoutMs: 25000,
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
    /** Only request the fields we use – keeps responses small. */
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

  /** Max items kept in the local scan history. */
  historyLimit: 20,
};
