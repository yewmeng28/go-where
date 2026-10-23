'use strict';

/* ---------- constants & helpers ---------- */
const KEY = 'gowhere-v1';
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// pin colour by rating: 0 = unrated, 1 (red) .. 5 (green)
const RC = ['#8b9bb0', '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'];
const RL = ['Unrated', 'Poor', 'Meh', 'OK', 'Good', 'Great'];
// price is built in for every category: a real amount, or a from–to range, in the currency chosen under Manage
const fmtNum = n => Number.isInteger(n) ? String(n) : n.toFixed(2);
const priceText = p => p.pmin == null ? '' : S.currency + fmtNum(p.pmin) + (p.pmax != null && p.pmax !== p.pmin ? '–' + fmtNum(p.pmax) : '');
const priceMid = p => p.pmin == null ? null : (p.pmin + (p.pmax ?? p.pmin)) / 2;
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; };
// colour for any rating 0..5: grey when unrated, otherwise blended between the red-to-green steps
const rc = r => {
  if (!(r > 0)) return RC[0];
  const x = Math.min(Math.max(r, 1), 5), i = Math.min(Math.floor(x), 4), f = x - i;
  const [a, b] = [RC[i], RC[i + 1]].map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)));
  return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('');
};

// Each category carries its own 5-star qualifiers; on every one, more stars is better (so "Value" = cheaper).
const DEFAULT_QUALS = {
  food: ['Taste', 'Value for money', 'Atmosphere', 'Service'],
  cafe: ['Coffee', 'Value for money', 'Atmosphere', 'Work-friendly'],
  sight: ['Fun factor', 'Value for money', 'Crowd-free'],
  shop: ['Selection', 'Value for money', 'Service'],
  nature: ['Scenery', 'Easy access', 'Crowd-free'],
};
const defaultQuals = id => (DEFAULT_QUALS[id] || []).map(name => ({ id: `${id}-${name.toLowerCase().replace(/\W+/g, '')}`, name }));

function seed() {
  return {
    cats: [['food', '🍜', 'Food'], ['cafe', '☕', 'Cafe'], ['sight', '🎡', 'Attraction'], ['shop', '🛍️', 'Shopping'], ['nature', '🌳', 'Nature']]
      .map(([id, emoji, name]) => ({ id, emoji, name, quals: defaultQuals(id) })),
    pins: [],
    currency: '$',
  };
}

function load() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && Array.isArray(r.cats) && Array.isArray(r.pins)) {
      r.cats.forEach(c => { if (!Array.isArray(c.quals)) c.quals = defaultQuals(c.id); });
      r.currency ??= '$';
      r.pins.forEach(p => { delete p.price; });          // earlier $-level prices can't be turned into amounts
      return r;
    }
  } catch (e) { /* fall through */ }
  return seed();
}

let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save (storage full or blocked)'); } }
try { navigator.storage?.persist?.(); } catch (e) { /* ignore */ }

const ui = { tab: 'map', map: null, layer: null, me: null, view: null, pick: null, draft: null, sort: 'recent', filter: [], minOverall: 0, minQ: {}, maxPrice: 0, results: [], busy: false,
  spin: { km: 5, maxPrice: 0, off: [], rot: 0, items: [], winner: null, busy: false, tried: false } };

let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

const cat = id => S.cats.find(c => c.id === id);
function addQual(c, name) {
  if (c.quals.some(q => qkey(q.name) === qkey(name))) return false;
  c.quals.push({ id: uid(), name }); save(); return true;
}
const pinOf = id => S.pins.find(p => p.id === id);

// overall rating = average of the rated qualifiers, to 0.1; with none rated it falls back to a manual star rating
function calcRating(catId, qr = {}, manual = 0) {
  const v = (cat(catId)?.quals || []).map(q => qr[q.id] || 0).filter(Boolean);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : manual || 0;
}
const pinRating = p => calcRating(p.cat, p.qr, p.rating);

