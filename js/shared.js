// shared.js — data, settings, cart (used by both pages)

// ── DEFAULT DATA ──
const DEFAULT_MATERIALS = [
  { id:1,  cat:'steel',    name:'RHS 100×50×5 Steel Tube',  unit:'6m length',    price:89.50  },
  { id:2,  cat:'steel',    name:'UC 203×203×46 Column',      unit:'metre',        price:42.00  },
  { id:3,  cat:'steel',    name:'Flat Bar 50×6mm',           unit:'6m length',    price:28.00  },
  { id:4,  cat:'steel',    name:'Angle Iron 65×65×6mm',      unit:'6m length',    price:34.00  },
  { id:5,  cat:'timber',   name:'F17 LVL Beam 200×45mm',    unit:'5.4m length',  price:67.00  },
  { id:6,  cat:'timber',   name:'90×45mm MGP10 Pine',        unit:'3.6m length',  price:14.50  },
  { id:7,  cat:'timber',   name:'Plywood 2400×1200 F14',    unit:'17mm sheet',   price:88.00  },
  { id:8,  cat:'concrete', name:'Ready Mix Concrete',        unit:'m³',           price:195.00 },
  { id:9,  cat:'concrete', name:'N12 Rebar 6m',              unit:'bar',          price:18.50  },
  { id:10, cat:'concrete', name:'SL82 Mesh Sheet',           unit:'6×2.4m sheet', price:145.00 },
  { id:11, cat:'fixings',  name:'M12×75mm Hex Bolt',         unit:'box of 50',    price:38.00  },
  { id:12, cat:'fixings',  name:'Dynabolt M10×100mm',        unit:'box of 20',    price:52.00  },
  { id:13, cat:'fixings',  name:'Tek Screws 14G×50mm',       unit:'box of 100',   price:22.00  },
  { id:14, cat:'fixings',  name:'Joist Hanger LUS210',       unit:'each',         price:8.50   },
];

const DEFAULT_SETTINGS = {
  supplierEmail: 'procurement@supplier.com',
  ccEmail: 'orders@yourcompany.com',
  companyName: 'Your Company',
  senderName: 'Procurement Team',
  deliveryNote: 'All materials to be delivered to the job site address on file.',
  gstRate: 10,
};

const CAT_COLORS = {
  steel:    { bg:'#dbeafe', icon:'#1d4ed8' },
  timber:   { bg:'#dcfce7', icon:'#15803d' },
  concrete: { bg:'#f1f5f9', icon:'#475569' },
  fixings:  { bg:'#fef3c7', icon:'#b45309' },
  other:    { bg:'#f3f4f6', icon:'#6b7280' },
};
const CAT_ICONS = {
  steel:'ti-box', timber:'ti-trees', concrete:'ti-cylinder', fixings:'ti-screw', other:'ti-package',
};
const ALL_CATS = ['steel','timber','concrete','fixings','other'];

// ── SETTINGS ──
const Settings = {
  get() {
    try { const s=localStorage.getItem('mo_settings'); return s?{...DEFAULT_SETTINGS,...JSON.parse(s)}:{...DEFAULT_SETTINGS}; }
    catch { return {...DEFAULT_SETTINGS}; }
  },
  save(obj) {
    const m={...this.get(),...obj};
    localStorage.setItem('mo_settings',JSON.stringify(m));
    return m;
  },
};

// ── LOCAL MATERIALS ──
const Data = {
  get() {
    try { const s=localStorage.getItem('mo_materials'); return s?JSON.parse(s):[...DEFAULT_MATERIALS]; }
    catch { return [...DEFAULT_MATERIALS]; }
  },
  save(list) { localStorage.setItem('mo_materials',JSON.stringify(list)); },
  reset() { localStorage.removeItem('mo_materials'); return [...DEFAULT_MATERIALS]; },
  nextId(list) { return list.length>0?Math.max(...list.map(m=>m.id))+1:1; },
  categories(list) {
    const cats=[...new Set((list||this.get()).map(m=>m.cat))];
    return [{ id:'all', label:'All' }, ...cats.map(c=>({ id:c, label:c.charAt(0).toUpperCase()+c.slice(1) }))];
  },
};

// ── CART ──
const Cart = {
  _items:{},
  get(id) { return this._items[id]||0; },
  set(id,qty) { if(qty<=0) delete this._items[id]; else this._items[id]=qty; },
  adjust(id,d) { this.set(id,(this._items[id]||0)+d); },
  remove(id) { delete this._items[id]; },
  clear() { this._items={}; },
  count() { return Object.keys(this._items).length; },
  isEmpty() { return this.count()===0; },
  items(mats) {
    return Object.keys(this._items).map(id=>{
      const m=mats.find(x=>x.id==id); if(!m) return null;
      const qty=this._items[id];
      return {...m,qty,subtotal:m.price*qty};
    }).filter(Boolean);
  },
  totals(mats) {
    const items=this.items(mats);
    const sub=items.reduce((s,i)=>s+i.subtotal,0);
    const gst=sub*(Settings.get().gstRate/100);
    return {sub,gst,total:sub+gst,count:items.length};
  },
};

// ── FIREBASE CONFIG (saved in localStorage) ──
const FirebaseConfig = {
  key: 'mo_firebase_config',
  get() {
    try { const s=localStorage.getItem(this.key); return s?JSON.parse(s):null; }
    catch { return null; }
  },
  save(cfg) { localStorage.setItem(this.key,JSON.stringify(cfg)); },
  clear() { localStorage.removeItem(this.key); },
};

// ── UTILITIES ──
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function genRef() {
  const d=new Date();
  return `ORD-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*900+100)}`;
}

function fmtTime(ts) {
  if(!ts) return '';
  const d=new Date(ts);
  return d.toLocaleString('en-AU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
}
