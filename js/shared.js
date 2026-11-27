// shared.js — v2026-11-27.12

// The build date plus that day's counter — "2026-10-06.2" is the second build
// on 6 Oct 2026 (the production board's scheme). Set by tools/bump-version.py;
// shown to people with a leading "v" (see verLabel).
const APP_VERSION = '2026-11-27.12';

// Numeric version comparison, part by part. Returns true if `a` is strictly
// newer than `b`. Reads both the dated form and the "v0.56"-style numbers used
// before the switch — any dated version is newer than any of those, and a
// device still running the old comparison agrees (it reads the year first).
function isVersionNewer(a, b) {
  const parse = v => String(v||'').replace(/^v/i,'').split(/[.\-]/).map(n => parseInt(n,10) || 0);
  const pa = parse(a), pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i=0; i<len; i++) {
    const na = pa[i]||0, nb = pb[i]||0;
    if (na !== nb) return na > nb;
  }
  return false; // equal
}
function verLabel(v) { return 'v' + String(v || '').replace(/^v/i, ''); }

const DEFAULT_SETTINGS = {
  supplierEmail:        '',     // set per PC under Settings → Email; nothing sends without it
  ccEmail:              '',
  deliveryNote:         'Please confirm availability and expected delivery date.',
  emailSubject:         '{orderType} - {category} - {date}',
  bulkConsumablesSubject: '{orderType} - {date}',
  emailSignature:       '',
  emailTemplate:        '{date}\r\n\r\n────────────────────────────────────────────────────\r\n{orderType} - {category}\r\n────────────────────────────────────────────────────\r\n\r\n{items}\r\n────────────────────────────────────────────────────\r\n{closingNote}',
  naturalSort:          true,   // numeric-aware sort order, e.g. 8mm before 10mm; inch sizes sort by their mm value
  unitAwareSearch:      true,   // "1 inch" matches "25.4mm" etc. — exact value match, no rounding
  fuzzySearch:          true,   // typo-tolerant text matching, exact matches always rank first
  fractionGlyphs:       false,  // show 1 1/2" as 1½" — off by default: the glyphs read small on the iPads
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

// A category's tile. Its colours are set as --cat and --cat-bg and the stylesheet decides
// how to use them, so a dark theme can tone the pastels down. cls: 'sm', or the class of
// a tile that isn't the usual material one.
function catTile(category, cls) {
  const ci = CAT_ICONS[category] || CAT_ICONS.default;
  const klass = cls === 'sm' ? 'mat-icon sm' : cls || 'mat-icon';
  return `<div class="${klass}" style="--cat:${ci.color};--cat-bg:${ci.bg}"><i class="ti ${ci.icon}"></i></div>`;
}

// ── THEMES ────────────────────────────────────────────────────────────
// Visual themes are CSS-variable override blocks in css/themes.css, keyed on
// <html data-theme="…">. The choice is per device (localStorage) — it's a
// Settings item on each page and the four pages share one origin, so picking a
// theme on any page themes them all on that device. Each page's <head> carries
// a two-line bootstrap that applies the saved id before first paint; set()
// switches it live. To add a theme: a block in themes.css + an entry here.
const THEMES = [
  { id: '',         name: 'Stella (default)' },
  { id: 'workshop', name: 'Workshop — light' },
];
const Theme = {
  _key: 'mo_theme',
  // 'stella' was the id before it became the default — read it as the default.
  get()   { try { const v = localStorage.getItem(this._key) || ''; return v === 'stella' ? '' : v; } catch { return ''; } },
  set(id) {
    try { if (id) localStorage.setItem(this._key, id); else localStorage.removeItem(this._key); } catch {}
    const root = document.documentElement;
    root.classList.add('theme-switching');
    this.apply();
    void getComputedStyle(root).color;   // the new colours land while nothing may fade
    root.classList.remove('theme-switching');
  },
  apply() {
    const id = this.get();
    if (id) document.documentElement.setAttribute('data-theme', id);
    else    document.documentElement.removeAttribute('data-theme');
    // Browser chrome / status bar tint follows the header colour of the theme
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const c = getComputedStyle(document.documentElement).getPropertyValue('--header-bg').trim();
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

// The defaults used to be example addresses, on other people's domains. A PC
// that saved its settings back then still holds them: they count as not set.
const EXAMPLE_ADDRESSES = new Set(['procurement@supplier.com', 'orders@yourcompany.com']);
const Settings = {
  get() {
    let out = { ...DEFAULT_SETTINGS };
    try {
      const s = localStorage.getItem('mo_settings');
      if (s) out = { ...out, ...JSON.parse(s) };
    } catch {}
    for (const k of ['supplierEmail', 'ccEmail'])
      if (EXAMPLE_ADDRESSES.has(String(out[k] || '').trim().toLowerCase())) out[k] = '';
    return out;
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
//   2. Unit-aware search — "1 inch" / "25.4mm" / "1\"" all match the same value;
//                          a bare number is read as millimetres ("50 x 25" ↔ "50mm x 25mm")
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
// Supplier descriptions arrive with vulgar-fraction glyphs and typographic inch
// marks ("1 ¼”", "½″") as often as with plain text ("1 1/4\""). Both the sorter
// and the unit-aware search run their input through this first, so either form
// works anywhere in the catalogue. A glyph straight after a digit gets a space
// so "1½" reads as the mixed number "1 1/2", not "11/2".
const FRACTION_GLYPHS = {
  '½':'1/2', '¼':'1/4', '¾':'3/4', '⅛':'1/8', '⅜':'3/8', '⅝':'5/8', '⅞':'7/8',
  '⅓':'1/3', '⅔':'2/3', '⅕':'1/5', '⅖':'2/5', '⅗':'3/5', '⅘':'4/5', '⅙':'1/6', '⅚':'5/6',
};
function normaliseGlyphs(str) {
  return String(str||'')
    .replace(/[½¼¾⅛⅜⅝⅞⅓⅔⅕⅖⅗⅘⅙⅚]/g, (g, i, full) => (i > 0 && /\d/.test(full[i-1]) ? ' ' : '') + FRACTION_GLYPHS[g])
    .replace(/[“”″]/g, '"');
}

// Display-only. By default every description shows FLAT — "1 ½”" from a
// supplier sheet renders as "1 1/2\"" like the rest — because the glyphs read
// too small on the iPads. The Settings toggle (fractionGlyphs) flips that to
// glyphs everywhere ("1 1/2\"" shows as "1½\""), for the fractions Unicode has a
// glyph for; 5/16 and the like stay as typed either way. Nothing underneath
// changes: sorting, search, emails and exports all work on the catalogue text
// as written. No lookbehind (older iPad Safari would refuse to parse the whole
// file), so the preceding character is captured and re-emitted instead.
const GLYPH_FOR = Object.fromEntries(Object.entries(FRACTION_GLYPHS).map(([g, f]) => [f, g]));
function prettyFractions(str) {
  return normaliseGlyphs(str)
    .replace(/(^|[^\d./])(\d)\s*\/\s*(\d{1,2})(?![\d/])/g, (m, pre, n, d) => pre + (GLYPH_FOR[`${n}/${d}`] || `${n}/${d}`))
    .replace(/(\d) ([½¼¾⅛⅜⅝⅞⅓⅔⅕⅖⅗⅘⅙⅚])/g, '$1$2');
}
function descHtml(str) { return esc(Settings.get().fractionGlyphs ? prettyFractions(str) : normaliseGlyphs(str)); }

function naturalSortChunks(str) {
  const s = normaliseGlyphs(str).toLowerCase()
    .replace(/^[^a-z0-9]+/, '')   // "(1 ½\") 38.1mm …" sorts by 38.1, not by "("
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
  const s = normaliseGlyphs(str).toLowerCase();
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

  // Bare numbers are millimetres — metric is the house standard, and the
  // catalogue is inconsistent about writing the unit ("50 x 25" here,
  // "50mm x 25mm" there), so a size has to match whichever way it was typed.
  // A number is only "bare" when nothing around it says otherwise:
  //   - not glued to letters (T5, P60, A554, part codes, "x" excepted so
  //     "40x40x2" still reads as three sizes)
  //   - not part of a fraction, or the whole number of a mixed fraction
  //   - not followed by a unit — length units are handled above, and
  //     weights, volumes, grits, percentages etc. aren't lengths at all
  //   - not a pipe schedule ("Sch 80") — stripped before scanning
  const bareSrc = s.replace(/\bsch(?:d|ed|edule)?\.?\s*\d+/g, ' ');
  const bareRe = /(^|[^\d.\/a-wyz])(\d+(?:\.\d+)?)(?![\d.\/])(?!\s+\d+\s*\/)(?!\s*(?:mm|mtr|m|inch(?:es)?|in|wt|kg|ml|g|l|ltr|litres?|grit|gr|swg|gauge|deg|pcs?|off)(?![a-z]))(?!\s*(?:"|''|°|%))/g;
  while ((m = bareRe.exec(bareSrc))) {
    results.push({ mm: roundMm(parseFloat(m[2])), raw: m[2], bare: true });
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
// The fewest typos between a typed word and any word in the text. Only words: one digit
// out is another size, not a typo ("8" and "3" are one edit apart).
function typosTo(word, text) {
  let best = Infinity;
  for (const w of String(text || '').toLowerCase().match(/[a-z]+/g) || []) {
    if (Math.abs(w.length - word.length) < best) best = Math.min(best, levenshtein(word, w));
  }
  return best;
}
// How many to forgive: none in a short word ("nut" is not "cut"), two in a long one.
function maxTypos(word) { return word.length <= 3 ? 0 : word.length <= 5 ? 1 : 2; }

const Data = {
  _list: null,
  _consumablesList: null,
  // Returns true if the partCode is a dummy/placeholder (SC prefix)
  isDummyCode(code) { return !code || /^SC\d*/i.test(code.trim()); },

  // ── Where the materials list comes from ──────────────────────────────
  // Once the manager has moved the list into the database (manager page →
  // Settings → Materials catalogue) it is read from there; until then, and on
  // a device that can't reach the catalogue and has never seen it, from
  // materials.csv exactly as before:
  //   1. the last catalogue this device saw, or failing that the last CSV — instant, and
  //      works offline. A saved CSV is checked against the site behind the page:
  //      onChange(list) if it differs.
  //   2. the catalogue, fetched (a few seconds at most, then we stop waiting
  //      so a bad connection can never hold the page on a blank screen)
  //   3. materials.csv → the built-in defaults
  // Data.watch() then keeps whichever list is showing live.
  _source: 'csv',     // 'catalogue' once the list is coming from the database
  _csvUrl: null,
  _saved(key) {
    try { const c = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(c) && c.length ? c : null; } catch { return null; }
  },
  async load(csvUrl, onChange) {
    this._csvUrl = csvUrl;
    try {
      const c = JSON.parse(localStorage.getItem('mo_cat_cache') || 'null');
      if (Array.isArray(c) && c.length) { this._list = c; this._source = 'catalogue'; return c; }
    } catch {}
    const saved = this._saved('mo_mat_cache');
    if (saved) {
      this._list = saved; this._source = 'csv';
      this._loadCsv(csvUrl).then(l => { if (onChange && this._source === 'csv' && JSON.stringify(l) !== JSON.stringify(saved)) onChange(l); });
      return saved;
    }
    if (typeof DB !== 'undefined' && DB.isReady() && DB.getCatalog) {
      const doc = await Promise.race([
        DB.getCatalog().catch(() => null),
        new Promise(r => setTimeout(() => r(null), 3000)),
      ]);
      const list = this.fromCatalog(doc);
      if (list) return this._useCatalog(list);
    }
    return this._loadCsv(csvUrl);
  },
  // Catalogue document → the item shape every page works with. Retired
  // materials are left out, and a description typed over the part list's
  // wording wins over it. Ids are permanent (never the position in the list).
  fromCatalog(doc) {
    if (!doc || !Array.isArray(doc.items) || !doc.items.length) return null;
    return doc.items.filter(i => i && !i.retired).map(i => ({
      id: i.id, partCode: i.code || '', description: i.desc || i.erpDesc || '',
      category: i.category || 'Uncategorised', subcategory: i.subcategory || 'General', qtyType: i.qtyType || 'Each',
      boxSize: 0, boxUnit: 'Box',
    }));
  },
  failed: false,       // no list could be had at all (not even a saved one)
  consFailed: false,
  _useCatalog(list) {
    this._list = list; this._source = 'catalogue'; this.failed = false;
    try { localStorage.setItem('mo_cat_cache', JSON.stringify(list)); } catch {}
    return list;
  },
  // Live catalogue. onChange(list) fires only when the list a page is showing
  // actually differs; onDoc(doc|null) fires on every snapshot (the manager's
  // catalogue screen works on the full document, retired rows included).
  watch(onChange, onDoc) {
    if (typeof DB === 'undefined' || !DB.isReady() || !DB.listenCatalog) return () => {};
    return DB.listenCatalog((doc, fromCache) => {
      const list = this.fromCatalog(doc);
      if (list) {
        const changed = this._source !== 'catalogue' || JSON.stringify(list) !== JSON.stringify(this._list);
        this._useCatalog(list);
        if (changed && onChange) onChange(list);
      } else if (!fromCache && this._source === 'catalogue') {
        // Confirmed by the server that there is no catalogue (any more) — back
        // to the CSV. An offline "not found" proves nothing, hence !fromCache.
        try { localStorage.removeItem('mo_cat_cache'); } catch {}
        this._source = 'csv';
        this._loadCsv(this._csvUrl).then(l => { if (onChange) onChange(l); });
      }
      if (onDoc) onDoc(doc, fromCache);
    });
  },
  async _loadCsv(csvUrl) {
    this._source = 'csv';
    try {
      const parsed = await this._fetchCsv(csvUrl);
      if (parsed.length) {
        if (this._source !== 'csv') return this._list;   // the catalogue arrived meanwhile
        this._list = parsed; this.failed = false;
        try { localStorage.setItem('mo_mat_cache', JSON.stringify(parsed)); } catch {}
        return parsed;
      }
      throw new Error('CSV parsed to 0 rows');
    } catch (e) { console.warn('[Materials] CSV load failed:', e.message); }
    try { const c = localStorage.getItem('mo_mat_cache'); if (c) { this._list = JSON.parse(c); return this._list; } } catch {}
    // Nothing to show: the page says so and offers Reload, rather than made-up materials.
    this.failed = true; this._list = [];
    return this._list;
  },
  // The saved list first, the site's behind it: onChange(list) if it differs.
  async loadConsumables(csvUrl, onChange) {
    const fetched = this._fetchCsv(csvUrl).then(parsed => {
      if (!parsed.length) throw new Error('CSV parsed to 0 rows');
      try { localStorage.setItem('mo_cons_cache', JSON.stringify(parsed)); } catch {}
      return parsed;
    }).catch(e => { console.warn('[Consumables] CSV load failed:', e.message); return null; });
    const saved = this._saved('mo_cons_cache');
    if (saved) {
      this._consumablesList = saved;
      fetched.then(l => { if (l && JSON.stringify(l) !== JSON.stringify(saved)) { this._consumablesList = l; if (onChange) onChange(l); } });
      return saved;
    }
    this._consumablesList = await fetched || [];
    this.consFailed = !this._consumablesList.length;
    return this._consumablesList;
  },
  async _fetchCsv(url) {
    const stop = new AbortController(), t = setTimeout(() => stop.abort(), 8000);
    try {
      const res = await fetch(url + '?nocache=' + Date.now(), { signal: stop.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = this._decode(await res.arrayBuffer());
      if (text.trim().startsWith('<')) throw new Error('Got HTML — check file exists in repo');
      return this._parseCsv(text);
    } finally { clearTimeout(t); }
  },
  get() { return this._list || []; },
  // The CSVs are edited in Excel, which saves either UTF-8 (with a BOM, when
  // "CSV UTF-8" is chosen) or the Windows ANSI codepage (plain "CSV"). Decode
  // strictly as UTF-8 first — the BOM is consumed — and fall back to
  // Windows-1252 if that fails, so a ½ or ” survives either way.
  _decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { return new TextDecoder('windows-1252').decode(buf); }
  },
  _parseCsv(text) {
    const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(l => l.trim() !== '');
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
    // Only in a backup downloaded from the materials catalogue: the permanent
    // id of each row (otherwise it's the row number) and whether it's retired.
    const iId      = findCol('id');
    const iRetired = findCol('retired');
    if (iCode < 0 || iDesc < 0) { console.error('[CSV] Missing required columns. Got:', headers); return []; }
    return lines.slice(1).map((line, i) => {
      const cols = this._splitLine(line);
      const get  = idx => (idx >= 0 && idx < cols.length) ? cols[idx].trim() : '';
      const code = get(iCode), desc = get(iDesc);
      if (!code && !desc) return null;
      if (/^(yes|true|1)$/i.test(get(iRetired))) return null;
      const boxSizeRaw = get(iBoxSize);
      const boxSize = boxSizeRaw ? parseInt(boxSizeRaw) || 0 : 0;
      return {
        id:parseInt(get(iId), 10) || i+1, partCode:code, description:desc,
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
  // For tab strips: the biggest categories first, so the ones used most are on screen
  // without scrolling. Goes by how many items each has, which changes rarely, so a tab
  // stays where people are used to finding it.
  categoriesBySize(list) {
    const n = new Map();
    for (const m of (list || this.get())) n.set(m.category, (n.get(m.category) || 0) + 1);
    return [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || naturalCompare(a, b));
  },
  subcategories(list, category) {
    const seen = new Set();
    const subs = (list||this.get()).filter(m=>m.category===category).map(m=>m.subcategory)
      .filter(s=>{ if(seen.has(s)) return false; seen.add(s); return true; });
    return Settings.get().naturalSort ? [...subs].sort(naturalCompare) : subs;
  },

  // The list to show for a category, a type and what is in the search box. An item has to
  // match all of it: every size, every code and every word. Words forgive a typo; sizes and
  // anything else with a digit in it match exactly, so one part never turns up as another.
  // If nothing matches it all, the nearest thing is shown instead and `.note` on the result
  // says what was left out.
  // opts can override Settings per-call, e.g. Data.filter(list, cat, sub, q, {fuzzySearch:false})
  filter(list, category, subcategory, query, opts) {
    const cfg = { ...Settings.get(), ...(opts||{}) };
    let out = list||this.get();
    if (category)    out = out.filter(m=>m.category===category);
    if (subcategory) out = out.filter(m=>m.subcategory===subcategory);

    const q = normaliseGlyphs(query).toLowerCase().trim();
    if (!q) {
      return cfg.naturalSort
        ? [...out].sort((a,b)=>naturalCompare(a.description, b.description))
        : out;
    }

    const sizes = cfg.unitAwareSearch ? extractMeasurements(q) : [];
    let rest = q;
    for (const s of sizes) rest = rest.replace(s.raw, ' ');
    const UNIT_WORDS = new Set(['mm', 'in', 'inch', 'inches', 'x', 'by']);
    const tokens = rest.split(/[^a-z0-9./]+/).map(t => t.replace(/^[./]+|[./]+$/g, '')).filter(t => t && !UNIT_WORDS.has(t));
    const exact  = tokens.filter(t => /\d/.test(t));
    const words  = tokens.filter(t => !/\d/.test(t) && t.length > 1);
    const qCode  = codeKey(q);
    const phrase = phraseRe(q);

    const full = [], close = [], noSize = [], noWord = [];
    for (const m of out) {
      const desc = normaliseGlyphs(m.description).toLowerCase();
      const code = codeKey(m.partCode);
      // What was typed, as it stands: in the description, or in the part code however it
      // is spaced ("SL 0301", "sl-0301"). Digits alone need three to count as a code.
      if (phrase.test(desc) || (qCode && code.includes(qCode) && (/[a-z]/.test(qCode) || qCode.length >= 3))) {
        full.push({ m, score: phrase.test(desc) ? 0 : 0.5 });
        continue;
      }
      const hay = `${desc} ${String(m.category || '').toLowerCase()} ${String(m.subcategory || '').toLowerCase()}`;
      let typo = 0, wordsOk = true;
      for (const w of words) {
        if (hay.includes(w)) continue;
        const d = cfg.fuzzySearch ? typosTo(w, hay) : Infinity;
        if (d > maxTypos(w)) { wordsOk = false; break; }
        typo += d;
      }
      const exactOk = exact.every(t => phraseRe(t).test(hay) || code.includes(t));
      // Each size typed needs its own: "50 x 50 x 3" is not a 50 x 25 x 3.
      const mm   = sizes.length ? extractMeasurements(desc).map(i => i.mm) : [];
      const hits = sizes.filter(s => { const i = mm.indexOf(s.mm); if (i >= 0) mm.splice(i, 1); return i >= 0; }).length;
      const allSizes = hits === sizes.length;
      const score = 1 + typo;
      if (!exactOk) continue;
      if (allSizes && wordsOk && (sizes.length || words.length || exact.length)) full.push({ m, score });
      else if (wordsOk && hits > 0)                      close.push({ m, score, hits });
      else if (wordsOk && words.length && sizes.length)  noSize.push({ m, score });
      else if (allSizes && sizes.length)                 noWord.push({ m, score: 1 });
    }

    const most = Math.max(...close.map(x => x.hits));
    const near = close.filter(x => x.hits === most);   // only the nearest of the near misses
    const list_ = full.length ? full : near.length ? near : noSize.length ? noSize : noWord;
    list_.sort((a,b) => a.score - b.score || naturalCompare(a.m.description, b.m.description));
    const found = list_.map(x => x.m);
    const typed = sizes.map(x => x.raw.trim() + (x.bare ? 'mm' : '')).join(' x ');
    if (!full.length && found.length) {
      found.note = list_ === near   ? `No exact match for ${typed}. Showing the closest.`
                 : list_ === noSize ? `Nothing in ${typed}. Showing all ${words.join(' ')}.`
                 :                    `Nothing called ${words.join(' ')}. Showing all ${typed}.`;
    }
    return found;
  },
};
// A part code with its spaces and dashes taken out.
function codeKey(s) { return String(s || '').toLowerCase().replace(/[\s\-_./]+/g, ''); }
// What was typed as one run of text. A number in it is a whole number: "50" is not in "150".
function phraseRe(t) {
  const src = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp((/^\d/.test(t) ? '(?:^|[^\\d.])' : '') + src + (/\d$/.test(t) ? '(?![\\d])(?!\\.\\d)' : ''));
}
// Typing searches every category; clearing the box goes back to the one that was open, or
// to one tapped meanwhile. cat/sub: the names of the page's own fields. True if they changed.
function searchScope(app, q, cat, sub) {
  const was = `_was${cat}`;
  if (q && !app[was]) {
    app[was] = [app[cat], app[sub]];
    app[cat] = app[sub] = null;
    return true;
  }
  if (!q && app[was]) {
    if (!app[cat]) [app[cat], app[sub]] = app[was];
    app[was] = null;
    return true;
  }
  return false;
}
function searchNote(found, q) {
  if (found.note) return `<div class="search-note">${esc(found.note)}</div>`;
  if (!found.length && String(q || '').trim()) return `<div class="empty-state"><i class="ti ti-search-off"></i><p>Nothing found for “${esc(q.trim())}”. Try fewer words, or check the spelling.</p></div>`;
  return '';
}

// ── TAB STRIPS ───────────────────────────────────────────────────────────
// Rows that scroll sideways: they keep their place through a redraw, bring the chosen tab
// into view, and fade at an edge that has more behind it.
const Strip = {
  _pos: {},
  watch(el, key) {
    if (!el) return;
    const fade = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.classList.toggle('more-left',  max > 1 && el.scrollLeft > 1);
      el.classList.toggle('more-right', max > 1 && el.scrollLeft < max - 1);
    };
    if (this._pos[key] !== undefined) el.scrollLeft = this._pos[key];
    el.addEventListener('scroll', () => { this._pos[key] = el.scrollLeft; fade(); }, { passive: true });
    const on = el.querySelector('.active');
    if (on && el.clientWidth) {
      const l = on.offsetLeft - el.offsetLeft, r = l + on.offsetWidth, pad = 44;
      if (l - pad < el.scrollLeft)                       el.scrollLeft = l - pad;
      else if (r + pad > el.scrollLeft + el.clientWidth) el.scrollLeft = r + pad - el.clientWidth;
    }
    fade();
    if (typeof ResizeObserver === 'function') new ResizeObserver(fade).observe(el);
  },
  // A category row and, under a category, its types. A lone type is only a label.
  // lead: { label, on } — a tab before All (the worker page's Recent), index -2.
  draw(wrap, { cats, cat, subs, sub, catAttr = 'cat-idx', subAttr = 'sub-idx', lead }) {
    if (!wrap) return;
    const tab = (attr, i, label, on) => `<button class="tab ${on ? 'active' : ''}" data-${attr}="${i}">${esc(label)}</button>`;
    const row = cats.map((c, i) => tab(catAttr, i, c, cat === c)).join('');
    let subRow = '';
    if (cat && subs.length === 1) subRow = `<span class="tab active tab-label">${esc(subs[0])}</span>`;
    else if (cat && subs.length)  subRow = tab(subAttr, -1, 'All', !sub) + subs.map((s, i) => tab(subAttr, i, s, sub === s)).join('');
    wrap.innerHTML = `<div class="tabs-bar"><div class="tabs-inner">${lead ? tab(catAttr, -2, lead.label, lead.on) : ''}${tab(catAttr, -1, 'All', !cat)}${row}</div></div>`
      + (subRow ? `<div class="tabs-bar sub-bar"><div class="tabs-inner">${subRow}</div></div>` : '');
    const [a, b] = wrap.querySelectorAll('.tabs-inner');
    this.watch(a, wrap.id);
    this.watch(b, `${wrap.id}:${cat}`);
  },
};

const Order = {
  _items: {},
  get(id)       { return this._items[id]||0; },
  set(id,qty)   { if(qty<=0) delete this._items[id]; else this._items[id]=qty; },
  adjust(id,d)  { this.set(id, round2((this._items[id]||0)+d)); },
  remove(id)    { delete this._items[id]; },
  clear()       { this._items={}; },
  count()       { return Object.keys(this._items).length; },
  isEmpty()     { return this.count()===0; },
  all()         { return this._items; },
  replace(items){ this._items = items; },
  items(mats)   {
    return Object.keys(this._items).map(id=>{
      const m=mats.find(x=>x.id==id); return m?{...m,qty:this._items[id]}:null;
    }).filter(Boolean);
  },
};

// ── KEPT WORK ────────────────────────────────────────────────────────────
// A half-built list, kept on this device through a reload by what each line is (stockId),
// since ids can change with the catalogue. Test mode keeps its own.
const Kept = {
  _key(name) { return `mo_kept_${name}${FirebaseConfig.isTestMode() ? '_test' : ''}`; },
  save(name, data) { try { localStorage.setItem(this._key(name), JSON.stringify({ at: Date.now(), ...data })); } catch {} },
  drop(name)       { try { localStorage.removeItem(this._key(name)); } catch {} },
  load(name, maxAge) {
    try { const v = JSON.parse(localStorage.getItem(this._key(name)) || 'null'); return v && v.at > Date.now() - maxAge ? v : null; } catch { return null; }
  },
  lines(items) { return items.map(i => ({ sid: stockId(i), qty: i.qty, ...(i.mode ? { mode: i.mode } : {}) })); },
  // A cart (id -> anything) carried over to a list whose ids may have changed.
  move(cart, from, to) {
    const out = {};
    for (const [id, v] of Object.entries(cart)) {
      const was = from.find(m => m.id == id), now = was && to.find(m => stockId(m) === stockId(was));
      if (now) out[now.id] = v;
    }
    return out;
  },
  fill(lines, catalog, put) {
    for (const l of lines || []) { const m = catalog.find(x => stockId(x) === l.sid); if (m && l.qty >= 0) put(m, l); }
  },
};

// ── OUTBOX ──────────────────────────────────────────────────────────────
// Writes made on this device that the server has not yet confirmed: orders,
// consumables sign-outs and stocktake counts. The write itself sits in
// Firestore's on-device queue (DB.init) and goes on its own when the
// connection returns; this is the belt to those braces: a copy of each kept
// here until the server confirms it, re-sent under the same id if that queue
// is ever lost (an order overwrites itself; a sign-out or count is refused if
// it already landed, see DB WAITING WRITES), and the "waiting to submit" count
// the header shows. Entries: { kind, id, ref, payload, placedAt, tries,
// lastTry, failed? } — kind 'order' (the default), 'signout' or 'count'.
const Outbox = {
  _key: 'mo_outbox', _entries: [], _watchers: {}, _onChange: null, _onSent: null, _onNote: null, _resumed: false,
  MAX_AUTO_TRIES: 3,
  _kinds: {
    order:   { send: en => DB.queueOrder(en.payload, en.id),   watch: (id, cb) => DB.watchOrderWrite(id, cb) },
    signout: { send: en => DB.queueSignOut(en.payload, en.id), watch: (id, cb) => DB.watchOp(id, cb) },
    count:   { send: en => DB.queueCounts(en.payload, en.id),  watch: (id, cb) => DB.watchOp(id, cb) },
  },
  _kind(en) { return this._kinds[en.kind] || this._kinds.order; },

  // onSent(entry): the server has something this device was keeping.
  // onNote(text): something the person should know that isn't a failure (a count not used).
  start(key, onChange, onSent, onNote) {
    this._key = key || this._key; this._onChange = onChange || null; this._onSent = onSent || null; this._onNote = onNote || null;
    try { this._entries = JSON.parse(localStorage.getItem(this._key) || '[]'); } catch { this._entries = []; }
    if (!Array.isArray(this._entries)) this._entries = [];
    window.addEventListener('online', () => this.retryFailed());
    this._render();
  },
  // Follow the kept entries in the database — once there is a signed-in
  // account, since the listeners need one. Safe to call again.
  resume() {
    this._resumed = true;
    this._entries.forEach(e => this._watch(e));
    this.retryFailed();
  },
  list()        { return this._entries.slice(); },
  // Where one order has got to: 'sent' (the server has it), 'failed' or 'waiting'.
  state(id)     { const en = this._get(id); return !en ? 'sent' : en.failed ? 'failed' : 'waiting'; },
  count()       { return this._entries.length; },
  failedCount() { return this._entries.filter(e => e.failed).length; },

  // Right after DB.queueOrder / queueSignOut / queueCounts: keep the copy and follow the write.
  add({ kind, id, ref, payload, done }) {
    const en = { kind: kind || 'order', id, ref: ref || '', payload, placedAt: payload.placedAt || payload.at || Date.now(), tries: 1, lastTry: Date.now() };
    this._entries.push(en);
    this._save(); this._render();
    this._follow(id, done);
    if (this._resumed) this._watch(en);
  },
  _follow(id, done) {
    if (!done || !done.then) return;
    done.then(() => this._confirm(id), e => this._fail(id, e));
  },
  _get(id) { return this._entries.find(e => e.id === id); },
  _confirm(id) {
    const en = this._get(id); if (!en) return;
    this._entries = this._entries.filter(e => e.id !== id);
    this._unwatch(id); this._save(); this._render();
    if (this._onSent) this._onSent(en);
  },
  _fail(id, e) {
    const en = this._get(id); if (!en) return;
    if (en.kind && en.kind !== 'order' && e && e.code === 'permission-denied') { this._refused(en, e); return; }
    en.failed = (e && e.code === 'permission-denied') ? 'refused by the server' : whyFailed(e);   // never the database's own words
    this._save(); this._render();
  },
  // A sign-out or count the server refused. It may simply be there already (sent twice
  // after a lost reply); a count may have been overtaken by a newer one of the same item,
  // which stands. Anything else stays on the list as refused, with Retry.
  async _refused(en, e) {
    try {
      if (await DB.opLanded(en.id)) { this._confirm(en.id); return; }
      if (en.kind === 'count') {
        const stale = await DB.staleCounts(en.payload);
        if (stale.length) {
          const gone = new Set(stale.map(l => l.sid));
          const names = stale.map(l => l.description).join(', ');
          if (this._onNote) this._onNote(`${names}: a newer count was already recorded, so ${stale.length === 1 ? 'this one was' : 'these were'} not used.`);
          en.payload = { ...en.payload, lines: en.payload.lines.filter(l => !gone.has(l.sid)) };
          if (!en.payload.lines.length) {
            this._entries = this._entries.filter(x => x.id !== en.id);
            this._unwatch(en.id); this._save(); this._render();
            return;
          }
          this._save();
          this.retry(en.id, true);   // the rest, at once
          return;
        }
      }
      en.failed = 'refused by the server';
    } catch (err) { en.failed = whyFailed(err); }
    this._save(); this._render();
  },
  // A write refused at once, while the person is still there to be told: take it off the
  // list (the page keeps what they entered, to try again).
  drop(id) {
    if (!this._get(id)) return;
    this._entries = this._entries.filter(e => e.id !== id);
    this._unwatch(id); this._save(); this._render();
  },
  // Re-send the kept copy under the same id (overwrites, never duplicates).
  // Automatic retries are few and spaced out; a tap on Retry is always allowed.
  _timers: {},
  retry(id, manual) {
    const en = this._get(id);
    if (!en || typeof DB === 'undefined' || !DB.isReady()) return;
    if (!manual && en.tries >= this.MAX_AUTO_TRIES) return;
    const wait = manual && en.failed ? 0 : 8000 - (Date.now() - (en.lastTry || 0));   // a failed try is over: nothing to wait for
    if (wait > 0) {                       // one attempt at a time: come back when the window has passed
      if (!this._timers[id]) this._timers[id] = setTimeout(() => { delete this._timers[id]; this.retry(id, manual); }, wait);
      return;
    }
    en.tries++; en.lastTry = Date.now(); delete en.failed;
    this._save(); this._render();
    try { const { done } = this._kind(en).send(en); this._follow(en.id, done); }
    catch (e) { this._fail(en.id, e); }
  },
  retryFailed() { this._entries.filter(e => e.failed).forEach(e => this.retry(e.id, false)); },
  // What the database says about the write: the server has it → done; the
  // server says there is no such record and nothing is queued → re-send the copy.
  _watch(en) {
    if (this._watchers[en.id] || typeof DB === 'undefined' || !DB.isReady()) return;
    this._watchers[en.id] = this._kind(en).watch(en.id, s => {
      if (s.error) { this._fail(en.id, s.error); return; }
      if (s.exists && !s.pending && !s.fromCache) this._confirm(en.id);
      else if (!s.exists && !s.fromCache) this.retry(en.id, false);
      // exists + pending: still queued on this device. !exists + fromCache: offline, nothing known yet — wait.
    });
  },
  _unwatch(id) { const u = this._watchers[id]; if (u) { try { u(); } catch {} delete this._watchers[id]; } if (this._timers[id]) { clearTimeout(this._timers[id]); delete this._timers[id]; } },
  _save() { try { localStorage.setItem(this._key, JSON.stringify(this._entries)); } catch {} },
  _render() {
    if (this._onChange) this._onChange(this);
    if (document.getElementById('outbox-card')) this.openList();
  },

  // ── the header pill, and the list behind it ──
  pillHtml() {
    const n = this.count(); if (!n) return '';
    const failed = this.failedCount(), waiting = n - failed;
    const label = [failed ? `${failed} not submitted` : '', waiting ? `${waiting} waiting to submit` : ''].filter(Boolean).join(' · ');
    return `<button class="outbox-pill${failed ? ' failed' : ''}" data-outbox><i class="ti ${failed ? 'ti-alert-triangle' : 'ti-cloud-upload'}"></i> ${label}</button>`;
  },
  // Each waiting order opens to its lines — what was asked for and how many
  // — so it can be read off the screen (and phoned through) if the connection
  // stays down. _open: which ones are open, kept across re-renders.
  _open: new Set(),
  _lines(e) { return (e.payload && (e.payload.items || e.payload.lines)) || []; },
  // What the row is called: the order's reference, whose sign-out, or the counts.
  _title(e) {
    if (e.kind === 'signout') return `Sign-out · ${e.ref || ''}`;
    if (e.kind === 'count')   return 'Stocktake counts';
    return e.ref || e.id;
  },
  _detailHtml(e) {
    const line = (qty, i) => `<div class="outbox-line">
        <div class="outbox-qty">${esc(qty)}</div>
        <div><div class="outbox-desc">${descHtml(i.description || '')}</div>${i.partCode && !Data.isDummyCode(i.partCode) ? `<div class="outbox-code">${esc(i.partCode)}</div>` : ''}</div>
      </div>`;
    if (e.kind === 'signout') return this._lines(e).map(i => line(`${i.qty} ${i.unit || ''}`.trim(), i)).join('');
    if (e.kind === 'count')   return this._lines(e).map(i => line(Count.words(i.mode, i.qty, i.unit || ''), i)).join('');
    const note = e.payload && e.payload.note;
    return this._lines(e).map(i => line(orderQtyDisplay(i, i.qty), i)).join('') + (note ? `<div class="outbox-note">${esc(note)}</div>` : '');
  },
  openList() {
    let ow = document.getElementById('overlay-wrap');
    if (!ow) { ow = document.createElement('div'); ow.id = 'overlay-wrap'; document.body.appendChild(ow); }
    const prev = document.querySelector('#outbox-card .outbox-list');
    const top = prev ? prev.scrollTop : 0;      // re-rendered while open (an order went): stay where the reader was
    const rows = this._entries.map(e => {
      const open = this._open.has(e.id), n = this._lines(e).length;
      return `<div class="outbox-item">
        <div class="outbox-top">
          <button class="outbox-head" data-outbox-toggle="${esc(e.id)}" aria-expanded="${open}" aria-controls="outbox-d-${esc(e.id)}">
            <span class="outbox-head-text"><span class="outbox-ref${e.kind && e.kind !== 'order' ? ' words' : ''}">${esc(this._title(e))}</span><span class="outbox-sub">${esc(fmtTime(new Date(e.placedAt)))} · ${n} line${n === 1 ? '' : 's'}${e.failed ? ' · ' + esc(e.failed) : ''}</span></span>
            <i class="ti ti-chevron-${open ? 'up' : 'down'}"></i>
          </button>
          ${e.failed ? `<button class="btn-sm outbox-retry" data-outbox-retry="${esc(e.id)}">Retry</button>` : ''}
        </div>
        <div class="outbox-detail" id="outbox-d-${esc(e.id)}"${open ? '' : ' hidden'}>${this._detailHtml(e)}</div>
      </div>`;
    }).join('');
    ow.innerHTML = `<div class="success-overlay"><div class="success-card" id="outbox-card" style="max-width:440px;text-align:left">
        <h3 style="text-align:center">${this.failedCount() && this.failedCount() === this.count() ? 'Not submitted' : 'Waiting to submit'}</h3>
        <div class="outbox-list">${rows || '<div class="outbox-sub">Nothing waiting.</div>'}</div>
        <button class="btn btn-outline" id="outbox-close" data-esc style="width:100%;margin-top:14px">Close</button>
      </div></div>`;
    document.getElementById('outbox-close').addEventListener('click', () => { ow.innerHTML = ''; });
    const list = ow.querySelector('.outbox-list'); if (list) list.scrollTop = top;
  },
  // Open or close one order in place — no re-render, so nothing jumps.
  toggle(id) {
    const open = !this._open.has(id);
    if (open) this._open.add(id); else this._open.delete(id);
    const btn = [...document.querySelectorAll('[data-outbox-toggle]')].find(b => b.dataset.outboxToggle === id);
    if (!btn) return;
    btn.setAttribute('aria-expanded', open);
    btn.querySelector('.ti').className = `ti ti-chevron-${open ? 'up' : 'down'}`;
    const d = document.getElementById('outbox-d-' + id); if (d) d.hidden = !open;
  },
};
document.addEventListener('click', e => {
  if (e.target.closest('[data-outbox]')) {
    // Opened from the pill: start closed — unless there is only one order
    // waiting, which is the one they came to read.
    Outbox._open.clear();
    if (Outbox.count() === 1) Outbox._open.add(Outbox.list()[0].id);
    Outbox.openList();
  }
  const t = e.target.closest('[data-outbox-toggle]');
  if (t) Outbox.toggle(t.dataset.outboxToggle);
  const r = e.target.closest('[data-outbox-retry]');
  if (r) Outbox.retry(r.dataset.outboxRetry, true);
});

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
// existing "tap the search box and scan" behaviour still works and we never double up
// — except in fields the page names with `through`: a person's name or a quantity must
// never swallow a barcode. There the field is put back as it was and the code goes
// where a scan always goes. Runs in the capture phase so the scanner's own Enter can
// be stopped before the field's handler sees it.
const BarcodeScanner = {
  MAX_GAP:  60,   // ms between keys — slower than this reads as human typing
  MIN_LEN:  4,    // shorter bursts are ignored
  END_WAIT: 90,   // ms of quiet that ends a scan when the scanner sends no Enter
  LATE_ENTER: 500, // ms after a scan in which an Enter is still the scanner's
  _buf: '', _last: 0, _timer: null, _field: null, _fieldWas: '', _enterUntil: 0,

  start(onScan, opts) {
    const through = opts && opts.through;
    document.addEventListener('keydown', e => {
      const el = document.activeElement;
      const inField = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const guarded = inField && !!through && through(el);
      if (inField && !guarded) { this._buf = ''; return; }   // typing into a field — leave it be

      const now = Date.now();
      if (e.key === 'Enter' && now < this._enterUntil) {      // the Enter that came late
        this._enterUntil = 0; e.preventDefault(); e.stopPropagation(); return;
      }
      if (e.repeat || now - this._last > this.MAX_GAP) this._buf = '';
      this._last = now;
      clearTimeout(this._timer);

      if (e.key === 'Enter') {
        if (this._isScan()) { e.preventDefault(); e.stopPropagation(); this._flush(onScan); this._enterUntil = 0; }
        else this._buf = '';
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!this._buf) { this._field = guarded ? el : null; this._fieldWas = guarded ? el.value : ''; }
        this._buf += e.key;
        this._timer = setTimeout(() => { if (this._isScan()) this._flush(onScan); else this._buf = ''; }, this.END_WAIT);
      }
    }, true);
  },

  // In a name field only a burst with a digit in it counts: nobody's name has one.
  _isScan() {
    const code = this._buf.trim();
    if (code.length < this.MIN_LEN) return false;
    return !(this._field && this._field.type === 'text' && !/\d/.test(code));
  },

  _flush(onScan) {
    const code = this._buf.trim();
    this._buf = '';
    this._enterUntil = Date.now() + this.LATE_ENTER;
    const f = this._field; this._field = null;
    if (f) {
      f.value = this._fieldWas;
      f.dispatchEvent(new Event('input',  { bubbles: true }));
      f.dispatchEvent(new Event('change', { bubbles: true }));
    }
    onScan(code);
  },
};

// ── OPENING OFFLINE ──────────────────────────────────────────────────────
// sw.js keeps a copy of each page's files on the device, so a page opened once online
// opens again with no connection, on the data the database kept (DB.init). Online it
// always fetches the newest files first, so updates arrive as before. The first visit
// loads before the worker can see it, so the page hands over the addresses it used.
// (An early version's worker served old files after updates; this one only falls back
// to its copy when the site can't be reached.)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    const first = !navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(reg => {
        if (!first || !reg.active) return;
        const used = performance.getEntriesByType('resource').map(r => r.name);
        reg.active.postMessage({ keep: [location.href, ...used] });
      })
      .catch(e => console.warn('[offline] files not kept on this device:', e && e.message));
  });
}

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
//   - FRESH reload: GitHub Pages caches every file for ~10 minutes, and a plain
//     location.reload() only revalidates — the CDN answers "unchanged" from its
//     stale copy, so right after a deploy the old build comes straight back
//     (banner reappears, nothing changed). reloadFresh() navigates to the page
//     with a ?v= query instead: a new URL to the CDN, so the HTML is fetched
//     from origin, and the HTML's own ?v=-stamped script/style tags (see
//     tools/bump-version.py) pull matching assets the same way.
//   - RETRY window: belt and braces for anything still stale — one attempt per
//     version PER HOUR (sessionStorage) can't loop; the banner stays up between.
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

  // Reload in a way the CDN can't serve stale: a version-stamped URL is a new
  // object to it. Used by the banner button and the idle auto-reload.
  reloadFresh(v) {
    const stamp = encodeURIComponent(v || this._latest || Date.now());
    location.replace(location.pathname + '?v=' + stamp);
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
    if (document.querySelector('.panel.open:not(#success-panel)')) return true;   // any slide-in panel (an order already sent is done with)
    const ow = document.getElementById('overlay-wrap');
    if (ow && ow.innerHTML.trim()) return true;                    // any dialog/overlay
    if (document.getElementById('ask-wrap')) return true;          // a question waiting for its answer
    const el = document.activeElement;                             // walked away mid-entry
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.value) return true;
    return this._opts.isBusy ? !!this._opts.isBusy() : false;
  },

  _maybeReload() {
    if (!this._opts || !this._latest) return;
    if (Date.now() - this._lastActivity < this.IDLE_MS) return;
    if (this._busy()) return;
    // Never under one of the hub's screens (its sign-in waits for somebody to type).
    if (document.querySelector('.shub-screen, .shub-scrim')) return;
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
    this.reloadFresh(this._latest);
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

// ── Firebase projects ────────────────────────────────────────────────────
// PUBLIC IDENTIFIERS, not secrets — every browser needs them to talk to
// Firebase, so they live here, as the production board's do, and a fresh
// device needs only a sign-in. What protects the data: Firebase Auth plus
// the Firestore rules (a LISTED account for every read, see js/auth.js) and
// App Check; the two browser keys are also restricted in Google Cloud to this
// site's origin and to the APIs the app calls. GitHub secret scanning flags
// any "AIzaSy…" string — a Firebase web key is public by design
// (firebase.google.com/docs/projects/api-keys): mark the alert a false
// positive, never rotate the key.
const FIREBASE_PROJECTS = {
  production: {
    apiKey: 'AIzaSyBuh_oL3dUQ3qCU8qQQL3e7hBKfGhYdBds',
    authDomain: 'material-ordering-41851.firebaseapp.com',
    projectId: 'material-ordering-41851',
    appId: '1:999530935622:web:e6798dc5b4edbe54142147',
  },
  // Throwaway data; locked the same way. Test mode (a master's switch in
  // Settings) points the whole device at it.
  test: {
    apiKey: 'AIzaSyA-FhiK3Lr4-ioifSGJ7OvtTRwmmZfDrMY',
    authDomain: 'material-ordering-testing.firebaseapp.com',
    projectId: 'material-ordering-testing',
    appId: '1:165316963515:web:4916fe002bab1b45cf8d9e',
  },
};
const FirebaseConfig = {
  _testModeKey: 'mo_test_mode',
  isTestMode()  { return localStorage.getItem(this._testModeKey) === 'true'; },
  setTestMode(v){ if (v) localStorage.setItem(this._testModeKey, 'true'); else localStorage.removeItem(this._testModeKey); },
  get()         { return FIREBASE_PROJECTS[this.isTestMode() ? 'test' : 'production']; },
  // Configs were pasted per device until 2026-10-22.2; nothing reads them now.
  forget()      { ['mo_firebase_config', 'mo_firebase_config_test'].forEach(k => localStorage.removeItem(k)); },
};

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Live data redraws whole lists, which throws away the fields in them: the one
// being typed in loses focus, and anything typed but not yet used is wiped. Call
// before a redraw; the function it returns puts all of that back afterwards.
//
// Fields are found again by id, or by their data- attributes inside the nearest
// box with an id (the same attributes are used in several lists). What is kept:
//   - the focused field: its text and caret, unless it was already accepted
//   - other fields typed in but not used yet (the stock cards' add/remove boxes)
// A field that edits the page's own state (it has data- attributes) is drawn from
// that state, so once accepted the redraw is right and nothing is put back.
document.addEventListener('input',  e => { e.target._accepted = false; }, true);
document.addEventListener('change', e => { e.target._accepted = true;  }, true);
function fieldSelector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  const own = [...el.attributes].filter(a => a.name.startsWith('data-'))
    .map(a => `[${a.name}="${a.value.replace(/["\\]/g, '\\$&')}"]`).join('');
  if (!own) return null;
  const box = el.parentElement && el.parentElement.closest('[id]');
  return (box ? '#' + CSS.escape(box.id) + ' ' : '') + own;
}
function captureInputFocus() {
  // Some browsers send "left the field" when a field is taken off the page by a
  // redraw. Nobody left it, so nothing is accepted until the redraw is over.
  QtyField.redrawing = true;
  setTimeout(() => { QtyField.redrawing = false; }, 0);
  const kept = [];
  document.querySelectorAll('input, textarea').forEach(el => {
    if (/^(checkbox|radio|file|button|submit)$/.test(el.type)) return;
    const focused = el === document.activeElement;
    if (!focused && el.value === el.defaultValue) return;
    const selector = fieldSelector(el); if (!selector) return;
    const own = [...el.attributes].some(a => a.name.startsWith('data-'));
    if (!focused && own) return;
    let start = null, end = null;
    if (focused) { try { start = el.selectionStart; end = el.selectionEnd; } catch {} } // number inputs throw
    const typed = el._typed === undefined ? el.value !== el.defaultValue : el._typed;
    kept.push({ el, selector, focused, own, typed, value: el.value, was: el.defaultValue, start, end });
  });
  return () => kept.forEach(k => {
    if (k.el.isConnected) return;                       // not redrawn after all
    const nel = document.querySelector(k.selector); if (!nel) return;
    const keep = k.focused
      ? k.typed && (k.el._qtyLive ? k.value.trim() === '' : !(k.own && k.el._accepted))
      : nel.defaultValue === k.was;
    if (keep) nel.value = k.value;
    if (!k.focused) return;
    for (const p of ['_before', '_qtyLive', '_typed', '_accepted']) nel[p] = k.el[p];
    QtyField.quiet = true;                              // back where they were, not a fresh tap
    try { nel.focus({ preventScroll: true }); } finally { QtyField.quiet = false; }
    if (k.start != null) { try { nel.setSelectionRange(k.start, k.end); } catch {} }
  });
}

// ── QUANTITY FIELDS ──────────────────────────────────────────────────────
// One behaviour for every quantity that is typed:
//   - tapping in selects what is there; nothing entered shows as empty, not 0
//   - what is typed counts at once, so a tap on +/− or Review never misses it
//   - leaving a field empty puts the last quantity back: it never removes a line
//   - units sold by measure (metres, grams) take decimals. The rest are whole, and
//     a decimal is refused with a note rather than quietly cut short
const MEASURED_UNITS = new Set(['metre', 'meter', 'm', 'mm', 'gram', 'g', 'kilogram', 'kg', 'litre', 'l', 'ml']);
function qtyAllowsDecimals(item) {
  return !!item && !hasBoxTracking(item) && MEASURED_UNITS.has(String(item.qtyType || '').trim().toLowerCase());
}
function round2(n) { return Math.round(n * 100) / 100; }
const QtyField = {
  quiet: false,      // focus being put back by a redraw
  redrawing: false,  // see captureInputFocus

  // The attributes of a quantity <input>; add the value and the data- attribute.
  attrs(item) {
    const d = qtyAllowsDecimals(item);
    return `type="number" min="0" step="${d ? 'any' : '1'}" inputmode="${d ? 'decimal' : 'numeric'}" placeholder="0" autocomplete="off"`;
  },
  // What is in the field: { blank } | { bad: 'why' } | { qty }
  read(el, item) {
    if (el.validity && el.validity.badInput) return { bad: 'Numbers only' };
    const raw = String(el.value).trim().replace(',', '.');
    if (!raw) return { blank: true };
    const n = Number(raw);
    if (!isFinite(n) || n < 0) return { bad: 'Numbers only' };
    if (n % 1 && !qtyAllowsDecimals(item)) return { bad: 'Whole numbers only' };
    return { qty: round2(n) };
  },
  // o: { item(el), get(el) -> qty, set(el, qty), live(el)?, zero?, later? }
  //   live  — called after each accepted change, to update the card in place
  //   zero  — typing 0 takes the item off (otherwise the last quantity comes back)
  //   later — the value is saved to the database, so only once the field is left
  attach(box, sel, o) {
    const find = e => e.target.closest && e.target.closest(sel);
    box.addEventListener('focusin', e => {
      const el = find(e); if (!el || this.quiet) return;
      el._before = o.get(el); el._qtyLive = !o.later; el._typed = false;
      setTimeout(() => { if (document.activeElement === el) { try { el.select(); } catch {} } }, 0);
    });
    box.addEventListener('input', e => {
      const el = find(e); if (!el) return;
      el._typed = true; el._qtyLive = !o.later;
      this._note(el, '');
      if (o.later) return;
      if (el._before === undefined) el._before = o.get(el);
      const r = this.read(el, o.item(el));
      if (r.qty > 0) { o.set(el, r.qty); if (o.live) o.live(el); }
    });
    const settle = e => {
      const el = find(e); if (!el || !el._typed || this.redrawing) return;
      el._typed = false;
      const r = this.read(el, o.item(el));
      const refused = r.blank || r.bad || (r.qty === 0 && !o.zero);
      if (!refused) { if (o.get(el) !== r.qty) o.set(el, r.qty); }
      else if (!o.later && o.get(el) !== el._before) o.set(el, el._before);   // a live order was never touched
      const shown = o.later && !refused ? r.qty : o.get(el);      // a cart may cap it (stock on hand)
      el.value = shown > 0 || (o.later && shown === 0) ? String(shown) : '';
      el.defaultValue = el.value;
      el._before = shown;
      if (r.bad) this._note(el, r.bad);
      if (o.live) o.live(el);
    };
    box.addEventListener('change', settle);
    box.addEventListener('focusout', settle);
  },
  // Why a value was refused, on the line under the description.
  _note(el, msg) {
    el.classList.toggle('qty-bad', !!msg);
    const row = el.closest('.mat-card, .order-item, .signout-item-row, .order-line, .combined-main-row, .combined-sub-row, .cons-tile');
    if (!row) return;
    let n = row.querySelector('.qty-note');
    if (!msg) { if (n) n.remove(); return; }
    if (!n) {
      n = document.createElement('div'); n.className = 'qty-note'; n.setAttribute('role', 'alert');
      (row.querySelector('.mat-info, .order-item-row > div, .signout-item-info, .order-line-info, .combined-main-info, .combined-sub-device, .cons-tile-body') || row).appendChild(n);
    }
    n.textContent = msg;
  },
};

// ── COUNTING (stocktake, worker and manager pages) ───────────────────────
// Set replaces what is recorded, Add and Take off move it. A count of zero is a count.
// attr: 'st' or 'mst' — each page's own data- attributes.
const Count = {
  MODES: [['set', 'Set'], ['add', 'Add'], ['subtract', 'Take off']],
  words(mode, qty, unit) { return `${mode === 'add' ? 'Add' : mode === 'subtract' ? 'Take off' : 'Set to'} ${qty} ${unit}`; },
  colour(mode) { return mode === 'add' ? 'var(--green-text)' : mode === 'subtract' ? 'var(--red-text)' : 'var(--blue-text)'; },
  // Taking nothing off, or adding nothing, is not a count.
  ready(qty, mode) { return qty !== undefined && (qty > 0 || mode === 'set'); },
  after(recorded, qty, mode) {
    const was = recorded || 0;
    return round2(mode === 'add' ? was + qty : mode === 'subtract' ? Math.max(0, was - qty) : qty);
  },
  // "3 Metre recorded → 8": what is recorded now and, once a count is entered, after it.
  // known: the recorded counts have arrived, so "not counted yet" is true.
  line(rec, unit, qty, mode, known) {
    const has = rec && rec.qty != null;
    const now = has ? `${rec.qty} ${esc(unit)} recorded` : known ? 'not counted yet' : '…';
    return this.ready(qty, mode) ? `${now} → <strong>${this.after(has ? rec.qty : 0, qty, mode)}</strong>` : now;
  },
  controls(attr, id, qty, mode) {
    const on = this.ready(qty, mode);
    return `<div class="st-controls">
        <div class="st-mode-seg">${this.MODES.map(([v, label]) =>
          `<button class="st-mode-opt ${v}${mode === v ? ' active' : ''}" data-${attr}-modeopt="${id}" data-mode="${v}" aria-pressed="${mode === v}">${label}</button>`).join('')}</div>
        <div class="st-ctrl-row">
          <button class="qty-btn" data-${attr}-dec="${id}">−</button>
          <input class="qty-input" type="number" min="0" step="any" inputmode="decimal" autocomplete="off" value="${qty === undefined ? '' : qty}" placeholder="–" data-${attr}-qid="${id}">
          <button class="qty-btn" data-${attr}-inc="${id}">+</button>
          <button class="st-tick ${on ? 'ready' : ''}" data-${attr}-tick="${id}" ${on ? '' : 'disabled'} aria-label="Record this count"><i class="ti ti-check"></i></button>
        </div>
      </div>`;
  },
  // Counts as waiting writes (DB.queueCounts): they go now with a connection, or by
  // themselves when one is back. lines: [{ sid, partCode, description, category,
  // subcategory, unit, qty, mode }]; recorded(sid): the qty recorded now, so "take off"
  // never goes below nothing. In parts of 400 (a batch holds 500 writes).
  // Returns [{ id, payload, done }].
  queue(lines, by, recorded) {
    const at = Date.now(), out = [];
    const fit = lines.map(l => l.mode === 'subtract' ? { ...l, applyQty: Math.min(l.qty, Math.max(0, recorded(l.sid) || 0)) } : l);
    for (let i = 0; i < fit.length; i += 400) {
      const payload = { by, at, lines: fit.slice(i, i + 400) };
      out.push({ payload, ...DB.queueCounts(payload, OpId.fresh()) });
    }
    return out;
  },
  // What is in the field: a number of 0 or more, or undefined (nothing entered yet).
  read(el) {
    const raw = String(el.value).trim().replace(',', '.'), n = Number(raw);
    return raw === '' || !isFinite(n) || n < 0 ? undefined : round2(n);
  },
  // Typing updates the card where it is: no redraw, so the caret and the next tap stay put.
  typed(el, rec, unit, qty, mode, known) {
    const card = el.closest('.mat-card'); if (!card) return;
    const on = this.ready(qty, mode), tick = card.querySelector('.st-tick'), line = card.querySelector('.st-recorded');
    card.classList.toggle('in-order', on);
    if (tick) { tick.classList.toggle('ready', on); tick.disabled = !on; }
    if (line) line.innerHTML = this.line(rec, unit, qty, mode, known);
  },
};

// ── START-UP ─────────────────────────────────────────────────────────────
// Each page's HTML carries a cover (#boot): its header and some blank rows, painted before
// any script has loaded. It holds no data and it is opaque, so it is also what hides the
// page until a sign-in is known. It goes when the page is drawn and the sign-in is known,
// or at once for the sign-in dialog or a "can't connect" card.
const Boot = {
  _waiting: new Set(['page', 'sign-in']),
  ready(what) { this._waiting.delete(what); if (!this._waiting.size) this.gone(); },
  gone()      { document.getElementById('boot')?.remove(); },
};
// Blank rows the size of what is coming, until the first data arrives.
function skeleton(n, cls) { return `<div class="skels ${cls || ''}" aria-hidden="true">${'<div class="skel"></div>'.repeat(n)}</div>`; }

// Cards open with a short, soft change of height instead of a snap (about 150ms open,
// 120ms closed; nothing under reduced motion). The height is measured here and animated
// by script, because Safari can't ease to a height of "auto". Only when someone taps: a
// list redrawn by a live update opens its cards at once.
const Fold = {
  OPEN_MS: 150, CLOSE_MS: 120, EASE: 'cubic-bezier(.23, 1, .32, 1)',
  _still() {
    return !Element.prototype.animate || !Element.prototype.getAnimations
      || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  },
  // Open, and not on its way shut.
  isOpen(el) { return !!el && el.classList.contains('open') && !el.classList.contains('shutting'); },
  _frames(el) {
    const cs = getComputedStyle(el);
    return [
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
      { height: cs.height, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 },
    ];
  },
  _mine(el) { return el.getAnimations().filter(a => a.id === 'fold'); },
  // Content stays inside the card while it moves.
  _tidy(el) { if (!this._mine(el).some(a => a.playState === 'running')) el.classList.remove('folding'); },
  _run(el, frames, ms, fill) {
    el.classList.add('folding');
    const a = el.animate(frames, { duration: ms, easing: this.EASE, fill });
    a.id = 'fold';
    return a;
  },
  // Something just shown: grow it from nothing to its own height.
  grow(el) {
    if (!el || this._still()) return;
    this._mine(el).forEach(a => a.cancel());   // a close under way gives in
    const a = this._run(el, this._frames(el), this.OPEN_MS, 'none');
    a.finished.then(() => this._tidy(el), () => this._tidy(el));
  },
  // Shrink to nothing, then `then` hides or redraws them.
  close(els, then) {
    els = els.filter(Boolean);
    if (!els.length || this._still()) return then();
    if (els.some(el => el.classList.contains('shutting'))) return;   // already closing
    const runs = els.map(el => {
      this._mine(el).forEach(a => a.cancel());
      el.classList.add('shutting');
      return this._run(el, this._frames(el).reverse(), this.CLOSE_MS, 'forwards');
    });
    Promise.all(runs.map(a => a.finished))
      .then(() => then(), () => {})   // reopened before it shut: nothing to do
      .finally(() => runs.forEach((a, i) => { els[i].classList.remove('shutting'); a.cancel(); this._tidy(els[i]); }));
  },
  // A body that stays in the page and is shown with the class "open".
  toggle(body, open) {
    if (!body) return;
    if (open) { body.classList.add('open'); this.grow(body); }
    else this.close([body], () => body.classList.remove('open'));
  },
};

// Live lists that have stopped. Firestore doesn't restart one that has failed, so without
// this the page goes on showing old rows under "Live".
const Lost = {
  _lists: new Map(),   // what -> how to start it again
  add(what, again) { this._lists.set(what, again); this.render(); },
  back(what)       { if (this._lists.delete(what)) this.render(); },
  render() {
    let el = document.getElementById('lost-lists');
    if (!this._lists.size) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'lost-lists'; el.className = 'update-banner'; el.setAttribute('role', 'alert');
      const at = document.getElementById('update-banner-wrap'); if (!at) return;
      at.after(el);
    }
    el.innerHTML = `<i class="ti ti-alert-triangle"></i><span>Stopped updating: ${esc([...this._lists.keys()].join(', '))}. What is shown may be old.</span><button>Retry</button>`;
    el.querySelector('button').addEventListener('click', () => {
      const all = [...this._lists.values()];
      this._lists.clear(); this.render();
      all.forEach(again => again());
    });
  },
};

// ── LIVE / OFFLINE ───────────────────────────────────────────────────────
// The header's dot and label, the update strip, and Reload beside "Offline". One place, so
// the four pages never disagree. connected: null until it is known.
const Live = {
  render({ connected, latestVersion }) {
    const dot = document.getElementById('live-dot'), lbl = document.getElementById('live-label');
    const wrap = document.getElementById('update-banner-wrap');
    // hostReachable(): keep the update strip when Firestore's channel is wedged (the dot
    // says Offline) but the site itself answers — refresh is the cure.
    const outdated = (connected || AutoUpdate.hostReachable()) && latestVersion && isVersionNewer(latestVersion, APP_VERSION);
    if (dot && lbl) {
      dot.classList.remove('disconnected', 'update-available', 'connecting');
      if (connected === null)  { dot.classList.add('connecting');       lbl.textContent = 'Connecting…'; }
      else if (!connected)     { dot.classList.add('disconnected');     lbl.textContent = 'Offline: showing saved data'; }
      else if (outdated)       { dot.classList.add('update-available'); lbl.textContent = 'Update ready'; }
      else                     { lbl.textContent = 'Live'; }
      let re = document.getElementById('live-reload');
      if (connected === false && !re) {
        re = document.createElement('button');
        re.id = 'live-reload'; re.className = 'live-reload'; re.textContent = 'Reload';
        re.addEventListener('click', () => this.reload(re));
        lbl.after(re);
      } else if (connected !== false && re) re.remove();
    }
    if (wrap) {
      wrap.innerHTML = outdated ? `<div class="update-banner">
          <i class="ti ti-refresh"></i>
          <span title="${esc(verLabel(APP_VERSION))} → ${esc(verLabel(latestVersion))}">An update is ready.</span>
          <button id="btn-refresh-update">Update now</button>
        </div>` : '';
      document.getElementById('btn-refresh-update')?.addEventListener('click', async () => {
        if (this.unsaved() && !await Ask.confirm({ title: 'Update now?', body: 'What is typed in the open window will be cleared.', yes: 'Update now', no: 'Not now' })) return;
        AutoUpdate.reloadFresh(latestVersion);
      });
    }
  },
  // Typing a reload would lose. Orders, counts, carts and delivery ticks come back by
  // themselves (Kept, drafts), so only what is typed into an open window counts.
  unsaved() {
    return [...document.querySelectorAll('#overlay-wrap input, #overlay-wrap textarea, #ask-wrap input, #email-q input, .panel.open input, .panel.open textarea')]
      .some(el => !/^(search|checkbox|radio|number|hidden|button|file)$/.test(el.type) && !el.hasAttribute('data-kept')
        && el.value.trim() !== '' && el.value !== el.defaultValue);
  },
  // Only if the site answers: reloading without a network would leave a kiosk with nothing.
  async reload(btn) {
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = 'Checking…';
    let ok = false;
    try {
      const stop = new AbortController(), t = setTimeout(() => stop.abort(), 8000);
      ok = (await fetch('js/shared.js?nocache=' + Date.now(), { cache: 'no-store', signal: stop.signal })).ok;
      clearTimeout(t);
    } catch { /* no answer */ }
    if (ok) { AutoUpdate.reloadFresh(Date.now()); return; }
    btn.disabled = false; btn.textContent = 'Reload';
    Ask.tell('No connection', 'Check the Wi-Fi, then tap Reload.');
  },
};

// A routine "done": what happened, and it goes by itself after a few seconds or with a
// tap anywhere. Nothing to decide, so nothing to press.
function doneMessage(ow, { title, text, ms = 5000 }) {
  if (!ow) return;
  ow.innerHTML = `<div class="success-overlay done-msg"><div class="success-card" role="status">
      <div class="success-icon green"><i class="ti ti-circle-check"></i></div>
      <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
      <button class="btn btn-outline" data-esc>Close</button>
    </div></div>`;
  const el = ow.firstElementChild;
  const close = () => { clearTimeout(t); if (el.isConnected) ow.innerHTML = ''; };
  const t = setTimeout(close, ms);
  el.addEventListener('click', close);
}

// A count beside a tab or on a button: capped, and hidden (its room kept) at zero.
function setCount(el, n) {
  if (!el) return;
  el.textContent = n > 99 ? '99+' : String(n);
  el.classList.toggle('zero', !n);
}

// A brief message at the foot of the screen, for things that are fine to miss.
// action: { label, run } — one thing that can still be done about it, offered for longer.
let _toastTimer = null;
function toast(msg, isWarning, action) {
  let el = document.getElementById('scan-toast');
  if (!el) { el = document.createElement('div'); el.id = 'scan-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = `scan-toast${isWarning ? ' warn' : ''}${action ? ' has-action' : ''} show`;
  el.innerHTML = `<i class="ti ${isWarning ? 'ti-alert-triangle' : 'ti-circle-check'}"></i> ${esc(msg)}${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  const hide = () => el.classList.remove('show', 'has-action');
  if (action) el.querySelector('.toast-action').addEventListener('click', () => { hide(); action.run(); });
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(hide, action ? 10000 : 2600);
}

// ── QUESTIONS AND FAILURES ───────────────────────────────────────────────
// A question with two answers that each say what they do. Resolves true or false;
// Esc and the backdrop are the safe answer.
const Ask = {
  _open: null,
  // Something that has to be read before carrying on.
  tell(title, body) { return this.confirm({ title, body, yes: 'Close' }); },
  // A typed answer: resolves with it, or null. The scanner can type it too.
  async text({ title, body, label, value, placeholder, yes, no }) {
    return await this.confirm({ title, body, yes, no, field: { label, value, placeholder } }) || null;
  },
  confirm({ title, body, rows, yes, no, danger, field }) {
    return new Promise(resolve => {
      if (this._open) this._open(false);   // one at a time: an earlier one gets the safe answer
      const from = document.activeElement;
      const w = document.createElement('div'); w.id = 'ask-wrap';
      w.innerHTML = `<div class="success-overlay"><div class="success-card ask-card" role="alertdialog" aria-modal="true" aria-labelledby="ask-title">
          <h3 id="ask-title">${esc(title)}</h3>
          ${body ? `<p>${esc(body)}</p>` : ''}
          ${rows && rows.length ? `<div class="ask-rows">${rows.map(r => `<div class="ask-row"><span>${esc(r[0])}</span><span class="ask-val">${esc(r[1])}</span></div>`).join('')}</div>` : ''}
          ${field ? `<div class="setup-field ask-field">${field.label ? `<label for="ask-text">${esc(field.label)}</label>` : ''}<input id="ask-text" type="text" autocomplete="off" spellcheck="false" value="${esc(field.value || '')}" placeholder="${esc(field.placeholder || '')}"></div>` : ''}
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ask="yes">${esc(yes)}</button>
          ${no ? `<button class="btn btn-outline" data-ask="no">${esc(no)}</button>` : ''}
        </div></div>`;
      const input = w.querySelector('#ask-text');
      const done = v => {
        document.removeEventListener('keydown', key, true);
        w.remove(); this._open = null;
        try { if (from && from.isConnected) from.focus({ preventScroll: true }); } catch {}
        resolve(v);
      };
      const agree = () => {
        if (!input) { done(true); return; }
        const v = input.value.trim();
        if (v) done(v); else input.focus();
      };
      const key = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        if (e.key === 'Enter' && e.target === input) { e.preventDefault(); e.stopPropagation(); agree(); }
      };
      w.addEventListener('click', e => {
        const b = e.target.closest('[data-ask]');
        if (b) { if (b.dataset.ask === 'yes') agree(); else done(false); }
        else if (e.target.classList.contains('success-overlay')) done(false);
      });
      document.addEventListener('keydown', key, true);
      this._open = done;
      document.body.appendChild(w);
      (input || w.querySelector(`[data-ask="${danger && no ? 'no' : 'yes'}"]`)).focus();
    });
  },
};
// A chosen filter pill: it alone is on, and says so.
function pickChip(chip) {
  chip.parentElement.querySelectorAll('.intake-filter-chip').forEach(c => {
    const on = c === chip; c.classList.toggle('active', on); c.setAttribute('aria-pressed', on);
  });
}
// Card headers and rows that open: Enter and Space work on them as on a button.
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || (e.key !== 'Enter' && e.key !== ' ')) return;
  const t = e.target;
  if (t && t.tagName !== 'BUTTON' && t.getAttribute && t.getAttribute('role') === 'button') { e.preventDefault(); t.click(); }
});

// ── DIALOGS: Esc and Tab ──
// The window on top keeps the keyboard: Tab goes round its own buttons and fields, and Esc
// presses its way out (the button marked data-esc, or an open panel's Back). Ask answers Esc
// itself; the sign-in has no way out.
const Dialogs = {
  top() {
    const last = sel => { const a = document.querySelectorAll(sel); return a.length ? a[a.length - 1] : null; };
    return last('#ask-wrap .success-card') || last('#overlay-wrap .success-card, #overlay-wrap .sheet')
      || last('#auth-gate .success-card') || last('#email-q .success-card') || last('.panel.open');
  },
};
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' && e.key !== 'Tab') return;
  // The hub's own screens and dialogs (its sign-in, its password dialog opened from
  // Settings) look after their own keys: step back while one is up or has the focus.
  if (document.querySelector('.shub-screen, .shub-scrim') || (document.activeElement && document.activeElement.closest && document.activeElement.closest('.shub'))) return;
  const box = Dialogs.top(); if (!box) return;
  if (e.key === 'Escape') {
    if (box.closest('#ask-wrap')) return;
    const out = box.querySelector('[data-esc]:not(:disabled)')
      || (box.classList.contains('panel') ? box.querySelector('.panel-header .back-btn') : null);
    if (out) { e.preventDefault(); out.click(); }
    return;
  }
  const f = [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.getClientRects().length);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey ? i <= 0 : (i < 0 || i === f.length - 1)) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
});

// A failure with nowhere of its own to sit. next: what to do about it.
function tellFailed(title, e, next) {
  console.error(title, e);
  if (e && e.code === 'permission-denied') return Ask.tell(title, 'This sign-in is not allowed to do that.');
  const why = whyFailed(e);
  return Ask.tell(title, `${why[0].toUpperCase()}${why.slice(1)}. ${next || 'Try again.'}`);
}
// A button at work: says what it is doing and can't be pressed again. Returns what puts
// it back (the list may have redrawn it meanwhile, which is the same thing).
function busyBtn(btn, label) {
  if (!btn) return () => {};
  const was = btn.innerHTML, w = btn.offsetWidth;
  btn.disabled = true;
  if (w) btn.style.minWidth = `${w}px`;
  btn.innerHTML = `<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> ${esc(label)}`;
  return () => { btn.disabled = false; btn.style.minWidth = ''; btn.innerHTML = was; };
}
// Why a write didn't go through, in words for whoever is holding the device.
function whyFailed(e) {
  const code = (e && e.code) || '', msg = (e && e.message) || '';
  if (navigator.onLine === false || /unavailable|deadline-exceeded/.test(code) || /offline/i.test(msg)) return 'the connection dropped';
  if (/permission-denied/.test(code)) return 'this sign-in is not allowed to';
  if (code === 'delivery-changed') return 'the manager changed this delivery';
  if (msg === 'INSUFFICIENT_STOCK') return 'there is not enough in stock';
  if (msg === 'Stock record not found') return 'this item is not tracked yet';
  if (msg === 'GHOST_EXISTS') return 'an item with that name was just made';
  return 'the database refused it';
}
// "Nothing was saved" can only be promised when the server answered: a dropped connection
// may have lost the reply, not the write. (Trying again is safe either way.)
function nothingDone(e, words) { return whyFailed(e) === 'the connection dropped' ? '' : ` ${words}`; }
// A refused field: red until it is typed in again, shaken once, focused and selected.
function refuseField(el) {
  if (!el) return;
  el.classList.add('field-bad'); el.setAttribute('aria-invalid', 'true');
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  el.addEventListener('input', () => { el.classList.remove('field-bad'); el.removeAttribute('aria-invalid'); }, { once: true });
  try { el.focus(); el.select(); } catch {}
}
// A failure stays on screen beside the button that failed. Empty clears it.
function inlineError(id, msg) {
  const el = document.getElementById(id); if (!el) return;
  el.textContent = msg || ''; el.hidden = !msg;
}
// The same id for the same content until it is done, so a write that went through
// but whose reply was lost can be tried again without counting twice.
const OpId = {
  _open: {},
  fresh() { return `OP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; },
  for(key, payload) {
    const sig = JSON.stringify(payload), cur = this._open[key];
    if (cur && cur.sig === sig) return cur.id;
    return (this._open[key] = { sig, id: this.fresh() }).id;
  },
  done(key) { delete this._open[key]; },
};

// Apply all template placeholders to a string (works for both subject and body)
function genRef() {
  const d=new Date();
  return `ORD-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*900+100)}`;
}
// Groups items across orders that were part of the same real email send into one
// "delivery" — never displayed, so uniqueness matters more than readability.
function genDeliveryId() {
  return `DLV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}
// When a recorded stocktake count was made: on the device that made it (countedAt, which
// a count that waited offline keeps), or for older counts, when the server got it.
function countedWhen(rec) { return rec ? (rec.countedAt || rec.updatedAt || null) : null; }
// A Firestore time (or a Date) that falls on today, on this device's clock.
function isToday(ts) {
  const d = ts && ts.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  return !!d && d.toDateString() === new Date().toDateString();
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
