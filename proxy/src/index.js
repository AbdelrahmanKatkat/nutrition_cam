/**
 * NutriSnap proxy – Cloudflare Worker that keeps the Gemini API key server-side.
 *
 *   Browser ──POST {image, mimeType}──► this Worker ──(x-goog-api-key: secret)──► Gemini
 *
 * The key lives in the Worker secret `GEMINI_API_KEY` (never in the repo, never in the browser).
 * The prompt and response schema also live here, so the endpoint can only do "analyse a meal photo"
 * and cannot be used as a free general-purpose Gemini relay.
 *
 * Protections: origin allow-list, per-client rate limit, payload size cap, upstream timeout.
 * Setup: see proxy/README.md.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BASE64_CHARS = 4_000_000;   // ≈ 3 MB image; the client already downsizes to ~1024 px
const UPSTREAM_TIMEOUT_MS = 20_000;   // give up on Gemini after 20 s
const DEFAULT_RETRY_AFTER_S = 30;     // Gemini doesn't document a Retry-After header

const PROMPT = `You are a nutrition assistant. Look at the meal photo and estimate the nutrition
of the whole visible portion. Be realistic about portion size and state assumptions in "notes".
If the image does not contain food, return calories 0, confidence 0 and explain in "notes".`;

/** Structured-output schema: forces valid JSON from the model. */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mealName:    { type: 'STRING' },
    calories:    { type: 'NUMBER' },
    confidence:  { type: 'NUMBER', description: '0 to 1' },
    proteinG:    { type: 'NUMBER' },
    carbsG:      { type: 'NUMBER' },
    fatG:        { type: 'NUMBER' },
    ingredients: { type: 'ARRAY', items: { type: 'STRING' } },
    notes:       { type: 'STRING' },
  },
  required: ['mealName', 'calories', 'confidence', 'proteinG', 'carbsG', 'fatG', 'ingredients', 'notes'],
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
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
    if (!env.GEMINI_API_KEY) return reply({ error: 'Server is missing GEMINI_API_KEY' }, 500);

    // --- our own per-client limit (protects your Gemini quota) ---
    if (env.RATE_LIMITER) {
      const client = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: client });
      if (!success) {
        return reply({ error: 'Too many requests. Please slow down.' }, 429,
          { 'Retry-After': String(DEFAULT_RETRY_AFTER_S) });
      }
    }

    // --- validate input ---
    let body;
    try { body = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    const { image, mimeType } = body || {};
    if (typeof image !== 'string' || !image || image.length > MAX_BASE64_CHARS) {
      return reply({ error: 'Image missing or too large' }, 413);
    }
    if (!ALLOWED_MIME.has(mimeType)) return reply({ error: 'Unsupported image type' }, 415);

    // --- call Gemini with a timeout ---
    const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    let upstream;
    try {
      upstream = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: image } }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      return reply({ error: timedOut ? 'Gemini timed out' : 'Could not reach Gemini' }, timedOut ? 504 : 502);
    }

    // Gemini quota hit (HTTP 429 / RESOURCE_EXHAUSTED): tell the browser to back off.
    if (upstream.status === 429) {
      const wait = upstream.headers.get('Retry-After') || String(DEFAULT_RETRY_AFTER_S);
      return reply({ error: 'Gemini rate limit reached. Try again shortly.' }, 429, { 'Retry-After': wait });
    }
    if (!upstream.ok) {
      // Log details server-side; never forward upstream bodies to the browser.
      console.error('Gemini error', upstream.status, (await upstream.text()).slice(0, 300));
      return reply({ error: `Gemini request failed (${upstream.status})` }, 502);
    }

    const data = await upstream.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return reply({ error: 'Gemini returned no content (image may have been blocked)' }, 502);
    try {
      return reply({ prediction: JSON.parse(text) });
    } catch {
      return reply({ error: 'Gemini returned invalid JSON' }, 502);
    }
  },
};