function dist(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = km => km < 1 ? `${Math.round(km * 100) * 10} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;

const qkey = name => name.trim().toLowerCase();
// a pin's rating for the qualifier called `key` (0 if its category has none by that name, or it was left unrated)
function qualValue(p, key) {
  const q = cat(p.cat)?.quals.find(x => qkey(x.name) === key);
  return q ? (p.qr?.[q.id] || 0) : 0;
}
const activeFilters = () => (ui.minOverall ? 1 : 0) + (ui.maxPrice ? 1 : 0) + Object.values(ui.minQ).filter(Boolean).length;

function visible() {
  return S.pins.filter(p => (!ui.filter.length || ui.filter.includes(cat(p.cat) ? p.cat : ''))
    && pinRating(p) >= ui.minOverall
    && (!ui.maxPrice || (p.pmin != null && p.pmin <= ui.maxPrice))
    && Object.entries(ui.minQ).every(([k, min]) => !min || qualValue(p, k) >= min));
}

// 5 stars: read-only, or buttons that fire `act` (extra = additional data attributes)
const stars = (r, ro, act = 'star', extra = '', num = false) => ro
  ? `<div class="stars ro" style="--c:${rc(r)}">${[1, 2, 3, 4, 5].map(i => `<span style="--p:${Math.round(Math.min(Math.max(r - (i - 1), 0), 1) * 100)}%">★</span>`).join('')}${num && r ? `<b>${r.toFixed(1)}</b>` : ''}</div>`
  : `<div class="stars" style="--c:${rc(r)}">${[1, 2, 3, 4, 5].map(i => `<button data-act="${act}" ${extra} data-v="${i}" class="${i <= r ? 'on' : ''}" aria-label="${i} stars">★</button>`).join('')}</div>`;

const markerSvg = (color, emoji) => `<svg viewBox="0 0 24 24" style="color:${color}"><use href="#pin"/></svg><span>${esc(emoji || '')}</span>`;

/* ---------- rendering ---------- */
function render(keep) {
  const y = keep ? scroller().scrollTop : 0;
  if (ui.map) { ui.view = { c: ui.map.getCenter(), z: ui.map.getZoom() }; ui.map.remove(); ui.map = null; }
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const v = $('#view');
  v.className = ui.tab === 'map' ? 'map' : '';
  if (ui.tab === 'map') renderMap(v);
  else if (ui.tab === 'list') renderList(v);
  else if (ui.tab === 'goWhere') renderSpin(v);
  else if (ui.tab === 'about') renderAbout(v);
  else renderManage(v);
  scroller().scrollTop = y;
}

// the map tab keeps its own fixed layer; the other tabs scroll the page, like Heavy Metal
const scroller = () => ui.tab === 'map' ? $('#view') : document.scrollingElement || document.documentElement;

function chipsHtml() {
  const chip = (id, on, label) => `<button class="chip ${on ? 'on' : ''}" data-act="chip" data-id="${esc(id)}">${label}</button>`;
  return chip('', !ui.filter.length, 'All')
    + S.cats.map(c => chip(c.id, ui.filter.includes(c.id), `${esc(c.emoji)} ${esc(c.name)}`)).join('')
    + (S.pins.some(p => !cat(p.cat)) ? chip('__none', ui.filter.includes(''), 'Other') : '')
    + `<button class="chip ${activeFilters() ? 'on' : ''}" data-act="filters">★ Ratings${activeFilters() ? ` (${activeFilters()})` : ''}</button>`;
}

function refreshChips() {
  document.querySelectorAll('#chips, .chips').forEach(el => { el.innerHTML = chipsHtml(); });
  if (ui.tab === 'map') drawMarkers(); else renderList($('#view'), true);
}

function renderMap(v) {
  v.innerHTML = `<div id="map"></div><div id="chips">${chipsHtml()}</div>`
    + (ui.pick
      ? `<svg class="crosshair" viewBox="0 0 24 24"><use href="#pin"/></svg>
         <div id="pickbar"><div class="grow sm">Move the map so the pin sits on the place</div>
         <button class="btn sm ghost" data-act="pick-cancel">Cancel</button><button class="btn sm primary" data-act="pick-ok">Set here</button></div>`
      : `<button class="fab loc" data-act="locate" aria-label="My location">◎</button><button class="fab" data-act="add" aria-label="Add place">+</button>`);
  const token = ui.token = (ui.token || 0) + 1;
  const offline = () => { const m = $('#map'); if (m && token === ui.token) m.innerHTML = '<div class="empty">The map needs an internet connection.<br>Your places are still in the List tab.</div>'; };
  if (navigator.onLine === false) return offline();
  loadLeaflet().then(() => { if (token === ui.token) initMap(); }, offline);
}

/* The map is online-only: Leaflet and the tiles are fetched on demand and the app never stores them. */
let leafletReady;
function loadLeaflet() {
  if (typeof L !== 'undefined') return Promise.resolve();
  leafletReady ||= new Promise((ok, fail) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = ok; js.onerror = () => { leafletReady = null; fail(); };
    document.head.append(css, js);
  });
  return leafletReady;
}

// tiles are fetched with no-store and shown from a short-lived blob, so they never land in the HTTP cache either
function addTiles(map) {
  const NoStoreTiles = L.TileLayer.extend({
    createTile(coords, done) {
      const img = document.createElement('img');
      img.alt = '';
      fetch(this.getTileUrl(coords), { cache: 'no-store' }).then(r => r.blob()).then(b => {
        img.onload = () => { URL.revokeObjectURL(img.src); done(null, img); };
        img.src = URL.createObjectURL(b);
      }).catch(e => done(e, img));
      return img;
    },
  });
  new NoStoreTiles('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
}

function initMap() {
  ui.map = L.map('map', { zoomControl: false });
  addTiles(ui.map);
  ui.layer = L.layerGroup().addTo(ui.map);
  ui.map.on('contextmenu', e => openForm(newDraft(e.latlng.lat, e.latlng.lng)));
  if (ui.view) ui.map.setView(ui.view.c, ui.view.z);
  else if (S.pins.length) ui.map.fitBounds(L.latLngBounds(S.pins.map(p => [p.lat, p.lng])), { padding: [50, 50], maxZoom: 15 });
  else ui.map.setView([20, 0], 2);
  drawMarkers();
}

function drawMarkers() {
  if (!ui.layer) return;
  ui.layer.clearLayers();
  for (const p of visible()) {
    const c = cat(p.cat);
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'gw-marker', html: markerSvg(rc(pinRating(p)), c?.emoji), iconSize: [36, 36], iconAnchor: [18, 34] }) })
      .on('click', () => openDetail(p.id)).addTo(ui.layer);
  }
  if (ui.me) L.marker([ui.me.lat, ui.me.lng], { icon: L.divIcon({ className: 'gw-marker', html: '<div class="gw-me"></div>', iconSize: [16, 16] }), interactive: false }).addTo(ui.layer);
}

function renderList(v, keepScroll) {
  const y = scroller().scrollTop;
  let ps = visible().slice();
  if (ui.sort === 'rating') ps.sort((a, b) => pinRating(b) - pinRating(a) || b.created - a.created);
  else if (ui.sort === 'near' && ui.me) ps.sort((a, b) => dist(ui.me, a) - dist(ui.me, b));
  else if (ui.sort === 'pasc' || ui.sort === 'pdesc') {        // sorted by the middle of the range; unpriced places go last
    const dir = ui.sort === 'pasc' ? 1 : -1;
    ps.sort((a, b) => {
      const x = priceMid(a), y = priceMid(b);
      if (x == null || y == null) return (x == null) - (y == null) || b.created - a.created;
      return (x - y) * dir || b.created - a.created;
    });
  }
  else ps.sort((a, b) => b.created - a.created);
  v.innerHTML = `<div class="chips">${chipsHtml()}</div>
    <div class="seg">${[['recent', 'Recent'], ['rating', 'Top'], ['near', 'Nearby'], ['pasc', 'Price ↑'], ['pdesc', 'Price ↓']].map(([k, l]) => `<button data-act="sort" data-id="${k}" class="${ui.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div>`
    + (ps.length ? ps.map(p => {
      const c = cat(p.cat);
      return `<div class="card pin" data-act="detail" data-id="${p.id}">
        <svg class="ic" viewBox="0 0 24 24" style="color:${rc(pinRating(p))}"><use href="#pin"/></svg>
        <div class="grow"><b>${esc(p.name)}</b>
          <div class="sm muted">${c ? esc(c.emoji + ' ' + c.name) : 'Uncategorised'}${p.pmin != null ? ' · ' + esc(priceText(p)) : ''}${ui.me ? ' · ' + fmtDist(dist(ui.me, p)) : ''}</div>
          ${stars(pinRating(p), true, '', '', true)}${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}</div></div>`;
    }).join('') : `<div class="empty">${S.pins.length ? 'No places in this category.' : 'No places yet.<br>Tap + on the map to save your first one.'}</div>`);
  if (keepScroll) scroller().scrollTop = y;
}

function renderManage(v) {
  v.innerHTML = `<h2>Categories</h2>
    <div class="card">${S.cats.map(c => `<div class="catblock"><div class="row">
        <input style="width:56px;text-align:center" value="${esc(c.emoji)}" data-cat="${c.id}" data-f="emoji" aria-label="Emoji">
        <input class="grow" value="${esc(c.name)}" data-cat="${c.id}" data-f="name" aria-label="Name">
        <button class="btn sm danger" data-act="cat-del" data-id="${c.id}">Delete</button></div>
        <div class="qchips">${c.quals.map(q => `<span class="chip q">${esc(q.name)}<button data-act="qual-del" data-id="${c.id}" data-q="${q.id}" aria-label="Remove ${esc(q.name)}">×</button></span>`).join('') || '<span class="sm muted">No qualifiers</span>'}</div>
        <div class="row"><input class="grow" data-qin="${c.id}" placeholder="Add a 5-star qualifier, e.g. Parking" enterkeyhint="done"><button class="btn sm" data-act="qual-add" data-id="${c.id}">Add</button></div></div>`).join('') || '<div class="muted sm">No categories yet.</div>'}
      <label class="f">New category</label>
      <div class="row"><input id="ncEmoji" style="width:56px;text-align:center" value="📍" aria-label="Emoji">
        <input id="ncName" class="grow" placeholder="e.g. Hiking trails" aria-label="Name"><button class="btn primary" data-act="cat-add">Add</button></div></div>
    <h3>Price</h3>
    <div class="card"><div class="row"><span class="grow">Currency symbol</span><input data-cur maxlength="4" style="width:80px;text-align:center" value="${esc(S.currency)}" aria-label="Currency symbol"></div>
      <div class="sm muted">Shown before prices, e.g. ${esc(S.currency)}15–30. Sort by price on the List tab.</div></div>
    <h3>Pin colours</h3>
    <div class="card"><div class="legend">${RC.map((c, i) => `<span><span class="dot" style="background:${c}"></span>${i ? i + ' ' : ''}${RL[i]}</span>`).join('')}</div></div>
    <h3>Location check</h3>
    <div class="card"><div class="sm muted">Shows what this device tells the app about location. Tap it from the same place you use the app.</div>
      <div class="row"><button class="btn" data-act="loc-check">Test location</button></div><pre id="locout" class="sm"></pre></div>
    <h3>Data</h3>
    <div class="card"><div class="sm muted">${S.pins.length} places · ${S.cats.length} categories, stored on this device only.</div>
      <div class="row wrap"><button class="btn" data-act="export">Export JSON</button><button class="btn" data-act="import-merge">Import (merge)</button><button class="btn danger" data-act="import-replace">Import (replace)</button></div>
      <div class="sm muted">Export regularly — Safari can clear site data. The Home Screen app and the Safari tab keep separate data.</div></div>`;
}

/* ---------- sheet: detail & form ---------- */
function showSheet(html) {
  const s = $('#sheet'), y = s.hidden ? 0 : s.querySelector('.panel')?.scrollTop || 0;
  s.innerHTML = `<div class="panel">${html}</div>`; s.hidden = false;
  if (y) s.querySelector('.panel').scrollTop = y;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; ui.results = []; }

const mapsUrl = p => `https://maps.apple.com/?daddr=${p.lat},${p.lng}&q=${encodeURIComponent(p.name || 'Place')}`;

function openDetail(id) {
  const p = pinOf(id); if (!p) return;
  const c = cat(p.cat);
  showSheet(`<h2>${esc(p.name)}<button class="x" data-act="close">×</button></h2>
    <div class="sm muted">${c ? esc(c.emoji + ' ' + c.name) : 'Uncategorised'}${p.pmin != null ? ' · ' + esc(priceText(p)) : ''}${ui.me ? ' · ' + fmtDist(dist(ui.me, p)) + ' away' : ''}</div>
    <div style="margin:8px 0">${stars(pinRating(p), true, '', '', true)}</div>
    ${(c?.quals || []).filter(q => p.qr?.[q.id]).map(q => `<div class="qrow"><span class="grow">${esc(q.name)}</span>${stars(p.qr[q.id], true)}</div>`).join('')}
    ${p.note ? `<div style="white-space:pre-wrap;margin:10px 0">${esc(p.note)}</div>` : ''}
    <div class="row"><a class="btn primary grow" style="text-align:center;text-decoration:none" href="${mapsUrl(p)}">Directions</a>
      <button class="btn grow" data-act="edit" data-id="${p.id}">Edit</button></div>`);
}

function newDraft(lat, lng) {
  const first = ui.filter.find(id => cat(id)) || S.cats[0]?.id || '';
  return { id: null, name: '', cat: first, rating: 0, pmin: '', pmax: '', qr: {}, note: '', lat: lat ?? null, lng: lng ?? null, addr: '', q: '' };
}

function overallBlock(d) {
  const r = calcRating(d.cat, d.qr, d.rating);
  if (!cat(d.cat)?.quals.length) return `<label class="f">Rating · ${RL[d.rating]}</label>${stars(d.rating)}`;
  return `<label class="f">Overall rating · average of the details</label>`
    + (r ? `<div class="overall">${stars(r, true, '', '', true)}</div>` : '<div class="sm muted">Rate a detail above to get an overall score.</div>');
}

function openForm(d) {
  ui.draft = d;
  const loc = d.lat != null ? `${d.addr ? esc(d.addr) + '<br>' : ''}${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : 'No location chosen yet';
  showSheet(`<h2>${d.id ? 'Edit place' : 'Add place'}<button class="x" data-act="close">×</button></h2>
    <label class="f">Where</label>
    <div class="row"><input class="grow" data-f="q" value="${esc(d.q)}" placeholder="Search a place or address" enterkeyhint="search"><button class="btn" data-act="search">${ui.busy ? '…' : 'Search'}</button></div>
    ${ui.results.length ? `<div class="res">${ui.results.map((r, i) => `<button data-act="result" data-id="${i}">${esc(r.name)}<small>${esc(r.addr)}</small></button>`).join('')}</div>` : ''}
    <div class="row wrap"><button class="btn sm" data-act="use-me">◎ My location</button><button class="btn sm" data-act="pick">⌖ Pick on map</button></div>
    <div class="loc-pill">${loc}</div>
    <label class="f">Name</label><input data-f="name" value="${esc(d.name)}" placeholder="e.g. Tonkotsu King">
    <label class="f">Category</label>
    <select data-f="cat">${S.cats.map(c => `<option value="${c.id}" ${c.id === d.cat ? 'selected' : ''}>${esc(c.emoji + ' ' + c.name)}</option>`).join('')}<option value="" ${!cat(d.cat) ? 'selected' : ''}>Uncategorised</option><option value="__new">＋ New category…</option></select>
    <label class="f">Price${S.currency ? ' (' + esc(S.currency) + ')' : ''}</label>
    <div class="row"><input data-f="pmin" value="${esc(d.pmin)}" inputmode="decimal" placeholder="From, e.g. 15"><span class="muted">–</span><input data-f="pmax" value="${esc(d.pmax)}" inputmode="decimal" placeholder="To (optional)"></div>
    ${cat(d.cat) ? `<label class="f">Details · ${esc(cat(d.cat).name)}</label>`
      + cat(d.cat).quals.map(q => `<div class="qrow"><span class="grow">${esc(q.name)}</span>${stars(d.qr[q.id] || 0, false, 'qstar', `data-q="${q.id}"`)}</div>`).join('')
      + '<button class="btn sm ghost" data-act="qual-new">＋ Add qualifier</button>' : ''}
    ${overallBlock(d)}
    <label class="f">Comment</label><textarea data-f="note" placeholder="What to order, tips, who recommended it…">${esc(d.note)}</textarea>
    <div class="row" style="margin-top:14px">${d.id ? '<button class="btn danger" data-act="del">Delete</button>' : ''}<button class="btn primary grow" data-act="save">Save place</button></div>`);
}

async function search() {
  const q = (ui.draft.q || '').trim();
  if (!q || ui.busy) return;
  ui.busy = true; openForm(ui.draft);
  try {
    const c = ui.map?.getCenter() || ui.view?.c;
    const url = `https://photon.komoot.io/api/?limit=6&q=${encodeURIComponent(q)}` + (c ? `&lat=${c.lat}&lon=${c.lng}` : '');
    const j = await (await fetch(url)).json();
    ui.results = j.features.map(f => {
      const p = f.properties;
      return { name: p.name || p.street || q, addr: [p.street && p.name ? p.street : '', p.city || p.county, p.state, p.country].filter(Boolean).join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    });
    if (!ui.results.length) toast('Nothing found — try Pick on map');
  } catch (e) { toast('Search needs an internet connection'); }
  ui.busy = false; openForm(ui.draft);
}

function locate(cb) {
  if (!window.isSecureContext) return toast('Location only works on https:// pages. Open the GitHub Pages address, not an http:// one.', 6000);
  if (!navigator.geolocation) return toast('This browser has no location support', 5000);
  const ok = pos => { ui.me = { lat: pos.coords.latitude, lng: pos.coords.longitude }; cb && cb(); };
  const fail = e => toast(e.code === 1
    ? 'Location is blocked for this site. In Safari tap aA › Website Settings › Location › Allow, then try again. Also check Settings › Privacy & Security › Location Services.'
    : e.code === 3 ? 'Could not get a position in time. Try again with Wi-Fi on, or outdoors.'
      : 'Position unavailable. Check Location Services is on for this device.', 8000);
  // GPS first; if that times out (indoors), retry with the coarser Wi-Fi/cell position
  navigator.geolocation.getCurrentPosition(ok, e => (e.code === 3
    ? navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 })
    : fail(e)), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
}

// reports what iOS says about location so a block can be traced to its cause
function locationCheck() {
  const out = $('#locout'), line = s => { out.textContent += s + '\n'; };
  out.textContent = '';
  line(`Page: ${location.origin}`);
  line(`https: ${window.isSecureContext ? 'yes' : 'NO (location is blocked on http)'}`);
  line(`Opened as: ${navigator.standalone ? 'Home Screen app' : 'Safari tab / browser'}`);
  if (!navigator.geolocation) return line('No geolocation support');
  line('Asking for position…');
  // asked first, straight from the tap, so nothing async can separate it from the user's gesture
  navigator.geolocation.getCurrentPosition(
    pos => line(`OK: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)} (±${Math.round(pos.coords.accuracy)} m)`),
    e => line(`Error ${e.code} (${['', 'permission denied', 'position unavailable', 'timeout'][e.code] || 'unknown'}): ${e.message}`),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 });
  navigator.permissions?.query({ name: 'geolocation' }).then(s => line(`Permission state: ${s.state}`), () => line('Permission state: not reported'));
}

