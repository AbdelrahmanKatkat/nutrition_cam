# NutriMap

A map of restaurants around the visitor: pins coloured by rating, a top-cuisines strip with photos, a cuisine filter, and a detail card for each place. Layout follows the mock-up in the project history.

## Data sources

| What | Source | Key | Notes |
|---|---|---|---|
| Map tiles | OpenStreetMap | No | Attribution shown. "Dark" is the same tiles with a colour filter. |
| Restaurants | OpenStreetMap, Overpass API | No | Public servers are shared and sometimes at capacity (see below). |
| Place search | OpenStreetMap, Nominatim | No | One request per search, as its usage policy asks. |
| Top-cuisine photos | Wikipedia | No | Title-matched, as in NutriChef. |
| Ratings | **Not connected yet** | Needs a provider key | Pins are grey ("No rating yet") until one is connected. |

## How the data loads

The visible map is split into cells of about 2 km. Each cell is fetched once and reused as the visitor moves. Zoom 15 or closer is needed, and a view that would need more than 16 cells asks the visitor to zoom in.

Each cell query tries two public servers. When both are busy, it backs off (2 s, then 4 s) and tries again, as Overpass asks. The page shows its progress ("area 2 of 6"). If it still fails, the message says so.

**Limit to know about:** the free Overpass servers are shared. At busy times they answer "at capacity". For a public launch, use one of these:
1. Put a cache in the Worker (the same pattern as the NutriAI proxy), so each area is fetched once for all visitors.
2. Pre-extract the restaurants for your city into a JSON file in the repository, and load that instead. This is fast and has no outside dependency, but covers only the cities you extract.
3. Run your own Overpass instance (heavy, but unlimited).

## Connecting ratings

`js/services/ratings.js` is the only file to change. `loadRatings(ids)` must return a `Map` of place id to `{ rating, count }`. Add a route in `proxy/src/` that holds the provider's key and does the lookup, then call it from `loadRatings`. Read the provider's terms first: most limit how long ratings may be stored and how they must be shown.

Colours: 4.7 and above dark green, 4.4 green, 4.0 yellow, below 4.0 orange, no rating grey.

## Files

- `nutrimap.html`: page markup.
- `css/map.css`: layout, cards, pins, the dark style.
- `js/map.js`: controller (loading, filters, selection, search, location).
- `js/map-ui.js`: view (Leaflet pins, strip, cards).
- `js/services/places.js`: Overpass query, cell grid, normalising, distance.
- `js/services/ratings.js`: colour scale and the ratings connection point.
- `js/services/cuisine-images.js`: cuisine to dish photo.
- `js/services/geocode.js`: place search.
- `assets/nutrimap-logo.svg`.

## Privacy

Map views are sent to the Overpass servers (as the bounding box of the area), and searches to Nominatim. Location, if the visitor allows it, stays in the browser. Say so in the notice when the site goes public.
