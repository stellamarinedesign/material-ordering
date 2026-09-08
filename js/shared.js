// shared.js — v0.51

const APP_VERSION = 'v0.51';

// Numeric version comparison (handles "v0.9" vs "v0.10" correctly, unlike
// plain string comparison). Returns true if `a` is strictly newer than `b`.
// Both inputs expected in the form "v0.32" or "v0.32.1".
function isVersionNewer(a, b) {
  const parse = v => String(v||'').replace(/^v/i,'').split('.').map(n => parseInt(n,10) || 0);
  const pa = parse(a), pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i=0; i<len; i++) {
    const na = pa[i]||0, nb = pb[i]||0;
    if (na !== nb) return na > nb;
  }
  return false; // equal
}

const DEFAULT_MATERIALS = [
  { id:1,  category:'Stainless Steel', subcategory:'Box Section', partCode:'SL0300', description:'100 x 50 x 3mm x 6m Box Section 316 S/S', qtyType:'Length' },
  { id:2,  category:'Stainless Steel', subcategory:'Box Section', partCode:'SL0301', description:'50 x 50 x 3mm x 6m Box Section 316 S/S',  qtyType:'Length' },
  { id:3,  category:'Stainless Steel', subcategory:'Round Bar',   partCode:'SL0400', description:'20mm Diameter x 6m Round Bar 316 S/S',     qtyType:'Length' },
  { id:4,  category:'Stainless Steel', subcategory:'Angle Bar',   partCode:'SL0500', description:'50 x 50 x 5mm x 6m Angle Bar 316 S/S',    qtyType:'Length' },
  { id:5,  category:'Stainless Steel', subcategory:'Channel',     partCode:'SL0600', description:'100 x 50 x 5mm x 6m Channel 316 S/S',     qtyType:'Length' },
  { id:6,  category:'Stainless Steel', subcategory:'Plate',       partCode:'SL0700', description:'3mm x 1500 x 3000mm Plate 316 S/S',        qtyType:'Sheet'  },
  { id:7,  category:'Aluminium',       subcategory:'Box Section', partCode:'AL0300', description:'100 x 50 x 3mm x 6m Box Section 6061-T6',  qtyType:'Length' },
  { id:8,  category:'Aluminium',       subcategory:'Round Bar',   partCode:'AL0400', description:'20mm Diameter x 6m Round Bar 6061-T6',      qtyType:'Length' },
  { id:9,  category:'Aluminium',       subcategory:'Angle Bar',   partCode:'AL0500', description:'50 x 50 x 5mm x 6m Angle Bar 6061-T6',     qtyType:'Length' },
  { id:10, category:'Aluminium',       subcategory:'Channel',     partCode:'AL0600', description:'100 x 50 x 5mm x 6m Channel 6061-T6',      qtyType:'Length' },
  { id:11, category:'Aluminium',       subcategory:'Plate',       partCode:'AL0700', description:'3mm x 1500 x 3000mm Plate 6061-T6',         qtyType:'Sheet'  },
];

const DEFAULT_SETTINGS = {
  supplierEmail:        'procurement@supplier.com',
  ccEmail:              'orders@yourcompany.com',
  deliveryNote:         'Please confirm availability and expected delivery date.',
  emailSubject:         '{orderType} - {category} - {date}',
  bulkConsumablesSubject: '{orderType} - {date}',
  emailSignature:       '',
  emailTemplate:        '{date}\r\n\r\n────────────────────────────────────────────────────\r\n{orderType} - {category}\r\n────────────────────────────────────────────────────\r\n\r\n{items}\r\n────────────────────────────────────────────────────\r\n{closingNote}',
  naturalSort:          true,   // numeric-aware sort order, e.g. 8mm before 10mm; inch sizes sort by their mm value
  unitAwareSearch:      true,   // "1 inch" matches "25.4mm" etc. — exact value match, no rounding
  fuzzySearch:          true,   // typo-tolerant text matching, exact matches always rank first
};

const CAT_ICONS = {
  // Material categories — colours loosely follow the real material's appearance
  // (phenolic orange, brass gold, bronze brown, steel greys light→dark, etc.)
  'Stainless Steel': { icon:'ti-atom-2',   bg:'#dbeafe', color:'#1d4ed8' },
  'Aluminium':       { icon:'ti-diamond',  bg:'#f0fdf4', color:'#15803d' },
  '2205 Duplex':     { icon:'ti-anchor',   bg:'#f1f5f9', color:'#64748b' },
  'Mild Steel':      { icon:'ti-building-bridge', bg:'#e5e7eb', color:'#4b5563' },
  '4140 Steel':      { icon:'ti-settings', bg:'#e5e7eb', color:'#374151' },
  'Acetal':          { icon:'ti-cylinder', bg:'#e4e4e7', color:'#18181b' },
  'Teflon':          { icon:'ti-droplet',  bg:'#f8fafc', color:'#9aa4b2' },
  'Brass':           { icon:'ti-coin',     bg:'#fef9c3', color:'#ca8a04' },
  'Bronze':          { icon:'ti-coins',    bg:'#fef3c7', color:'#92400e' },
  'Thrust Washer':   { icon:'ti-circle-dot', bg:'#ffedd5', color:'#c2410c' },
  '3D Filament':     { icon:'ti-3d-cube-sphere', bg:'#ecfeff', color:'#0e7490' },
  // Consumable categories
  'Fasteners':       { icon:'ti-bolt',    bg:'#fef9c3', color:'#a16207' },
  'Abrasives':       { icon:'ti-ripple',  bg:'#fce7f3', color:'#9d174d' },
  'Welding':         { icon:'ti-flame',   bg:'#fff7ed', color:'#c2410c' },
  'Safety':          { icon:'ti-shield-check', bg:'#f0fdf4', color:'#166534' },
  'Chemicals':       { icon:'ti-flask',   bg:'#faf5ff', color:'#7e22ce' },
  'default':         { icon:'ti-package', bg:'#f3f4f6', color:'#6b7280' },
};

