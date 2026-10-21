# NutriSnap – Snap & Know Your Food

A static, no-build site with two pages that share one design and one Gemini proxy:

**NutriSnap** (`index.html`): take or upload a meal photo on your phone.
- **Gemini AI** estimates the meal's calories and macros.
- **Open Food Facts** returns nutrition facts, Nutri-Score and labels for a product (by barcode, or by the meal name).

**NutriChef** (`chef.html`): search a recipe and learn what is in it and why it works.
- **TheMealDB** (free recipe database) supplies recipes, photos, ingredients and instructions.
- **Gemini AI** adds nutrition per serving, vitamins, the chemistry and cooking theory with optimal temperatures, clear making steps, and a chat to make the recipe healthier or higher in protein.
- Details: [`docs/NUTRICHEF.md`](docs/NUTRICHEF.md).

Design reference: [`docs/design-reference.jpg`](docs/design-reference.jpg).

## Run it locally

Deploy the proxy first ([`proxy/README.md`](proxy/README.md)) and set `proxy.url` in `js/config.js`; the page needs it for AI estimates. Barcode lookups work without it.

```bash
# ES modules need http://, not file://
python -m http.server 8080
# open http://localhost:8080  (on your phone: http://<your-pc-ip>:8080)
```

> Camera capture on phones generally requires HTTPS – it works on GitHub Pages and on `localhost`.
> On plain `http://<ip>`, the button still lets you pick a photo from the gallery.

## Going live (Gemini key stays on a server)

The Gemini key is **not** in the page, the repo, or the browser. It lives as a secret in a small
Cloudflare Worker ([`proxy/`](proxy/README.md)) that the page calls.

1. Get a key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Deploy the proxy and store the key with `npx wrangler secret put GEMINI_API_KEY` – full steps in [`proxy/README.md`](proxy/README.md).
3. Put the Worker URL in `js/config.js` → `proxy.url` and push.

Open Food Facts needs no key and is called directly from the browser.

**Rate limits.** Gemini limits (requests/min, tokens/min, requests/day, per Google project) return HTTP 429 when exceeded.
NutriSnap guards against that at three levels: an 8 s cooldown between scans in the browser (`scan.cooldownMs`),
a per-IP limit in the Worker, and a clear "try again in Ns" message when a 429 comes back. Requests also time out after 25 s.
Check your real limits in [AI Studio](https://aistudio.google.com/rate-limit).

## Privacy and analytics

- **Photos go to Google Gemini** on every AI scan (through the Worker). Show a notice to visitors before a public launch.
- **No cookies.** The site stores only settings and scan history in the visitor's own browser (`localStorage`).
- **Recipe text and chat messages** typed in NutriChef are also sent to Gemini. The browser caches recipe analyses (no chat) locally.
- **Counters without personal data.** Cloudflare Web Analytics (visits, countries, devices) is cookie-free, and the Worker counts each successful scan as food or not food, with no IP address, photo or description.
- Setup for the analytics: see the comments in `js/config.js` (`webAnalyticsToken`) and `proxy/wrangler.toml` (`SCANS`).

Details are in [`docs/IMPROVEMENTS.md`](docs/IMPROVEMENTS.md#6-privacy).

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Source: GitHub Actions**.
3. Every push to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml) and publishes the site.

## Project structure

```
index.html                  NutriSnap page markup
chef.html                   NutriChef page markup
css/styles.css              shared styling + NutriSnap (CSS variables for the palette)
css/chef.css                NutriChef styling
js/
  app.js, ui.js             NutriSnap controller and view
  chef.js, chef-ui.js       NutriChef controller and view
  dom.js                    shared helpers ($, esc, safe markdown)
  config.js                 URLs, limits, daily values
  services/
    proxy.js                the one place the browser calls the Worker (timeout, 429)
    gemini.js               NutriSnap: meal photo -> estimate
    chef-ai.js              NutriChef: analysis, chat, smart search, create recipe
    mealdb.js               TheMealDB client
    openfoodfacts.js        barcode lookup + text search
    image.js                resize photo, barcode detection
    storage.js              localStorage: settings, history, analysis cache
assets/                     logos and illustrations (SVG)
proxy/                      Cloudflare Worker: key, prompts, gates (own README)
  src/index.js              gates + routing
  src/gemini.js             retries, fallback model, time budget
  src/tasks.js              one validator + prompt + schema per action
  src/prompts/              scan.js (NutriSnap), chef.js (NutriChef)
docs/
  NUTRICHEF.md              NutriChef design, APIs, prompts
  IMPROVEMENTS.md           roadmap and known limitations
  AGENTIC_AI.md             how to add agentic AI later
  design-reference.jpg
.github/workflows/pages.yml GitHub Pages deployment
```

### Scan flow

```
photo ─► resize ─► proxy ─► Gemini ─► meal name, kcal, macros
                                         │
barcode (typed / detected) ─────────────►├─► Open Food Facts ─► Nutri-Score, labels, per-100g
                                         ▼
                                  render + save to history (localStorage)
```

Each service module exposes one or two plain async functions, so any of them can be replaced
(proxy, different model, agent) without touching the UI.

## Notes

- Calorie estimates from a photo are approximations; portion size is the main source of error.
- History keeps the last 20 scans (small thumbnails only) in the browser.
- Open Food Facts data is community-contributed; some products have missing fields.
