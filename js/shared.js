// shared.js — data, settings, order state (no pricing)

const DEFAULT_MATERIALS = [
  { id:1,  category:'Stainless Steel', subcategory:'Hollow Section', partCode:'SL0300', description:'100 x 50 x 3mm x 6m Box Section 316 S/S',  qtyType:'Length' },
  { id:2,  category:'Stainless Steel', subcategory:'Hollow Section', partCode:'SL0301', description:'50 x 50 x 3mm x 6m Box Section 316 S/S',    qtyType:'Length' },
  { id:3,  category:'Stainless Steel', subcategory:'Hollow Section', partCode:'SL0302', description:'75 x 75 x 3mm x 6m Box Section 316 S/S',    qtyType:'Length' },
  { id:4,  category:'Stainless Steel', subcategory:'Round Bar',      partCode:'SL0400', description:'20mm Diameter x 6m Round Bar 316 S/S',       qtyType:'Length' },
  { id:5,  category:'Stainless Steel', subcategory:'Round Bar',      partCode:'SL0401', description:'25mm Diameter x 6m Round Bar 316 S/S',       qtyType:'Length' },
  { id:6,  category:'Stainless Steel', subcategory:'Angle Bar',      partCode:'SL0500', description:'50 x 50 x 5mm x 6m Angle Bar 316 S/S',      qtyType:'Length' },
  { id:7,  category:'Stainless Steel', subcategory:'Angle Bar',      partCode:'SL0501', description:'65 x 65 x 6mm x 6m Angle Bar 316 S/S',      qtyType:'Length' },
  { id:8,  category:'Stainless Steel', subcategory:'Channel',        partCode:'SL0600', description:'100 x 50 x 5mm x 6m Channel 316 S/S',       qtyType:'Length' },
  { id:9,  category:'Aluminium',       subcategory:'Hollow Section', partCode:'AL0300', description:'100 x 50 x 3mm x 6m Box Section 6061-T6',    qtyType:'Length' },
  { id:10, category:'Aluminium',       subcategory:'Hollow Section', partCode:'AL0301', description:'50 x 50 x 3mm x 6m Box Section 6061-T6',     qtyType:'Length' },
  { id:11, category:'Aluminium',       subcategory:'Round Bar',      partCode:'AL0400', description:'20mm Diameter x 6m Round Bar 6061-T6',        qtyType:'Length' },
  { id:12, category:'Aluminium',       subcategory:'Angle Bar',      partCode:'AL0500', description:'50 x 50 x 5mm x 6m Angle Bar 6061-T6',       qtyType:'Length' },
  { id:13, category:'Aluminium',       subcategory:'Channel',        partCode:'AL0600', description:'100 x 50 x 5mm x 6m Channel 6061-T6',        qtyType:'Length' },
];

const DEFAULT_SETTINGS = {
  supplierEmail: 'procurement@supplier.com',
  ccEmail:       'orders@yourcompany.com',
  senderName:    'Procurement Team',
  deliveryNote:  'Please confirm availability and expected delivery date.',
};

const CAT_ICONS = {
  'Stainless Steel': { icon:'ti-atom-2',  bg:'#dbeafe', color:'#1d4ed8' },
  'Aluminium':       { icon:'ti-diamond', bg:'#f0fdf4', color:'#15803d' },
  'default':         { icon:'ti-package', bg:'#f3f4f6', color:'#6b7280' },
};

// ── SETTINGS ──
const Settings = {
  get() {
    try { const s = localStorage.getItem('mo_settings'); return s ? {...DEFAULT_SETTINGS,...JSON.parse(s)} : {...DEFAULT_SETTINGS}; }
    catch { return {...DEFAULT_SETTINGS}; }
  },
  save(obj) {
    const m = {...this.get(),...obj};
    localStorage.setItem('mo_settings', JSON.stringify(m));
    return m;
  },
};

