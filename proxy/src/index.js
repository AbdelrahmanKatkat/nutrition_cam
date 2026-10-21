/**
 * NutriSnap / NutriChef proxy - Cloudflare Worker that keeps the Gemini API key server-side.
 *
 *   Browser --POST {action, ...}--> this Worker --(x-goog-api-key: secret)--> Gemini
 *
 * The key lives in the Worker secret `GEMINI_API_KEY` (never in the repo, never in the browser).
 * Prompts and response schemas also live here (see ./prompts and ./tasks.js), so the endpoint can only
 * do the specific jobs defined there and cannot be used as a free general-purpose Gemini relay.
 *
 * Request gates, cheapest first: method, origin allow-list, API key present, per-client rate limit,
 * body size, JSON, action, per-action validation. Then one Gemini call with retries (see ./gemini.js).
 * Setup: see proxy/README.md.
 */

import { callGemini } from './gemini.js';
import { TASKS } from './tasks.js';

const DEFAULT_RETRY_AFTER_S = 30;
const MAX_BODY_BYTES = 5_000_000; // largest legitimate body is a ~3 MB photo as base64

/**
 * Count one successful request in Analytics Engine (env.SCANS). Only the kind is stored
 * (food, not_food, recipe, chat, ...): no IP address, no photo, no text, no cookie.
 * Failures here must never break a request.
 */
function record(env, kind) {
  try {
    env.SCANS?.writeDataPoint({ blobs: [kind], doubles: [1], indexes: [kind] });
  } catch { /* analytics is optional */ }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    // Local development: http://localhost:<any port> and http://127.0.0.1:<any port>, when enabled in wrangler.toml.
    const isLocal = env.ALLOW_LOCALHOST === 'true' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const originOk = allowed.includes(origin) || isLocal;
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Expose-Headers': 'Retry-After',
      Vary: 'Origin',
    };
    const reply = (body, status = 200, extra = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors, ...extra },
      });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    if (!originOk) return reply({ error: 'Origin not allowed' }, 403);
    if (!env.GEMINI_API_KEY) return reply({ error: 'The AI service is not configured on the server.' }, 500);

    // --- our own per-client limit (protects your Gemini quota) ---
    if (env.RATE_LIMITER) {
      const client = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: client });
      if (!success) {
        return reply({ error: 'Too many requests. Please slow down.' }, 429,
          { 'Retry-After': String(DEFAULT_RETRY_AFTER_S) });
      }
    }

    // --- reject oversized bodies before reading them into memory ---
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) {
      return reply({ error: 'Request too large' }, 413);
    }

    // --- parse and route ---
    let body;
    try { body = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    body = body && typeof body === 'object' ? body : {};
    const action = typeof body.action === 'string' ? body.action : 'scan'; // old clients send no action
    const task = Object.hasOwn(TASKS, action) ? TASKS[action] : null;
    if (!task) return reply({ error: 'Unknown action' }, 400);

    const built = task.build(body);
    if (built.error) return reply({ error: built.error }, built.status);

    // --- call Gemini (retries, fallback model and time budget live in gemini.js) ---
    const result = await callGemini(env, built);
    if (!result.ok) {
      return reply({ error: result.error }, result.status, result.retryAfter ? { 'Retry-After': result.retryAfter } : {});
    }

    record(env, task.kind(result.json));
    return reply({ prediction: result.json });
  },
};
