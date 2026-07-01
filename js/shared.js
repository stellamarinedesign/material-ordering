// shared.js — v0.37.2

const APP_VERSION = 'v0.37.2';

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
  naturalSort:          true,   // numeric-aware sort order, e.g. 8mm before 10mm
  unitAwareSearch:      true,   // "1 inch" matches "25.4mm" etc. — exact value match, no rounding
  fuzzySearch:          true,   // typo-tolerant text matching, exact matches always rank first
};

const CAT_ICONS = {
  'Stainless Steel': { icon:'ti-atom-2',  bg:'#dbeafe', color:'#1d4ed8' },
  'Aluminium':       { icon:'ti-diamond', bg:'#f0fdf4', color:'#15803d' },
  // Consumable categories
  'Fasteners':       { icon:'ti-bolt',    bg:'#fef9c3', color:'#a16207' },
  'Abrasives':       { icon:'ti-ripple',  bg:'#fce7f3', color:'#9d174d' },
  'Welding':         { icon:'ti-flame',   bg:'#fff7ed', color:'#c2410c' },
  'Safety':          { icon:'ti-shield-check', bg:'#f0fdf4', color:'#166534' },
  'Chemicals':       { icon:'ti-flask',   bg:'#faf5ff', color:'#7e22ce' },
  'default':         { icon:'ti-package', bg:'#f3f4f6', color:'#6b7280' },
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
//   1. Natural sort      — "10mm" sorts after "8mm", not before (default list order)
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
// numbers numerically rather than character-by-character. Handles
// decimals (7.5) but not fractions — fraction handling lives in the
// unit-aware layer below, since "1 1/2" as a sort key isn't well-defined
// without knowing it's a measurement.
function naturalSortChunks(str) {
  return String(str||'').toLowerCase().match(/\d+\.?\d*|\D+/g) || [];
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

function extractMeasurements(str) {
  const s = String(str||'').toLowerCase();
  const results = [];

  // Fractional/mixed inches: "1 1/2"", "1/2 inch", "3/8in", etc.
  // Mixed: optional whole number, optional fraction, then an inch unit.
  // Note: \b doesn't work reliably after a quote character (" isn't a word
  // character), so the unit alternation uses an explicit lookahead instead —
  // (?![a-z]) for the word-based units (in/inch/inches) to avoid matching
  // inside a longer word, and nothing extra needed after the quote symbols.
  const inchUnit = `(?:"|''|in\\.?(?![a-z])|inch(?:es)?(?![a-z]))`;
  const inchRe = new RegExp(
    `(\\d+\\s+)?(\\d+)\\s*\\/\\s*(\\d+)\\s*${inchUnit}|(\\d+(?:\\.\\d+)?)\\s*${inchUnit}`, 'g'
  );
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
    try { const c = localStorage.getItem('mo_cons_cache'); if (c) { this._consumablesList = JSON.parse(c); return JSON.parse(c); } } catch {}
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
  _key: 'mo_firebase_config',
  get()     { try { const s=localStorage.getItem(this._key); return s?JSON.parse(s):null; } catch { return null; } },
  save(cfg) { localStorage.setItem(this._key, JSON.stringify(cfg)); },
  clear()   { localStorage.removeItem(this._key); },
};

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
    return `${codePart}${i.description}${boxSuffix(i)}\r\n  Qty: ${i.qty} ${i.qtyType||''}`;
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
      return `  ${codePart}${i.description}${boxSuffix(i)}\r\n    Qty: ${i.qty} ${i.qtyType||''}`;
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