function savePin() {
  const d = ui.draft;
  if (d.lat == null) return toast('Choose a location first');
  const name = d.name.trim() || d.addr.split(',')[0] || 'Untitled place';
  let pmin = num(d.pmin), pmax = num(d.pmax);
  if (pmin == null) pmax = null;
  else if (pmax != null && pmax < pmin) [pmin, pmax] = [pmax, pmin];
  const qr = Object.fromEntries(Object.entries(d.qr).filter(([, v]) => v));
  if (d.id) Object.assign(pinOf(d.id), { name, cat: d.cat, rating: d.rating, pmin, pmax, qr, note: d.note.trim(), lat: d.lat, lng: d.lng });
  else S.pins.push({ id: uid(), name, cat: d.cat, rating: d.rating, pmin, pmax, qr, note: d.note.trim(), lat: d.lat, lng: d.lng, created: Date.now() });
  save(); closeSheet();
  if (ui.tab === 'map') ui.view = { c: { lat: d.lat, lng: d.lng }, z: Math.max(ui.map?.getZoom() || 0, 15) };
  render(); toast('Saved');
}

// minimum-rating filters: overall plus one row per qualifier name used by the selected categories
function openFilters() {
  const pool = ui.filter.length ? S.cats.filter(c => ui.filter.includes(c.id)) : S.cats;
  const names = new Map();
  pool.forEach(c => c.quals.forEach(q => { if (!names.has(qkey(q.name))) names.set(qkey(q.name), q.name); }));
  const row = (label, key, v) => `<div class="qrow"><span class="grow">${esc(label)}</span>${stars(v, false, 'minq', `data-q="${esc(key)}"`)}</div>`;
  showSheet(`<h2>Minimum ratings<button class="x" data-act="close">×</button></h2>
    <div class="sm muted">Only show places rated at least this many stars. Qualifiers follow the categories selected above.</div>
    ${row('Overall', '', ui.minOverall)}
    <div class="qrow"><span class="grow">Max price (${esc(S.currency)})</span><input data-maxp inputmode="decimal" style="width:110px" value="${ui.maxPrice || ''}" placeholder="No limit"></div>${[...names].map(([k, n]) => row(n, k, ui.minQ[k] || 0)).join('')}
    <div class="row" style="margin-top:14px"><button class="btn grow" data-act="filters-clear">Clear all</button><button class="btn primary grow" data-act="close">Show ${visible().length} places</button></div>`);
}