// ── THEMES ────────────────────────────────────────────────────────────
// Visual themes are CSS-variable override blocks in css/themes.css, keyed on
// <html data-theme="…">. The choice is per device (localStorage) — it's a
// Settings item on each page and the four pages share one origin, so picking a
// theme on any page themes them all on that device. Each page's <head> carries
// a two-line bootstrap that applies the saved id before first paint; set()
// switches it live. To add a theme: a block in themes.css + an entry here.
const THEMES = [
  { id: '',       name: 'Workshop (default)' },
  { id: 'stella', name: 'Stella brand' },
];
const Theme = {
  _key: 'mo_theme',
  get()   { try { return localStorage.getItem(this._key) || ''; } catch { return ''; } },
  set(id) {
    try { if (id) localStorage.setItem(this._key, id); else localStorage.removeItem(this._key); } catch {}
    this.apply();
  },
  apply() {
    const id = this.get();
    if (id) document.documentElement.setAttribute('data-theme', id);
    else    document.documentElement.removeAttribute('data-theme');
    // Browser chrome / status bar tint follows the header colour of the theme
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const c = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      if (c) meta.setAttribute('content', c);
    }
  },
};

const DeviceName = {
  _key: 'mo_device_name',
  get()      { return localStorage.getItem(this._key) || ''; },
  save(name) { localStorage.setItem(this._key, name.trim()); },
  isSet()    { return !!this.get(); },
};

const Settings = {
  get() {
    try {
      const s = localStorage.getItem('mo_settings');
      return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : { ...DEFAULT_SETTINGS };
    } catch { return { ...DEFAULT_SETTINGS }; }
  },
  save(obj) {
    const m = { ...this.get(), ...obj };
    localStorage.setItem('mo_settings', JSON.stringify(m));
    return m;
  },
};

// ═══════════════════════════════════════════════════════════════════
// SEARCH & SORT ENGINE
// ═══════════════════════════════════════════════════════════════════
// Three independent, toggleable features feeding into Data.filter():
//   1. Natural sort      — "10mm" sorts after "8mm", not before; inch sizes sort
//                          by their mm value, interleaved with metric sizes
//   2. Unit-aware search — "1 inch" / "25.4mm" / "1\"" all match the same value
//   3. Fuzzy text search — tolerates typos in the catalogue or in what's typed
//
// Toggles live in Settings (naturalSort / unitAwareSearch / fuzzySearch,
// see DEFAULT_SETTINGS above) so they're persisted and editable from the
// Settings panel without touching code. Pass opts into Data.filter() to
// override per-call if a specific page ever needs different behaviour,
// e.g. Data.filter(list, cat, sub, q, {fuzzySearch:false}).

// ── 1. NATURAL SORT ──────────────────────────────────────────────────
// Splits a string into alternating text/number chunks and compares
// numbers numerically rather than character-by-character. Two conversions
// happen before chunking so sizes sort in true numeric order:
//   - inch measurements (1", 1 1/2", 3/8", 0.5 in) are replaced by their
//     millimetre value, putting inch and mm items on ONE scale — a 32mm
//     pipe sorts between 1" (25.4) and 1 1/2" (38.1), not after both
//   - remaining plain fractions ("1 1/2", "3/8") become decimals
// Uses INCH_VALUE_RE / MM_PER_INCH / roundMm from the unit-aware search
// section below — safe, since sorting only runs long after the whole file
// has been evaluated.
function naturalSortChunks(str) {
  const s = String(str||'').toLowerCase()
    .replace(INCH_VALUE_RE, (m, w, n, d, dec) => {
      const inches = dec !== undefined
        ? parseFloat(dec)
        : (w ? parseFloat(w) : 0) + parseFloat(n) / parseFloat(d);
      return String(roundMm(inches * MM_PER_INCH));
    })
    .replace(/(\d+)\s+(\d+)\/(\d+)/g, (_, w, n, d) => String(+w + +n / +d))
    .replace(/(\d+)\/(\d+)/g, (_, n, d) => String(+n / +d));
  return s.match(/\d+\.?\d*|\D+/g) || [];
}
// Description comparator that honours the naturalSort setting — for secondary sorts
// outside Data.filter (stock lists, consumables checkout) so "8mm before 10mm"
// applies consistently everywhere, not just on the ordering pages.
function descCompare(a, b) {
  return Settings.get().naturalSort ? naturalCompare(a, b) : String(a||'').localeCompare(String(b||''));
}

function naturalCompare(a, b) {
  const ca = naturalSortChunks(a), cb = naturalSortChunks(b);
  const len = Math.max(ca.length, cb.length);
  for (let i = 0; i < len; i++) {
    const xa = ca[i], xb = cb[i];
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;
    const na = parseFloat(xa), nb = parseFloat(xb);
    const bothNumeric = !isNaN(na) && !isNaN(nb) && /^\d/.test(xa) && /^\d/.test(xb);
    if (bothNumeric) {
      if (na !== nb) return na - nb;
    } else {
      if (xa !== xb) return xa < xb ? -1 : 1;
    }
  }
  return 0;
}

// ── 2. UNIT-AWARE MEASUREMENT EXTRACTION ─────────────────────────────
// Recognises number+unit tokens in a string and converts each to a
// canonical millimetre value. Supports decimals, whole-or-fractional
// inches (1", 1 1/2", 1/2"), and common unit spellings/spacing variants.
// Deliberately exact — no rounding tolerance, since the workshop genuinely
// stocks both 25mm and 25.4mm as distinct items and conflating them would
// be wrong, not helpful.
const MM_PER_INCH = 25.4;

