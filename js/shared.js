// shared.js — v17

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
  supplierEmail:  'procurement@supplier.com',
  ccEmail:        'orders@yourcompany.com',
  deliveryNote:   'Please confirm availability and expected delivery date.',
  emailSubject:   'Material Order - {category}',
  // Placeholders: {date} {category} {items} {closingNote}
  // Note: {orderRefs} removed from default — orders are now per-category
  emailTemplate:  '{date}\r\n\r\n────────────────────────────────────────────────────\r\nMATERIAL ORDER - {category}\r\n────────────────────────────────────────────────────\r\n\r\n{items}\r\n────────────────────────────────────────────────────\r\n{closingNote}',
};

const CAT_ICONS = {
  'Stainless Steel': { icon:'ti-atom-2',  bg:'#dbeafe', color:'#1d4ed8' },
  'Aluminium':       { icon:'ti-diamond', bg:'#f0fdf4', color:'#15803d' },
  'default':         { icon:'ti-package', bg:'#f3f4f6', color:'#6b7280' },
};

// ── DEVICE NAME ──
const DeviceName = {
  _key: 'mo_device_name',
  get()      { return localStorage.getItem(this._key) || ''; },
  save(name) { localStorage.setItem(this._key, name.trim()); },
  isSet()    { return !!this.get(); },
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

// ── DATA ──
const Data = {
  _list: null,
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
    if (iCode < 0 || iDesc < 0) { console.error('[CSV] Missing required columns. Got:', headers); return []; }
    return lines.slice(1).map((line, i) => {
      const cols = this._splitLine(line);
      const get  = idx => (idx >= 0 && idx < cols.length) ? cols[idx].trim() : '';
      const code = get(iCode), desc = get(iDesc);
      if (!code && !desc) return null;
      return { id:i+1, partCode:code, description:desc, category:get(iCat)||'Uncategorised', subcategory:get(iSub)||'General', qtyType:get(iQty)||'Each' };
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
    return (list||this.get()).map(m=>m.category).filter(c=>{ if(seen.has(c)) return false; seen.add(c); return true; });
  },
  subcategories(list, category) {
    const seen = new Set();
    return (list||this.get()).filter(m=>m.category===category).map(m=>m.subcategory)
      .filter(s=>{ if(seen.has(s)) return false; seen.add(s); return true; });
  },
  filter(list, category, subcategory, query) {
    let out = list||this.get();
    if (category)    out = out.filter(m=>m.category===category);
    if (subcategory) out = out.filter(m=>m.subcategory===subcategory);
    if (query) { const q=query.toLowerCase(); out=out.filter(m=>m.description.toLowerCase().includes(q)||m.partCode.toLowerCase().includes(q)); }
    return out;
  },
};

// ── ORDER STATE ──
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

// ── FIREBASE CONFIG ──
const FirebaseConfig = {
  _key: 'mo_firebase_config',
  get()     { try { const s=localStorage.getItem(this._key); return s?JSON.parse(s):null; } catch { return null; } },
  save(cfg) { localStorage.setItem(this._key, JSON.stringify(cfg)); },
  clear()   { localStorage.removeItem(this._key); },
};

// ── UTILITIES ──
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function genRef() {
  const d=new Date();
  return `ORD-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*900+100)}`;
}
function fmtTime(ts) {
  if (!ts) return '';
  const d=ts instanceof Date?ts:new Date(ts);
  return d.toLocaleString('en-AU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
}

// ── BUILD EMAIL FOR A SINGLE CATEGORY ──
function buildCategoryEmail(items, category) {
  const s       = Settings.get();
  const date    = new Date().toLocaleDateString('en-AU',{day:'2-digit',month:'long',year:'numeric'});
  const itemsStr= items.map(i=>`${i.partCode} - ${i.description}\r\n  Qty: ${i.qty} ${i.qtyType||''}`).join('\r\n\r\n');
  const subjectTpl = s.emailSubject || DEFAULT_SETTINGS.emailSubject;
  const subject    = subjectTpl.replace('{category}', category);
  const tpl  = s.emailTemplate || DEFAULT_SETTINGS.emailTemplate;
  const body = tpl
    .replace('{date}',       `Date: ${date}`)
    .replace('{category}',   category)
    .replace('{orderRefs}',  '') // kept for backwards compat if someone has old template
    .replace('{items}',      itemsStr)
    .replace('{closingNote}',s.deliveryNote);
  return { subject, body };
}

// ── GROUP ITEMS BY CATEGORY across orders, tracking device per item ──
// Returns { category: { items: [{...item, deviceName, orderId}] } }
function groupByCategory(orders) {
  const groups = {};
  for (const order of orders) {
    for (const item of (order.items||[])) {
      // Skip items that have already been emailed
      if (item.emailed) continue;
      const cat = item.category || 'Uncategorised';
      if (!groups[cat]) groups[cat] = { items: [] };
      // Check if this partCode already exists in the group (combining quantities)
      const existing = groups[cat].items.find(x => x.partCode === item.partCode);
      if (existing) {
        existing.qty += item.qty;
        // Track multiple device names if different
        if (item.deviceName && !existing.deviceNames.includes(item.deviceName)) {
          existing.deviceNames.push(item.deviceName);
        }
      } else {
        groups[cat].items.push({
          ...item,
          deviceName:  order.deviceName || '',
          deviceNames: order.deviceName ? [order.deviceName] : [],
          orderId:     order._id,
        });
      }
    }
  }
  return groups;
}

// ── OUTLOOK-COMPATIBLE MAILTO ──
// Opens email via a hidden anchor click — more reliable than window.location.href for Outlook Classic
function openMailto(to, cc, subject, body) {
  const mailto = 'mailto:' + to
    + '?cc='      + encodeURIComponent(cc)
    + '&subject=' + encodeURIComponent(subject)
    + '&body='    + encodeURIComponent(body);
  const a = document.createElement('a');
  a.href = mailto;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 1000);
}