/* ---------- data in / out ---------- */
async function exportJson() {
  const text = JSON.stringify({ app: 'gowhere', v: 2, currency: S.currency, cats: S.cats, pins: S.pins }, null, 2);
  const file = new File([text], `gowhere-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function importJson(mode) {
  const f = $('#file');
  f.value = '';
  f.onchange = async () => {
    try {
      const j = JSON.parse(await f.files[0].text());
      if (!Array.isArray(j.cats) || !Array.isArray(j.pins)) throw new Error('bad');
      if (mode === 'replace') { if (!confirm('Replace everything on this device with the file?')) return; S = { cats: j.cats.map(c => ({ ...c, quals: c.quals || defaultQuals(c.id) })), pins: j.pins, currency: j.currency ?? '$' }; }
      else {
        for (const c of j.cats) if (!cat(c.id)) S.cats.push({ ...c, quals: c.quals || defaultQuals(c.id) });
        for (const p of j.pins) if (!pinOf(p.id)) S.pins.push(p);
      }
      save(); render(); toast('Imported');
    } catch (e) { toast('That file is not a GoWhere backup'); }
  };
  f.click();
}

/* ---------- about: how to use the app ---------- */
const ABOUT = [
  ['Save a place', `<ol><li>On the <b>Map</b> tab tap <b>+</b>.</li>
    <li>Set where it is: <b>search</b> a name or address, tap <b>◎ My location</b>, or <b>⌖ Pick on map</b> and move the map under the pin. You can also <b>long-press</b> the map to start a pin right there.</li>
    <li>Give it a name, choose a category, rate it, add a price and a comment, then <b>Save place</b>.</li></ol>
    <p>Tap a pin on the map, or a card in the List, to see its details, get <b>Directions</b> in Apple Maps, or <b>Edit</b> or delete it.</p>`],
  ['Ratings and colours', `<p>Each category has its own 5-star <b>details</b> (Food: Taste, Value for money, Atmosphere…). Rate the ones you care about; tap the same star again to clear it.</p>
    <p>The <b>overall rating</b> is the average of the details you rated, to one decimal (e.g. 4.3). A category with no details uses a plain star rating.</p>
    <p>Pins are coloured by overall rating, from red (1) through orange, yellow and lime to green (5). Grey means not rated yet.</p>`],
  ['Categories and details', `<p>Open <b>Manage</b> to add your own categories (a name and an emoji), rename them or delete them. Deleting a category keeps its places as "Other".</p>
    <p>Each category has its own list of 5-star details. Add one under the category, or tap <b>＋ Add qualifier</b> while saving a place (e.g. Parking, Kid-friendly). Removing a detail clears its ratings.</p>`],
  ['Price', `<p>Every place can have a price: one amount, or a from–to range such as 15–30. Choose the currency symbol under <b>Manage › Price</b>.</p>
    <p>On the <b>List</b> tab, <b>Price ↑</b> and <b>Price ↓</b> sort by price. A range counts as its middle, and places with no price go last.</p>`],
  ['Filter and sort', `<p>The chips at the top of the Map and List select categories. Pick several to combine them; <b>All</b> clears them.</p>
    <p>The <b>★ Ratings</b> chip sets minimums: overall rating, any detail of the chosen categories (e.g. Atmosphere at least 4) and a <b>Max price</b>.</p>
    <p>The List can be sorted by <b>Recent</b>, <b>Top</b> rated, <b>Nearby</b>, or <b>Price</b>.</p>`],
  ['Can\'t decide? Go Where?', `<p>Open the <b>Go Where?</b> tab, set a range in km, optionally a <b>max price</b> (places priced above it, or with no price, are left out), and choose at least one category. Each chip shows how many places match. Tap <b>Spin the wheel</b> and the wheel picks one at random, with a card to get directions.</p>
    <p>The wheel has about 4 slices per chosen category (6 to 16 in all). If more places match than fit, it shows a spread across your categories, always including the winner. It needs your location.</p>`],
  ['Location', `<p>Location is only used for <b>◎ My location</b>, the <b>Nearby</b> sort and <b>Go Where?</b>. Searching, picking on the map and long-pressing work without it.</p>
    <p>If location is blocked: in Safari tap <b>aA › Website Settings › Location › Allow</b>, and check Settings › Privacy &amp; Security › Location Services. <b>Manage › Test location</b> shows what the phone reports.</p>`],
  ['Your data', `<p>Everything is stored only on this phone, in this browser. Nothing is uploaded. Use <b>Manage › Export JSON</b> to back up or move to another device, and <b>Import</b> (merge or replace) to bring it back. Export now and then, since Safari can clear site data.</p>
    <p>The map and place search need an internet connection. Your saved places, the list and the wheel work offline, but the map stays blank without a connection.</p>`],
];

function renderAbout(v) {
  v.innerHTML = `<h2>How to use GoWhere</h2>
    <div class="sm muted" style="margin-bottom:12px">Save the places you want to remember, rate them, and let the wheel decide when you can't.</div>`
    + ABOUT.map(([title, body], i) => `<details class="card about" ${i === 0 ? 'open' : ''}><summary>${title}</summary>${body}</details>`).join('');
}

/* ---------- spin: let the wheel pick where to go ---------- */
const WHEEL = ['#2ec4b6', '#ff9f1c', '#e71d36', '#9b5de5', '#3a86ff', '#8ac926', '#ff006e', '#ffbe0b', '#06d6a0', '#f15bb5', '#00bbf9', '#fb5607'];
// slices on the wheel grow with the chosen categories (a few per category that has places in range), within a readable range
const SLICES_PER_CAT = 4, WHEEL_MIN = 6, WHEEL_CAP = 16;

const catKey = p => cat(p.cat) ? p.cat : '__none';
// categories switched on (all of them unless some were turned off), including "Other" when there are uncategorised places
const spinCats = () => [...S.cats.map(c => c.id), ...(S.pins.some(p => !cat(p.cat)) ? ['__none'] : [])].filter(id => !ui.spin.off.includes(id));
// a max price keeps places whose lowest price is at or below it; places with no price are left out while it is set
const spinPriceOk = p => !ui.spin.maxPrice || (p.pmin != null && p.pmin <= ui.spin.maxPrice);
const inRange = () => ui.me ? S.pins.filter(p => dist(ui.me, p) <= ui.spin.km && spinPriceOk(p)) : [];
const spinCandidates = () => { const on = spinCats(); return inRange().filter(p => on.includes(catKey(p))).sort((a, b) => dist(ui.me, a) - dist(ui.me, b)); };

// unbiased random integer in [0, n)
function rand(n) {
  const a = new Uint32Array(1), lim = 2 ** 32 - (2 ** 32 % n);
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return a[0] % n;
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const wheelSize = cands => Math.min(cands.length, Math.min(WHEEL_CAP, Math.max(WHEEL_MIN, new Set(cands.map(catKey)).size * SLICES_PER_CAT)));

// `size` places taken one category at a time (round-robin), so every chosen category with places is represented
function spread(cands, size, pick = a => a) {
  const groups = {};
  cands.forEach(p => (groups[catKey(p)] ||= []).push(p));
  const lists = pick(Object.values(groups)).map(g => pick(g));
  const out = [];
  for (let i = 0; out.length < size && lists.some(l => i < l.length); i++) lists.forEach(l => { if (i < l.length && out.length < size) out.push(l[i]); });
  return out;
}

// the winner is drawn uniformly from every candidate; the wheel then shows it with a spread of the others across the categories
function buildWheel(cands) {
  const winner = cands[rand(cands.length)];
  const size = wheelSize(cands);
  const others = spread(cands.filter(p => p !== winner), size - 1, shuffle);
  const items = shuffle([winner, ...others]);
  return { items, idx: items.indexOf(winner) };
}

// rotation that leaves slice `idx` (of n) under the pointer at the top, after `turns` extra full turns
function landingRot(rot, idx, n, jitter, turns) {
  const seg = 2 * Math.PI / n, full = 2 * Math.PI;
  const target = -Math.PI / 2 - (idx + 0.5 + jitter * 0.8) * seg;     // jitter in (-0.5, 0.5): land off-centre in the slice
  return rot + ((target - rot) % full + full) % full + turns * full;
}

function renderSpin(v) {
  const s = ui.spin;
  v.innerHTML = `<h2>Go Where?</h2>
    <div class="card">
      <div class="row"><span class="grow">Within <b id="kmval">${s.km}</b> km</span><button class="btn sm" data-act="spin-loc">◎ ${ui.me ? 'Update' : 'Use my'} location</button></div>
      <input type="range" min="1" max="50" step="1" value="${s.km}" data-spinkm aria-label="Range in km">
      <div class="row"><span class="grow">Max price${S.currency ? ' (' + esc(S.currency) + ')' : ''}</span><input data-spinmax inputmode="decimal" style="width:110px" value="${s.maxPrice || ''}" placeholder="No limit" aria-label="Max price"></div>
      <label class="f">Categories (at least one)</label>
      <div class="spinchips" id="spinchips"></div>
      <div id="spininfo" class="sm muted" style="margin-top:8px"></div>
    </div>
    <div class="wheelbox"><div class="pointer"></div><canvas id="wheel"></canvas></div>
    <button class="btn primary block spinbtn" id="spinbtn" data-act="spin-go">Decide My Fate</button>
    <div id="spinres"></div>`;
  updateSpin();
}

function updateSpin() {
  if (!$('#spinchips')) return;
  const s = ui.spin, on = spinCats(), near = inRange(), cands = spinCandidates();
  const chip = (id, label) => `<button class="chip ${on.includes(id) ? 'on' : ''}" data-act="spin-cat" data-id="${id}">${label} · ${near.filter(p => catKey(p) === id).length}</button>`;
  $('#spinchips').innerHTML = S.cats.map(c => chip(c.id, `${esc(c.emoji)} ${esc(c.name)}`)).join('')
    + (S.pins.some(p => !cat(p.cat)) ? chip('__none', 'Other') : '');
  $('#spininfo').textContent = !ui.me ? 'Turn on location to see what is nearby.'
    : `${cands.length} place${cands.length === 1 ? '' : 's'} within ${s.km} km in the chosen categories${s.maxPrice ? `, priced up to ${S.currency}${fmtNum(s.maxPrice)}` : ''}`
      + (cands.length > wheelSize(cands) ? ` · the wheel shows ${wheelSize(cands)} of them, spread across your categories, including the winner` : '');
  if (!s.busy && !s.winner) s.items = spread(cands, wheelSize(cands));          // preview until a spin has been made
  $('#spinbtn').disabled = s.busy || !cands.length;
  for (const el of document.querySelectorAll('[data-spinkm], [data-spinmax]')) el.disabled = s.busy;
  const w = s.winner, c = w && cat(w.cat);
  $('#spinres').innerHTML = !w ? '' : `<div class="card result">
    <div class="sm muted">Go to…</div><h2>${esc(c?.emoji || '📍')} ${esc(w.name)}</h2>
    <div class="sm muted">${c ? esc(c.name) : 'Uncategorised'}${w.pmin != null ? ' · ' + esc(priceText(w)) : ''} · ${fmtDist(dist(ui.me, w))} away</div>
    <div style="margin:6px 0">${stars(pinRating(w), true, '', '', true)}</div>${w.note ? `<div class="note" style="white-space:pre-wrap">${esc(w.note)}</div>` : ''}
    <div class="row"><a class="btn primary grow" style="text-align:center;text-decoration:none" href="${mapsUrl(w)}">Directions</a><button class="btn grow" data-act="detail" data-id="${w.id}">Details</button></div></div>`;
  drawWheel();
}

function drawWheel() {
  const cv = $('#wheel');
  if (!cv?.getContext) return;
  const dpr = window.devicePixelRatio || 1, size = cv.clientWidth || 300;
  cv.width = cv.height = Math.round(size * dpr);
  const g = cv.getContext('2d'), items = ui.spin.items, n = items.length, r = size / 2 - 6;
  g.scale(dpr, dpr); g.translate(size / 2, size / 2);
  if (!n) {
    g.beginPath(); g.arc(0, 0, r, 0, 2 * Math.PI); g.fillStyle = '#1e2b3a'; g.fill();
    g.fillStyle = '#8b9bb0'; g.font = '700 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 0, 4);
    return;
  }
  const seg = 2 * Math.PI / n;
  items.forEach((p, i) => {
    const a0 = ui.spin.rot + i * seg;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, a0, a0 + seg); g.closePath();
    g.fillStyle = WHEEL[i % WHEEL.length]; g.fill(); g.strokeStyle = '#0f1720'; g.lineWidth = 2; g.stroke();
    g.save(); g.rotate(a0 + seg / 2);
    g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.font = '700 14px -apple-system,system-ui,sans-serif';
    g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 3;
    let label = `${cat(p.cat)?.emoji || '📍'} ${p.name}`, text = label;
    while (g.measureText(text).width > r - 46 && label.length > 1) { label = label.slice(0, -1); text = label + '…'; }
    g.fillText(text, r - 14, 0); g.restore();
  });
  g.beginPath(); g.arc(0, 0, 20, 0, 2 * Math.PI); g.fillStyle = '#0f1720'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#2ec4b6'; g.stroke();
}

function doSpin() {
  const s = ui.spin;
  if (s.busy) return;
  if (!ui.me) { toast('Needs your location first'); return locate(() => { if (ui.tab === 'goWhere') updateSpin(); }); }
  const cands = spinCandidates();
  if (!cands.length) return toast('No places in range for those categories');
  const { items, idx } = buildWheel(cands);
  const from = s.rot, to = landingRot(from, idx, items.length, rand(1000) / 1000 - 0.5, 5 + rand(3));
  s.items = items; s.winner = null; s.busy = true; $('#spinres').innerHTML = ''; updateSpin();
  const t0 = performance.now(), dur = 5200, ease = x => 1 - (1 - x) ** 4;
  const step = now => {
    const x = Math.min((now - t0) / dur, 1);
    s.rot = from + (to - from) * ease(x);
    if (x < 1 && ui.tab === 'goWhere') { drawWheel(); return requestAnimationFrame(step); }
    s.busy = false; s.winner = items[idx];                               // finished (or you left the tab: the result waits for you)
    if (ui.tab === 'goWhere') updateSpin();
  };
  requestAnimationFrame(step);
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const tab = e.target.closest('#tabs button');
  if (tab) {
    ui.tab = tab.dataset.tab; ui.pick = null; render();
    if (ui.tab === 'goWhere' && !ui.me && !ui.spin.tried) { ui.spin.tried = true; locate(() => { if (ui.tab === 'goWhere') updateSpin(); }); }
    return;
  }
  if (e.target.id === 'sheet') return closeSheet();
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = el.dataset.id, d = ui.draft;
  switch (el.dataset.act) {
    case 'close': closeSheet(); break;
    case 'add': openForm(newDraft()); break;
    case 'detail': openDetail(id); break;
    case 'edit': { const p = pinOf(id); openForm({ ...p, pmin: p.pmin ?? '', pmax: p.pmax ?? '', qr: { ...p.qr }, addr: '', q: '' }); break; }
    case 'del': if (confirm('Delete this place?')) { S.pins = S.pins.filter(p => p.id !== d.id); save(); closeSheet(); render(); } break;
    case 'save': savePin(); break;
    case 'star': d.rating = d.rating === +el.dataset.v ? 0 : +el.dataset.v; openForm(d); break;
    case 'qstar': { const q = el.dataset.q, v = +el.dataset.v; d.qr[q] = d.qr[q] === v ? 0 : v; openForm(d); break; }
    case 'qual-new': {
      const name = (prompt(`New qualifier for ${cat(d.cat).name} (rated in stars)`) || '').trim();
      if (name) { addQual(cat(d.cat), name); openForm(d); }
      break;
    }
    case 'qual-add': {
      const inp = document.querySelector(`[data-qin="${id}"]`), name = inp.value.trim();
      if (!name) return toast('Type a qualifier name first');
      if (!addQual(cat(id), name)) toast('That qualifier already exists');
      render(true); break;
    }
    case 'qual-del': {
      const c = cat(id); c.quals = c.quals.filter(q => q.id !== el.dataset.q);
      S.pins.forEach(p => { if (p.qr) delete p.qr[el.dataset.q]; }); save(); render(true); break;
    }
    case 'filters': openFilters(); break;
    case 'minq': {
      const k = el.dataset.q, v = +el.dataset.v;
      if (!k) ui.minOverall = ui.minOverall === v ? 0 : v;
      else ui.minQ[k] = ui.minQ[k] === v ? 0 : v;
      refreshChips(); openFilters(); break;
    }
    case 'filters-clear': ui.minOverall = 0; ui.minQ = {}; ui.maxPrice = 0; refreshChips(); openFilters(); break;
    case 'search': search(); break;
    case 'result': { const r = ui.results[+id]; Object.assign(d, { lat: r.lat, lng: r.lng, addr: [r.name, r.addr].filter(Boolean).join(', ') }); if (!d.name.trim()) d.name = r.name; ui.results = []; openForm(d); break; }
    case 'use-me': locate(() => { d.lat = ui.me.lat; d.lng = ui.me.lng; d.addr = 'My location'; openForm(d); }); break;
    case 'pick':
      if (navigator.onLine === false) return toast('Picking on the map needs an internet connection');
      ui.pick = { d }; ui.view = d.lat != null ? { c: { lat: d.lat, lng: d.lng }, z: 16 } : ui.view; closeSheet(); ui.tab = 'map'; render(); break;
    case 'pick-ok': { if (!ui.map) return toast('Map not ready yet'); const c = ui.map.getCenter(), pd = ui.pick.d; pd.lat = c.lat; pd.lng = c.lng; pd.addr = ''; ui.pick = null; render(); openForm(pd); break; }
    case 'pick-cancel': { const pd = ui.pick.d; ui.pick = null; render(); openForm(pd); break; }
    case 'locate': locate(() => { ui.map?.setView([ui.me.lat, ui.me.lng], 16); drawMarkers(); }); break;
    case 'chip':
      if (!id) ui.filter = [];
      else { const k = id === '__none' ? '' : id; ui.filter = ui.filter.includes(k) ? ui.filter.filter(x => x !== k) : [...ui.filter, k]; }
      refreshChips(); break;
    case 'sort': if (id === 'near' && !ui.me) locate(() => { ui.sort = id; render(); }); else { ui.sort = id; render(); } break;
    case 'cat-add': {
      const name = $('#ncName').value.trim(); if (!name) return toast('Give the category a name');
      S.cats.push({ id: uid(), name, emoji: $('#ncEmoji').value.trim() || '📍', quals: [] }); save(); render(true); break;
    }
    case 'cat-del': {
      const c = cat(id); if (!confirm(`Delete "${c.name}"? Its places are kept as uncategorised.`)) return;
      S.cats = S.cats.filter(x => x.id !== id); ui.filter = ui.filter.filter(x => x !== id);
      S.pins.forEach(p => { if (p.cat === id) p.cat = ''; }); save(); render(); break;
    }
    case 'loc-check': locationCheck(); break;
    case 'spin-cat': {
      const s = ui.spin; if (s.busy) break;
      if (!s.off.includes(id) && spinCats().length === 1) { toast('Pick at least one category'); break; }
      s.off = s.off.includes(id) ? s.off.filter(x => x !== id) : [...s.off, id]; s.winner = null; updateSpin(); break;
    }
    case 'spin-loc': locate(() => { ui.spin.winner = null; if (ui.tab === 'goWhere') updateSpin(); }); break;
    case 'spin-go': doSpin(); break;
    case 'export': exportJson(); break;
    case 'import-merge': importJson('merge'); break;
    case 'import-replace': importJson('replace'); break;
  }
});

