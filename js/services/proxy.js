/**
 * The one place the browser talks to the Worker (which holds the Gemini key).
 * NutriSnap and NutriChef both go through `askProxy`, so timeouts and error handling are identical.
 *
 * @module services/proxy
 */

import { CONFIG } from '../config.js';

/** Thrown on HTTP 429 so the UI can show a countdown instead of a generic error. */
export class RateLimitError extends Error {
  constructor(retryAfterS) {
    super(`Rate limit reached. Try again in ${retryAfterS}s.`);
    this.name = 'RateLimitError';
    this.retryAfterS = retryAfterS;
  }
}

/**
 * POST one job to the Worker and return the model's JSON answer.
 * @param {string} action   scan | recipe_analyse | recipe_chat | recipe_search | recipe_create
 * @param {object} payload  action-specific fields (see proxy/src/tasks.js)
 * @returns {Promise<object>} the parsed `prediction` object
 * @throws {RateLimitError} on HTTP 429
 */
export async function askProxy(action, payload) {
  const { url, timeoutMs } = CONFIG.proxy;
  if (!url) throw new Error('Proxy URL not set. Deploy the proxy (proxy/README.md) and set proxy.url in js/config.js.');

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`The request timed out after ${Math.round(timeoutMs / 1000)}s. Please try again.`);
    }
    // A browser reports a blocked (CORS) response the same way as no network, so name both causes.
    throw new Error(
      `Could not reach the proxy. Check your internet connection. ` +
      `If you opened this page from ${location.origin}, that address must be allowed in ALLOWED_ORIGINS or ALLOW_LOCALHOST (proxy/wrangler.toml).`,
    );
  }

  if (res.status === 429) {
    const wait = parseInt(res.headers.get('Retry-After'), 10);
    throw new RateLimitError(Number.isFinite(wait) ? wait : CONFIG.scan.defaultRetryAfterS);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data.prediction || {};
}