// Inch token forms shared by search AND sort: mixed/fractional ("1 1/2"",
// "1/2 inch", "3/8in") or decimal ("0.5""). Note: \b doesn't work reliably
// after a quote character (" isn't a word character), so the unit alternation
// uses an explicit lookahead instead — (?![a-z]) for the word-based units
// (in/inch/inches) to avoid matching inside a longer word, and nothing extra
// needed after the quote symbols.
// INCH_VALUE_RE is precompiled for the sorter, which runs inside comparators
// where per-call RegExp construction would be wasteful — safe to share there
// because String.replace resets a /g regex's lastIndex itself. The exec loop
// in extractMeasurements builds its own instance so its cursor stays private.
const INCH_UNIT_SRC  = `(?:"|''|in\\.?(?![a-z])|inch(?:es)?(?![a-z]))`;
const INCH_VALUE_SRC = `(\\d+\\s+)?(\\d+)\\s*\\/\\s*(\\d+)\\s*${INCH_UNIT_SRC}|(\\d+(?:\\.\\d+)?)\\s*${INCH_UNIT_SRC}`;
const INCH_VALUE_RE  = new RegExp(INCH_VALUE_SRC, 'g');

function extractMeasurements(str) {
  const s = String(str||'').toLowerCase();
  const results = [];

  const inchRe = new RegExp(INCH_VALUE_SRC, 'g');
  let m;
  while ((m = inchRe.exec(s))) {
    let inches;
    if (m[2] && m[3]) {
      const whole = m[1] ? parseFloat(m[1]) : 0;
      inches = whole + (parseFloat(m[2]) / parseFloat(m[3]));
    } else {
      inches = parseFloat(m[4]);
    }
    if (!isNaN(inches)) results.push({ mm: roundMm(inches * MM_PER_INCH), raw: m[0] });
  }

  // Plain millimetres: "25.4mm", "100 mm"
  const mmRe = /(\d+(?:\.\d+)?)\s*mm(?![a-z])/g;
  while ((m = mmRe.exec(s))) {
    results.push({ mm: roundMm(parseFloat(m[1])), raw: m[0] });
  }

  return results;
}
// Round to a sane precision to absorb floating-point noise (e.g. 1/2" * 25.4
// landing on 12.700000000000001) without introducing any real tolerance —
// this is precision cleanup, not a fuzziness allowance.
function roundMm(n) { return Math.round(n * 1000) / 1000; }

// ── 3. FUZZY TEXT MATCH (Levenshtein-based) ─────────────────────────
function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = Array.from({length: bl+1}, (_, i) => i);
  for (let i = 1; i <= al; i++) {
    const cur = [i];
    for (let j = 1; j <= bl; j++) {
      cur[j] = a[i-1] === b[j-1]
        ? prev[j-1]
        : 1 + Math.min(prev[j-1], prev[j], cur[j-1]);
    }
    prev = cur;
  }
  return prev[bl];
}
// Word-level fuzzy score: best (lowest-distance) match between the query
// word and any word in the target text, normalised by word length so
// short/long words are judged fairly. Returns 0 (best) to 1 (no relation).
function fuzzyWordScore(queryWord, text) {
  const words = String(text||'').toLowerCase().match(/[a-z]+/g) || [];
  if (!queryWord || !words.length) return 1;
  let best = Infinity;
  for (const w of words) {
    const d = levenshtein(queryWord, w);
    best = Math.min(best, d / Math.max(queryWord.length, w.length));
  }
  return best === Infinity ? 1 : best;
}
// Only fuzzy-match on alphabetic tokens — numbers are excluded since edit
// distance between digits doesn't mean "similar value" (e.g. "8" and "3"
// are one edit apart but not remotely the same thing).
const FUZZY_MAX_DISTANCE_RATIO = 0.34; // tolerates ~1-2 typos in a typical word

