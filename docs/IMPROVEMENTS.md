# Improvements & Roadmap

Ordered roughly by value. Each item notes where in the code it would land.

## 1. Security

**Done:** the Gemini key is a Worker secret (see [`proxy/README.md`](../proxy/README.md)); the browser never sees it.
The Worker has an origin allow-list, per-IP rate limit, payload validation and an upstream timeout.

**Remaining hardening for a public site:**
- The `Origin` check can be forged outside browsers. Add [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) (bot check) and verify its token in the Worker.
- Set a quota/spend cap on the Gemini key in Google AI Studio / Cloud Console.
- Rate limiting counters are per Cloudflare location and approximate; use a Durable Object counter if you need exact limits, plus a global daily cap.
- Never commit keys or `.dev.vars` (already git-ignored).

## 2. Accuracy

- **Portion calibration:** ask the user for a reference ("plate is 26 cm", "one cup") or let them edit the grams, then rescale.
- **Per-ingredient breakdown:** the schema already returns `ingredients`; extend it with grams + kcal each, show a table, and let users remove wrong items.
- **Cross-check with Open Food Facts:** for each ingredient search OFF per-100g values and compute kcal from grams instead of trusting the model's total.
- **Confidence handling:** warn when `confidence < 0.5` and suggest a closer/better-lit photo.
- Run the same photo twice (or two models) and flag large disagreement.

## 3. Features

- Editable result (correct the meal name / kcal) before saving.
- **Daily log & totals** with a progress ring against a calorie goal (`storage.js` + new `js/log.js`).
- Live **barcode scanner** using the camera stream (`BarcodeDetector` already used on photos in `services/image.js`; add a `<video>` loop or the `zxing-wasm` fallback for Safari < 17).
- Export history as CSV / JSON.
- Multiple photos per meal (different angles).
- Localisation (Arabic/RTL support: CSS logical properties are an easy first step).

## 4. PWA / mobile polish

- Add `manifest.webmanifest` + a service worker → installable app, offline shell.
- Add 192/512 px PNG icons (generate from `assets/logo.svg`).
- Use `navigator.mediaDevices.getUserMedia` for an in-page viewfinder instead of the file picker.

## 5. Engineering

- **Tests:** unit-test `normalize()` in `gemini.js` / `openfoodfacts.js` with fixtures (Vitest, no bundler needed for plain ESM).
- **Lint/format:** ESLint + Prettier, run in the Pages workflow before deploy.
- **Error UX:** distinguish quota (429), invalid key (400/403) and network errors with friendly messages.
- **Accessibility audit:** focus management when dialogs open, reduced-motion for bar transitions, contrast check on the muted text.
- **Caching:** cache OFF responses by barcode in `sessionStorage` to avoid repeat calls (OFF asks clients to be gentle, and to send a descriptive `User-Agent` for heavy use).
- Pin the Gemini model name in `config.js` and handle model deprecations.

## 6. Privacy

**What is collected, and where**

| Data | Where | Kept by | Personal? |
|---|---|---|---|
| Meal photo | Sent to the Worker, then to Google Gemini. Not stored by the Worker. | Google, under its API terms | Yes |
| Meal description | Sent with the photo | Google, under its API terms | Possibly |
| NutriChef recipe text and chat messages | Sent to the Worker, then to Gemini. Not stored by the Worker. | Google, under its API terms | Possibly (anything you type) |
| Dish name for a photo (Gemini-written recipes only) | Sent from the browser to Wikipedia | Wikimedia | The visitor's IP is visible to Wikimedia |
| NutriChef analysis cache | Browser `localStorage` only (recipes, no chat) | The visitor's browser | No |
| Scan history (thumbnail, name, kcal) | Browser `localStorage` only | The visitor's browser | Yes, on the device only |
| Settings (two service ticks) | Browser `localStorage` only | The visitor's browser | No |
| Request counter | Cloudflare Analytics Engine: one data point per successful request, with only its kind (`food`, `not_food`, `recipe`, `chat`, `recipe_search`, `recipe_create`). No IP address, photo, text or cookie. | Cloudflare | No |
| Page visits, countries, devices | Cloudflare Web Analytics: cookie-free beacon. No personal data. | Cloudflare | No |

**No cookies are set by the site, the Worker or the analytics.** Browser storage (`localStorage`) is used only on the device.

**Still to do before a public launch**
- Add a short consent notice before the first AI scan: photos are sent to Google.
- Tell visitors about the counters in the README privacy section, as above.
- Set `ALLOW_LOCALHOST` to `"false"` in `proxy/wrangler.toml`.
- Consider a retention setting for the Analytics Engine dataset.