// ── MATERIALS — loaded from CSV on GitHub, fallback to defaults ──
const Data = {
  _cache: null,

  // Called once on startup — fetches CSV from same origin
  async load(csvUrl) {
    try {
      const res = await fetch(csvUrl + '?v=' + Date.now());
      if (!res.ok) throw new Error('fetch failed');
      const text = await res.text();
      const parsed = this._parseCsv(text);
      if (parsed.length) {
        this._cache = parsed;
        localStorage.setItem('mo_materials_cache', JSON.stringify(parsed));
        return parsed;
      }
    } catch (e) {
      console.warn('CSV fetch failed, using cache/defaults:', e);
    }
    // fallback: localStorage cache, then built-in defaults
    try {
      const c = localStorage.getItem('mo_materials_cache');
      if (c) { this._cache = JSON.parse(c); return this._cache; }
    } catch {}
    this._cache = [...DEFAULT_MATERIALS];
    return this._cache;
  },

  get() { return this._cache || [...DEFAULT_MATERIALS]; },

  _parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    // Parse header — find column indices case-insensitively
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g,'_'));
    const idx = h => headers.indexOf(h);
    const iCode = idx('part_code'), iDesc = idx('description'),
          iCat  = idx('category'),  iSub  = idx('subcategory'), iQty = idx('quantity_type');

    return lines.slice(1).map((line, i) => {
      // Handle quoted fields
      const cols = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) || line.split(',');
      const col = n => (cols[n] || '').replace(/^"|"$/g,'').trim();
      return {
        id: i + 1,
        partCode:    col(iCode) || '',
        description: col(iDesc) || '',
        category:    col(iCat)  || 'Uncategorised',
        subcategory: col(iSub)  || 'General',
        qtyType:     col(iQty)  || 'Each',
      };
    }).filter(m => m.partCode || m.description);
  },

  categories(list) {
    return [...new Set((list || this.get()).map(m => m.category))];
  },
  subcategories(list, category) {
    return [...new Set((list || this.get()).filter(m => m.category === category).map(m => m.subcategory))];
  },
};

// ── ORDER STATE ──
const Order = {
  _items: {},
  get(id)      { return this._items[id] || 0; },
  set(id, qty) { if (qty <= 0) delete this._items[id]; else this._items[id] = qty; },
  adjust(id,d) { this.set(id, (this._items[id] || 0) + d); },
  remove(id)   { delete this._items[id]; },
  clear()      { this._items = {}; },
  count()      { return Object.keys(this._items).length; },
  isEmpty()    { return this.count() === 0; },
  items(mats)  {
    return Object.keys(this._items).map(id => {
      const m = mats.find(x => x.id == id); if (!m) return null;
      return {...m, qty: this._items[id]};
    }).filter(Boolean);
  },
};

// ── FIREBASE CONFIG ──
const FirebaseConfig = {
  key: 'mo_firebase_config',
  get()      { try { const s=localStorage.getItem(this.key); return s?JSON.parse(s):null; } catch { return null; } },
  save(cfg)  { localStorage.setItem(this.key, JSON.stringify(cfg)); },
  clear()    { localStorage.removeItem(this.key); },
};

// ── UTILITIES ──
function esc(str) {
  return String(str||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function genRef() {
  const d = new Date();
  return `ORD-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*900+100)}`;
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleString('en-AU', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
}
function buildEmailBody(orderRef, items) {
  const s = Settings.get();
  const date = new Date().toLocaleDateString('en-AU', {day:'2-digit',month:'long',year:'numeric'});
  const line = '─'.repeat(52);
  let body = `Order Reference: ${orderRef}\nDate: ${date}\n\n${line}\nMATERIAL ORDER\n${line}\n\n`;
  items.forEach(i => {
    body += `${i.partCode} - ${i.description}\n  Qty: ${i.qty} ${i.qtyType||''}\n\n`;
  });
  body += `${line}\n${s.deliveryNote}`;
  return body;
}