const Data = {
  _list: null,
  _consumablesList: null,
  // Returns true if the partCode is a dummy/placeholder (SC prefix)
  isDummyCode(code) { return !code || /^SC\d*/i.test(code.trim()); },
  async load(csvUrl) {
    try {
      const res = await fetch(csvUrl + '?nocache=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (text.trim().startsWith('<')) throw new Error('Got HTML — check file exists in repo');
      const parsed = this._parseCsv(text);
      if (parsed.length) {
        this._list = parsed;
        try { localStorage.setItem('mo_mat_cache', JSON.stringify(parsed)); } catch {}
        return parsed;
      }
      throw new Error('CSV parsed to 0 rows');
    } catch (e) { console.warn('[Materials] CSV load failed:', e.message); }
    try { const c = localStorage.getItem('mo_mat_cache'); if (c) { this._list = JSON.parse(c); return this._list; } } catch {}
    this._list = [...DEFAULT_MATERIALS];
    return this._list;
  },
  async loadConsumables(csvUrl) {
    try {
      const res = await fetch(csvUrl + '?nocache=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (text.trim().startsWith('<')) throw new Error('Got HTML — check file exists in repo');
      const parsed = this._parseCsv(text);
      if (parsed.length) {
        this._consumablesList = parsed;
        try { localStorage.setItem('mo_cons_cache', JSON.stringify(parsed)); } catch {}
        return parsed;
      }
      throw new Error('CSV parsed to 0 rows');
    } catch (e) { console.warn('[Consumables] CSV load failed:', e.message); }
    try { const c = localStorage.getItem('mo_cons_cache'); if (c) { this._consumablesList = JSON.parse(c); return this._consumablesList; } } catch {}
    this._consumablesList = [];
    return [];
  },
  get() { return this._list || [...DEFAULT_MATERIALS]; },
  _parseCsv(text) {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) return [];
    const headers = this._splitLine(lines[0]).map(h => h.toLowerCase().trim());
    const findCol = (...names) => { for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; } return -1; };
    const iCode = findCol('part code','part_code','partcode','code');
    const iDesc = findCol('description','desc');
    const iCat  = findCol('category','cat');
    const iSub  = findCol('subcategory','sub category','sub_category','sub');
    const iQty  = findCol('quantity type','quantity_type','quantitytype','qty type','qty_type','unit');
    const iBoxSize = findCol('box size','box_size','boxsize');
    const iBoxUnit = findCol('box unit','box_unit','boxunit');
    if (iCode < 0 || iDesc < 0) { console.error('[CSV] Missing required columns. Got:', headers); return []; }
    return lines.slice(1).map((line, i) => {
      const cols = this._splitLine(line);
      const get  = idx => (idx >= 0 && idx < cols.length) ? cols[idx].trim() : '';
      const code = get(iCode), desc = get(iDesc);
      if (!code && !desc) return null;
      const boxSizeRaw = get(iBoxSize);
      const boxSize = boxSizeRaw ? parseInt(boxSizeRaw) || 0 : 0;
      return {
        id:i+1, partCode:code, description:desc,
        category:get(iCat)||'Uncategorised', subcategory:get(iSub)||'General', qtyType:get(iQty)||'Each',
        boxSize, boxUnit: get(iBoxUnit) || 'Box',
      };
    }).filter(Boolean);
  },
  _splitLine(line) {
    const cols = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch==='"') { if (inQ && line[i+1]==='"') { cur+='"'; i++; } else inQ=!inQ; }
      else if (ch===',' && !inQ) { cols.push(cur); cur=''; }
      else cur+=ch;
    }
    cols.push(cur); return cols;
  },
  categories(list) {
    const seen = new Set();
    const cats = (list||this.get()).map(m=>m.category).filter(c=>{ if(seen.has(c)) return false; seen.add(c); return true; });
    return Settings.get().naturalSort ? [...cats].sort(naturalCompare) : cats;
  },
  subcategories(list, category) {
    const seen = new Set();
    const subs = (list||this.get()).filter(m=>m.category===category).map(m=>m.subcategory)
      .filter(s=>{ if(seen.has(s)) return false; seen.add(s); return true; });
    return Settings.get().naturalSort ? [...subs].sort(naturalCompare) : subs;
  },

  // opts can override Settings per-call, e.g. Data.filter(list, cat, sub, q, {fuzzySearch:false})
  filter(list, category, subcategory, query, opts) {
    const cfg = { ...Settings.get(), ...(opts||{}) };
    let out = list||this.get();
    if (category)    out = out.filter(m=>m.category===category);
    if (subcategory) out = out.filter(m=>m.subcategory===subcategory);

    if (!query) {
      return cfg.naturalSort
        ? [...out].sort((a,b)=>naturalCompare(a.description, b.description))
        : out;
    }

    const q = query.toLowerCase().trim();
    const qMeasurements = cfg.unitAwareSearch ? extractMeasurements(q) : [];
    // Strip out the raw text that was successfully parsed as a measurement
    // (e.g. "1in", "25.4mm") before pulling out words for fuzzy matching —
    // otherwise a bare unit token like "in" or "mm" can fuzzy-match as a
    // normal English word and produce false positives (e.g. "in" matching
    // any description containing the word "in"). Also drop standalone unit
    // words and anything under 3 letters, since short fragments are too
    // unreliable to fuzzy-match meaningfully.
    let qForWords = q;
    for (const meas of qMeasurements) qForWords = qForWords.replace(meas.raw, ' ');
    const UNIT_WORDS = new Set(['mm','in','inch','inches']);
    const qWords = (qForWords.match(/[a-z]+/g) || [])
      .filter(w => w.length >= 3 && !UNIT_WORDS.has(w));

    const scored = out.map(m => {
      const desc = m.description.toLowerCase();
      const code = m.partCode.toLowerCase();
      let score = null; // null = no match, lower number = better match

      // Tier 0: exact substring match on description or part code — always wins
      if (desc.includes(q) || code.includes(q)) {
        score = 0;
      }

      // Tier 1: unit-aware exact value match — query names a measurement that
      // appears (in any written form) in this item's description. Exact
      // canonical-mm equality only, no rounding tolerance.
      if (score === null && qMeasurements.length) {
        const itemMeasurements = extractMeasurements(desc);
        const hit = qMeasurements.some(qm => itemMeasurements.some(im => im.mm === qm.mm));
        if (hit) score = 1;
      }

      // Tier 2: fuzzy word match on remaining alphabetic query words —
      // catches typos in either the catalogue or what was typed. Numbers
      // and unit tokens are excluded (see above) since edit-distance on
      // digits or short unit abbreviations doesn't mean "similar item".
      if (score === null && cfg.fuzzySearch && qWords.length) {
        const avgDist = qWords.reduce((s,w) => s + fuzzyWordScore(w, desc), 0) / qWords.length;
        if (avgDist <= FUZZY_MAX_DISTANCE_RATIO) score = 2 + avgDist;
      }

      return score === null ? null : { m, score };
    }).filter(Boolean);

    scored.sort((a,b) => a.score - b.score || naturalCompare(a.m.description, b.m.description));
    return scored.map(s => s.m);
  },
};