document.addEventListener('input', e => {
  if (e.target.dataset.spinmax !== undefined) {                   // max price on the Spin tab
    ui.spin.maxPrice = num(e.target.value) || 0; ui.spin.winner = null; updateSpin(); return;
  }
  if (e.target.dataset.spinkm !== undefined) {                    // range slider on the Spin tab
    ui.spin.km = +e.target.value; ui.spin.winner = null;
    $('#kmval').textContent = ui.spin.km; updateSpin(); return;
  }
  const f = e.target.dataset.f;
  if (!f || e.target.dataset.cat || e.target.tagName === 'SELECT') return;
  ui.draft[f] = e.target.value;
});

document.addEventListener('change', e => {
  const t = e.target, f = t.dataset.f;
  if (t.dataset.cur !== undefined) { S.currency = t.value.trim(); save(); return; }
  if (t.dataset.maxp !== undefined) { ui.maxPrice = num(t.value) || 0; refreshChips(); openFilters(); return; }
  if (!f) return;
  if (t.dataset.cat) {                       // inline category edit on the Manage tab
    const c = cat(t.dataset.cat);
    if (f === 'name' && !t.value.trim()) { t.value = c.name; return; }
    c[f] = t.value.trim() || c[f]; save(); return;
  }
  if (f === 'cat') {
    if (t.value === '__new') {
      const name = (prompt('New category name') || '').trim();
      if (name) { const c = { id: uid(), name, emoji: '📍', quals: [] }; S.cats.push(c); save(); ui.draft.cat = c.id; }
      openForm(ui.draft);
    } else ui.draft.cat = t.value;
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.dataset.f === 'q') { e.preventDefault(); search(); }
  else if (e.target.dataset.qin) e.target.parentElement.querySelector('[data-act="qual-add"]').click();
});

window.addEventListener('online', () => { if (ui.tab === 'map' && !ui.map) render(true); });
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
