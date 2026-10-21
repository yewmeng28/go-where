# GoWhere?

A free, offline-capable place journal for iPhone: pin the places you want to remember, rate them, and filter by category.
Plain HTML/CSS/JS, no build step, no backend, no accounts. Data lives in your browser (`localStorage`); use **Manage → Export JSON** to back up.

## How to use

- **Add a place:** tap **+** on the map, then search a name or address, tap **◎ My location**, or **⌖ Pick on map** and move the map under the pin. You can also long-press the map to start a pin there.
- **Rate it:** rate each detail of the place's category in stars (tap the same star again to clear) and add a comment. The **overall rating is the average of the details you rated**, to one decimal (e.g. 4.3 ★). A category with no qualifiers uses a plain star rating instead. The pin colour follows the overall rating, blending from red (1) through orange, yellow and lime to green (5); grey means unrated.
- **Details per category:** each category has its own 5-star qualifiers (Food: Taste, Value for money, Atmosphere, Service; Cafe: Coffee, Work-friendly, and so on). More stars is always better, so "Value for money" = cheaper. Rate them when saving a place; they feed the overall rating. Add your own with **＋ Add qualifier** in the form, or manage them per category under **Manage**.
- **Price:** every place, in any category (including your own), has a built-in price: one amount or a from–to range (e.g. 15–30 per person). Pick the currency symbol under **Manage**. The **Price ↑ / Price ↓** buttons on the List tab sort by it (a range counts as its middle; places without a price go last), and the **★ Ratings** chip has a **Max price** filter that keeps places starting at or below it.
- **Rating filters:** the **★ Ratings** chip sets a minimum for the overall rating and for any qualifier of the selected categories (e.g. Food + Atmosphere ≥ 4).
- **Categories:** **Manage** lets you add your own (name + emoji), rename or delete them. The chips above the map and list filter the pins; select several to combine them.
- **List tab:** the same places as cards, sorted by recent, top rated or nearby.
- **Directions:** open a place and tap **Directions** to hand off to Apple Maps.

## Run locally

    python3 -m http.server 8000   # then open http://localhost:8000

## Deploy (GitHub Pages)

Push to GitHub, then Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`. Open the URL in **Safari** on your iPhone and use Share → **Add to Home Screen**.

## Location troubleshooting (iPhone)

1. **Use the https address.** Geolocation is blocked on plain `http://` pages (a `http://192.168.x.x:8000` dev server on your phone will never work; `http://localhost` only works on the machine running it). The GitHub Pages URL is https, so use that.
2. **Settings › Privacy & Security › Location Services** must be **on**. Then set **Safari Websites** to *While Using the App* (this covers the Safari tab) and, once you've tapped ◎ in the Home Screen app, find **GoWhere** in the same list and set it to *While Using the App* too. Home Screen apps get their own entry.
3. If it was denied once and never asks again: delete the Home Screen icon and add it again (this resets that app's permission), or use **Settings › General › Transfer or Reset iPhone › Reset › Reset Location & Privacy** to make every app ask again.
4. Try it in a Safari tab first: the **aA** menu › **Website Settings › Location** shows *Ask / Allow / Deny* for the site.
5. The message shown in the app says which case it is: blocked (permission), timed out (retry on Wi-Fi or outdoors), or unavailable.

## Notes

- **The map is online-only.** The app stores only your places and its own files. Leaflet is loaded from unpkg when you open the Map tab and the tiles come from OpenStreetMap (fetched with `no-store`), so nothing from the map is cached. Offline, the Map tab says so and the List, Manage and add-by-GPS still work. Search (Photon) and Pick on map also need a connection.
- Bump `CACHE` in `sw.js` after changing any app file so installed copies update.
- The Home Screen app and the Safari tab keep **separate** data. Pick one and stick with it, and export now and then.
- Location only works while the app is open (no background tracking).
- Regenerate the icons with `python3 tools/make_icons.py` (needs Pillow).
