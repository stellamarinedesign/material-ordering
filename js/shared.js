// shared.js

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
  supplierEmail: 'procurement@supplier.com',
  ccEmail:       'orders@yourcompany.com',
  senderName:    'Procurement Team',
  deliveryNote:  'Please confirm availability and expected delivery date.',
};

// Icon mapping — falls back to 'default' for any unknown category
const CAT_ICONS = {
  'Stainless Steel': { icon:'ti-atom-2',  bg:'#dbeafe', color:'#1d4ed8' },
  'Aluminium':       { icon:'ti-diamond', bg:'#f0fdf4', color:'#15803d' },
  'default':         { icon:'ti-package', bg:'#f3f4f6', color:'#6b7280' },
};

// ── SETTINGS ──
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

// ── DATA — loads from materials.csv, falls back to cache then defaults ──
const Data = {
  _list: null,

  async load(csvUrl) {
    try {
      const res = await fetch(csvUrl + '?v=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const parsed = this._parseCsv(text);
      if (parsed.length) {
        this._list = parsed;
        try { localStorage.setItem('mo_mat_cache', JSON.stringify(parsed)); } catch {}
        return parsed;
      }
    } catch (e) {
      console.warn('CSV load failed, using cache/defaults:', e.message);
    }
    // fallback to localStorage cache
    try {
      const c = localStorage.getItem('mo_mat_cache');
      if (c) { this._list = JSON.parse(c); return this._list; }
    } catch {}
    // final fallback
    this._list = [...DEFAULT_MATERIALS];
    return this._list;
  },

  get() { return this._list || [...DEFAULT_MATERIALS]; },

  _parseCsv(text) {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const col = (row, name) => {
      const i = headers.indexOf(name);
      if (i < 0) return '';
      return (row[i] || '').replace(/^"|"$/g, '').trim();
    };
    return lines.slice(1).map((line, i) => {
      // simple CSV split (handles basic quoted fields)
      const row = line.match(/("(?:[^"]|"")*"|[^,]*)/g)
                      .map(v => v.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
      const partCode    = col(row, 'part_code');
      const description = col(row, 'description');
      if (!partCode && !description) return null;
      return {
        id:          i + 1,
        partCode:    partCode,
        description: description,
        category:    col(row, 'category')      || 'Uncategorised',
        subcategory: col(row, 'subcategory')   || 'General',
        qtyType:     col(row, 'quantity_type') || 'Each',
      };
    }).filter(Boolean);
  },

  // ── Dynamic category/subcategory helpers (derived from live list) ──

  // Returns array of unique category strings in the order they appear
  categories(list) {
    const seen = new Set();
    return (list || this.get())
      .map(m => m.category)
      .filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });
  },

  // Returns subcategories for a given category
  subcategories(list, category) {
    const seen = new Set();
    return (list || this.get())
      .filter(m => m.category === category)
      .map(m => m.subcategory)
      .filter(s => { if (seen.has(s)) return false; seen.add(s); return true; });
  },

  // Filter list by category and optional subcategory
  filter(list, category, subcategory, query) {
    let out = list || this.get();
    if (category)    out = out.filter(m => m.category === category);
    if (subcategory) out = out.filter(m => m.subcategory === subcategory);
    if (query) {
      const q = query.toLowerCase();
      out = out.filter(m =>
        m.description.toLowerCase().includes(q) ||
        m.partCode.toLowerCase().includes(q)
      );
    }
    return out;
  },
};

// ── ORDER STATE ──
const Order = {
  _items: {},
  get(id)       { return this._items[id] || 0; },
  set(id, qty)  { if (qty <= 0) delete this._items[id]; else this._items[id] = qty; },
  adjust(id, d) { this.set(id, (this._items[id] || 0) + d); },
  remove(id)    { delete this._items[id]; },
  clear()       { this._items = {}; },
  count()       { return Object.keys(this._items).length; },
  isEmpty()     { return this.count() === 0; },
  items(mats)   {
    return Object.keys(this._items)
      .map(id => { const m = mats.find(x => x.id == id); return m ? { ...m, qty: this._items[id] } : null; })
      .filter(Boolean);
  },
};

// ── FIREBASE CONFIG ──
const FirebaseConfig = {
  _key: 'mo_firebase_config',
  get()     { try { const s = localStorage.getItem(this._key); return s ? JSON.parse(s) : null; } catch { return null; } },
  save(cfg) { localStorage.setItem(this._key, JSON.stringify(cfg)); },
  clear()   { localStorage.removeItem(this._key); },
};

// ── UTILITIES ──
function esc(str) {
  return String(str || '')
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
  return d.toLocaleString('en-AU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
function buildEmailBody(orderRef, items) {
  const s    = Settings.get();
  const date = new Date().toLocaleDateString('en-AU', { day:'2-digit', month:'long', year:'numeric' });
  const line = '─'.repeat(52);
  let body   = `Order Reference: ${orderRef}\nDate: ${date}\n\n${line}\nMATERIAL ORDER\n${line}\n\n`;
  items.forEach(i => {
    body += `${i.partCode} - ${i.description}\n  Qty: ${i.qty} ${i.qtyType || ''}\n\n`;
  });
  body += `${line}\n${s.deliveryNote}`;
  return body;
}