const Order = {
  _items: {},
  get(id)       { return this._items[id]||0; },
  set(id,qty)   { if(qty<=0) delete this._items[id]; else this._items[id]=qty; },
  adjust(id,d)  { this.set(id,(this._items[id]||0)+d); },
  remove(id)    { delete this._items[id]; },
  clear()       { this._items={}; },
  count()       { return Object.keys(this._items).length; },
  isEmpty()     { return this.count()===0; },
  items(mats)   {
    return Object.keys(this._items).map(id=>{
      const m=mats.find(x=>x.id==id); return m?{...m,qty:this._items[id]}:null;
    }).filter(Boolean);
  },
};

// Generate a stable Firestore document ID for a consumable item.
// Uses real part code if available; otherwise slugifies description.
function stockId(item) {
  if (item.partCode && !Data.isDummyCode(item.partCode)) {
    return item.partCode.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  }
  // Fallback: first 40 chars of slugified description
  return item.description.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
}

// ── GHOST ITEMS (created on-device, not yet in consumables.csv) ──────────
// A "ghost" is a consumable created during setup on the manager page. It lives
// entirely on its stock document — stock.<sid>.ghost holds what the CSV row will
// eventually say — until that row is actually added to consumables.csv, at which
// point the manager page reconciles it (clears the flag, migrating the stock doc
// if the description was edited) and the CSV takes over as the source of truth.
//
// merge() folds ghosts into a page's catalog list so every surface (checkout grid,
// stock tab, ordering, stocktake) treats them as real items immediately. Their SC
// part codes are dummy codes, so they're already hidden from order emails.
//
// Ids: catalog ids are CSV row indexes, and carts/order lines reference items by
// id — so ghost ids are assigned from a high base (no collision possible) and
// kept session-stable via _idMap (an id that shifted mid-session would silently
// re-point cart entries at the wrong item).
const GhostItems = {
  _idBase: 100000,
  _idMap:  new Map(),   // stock doc id -> session-stable numeric id
  merge(catalog, stockRecords) {
    const ghosts = (stockRecords || []).filter(r => r.ghost);
    if (!ghosts.length) return catalog;
    const codes = new Set(catalog.map(m => (m.partCode || '').toLowerCase()).filter(Boolean));
    const sids  = new Set(catalog.map(m => stockId(m)));
    // Deterministic assignment order (oldest first) so devices agree on ids
    ghosts.sort((a, b) => ((a.ghost.createdAt || 0) - (b.ghost.createdAt || 0)) || a._id.localeCompare(b._id));
    const out = [...catalog];
    for (const rec of ghosts) {
      const g = rec.ghost;
      // CSV row now exists (matched by code or by doc id) — the catalog row wins;
      // the manager page clears the leftover flag separately (reconciliation).
      if (sids.has(rec._id) || (g.partCode && codes.has(g.partCode.toLowerCase()))) continue;
      if (!this._idMap.has(rec._id)) this._idMap.set(rec._id, this._idBase + this._idMap.size + 1);
      out.push({
        id:          this._idMap.get(rec._id),
        partCode:    g.partCode || '',
        description: g.description || rec._id,
        category:    g.category || 'Uncategorised',
        subcategory: g.subcategory || 'General',
        qtyType:     g.qtyType || 'Each',
        boxSize:     g.boxSize || 0,
        boxUnit:     g.boxUnit || 'Box',
        _ghost:      true,
      });
    }
    return out;
  },
};

// Stocktake counting unit — hard-coded rule for now: anything bought by the length
// (round bar, box section, pipe/tube etc., i.e. qtyType Length or Metre) is counted
// in metres; sheets/plates and per-each items are counted as-is. Decimals allowed.
function stocktakeUnit(item) {
  const qt = String(item.qtyType || '').toLowerCase();
  return (qt === 'length' || qt === 'metre') ? 'Metre' : (item.qtyType || 'Each');
}

// Returns true if an item uses dual-unit (box) tracking
function hasBoxTracking(item) { return !!(item && item.boxSize && item.boxSize > 0); }

// Format a rolling individual qty alongside its box equivalent, e.g. "47 Each (≈0.9 Box)"
function boxDisplay(item, qty) {
  if (!hasBoxTracking(item)) return `${qty} ${item.qtyType||''}`;
  const boxes = (qty / item.boxSize).toFixed(1).replace(/\.0$/, '');
  return `${qty} ${item.qtyType||''} (≈${boxes} ${item.boxUnit||'Box'})`;
}

// For reorder emails: append box size info to the item name, e.g. "Safety Glasses Clear Lens (Box of 50)"
function boxSuffix(item) {
  return hasBoxTracking(item) ? ` (Box of ${item.boxSize} ${item.qtyType||'Each'})` : '';
}

// Ordering/delivery quantity unit for a consumables item. Boxed items are counted in
// BOXES (the qty field means number of boxes) end-to-end through ordering, the email
// and delivery intake; everything else uses its qtyType. Stock is still stored in
// individual units — multiply by boxSize when receiving (see stock intake).
function orderQtyUnit(item) { return hasBoxTracking(item) ? (item.boxUnit || 'Box') : (item.qtyType || ''); }
function orderQtyDisplay(item, qty) {
  if (!hasBoxTracking(item)) return `${qty}${item.qtyType ? ' ' + item.qtyType : ''}`;
  const u = item.boxUnit || 'Box';
  const plural = qty === 1 ? u : (/box$/i.test(u) ? u + 'es' : u + 's');
  return `${qty} ${plural}`;
}

