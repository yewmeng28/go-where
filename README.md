# GoWhere?

A free, offline-capable place journal for iPhone: pin the places you want to remember, rate them, and filter by category.
Plain HTML/CSS/JS, no build step, no backend, no accounts. Data lives in your browser (`localStorage`); use **Manage → Export JSON** to back up.

## How to use

- **Add a place:** tap the **+** in the middle of the tab bar (it works from any tab), then search a name or address, tap **◎ My location**, or **⌖ Pick on map** and move the map under the pin. You can also long-press the map to start a pin there.
- **Rate it:** rate each detail of the place's category in stars (tap the same star again to clear) and add a comment. The **overall rating is the average of the details you rated**, to one decimal (e.g. 4.3 ★). A category with no qualifiers uses a plain star rating instead. The pin colour follows the overall rating, blending from red (1) through orange, yellow and lime to green (5); grey means unrated.
- **Details per category:** each category has its own 5-star qualifiers (Food: Taste, Value for money, Atmosphere, Service; Cafe: Coffee, Work-friendly, and so on). More stars is always better, so "Value for money" = cheaper. Rate them when saving a place; they feed the overall rating. Add your own with **＋ Add qualifier** in the form, or manage them per category under **Manage**.
- **Price:** every place, in any category (including your own), has a built-in price: one amount or a from–to range (e.g. 15–30 per person). Pick the currency symbol under **Manage**. The **Price ↑ / Price ↓** buttons on the List tab sort by it (a range counts as its middle; places without a price go last), and the **★ Ratings** chip has a **Max price** filter that keeps places starting at or below it.
- **Rating filters:** the **★ Ratings** chip sets a minimum for the overall rating and for any qualifier of the selected categories (e.g. Food + Atmosphere ≥ 4).
- **Categories:** **Manage** lets you add your own (name + emoji), rename or delete them. The chips above the map and list filter the pins; select several to combine them.
- **List tab:** the same places as cards, sorted by recent, top rated or nearby.
- **Visits and spending:** open a place and tap **＋ Log a visit** (date, plus what you spent if you like). Each place keeps a visit counter, a total spent, and the date of the last visit; the List shows them and Manage shows the totals for everything. The wheel's result has a **✓ I went here** shortcut.
- **How to use:** the same how-to is built into the app, in collapsible sections at the bottom of the **Manage** tab.
- **Go Where? tab (can't decide?):** set a range in km, optionally a max price (keeps places starting at or below it; unpriced places are left out while it's set), narrow by **last visited** (visited within, or not visited within, N days; or never) and **times visited** (min / max), pick at least one category (each chip shows how many places match), and spin the wheel. The winner is drawn at random, evenly across every matching place; the wheel has about 4 slices per chosen category (6 to 16 in all), and if more places match than fit it shows a spread across your categories that always includes the winner. Needs your location (◎).
- **Directions:** open a place and tap **Directions** to hand off to Apple Maps.

## Run locally

    python3 -m http.server 8000   # then open http://localhost:8000

## Deploy (GitHub Pages)

Push to GitHub, then Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`. Open the URL in **Safari** on your iPhone and use Share → **Add to Home Screen**. GoWhere is set up as a **Safari shortcut** (`display: browser`, no web-app meta tags): the icon opens it in Safari, because iOS never shows the location prompt inside a Home Screen web app. If the Add to Home Screen sheet has an **Open as Web App** switch, leave it off.

## Location troubleshooting (iPhone)

Location is only used by **◎ My location** and the **Nearby** sort; searching, picking on the map and long-pressing the map work without it.

If ◎ says location is blocked:
1. **Open GoWhere in Safari** (the Home Screen icon is set up as a Safari shortcut). iOS never shows the location prompt inside a Home Screen web app.
2. Tap **aA** in the address bar › **Website Settings** › **Location** › **Allow**. This is the usual fix: a site that was denied once stays denied even when Settings › Privacy & Security › Location Services › Safari Websites is allowed.
3. Check **Settings › Privacy & Security › Location Services** is on, **Safari Websites** isn't *Never*, and **Precise Location** is on.
4. Still denied? Settings › Apps › Safari › Advanced › Website Data: remove the site, or Settings › General › Transfer or Reset iPhone › Reset › **Reset Location & Privacy**. On a work phone, a device profile or Screen Time restriction can block location altogether.
5. Location only works on **https** pages and while the app is open (no background tracking).

**Manage › Location check › Test location** prints what the device reports (https, Safari tab vs Home Screen, permission state and the exact error), which helps when the in-app message isn't enough.

The message shown in the app says which case it is: blocked, timed out (try again on Wi-Fi or outdoors), or unavailable.

## Notes

- **The map is online-only.** The app stores only your places and its own files. Leaflet is loaded from unpkg when you open the Map tab and the tiles come from OpenStreetMap (fetched with `no-store`), so nothing from the map is cached. Offline, the Map tab says so and the List, Manage and add-by-GPS still work. Search (Photon) and Pick on map also need a connection.
- Bump `CACHE` in `sw.js` after changing any app file so installed copies update.
- The Home Screen app and the Safari tab keep **separate** data. Pick one and stick with it, and export now and then.
- Location only works while the app is open (no background tracking).
- Regenerate the icons with `python3 tools/make_icons.py` (needs Pillow).
