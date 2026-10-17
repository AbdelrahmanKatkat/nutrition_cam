# NutriSnap proxy (Cloudflare Worker)

Keeps your Gemini API key out of the browser and out of GitHub.

```
GitHub Pages site ──► Worker (secret GEMINI_API_KEY) ──► Gemini
```

## Deploy (about 5 minutes, free Cloudflare account)

```bash
cd proxy
npx wrangler login
```

1. Edit `wrangler.toml` → `ALLOWED_ORIGINS`: put your Pages origin, e.g. `https://abdelrahman.github.io` (no path, no trailing slash). Keep `http://localhost:8080` for local testing.
2. Store the key as a **secret** (you'll be prompted to paste it; it is never written to a file):
   ```bash
   npx wrangler secret put GEMINI_API_KEY
   ```
3. Deploy:
   ```bash
   npx wrangler deploy
   ```
   Wrangler prints the URL, e.g. `https://nutrisnap-proxy.<your-subdomain>.workers.dev`.
4. Put that URL in `js/config.js` → `proxy.url` and push the site.

Local development: `npx wrangler dev` (serves on `http://localhost:8787`). For a local-only key create `proxy/.dev.vars` containing `GEMINI_API_KEY=...` (git-ignored). Set `proxy.url` to the local URL while testing.

Rotating the key: run `wrangler secret put GEMINI_API_KEY` again. No redeploy of the site is needed.

## What it protects against

| Control | Where | Purpose |
|---|---|---|
| Secret key | Worker secret | Never reaches browser or repo |
| Origin allow-list | `ALLOWED_ORIGINS` | Only your site's browser calls are accepted |
| Rate limit (5/min per IP) | `[[ratelimits]]` | Stops one client draining your Gemini quota |
| Size/type validation | `src/index.js` | Rejects huge or non-image payloads |
| 20 s upstream timeout | `src/index.js` | A hung Gemini call can't hold requests open |
| Fixed prompt + schema | `src/index.js` | Endpoint only does meal analysis |
| 429 passthrough with `Retry-After` | `src/index.js` | Browser shows a countdown instead of retrying blindly |

**Limits of these protections:** the `Origin` header is enforced by browsers but can be forged by scripts (curl), and the Cloudflare rate limiter is approximate and per location. For a public site, also (a) set a spending/quota cap on the Gemini key in Google AI Studio / Cloud, and (b) optionally add [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) to stop bots.

## Gemini rate limits

Gemini limits are applied **per Google Cloud project (not per key)** across three dimensions – requests per minute (RPM), input tokens per minute (TPM) and requests per day (RPD). Exceeding any one returns HTTP **429 `RESOURCE_EXHAUSTED`**; the daily quota resets at midnight Pacific time. Google does not publish fixed numbers in its docs – they vary by model and tier and change over time. **Check your actual limits in [Google AI Studio → Rate limits](https://aistudio.google.com/rate-limit).**

NutriSnap's defence in depth: client cooldown between scans (`js/config.js`) → Worker per-IP limit → graceful 429 handling with a wait message. Tune `limit` in `wrangler.toml` and `scan.cooldownMs` in `config.js` to fit your quota.

## Costs

Workers free plan allows 100,000 requests/day, plenty for this app. Gemini usage is billed or quota-limited on your Google project.