// ── BARCODE SCANNER (HID keyboard-wedge) ─────────────────────────────────
// Bluetooth scanners like the Tecor IS-5700LB pair as a keyboard and "type" the
// decoded barcode, normally ending with Enter — no driver or API involved. We spot
// them by the burst pattern: several characters arriving far faster than anyone can
// type. That means a scan is picked up wherever you are on the page, with no need to
// tap into a field first.
//
// When the cursor IS in a text field the scan is left alone to type normally, so the
// existing "tap the search box and scan" behaviour still works and we never double up.
const BarcodeScanner = {
  MAX_GAP:  60,   // ms between keys — slower than this reads as human typing
  MIN_LEN:  4,    // shorter bursts are ignored
  END_WAIT: 90,   // ms of quiet that ends a scan when the scanner sends no Enter
  _buf: '', _last: 0, _timer: null,

  start(onScan) {
    document.addEventListener('keydown', e => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        this._buf = ''; return;   // typing into a field — leave it be
      }
      const now = Date.now();
      if (now - this._last > this.MAX_GAP) this._buf = '';
      this._last = now;
      clearTimeout(this._timer);

      if (e.key === 'Enter') {
        if (this._buf.trim().length >= this.MIN_LEN) e.preventDefault();
        this._flush(onScan);
      } else if (e.key.length === 1) {
        this._buf += e.key;
        this._timer = setTimeout(() => this._flush(onScan), this.END_WAIT);
      }
    });
  },

  _flush(onScan) {
    const code = this._buf.trim();
    this._buf = '';
    if (code.length >= this.MIN_LEN) onScan(code);
  },
};

// ── AUTO-UPDATE (idle reload for the home-screen iPads) ──────────────────
// The iPads run these pages as home-screen web apps: no address bar, no easy
// refresh, and iOS keeps the old page alive for days — so the update banner
// alone can sit unseen forever. Ported from the Stella Drawings app:
//
//   1. DISCOVER — the meta/version Firestore listener stays the fast path
//      (pages feed what it reports into notifyVersion). A periodic self-fetch
//      of js/shared.js (cache: no-store, regexing APP_VERSION out of the
//      source) backstops the case where EVERY device is stale — Firestore only
//      learns about a new version once one device has actually loaded it.
//   2. RELOAD — once a newer version is known, reload automatically, but only
//      when it can't lose work or interrupt anyone: user idle 3+ minutes, no
//      panel or overlay open, nothing sitting in a focused input, and the
//      page's own carts empty (isBusy).
//
// Two extra safeguards on the reload itself:
//   - RETRY window: GitHub Pages caches HTML ~10 minutes, so a reload right
//     after deploy can be served the old build again. One attempt per version
//     PER HOUR (sessionStorage) self-heals that without any possibility of a
//     reload loop; the banner stays up in between as the manual fallback.
//   - REACHABLE gate: a reload only fires if a self-fetch succeeded moments
//     ago, so a kiosk can't reload itself into a browser error page.
//
// Reachability is judged ONLY by the self-fetch — deliberately NOT by
// Firestore's connection state. iOS home-screen apps can wake from a long
// suspend with a wedged Firestore channel (the page shows "Offline" despite
// working wifi, and stays that way until reloaded). That is a state a reload
// CURES, so gating on Firestore would block the fix on exactly the devices
// that need it. Same reason hostReachable() feeds the update banner: a wedged
// page must still show the pill when the site itself is answering.
const AutoUpdate = {
  SELF_CHECK_MS: 5 * 60 * 1000,   // self-fetch cadence (Firestore push is the fast path)
  TICK_MS:       30 * 1000,        // how often the reload decision is re-evaluated
  IDLE_MS:       3 * 60 * 1000,    // required inactivity before an automatic reload
  RETRY_MS:      60 * 60 * 1000,   // min gap between reload attempts for the same version
  REACHABLE_MS:  3 * 60 * 1000,    // a successful self-fetch must be this recent to reload
  _latest: null, _lastActivity: Date.now(), _lastSelfCheck: 0, _lastSelfOk: 0,
  _opts: null, _tried: null,

  start(opts) {
    if (this._opts) return;   // once per page load
    this._opts = opts || {};
    for (const ev of ['touchstart', 'mousedown', 'keydown', 'wheel', 'scroll'])
      addEventListener(ev, () => { this._lastActivity = Date.now(); }, { passive: true, capture: true });
    setInterval(() => { this._selfCheck(); this._maybeReload(); }, this.TICK_MS);
    // Home-screen apps freeze while backgrounded — check the moment they wake.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this._selfCheck(true);
    });
  },

  // Both discovery paths (Firestore push + self-fetch) funnel through here so a
  // single "newest known version" drives the reload decision.
  notifyVersion(v) {
    if (v && isVersionNewer(v, APP_VERSION) && (!this._latest || isVersionNewer(v, this._latest)))
      this._latest = v;
  },

  // True while a self-fetch answered recently — the site host is genuinely
  // reachable even if Firestore's channel is wedged. Pages use this to keep the
  // update banner visible in that state (refreshing is exactly the remedy).
  hostReachable() { return Date.now() - this._lastSelfOk < this.REACHABLE_MS; },

  async _selfCheck(force) {
    const now = Date.now();
    if (now - this._lastSelfCheck < (force ? 20 * 1000 : this.SELF_CHECK_MS)) return;
    this._lastSelfCheck = now;
    try {
      const res = await fetch('js/shared.js?nocache=' + now, { cache: 'no-store' });
      if (!res.ok) return;
      this._lastSelfOk = Date.now();   // proof the site host is reachable right now
      const m = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/);
      if (m && isVersionNewer(m[1], APP_VERSION)) {
        this.notifyVersion(m[1]);
        if (this._opts.onDiscover) this._opts.onDiscover(m[1]);   // surface the banner
      }
    } catch { /* offline — ignore */ }
  },

  _busy() {
    if (document.querySelector('.panel.open')) return true;        // any slide-in panel
    const ow = document.getElementById('overlay-wrap');
    if (ow && ow.innerHTML.trim()) return true;                    // any dialog/overlay
    const el = document.activeElement;                             // walked away mid-entry
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.value) return true;
    return this._opts.isBusy ? !!this._opts.isBusy() : false;
  },

  _maybeReload() {
    if (!this._opts || !this._latest) return;
    if (Date.now() - this._lastActivity < this.IDLE_MS) return;
    if (this._busy()) return;
    // REACHABLE gate — only reload off the back of a recent successful fetch of
    // the site itself. Forcing a check here (throttled to 20s inside) means the
    // next 30s tick can pass this gate if the host answers.
    if (Date.now() - this._lastSelfOk > this.REACHABLE_MS) { this._selfCheck(true); return; }
    // RETRY window — one attempt per version per RETRY_MS. In-memory mirror of
    // the sessionStorage record covers private mode, where storage throws.
    const tried = this._tried
      || (() => { try { return JSON.parse(sessionStorage.getItem('mo_auto_reload') || 'null'); } catch { return null; } })();
    if (tried && tried.v === this._latest && Date.now() - tried.at < this.RETRY_MS) return;
    this._tried = { v: this._latest, at: Date.now() };
    try { sessionStorage.setItem('mo_auto_reload', JSON.stringify(this._tried)); } catch {}
    location.reload();
  },
};

