/**
 * One place that talks to Gemini: retries busy errors, falls back to a second model, and keeps
 * every attempt inside a single time budget so the Worker always answers before the browser gives up.
 */

import { sleep } from './util.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_RETRY_AFTER_S = 30;      // Gemini doesn't document a Retry-After header
const ATTEMPT_TIMEOUT_MS = 25_000;     // longest single Gemini call
const TOTAL_BUDGET_MS = 50_000;        // all attempts together; the browser waits 60 s
const MIN_ATTEMPT_MS = 5_000;          // don't start an attempt with less time than this
const RETRY_DELAYS_MS = [1500, 3000];  // back-off before attempts 2 and 3
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]); // Gemini "busy" / transient errors

/**
 * @param {object} env  Worker environment (GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL)
 * @param {{system:string, contents:object[], schema:object}} request
 * @returns {Promise<{ok:true, json:object} | {ok:false, status:number, error:string, retryAfter?:string}>}
 */
export async function callGemini(env, { system, contents, schema }) {
  const primary = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const fallback = env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash';
  // Busy main model -> try the fallback next (different capacity), then the main model again if time remains.
  const attempts = [primary, fallback, primary];

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    // Temperature left at the model default: Google advises against lowering it for Gemini 3 models.
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  });

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let upstream = null;

  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await sleep(RETRY_DELAYS_MS[i - 1]);
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) break; // out of time: reply rather than wait on Gemini
    try {
      upstream = await fetch(`${GEMINI_BASE}/${attempts[i]}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining)),
        body: payload,
      });
    } catch (err) {
      upstream = null;
      if (i === attempts.length - 1) {
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        return { ok: false, status: timedOut ? 504 : 502, error: timedOut ? 'Gemini timed out' : 'Could not reach Gemini' };
      }
      continue;
    }
    // Quota exhausted: retrying now would only burn more quota, so tell the browser to back off.
    if (upstream.status === 429) {
      const retryAfter = upstream.headers.get('Retry-After') || String(DEFAULT_RETRY_AFTER_S);
      return { ok: false, status: 429, error: 'Gemini rate limit reached. Try again shortly.', retryAfter };
    }
    if (!RETRYABLE_STATUS.has(upstream.status)) break;
    console.warn('Gemini busy', attempts[i], upstream.status, 'attempt', i + 1);
  }

  if (!upstream) return { ok: false, status: 504, error: 'Gemini did not respond in time. Please try again.' };
  if (RETRYABLE_STATUS.has(upstream.status)) {
    return { ok: false, status: 503, error: 'Gemini is busy right now. Please try again in a moment.', retryAfter: '20' };
  }
  if (!upstream.ok) {
    // Log details server-side; never forward upstream bodies to the browser.
    console.error('Gemini error', upstream.status, (await upstream.text()).slice(0, 300));
    return { ok: false, status: 502, error: `Gemini request failed (${upstream.status})` };
  }

  const data = await upstream.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { ok: false, status: 502, error: 'Gemini returned no content (the input may have been blocked)' };
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, status: 502, error: 'Gemini returned invalid JSON' };
  }
}