const ConsumablesDeviceName = {
  _key: 'cons_device_name',
  get()      { return localStorage.getItem(this._key) || ''; },
  save(name) { localStorage.setItem(this._key, name.trim()); },
  isSet()    { return !!this.get(); },
};

const WarehouseDeviceName = {
  _key: 'warehouse_device_name',
  get()      { return localStorage.getItem(this._key) || ''; },
  save(name) { localStorage.setItem(this._key, name.trim()); },
  isSet()    { return !!this.get(); },
};

const FirebaseConfig = {
  _key:         'mo_firebase_config',
  _testKey:     'mo_firebase_config_test',
  _testModeKey: 'mo_test_mode',
  isTestMode()  { return localStorage.getItem(this._testModeKey) === 'true'; },
  setTestMode(v){ if (v) localStorage.setItem(this._testModeKey, 'true'); else localStorage.removeItem(this._testModeKey); },
  get()         { try { const s=localStorage.getItem(this.isTestMode()?this._testKey:this._key); return s?JSON.parse(s):null; } catch { return null; } },
  save(cfg)     { localStorage.setItem(this.isTestMode()?this._testKey:this._key, JSON.stringify(cfg)); },
  hasTestConfig(){ return !!localStorage.getItem(this._testKey); },
  clear()       { localStorage.removeItem(this._key); },
  clearTest()   { localStorage.removeItem(this._testKey); },
};

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Captures which input/textarea currently has focus (plus its caret and un-committed
// value) and returns a restore function to call after an innerHTML/outerHTML
// re-render. Live Firestore snapshots re-render whole lists, which otherwise steals
// focus mid-typing and can drop keystrokes still inside a debounce window.
// Elements are re-found by id, or by the data-attribute pairs intake rows use.
function captureInputFocus() {
  const el = document.activeElement;
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return () => {};
  let selector = null;
  if (el.id) selector = `#${CSS.escape(el.id)}`;
  else if (el.dataset.notesItem)   selector = `[data-notes-item="${el.dataset.notesItem}"][data-notes-order="${el.dataset.notesOrder}"]`;
  else if (el.dataset.partialItem) selector = `[data-partial-item="${el.dataset.partialItem}"][data-partial-order="${el.dataset.partialOrder}"]`;
  if (!selector) return () => {};
  const value = el.value;
  let selStart = null, selEnd = null;
  try { selStart = el.selectionStart; selEnd = el.selectionEnd; } catch {} // number inputs throw
  return () => {
    const nel = document.querySelector(selector);
    if (!nel) return;
    nel.value = value;
    nel.focus({ preventScroll: true });
    if (selStart != null) { try { nel.setSelectionRange(selStart, selEnd); } catch {} }
  };
}

// Parses a Firebase config string into { apiKey, projectId, appId }.
// Accepts either:
//   1. Pipe-separated:  "apiKey|projectId|appId"  (preferred — easy to store and copy)
//   2. JS/JSON blob:    the firebaseConfig snippet pasted from the Firebase console
function parseFirebaseConfig(raw) {
  const s = String(raw || '').trim();
  // Pipe-separated format: three segments, no spaces around pipes
  const parts = s.split('|');
  if (parts.length === 3 && parts.every(p => p.trim())) {
    return { apiKey: parts[0].trim(), projectId: parts[1].trim(), appId: parts[2].trim() };
  }
  // Fall back to key-value extraction for JS/JSON blobs
  const get = key => {
    const m = s.match(new RegExp('"?' + key + '"?\\s*[:=]\\s*["\']([^"\']+)["\']'));
    return m ? m[1].trim() : '';
  };
  return { apiKey: get('apiKey'), projectId: get('projectId'), appId: get('appId') };
}
function genRef() {
  const d=new Date();
  return `ORD-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*900+100)}`;
}
// Groups items across orders that were part of the same real email send into one
// "delivery" — never displayed, so uniqueness matters more than readability.
function genDeliveryId() {
  return `DLV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}
function fmtTime(ts) {
  if (!ts) return '';
  const d=ts instanceof Date?ts:new Date(ts);
  return d.toLocaleString('en-AU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
}

// Apply all template placeholders to a string (works for both subject and body)
function applyPlaceholders(str, category, date, items, closingNote, orderType) {
  return str
    .replace(/\{orderType\}/g, orderType || 'Material Order')
    .replace(/\{category\}/g, category || '')
    .replace(/\{date\}/g,     date     || '')
    .replace(/\{items\}/g,    items    || '')
    .replace(/\{closingNote\}/g, closingNote || '')
    .replace(/\{orderRefs\}/g, ''); // legacy compat
}

// Build email for a single category.
// items: array of {partCode, description, qtyType, qty} — NOT pre-summed, kept per-order
// orderType: 'Material Order' | 'Consumables Order'
function buildCategoryEmail(items, category, orderType) {
  const s        = Settings.get();
  const type     = orderType || 'Material Order';
  const dateStr  = new Date().toLocaleDateString('en-AU',{day:'2-digit',month:'long',year:'numeric'});
  const dateShort= new Date().toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'});

  // Items block — suppress dummy part codes (SC prefix) from display, append box info
  const itemsStr = items.map(i => {
    const showCode = i.partCode && !Data.isDummyCode(i.partCode);
    const codePart = showCode ? `${i.partCode} - ` : '';
    return `${codePart}${i.description}${boxSuffix(i)}\r\n  Qty: ${orderQtyDisplay(i, i.qty)}`;
  }).join('\r\n\r\n');

  const subject = applyPlaceholders(
    s.emailSubject || DEFAULT_SETTINGS.emailSubject,
    category, dateShort, '', '', type
  );
  const body = applyPlaceholders(
    s.emailTemplate || DEFAULT_SETTINGS.emailTemplate,
    category, `Date: ${dateStr}`, itemsStr, s.deliveryNote, type
  );
  // Append signature if set
  const sig = s.emailSignature || '';
  const bodyWithSig = sig ? body + '\r\n\r\n' + sig : body;
  return { subject, body: bodyWithSig };
}

// Build a single bulk email covering ALL consumable items across all categories.
// items: full array of {partCode, description, category, qtyType, qty}
function buildBulkConsumablesEmail(items) {
  const s         = Settings.get();
  const orderType = 'Consumables Order';
  const dateStr   = new Date().toLocaleDateString('en-AU',{day:'2-digit',month:'long',year:'numeric'});
  const dateShort = new Date().toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'});

  // Group by category, with a header per category in the body
  const byCategory = {};
  for (const i of items) {
    if (!byCategory[i.category]) byCategory[i.category] = [];
    byCategory[i.category].push(i);
  }
  const itemsStr = Object.entries(byCategory).map(([cat, catItems]) => {
    const lines = catItems.map(i => {
      const showCode = i.partCode && !Data.isDummyCode(i.partCode);
      const codePart = showCode ? `${i.partCode} - ` : '';
      return `  ${codePart}${i.description}${boxSuffix(i)}\r\n    Qty: ${orderQtyDisplay(i, i.qty)}`;
    }).join('\r\n\r\n');
    return `── ${cat} ──\r\n\r\n${lines}`;
  }).join('\r\n\r\n');

  const subjTemplate = s.bulkConsumablesSubject || DEFAULT_SETTINGS.bulkConsumablesSubject;
  const subject = applyPlaceholders(subjTemplate, '', dateShort, '', '', orderType);
  const body    = applyPlaceholders(
    s.emailTemplate || DEFAULT_SETTINGS.emailTemplate,
    'All Categories', `Date: ${dateStr}`, itemsStr, s.deliveryNote, orderType
  );
  const sig = s.emailSignature || '';
  return { subject, body: sig ? body + '\r\n\r\n' + sig : body };
}

// Group items by category across orders.
// Returns per-category array of items, each with their own order/device context.
// Items from DIFFERENT orders with the same partCode are kept SEPARATE (not summed),
// so the email clearly shows each order's contribution.
// Items from the SAME order with the same partCode are summed (shouldn't happen but defensive).
function groupByCategory(orders) {
  const groups = {};
  for (const order of orders) {
    for (const item of (order.items||[])) {
      if (item.emailed) continue;
      const cat = item.category || 'Uncategorised';
      if (!groups[cat]) groups[cat] = { items: [] };

      // Check if same orderId + partCode already exists (same order, same part — sum)
      const existing = groups[cat].items.find(
        x => x.orderId === order._id && x.partCode === item.partCode
      );
      if (existing) {
        existing.qty += item.qty;
      } else {
        groups[cat].items.push({
          ...item,
          deviceName:  order.deviceName || '',
          orderId:     order._id,
          orderRef:    order.ref || order._id,
        });
      }
    }
  }
  return groups;
}

// Outlook Classic compatible mailto opener.
// Uses window.location.href which Outlook Classic handles more reliably than anchor clicks.
// Key: do NOT encode the to/cc addresses themselves, only encode subject and body.
// Do NOT use encodeURIComponent on the whole string — build it manually.
function openMailto(to, cc, subject, body) {
  // Build the mailto string carefully for Outlook Classic:
  // - 'to' and 'cc' addresses must NOT be encoded (Outlook Classic fails on %40)
  // - subject and body must be encoded but use %0D%0A for line breaks (not %0A)
  const encodedSubject = encodeURIComponent(subject);
  // Replace any %0A-only line breaks with %0D%0A for Outlook Classic
  const encodedBody = encodeURIComponent(body).replace(/%0A/g, '%0D%0A');

  let mailto = 'mailto:' + to;
  const params = [];
  if (cc)      params.push('cc='      + cc);
  if (subject) params.push('subject=' + encodedSubject);
  if (body)    params.push('body='    + encodedBody);
  if (params.length) mailto += '?' + params.join('&');

  // window.location.href is most reliable for Outlook Classic
  window.location.href = mailto;
}
