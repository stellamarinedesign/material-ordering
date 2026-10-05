// catalogue.js — v2026-10-06.1
//
// Manager page only: the materials catalogue (Settings → Materials catalogue).
// The list every page orders from lives in the database (meta/catalogMaterials,
// see firebase-sync.js) instead of materials.csv, and is looked after here:
//
//   MATERIALS  search, edit, retire and restore the materials in the list
//   IMPORT     upload the production board's part-list workbook; everything it
//              would change is laid out for review before anything is saved
//   ADD        pick a part from the uploaded list, or type a material in by
//              hand — category, type and unit are guessed from the description
//
// DESCRIPTIONS. A material shows the part list's wording exactly as it came
// (`erpDesc`), unless the manager has typed their own over it (`desc`). When an
// upload brings different list wording for a material, nothing changes
// silently: the review shows it and the manager picks Replace (take the new
// wording), Ignore (keep showing what's shown) or Edit (type something else).
//
// IDS are permanent. Rows moved over from materials.csv keep the row number
// they always had — so a half-built order on an iPad still points at the same
// materials through the switch — and new rows take `nextId`, which only goes up.
//
// NOTHING IS DELETED. A material that's no longer wanted is retired: hidden
// from ordering and stocktake, still here, restorable.
//
// Item shape:  { id, code, erpDesc, desc?, listed?, category, subcategory, qtyType, retired? }
//   listed  — erpDesc came from the part list (otherwise it was typed by hand)
//   code    — a material with no part code yet carries a placeholder "SCM<id>",
//             which the rest of the app already treats as "no code" (SC prefix)
//
// The first half of this file is pure logic (no DOM, no Firebase).
const Catalogue = {

  // ══════════════════════════════════════════
  // DESCRIPTION → CATEGORY / TYPE / UNIT
  // First rule that matches wins, so the order matters (duplex before the
  // stainless grades, "Angle Bar" before the catch-all bar rule).
  // ══════════════════════════════════════════
  CATEGORY_RULES: [
    ['2205 Duplex',     /duplex|(^|\D)2205(\D|$)/i],
    ['4140 Steel',      /(^|\D)4140(\D|$)/],
    ['3D Filament',     /filament/i],
    ['Thrust Washer',   /phenolic/i],
    ['Acetal',          /acetal/i],
    ['Teflon',          /teflon|ptfe/i],
    ['Bronze',          /bronze|\bLG2\b/i],
    ['Brass',           /brass/i],
    ['Aluminium',       /alumin|\bali\b|(^|\D)(5083|5052|5005|606\d|6082|6005)(\D|$)/i],
    ['Stainless Steel', /stainless|s\/s|(^|\D)(316|304)(\D|$)/i],
    ['Mild Steel',      /\bsteel\b|\bRHS\b|\bSHS\b/i],
  ],
  TYPE_RULES: [
    ['Box Section', /box section|\bbox\b|\bRHS\b|\bSHS\b/i],
    ['Hollow Bar',  /hollow bar/i],
    ['Hex Bar',     /hex(agon)? bar/i],
    ['Flat Bar',    /flat bar|square bar/i],
    ['Angle',       /\bangle\b/i],
    ['Channel',     /channel/i],
    ['Pipe',        /\bpipe\b/i],
    ['Tube',        /\btube\b/i],
    ['Plate',       /\bplate\b|\bsheet\b/i],
    ['Round Bar',   /\bbar\b|\brod\b/i],
  ],
  // The part list's stocking unit → how the workshop orders it. Only a fallback:
  // what the catalogue already uses for the same kind of material comes first.
  LIST_UNITS: { MTR:'Length', METER:'Length', METRE:'Length', LGTH6:'Length', SQM:'Each', EACH:'Each', GRAM:'Gram', KG:'Kg', LTR:'Litre', LITRE:'Litre', PACK:'Pack', BOX:'Box', SET:'Set' },

  // → { category, subcategory, qtyType, sure, strong }. Empty strings where
  // nothing matched. `sure`: both a material and a type were recognised.
  // `strong`: that, and it reads like stock — the description leads with a
  // size (or it's filament / phenolic). Used to shortlist a first upload.
  suggest(desc, listUnit, items) {
    const d = String(desc || '');
    const live = (items || []).filter(i => i && !i.retired);
    let category = '', subcategory = '';
    for (const [name, re] of this.CATEGORY_RULES) if (re.test(d)) { category = name; break; }
    if (category === '3D Filament') {
      const m = d.match(/\b(PETG|PEGT|PLA|ABS|ASA|TPU|PC|Nylon)\b/i);
      if (m) subcategory = /^pe[gt]{2}$/i.test(m[1]) ? 'PETG' : (/^nylon$/i.test(m[1]) ? 'Nylon' : m[1].toUpperCase());
    } else {
      for (const [name, re] of this.TYPE_RULES) if (re.test(d)) { subcategory = name; break; }
      if (subcategory === 'Plate') {
        // "Plate" or "Sheet" — whichever this category already files flat stock under
        const subs = new Set(live.filter(i => i.category === category).map(i => i.subcategory));
        if (subs.has('Sheet') !== subs.has('Plate')) subcategory = subs.has('Sheet') ? 'Sheet' : 'Plate';
        else if (!/\bplate\b/i.test(d)) subcategory = 'Sheet';
      }
    }
    const common = arr => {
      const n = new Map(); let best = '', top = 0;
      for (const i of arr) { const c = (n.get(i.qtyType) || 0) + 1; n.set(i.qtyType, c); if (c > top) { top = c; best = i.qtyType; } }
      return best;
    };
    const qtyType =
         (category && subcategory && common(live.filter(i => i.category === category && i.subcategory === subcategory)))
      || this.LIST_UNITS[String(listUnit || '').toUpperCase()]
      || (subcategory && common(live.filter(i => i.subcategory === subcategory)))
      || (category && common(live.filter(i => i.category === category)))
      || '';
    const sure = !!(category && subcategory);
    return { category, subcategory, qtyType, sure, strong: sure && (/^[\d¼½¾⅛⅜⅝⅞]/.test(d.trim()) || /filament|phenolic/i.test(d)) };
  },

  // ══════════════════════════════════════════
  // ITEMS
  // ══════════════════════════════════════════
  _real(code) { return !!code && !Data.isDummyCode(code); },
  _shown(it)  { return it.desc || it.erpDesc || ''; },
  // Wording is compared with runs of spaces collapsed: a doubled space is a
  // typo, not a different description, and is tidied to the list's spacing.
  _same(a, b) { return String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim(); },
  // A clean item: Firestore rejects undefined, and empty optional fields are
  // left off rather than stored.
  _mk(o) {
    const it = {
      id: o.id, code: String(o.code || '').trim(), erpDesc: String(o.erpDesc || '').trim(),
      category: String(o.category || '').trim() || 'Uncategorised',
      subcategory: String(o.subcategory || '').trim() || 'General',
      qtyType: String(o.qtyType || '').trim() || 'Each',
    };
    const desc = String(o.desc || '').trim();
    if (desc && desc !== it.erpDesc) it.desc = desc;
    if (o.listed)  it.listed = true;
    if (o.retired) it.retired = true;
    return it;
  },
  // The page-facing shape of one item (what Data.fromCatalog produces).
  _shape(it) {
    return { id: it.id, partCode: it.code || '', description: this._shown(it), category: it.category, subcategory: it.subcategory, qtyType: it.qtyType, boxSize: 0, boxUnit: 'Box' };
  },
  // New rows go in beside their own kind (after the last row of the same
  // category + type, else the same category) so pages that list materials in
  // catalogue order keep them grouped.
  _insert(items, it) {
    let at = -1;
    items.forEach((x, i) => { if (x.category === it.category && x.subcategory === it.subcategory) at = i; });
    if (at < 0) items.forEach((x, i) => { if (x.category === it.category) at = i; });
    if (at < 0) items.push(it); else items.splice(at + 1, 0, it);
  },
  _nextId(doc) { return Math.max(doc.nextId || 1, ...doc.items.map(i => (i.id || 0) + 1)); },

  // materials.csv rows → the first catalogue document. Same rows, same order,
  // same ids, same wording: moving the list changes nothing anyone can see.
  seed(list) {
    const items = list.map(m => this._mk({ id: m.id, code: m.partCode, erpDesc: m.description, category: m.category, subcategory: m.subcategory, qtyType: m.qtyType }));
    return { items, nextId: Math.max(0, ...items.map(i => i.id)) + 1, seededFrom: 'materials.csv', seededAt: Date.now() };
  },

  // ══════════════════════════════════════════
  // READING AN UPLOADED PART LIST
  // sheets: [{ name, rows: [[cell, …], …] }] → { parts:[{code,desc,unit,notes}], erpDate, downloaded, fileName }
  // Uses the "All Parts" sheet when there is one (the board's export), else
  // every sheet that has a code column and a description column.
  // ══════════════════════════════════════════
  parseRows(sheets, fileName) {
    const norm = v => String(v == null ? '' : v).trim();
    const find = (hdr, names) => { for (const n of names) { const i = hdr.indexOf(n); if (i >= 0) return i; } return -1; };
    const read = sheet => {
      for (let r = 0; r < Math.min(10, sheet.rows.length); r++) {
        const hdr = (sheet.rows[r] || []).map(c => norm(c).toLowerCase());
        const iCode = find(hdr, ['inventory id', 'part code', 'partcode', 'part_code', 'code']);
        const iDesc = find(hdr, ['description', 'desc']);
        if (iCode < 0 || iDesc < 0) continue;
        const iUnit = find(hdr, ['base unit', 'unit', 'uom']), iNote = find(hdr, ['notes', 'note']);
        const out = [];
        for (const row of sheet.rows.slice(r + 1)) {
          const code = norm(row && row[iCode]), desc = norm(row && row[iDesc]);
          if (!code || !desc) continue;
          out.push({ code, desc, unit: iUnit >= 0 ? norm(row[iUnit]) : '', notes: iNote >= 0 ? norm(row[iNote]) : '' });
        }
        return out;
      }
      return null;
    };
    const all = sheets.find(s => /^all parts$/i.test(norm(s.name)));
    let parts = all ? read(all) : null;
    if (!parts) { parts = []; for (const s of sheets) { const p = read(s); if (p) parts.push(...p); } }
    const seen = new Set();
    parts = parts.filter(p => { const k = p.code.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!parts.length) throw new Error('No part list found in that file. It needs a sheet with "Inventory ID" and "Description" columns.');
    let erpDate = '', downloaded = '';
    const about = sheets.find(s => /^about$/i.test(norm(s.name)));
    if (about) for (const row of about.rows) {
      const k = norm(row && row[0]).toLowerCase(), v = norm(row && row[1]);
      if (k.startsWith('erp data exported')) erpDate = v;
      else if (k === 'downloaded') downloaded = v;
    }
    return { parts, erpDate, downloaded, fileName: fileName || '' };
  },
  async readFile(file) {
    const buf = await file.arrayBuffer();
    if (/\.csv$/i.test(file.name)) {
      const rows = Data._decode(buf).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '').map(l => Data._splitLine(l));
      return this.parseRows([{ name: 'csv', rows }], file.name);
    }
    if (typeof XLSX === 'undefined') throw new Error('The spreadsheet reader did not load — refresh the page and try again.');
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const sheets = wb.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }) }));
    return this.parseRows(sheets, file.name);
  },

  // ══════════════════════════════════════════
  // WHAT AN UPLOAD WOULD CHANGE
  // baseline: Set of (upper-case) codes the previous upload already held, or
  // null on the very first upload — then only parts that read like raw
  // materials are offered, rather than the whole list.
  // ══════════════════════════════════════════
  diff(doc, parsed, baseline) {
    const byCode = new Map(parsed.parts.map(p => [p.code.toUpperCase(), p]));
    const changed = [], gone = [], added = [];
    let same = 0, coded = 0;
    for (const it of doc.items) {
      if (!this._real(it.code)) continue;                 // no part code — nothing to compare against
      const p = byCode.get(it.code.toUpperCase());
      if (!it.retired) coded++;
      if (!p) { if (!it.retired) gone.push({ id: it.id, item: it }); continue; }
      // Unchanged, or the list has caught up with the manager's own wording,
      // or the row is retired: settled quietly when the import is applied.
      if (this._same(p.desc, it.erpDesc) || this._same(p.desc, it.desc) || it.retired) { if (!it.retired) same++; continue; }
      changed.push({ id: it.id, item: it, from: it.erpDesc, to: p.desc, shown: this._shown(it), hasOverride: !!it.desc, notes: p.notes });
    }
    const have = new Set(doc.items.filter(i => i.code).map(i => i.code.toUpperCase()));
    for (const p of parsed.parts) {
      const k = p.code.toUpperCase();
      if (have.has(k)) continue;
      const s = this.suggest(p.desc, p.unit, doc.items);
      if (baseline ? !baseline.has(k) : s.strong) added.push({ part: p, suggest: s });
    }
    added.sort((a, b) => (b.suggest.sure - a.suggest.sure) || a.part.code.localeCompare(b.part.code));
    return { changed, gone, added, same, coded, first: !baseline, total: parsed.parts.length };
  },

  // The catalogue after an import. Runs inside the save transaction against the
  // catalogue as it is at that moment, so it works by id / code, not position.
  // dec: { changed: { [id]: { action:'replace'|'ignore'|'edit', text } },
  //        add:     [{ code, erpDesc, category, subcategory, qtyType }],
  //        retire:  [id, …] }
  applyImport(cur, parsed, dec) {
    if (!cur) return null;
    const byCode = new Map(parsed.parts.map(p => [p.code.toUpperCase(), p]));
    const retire = new Set(dec.retire || []);
    const items = cur.items.map(it => {
      const n = { ...it };
      if (retire.has(n.id)) n.retired = true;
      const p = this._real(n.code) ? byCode.get(n.code.toUpperCase()) : null;
      if (!p) return this._mk(n);
      if (this._same(p.desc, n.erpDesc)) { n.erpDesc = p.desc; n.listed = true; return this._mk(n); }
      const d = dec.changed && dec.changed[n.id];
      if (n.retired || this._same(n.desc, p.desc)) { n.erpDesc = p.desc; if (this._same(n.desc, p.desc)) n.desc = ''; n.listed = true; }
      else if (!d) { /* not in the review (the catalogue changed while it was open) — left for the next upload to ask about */ }
      else if (d.action === 'replace') { n.erpDesc = p.desc; n.desc = ''; n.listed = true; }
      else if (d.action === 'edit')    { n.desc = String(d.text || '').trim() || this._shown(n); n.erpDesc = p.desc; n.listed = true; }
      else                             { n.desc = this._shown(n); n.erpDesc = p.desc; n.listed = true; }   // ignore: keep what's shown
      return this._mk(n);
    });
    let nextId = this._nextId(cur);
    const have = new Set(items.filter(i => i.code).map(i => i.code.toUpperCase()));
    for (const a of dec.add || []) {
      const k = String(a.code).toUpperCase();
      if (have.has(k)) continue;
      have.add(k);
      this._insert(items, this._mk({ ...a, id: nextId++, listed: true }));
    }
    return {
      ...cur, items, nextId, hasUndo: 'import',
      listDate: parsed.erpDate || '', listFile: parsed.fileName || '', listCount: parsed.parts.length, listImportedAt: Date.now(),
    };
  },

  // Add (form.id == null) or edit one material. form: { id?, code, shown,
  // listDesc, category, subcategory, qtyType } — listDesc is the part list's
  // wording for form.code ('' when the code isn't on the list / there's no code).
  applyForm(cur, form) {
    if (!cur) return null;
    const items = cur.items.map(i => ({ ...i }));
    let nextId = this._nextId(cur);
    const adding = form.id == null;
    const it = adding ? { id: nextId++ } : items.find(i => i.id === form.id);
    if (!it) throw new Error('That material is no longer in the catalogue.');
    const code = String(form.code || '').trim() || `SCM${it.id}`;
    if (items.some(i => i.id !== it.id && i.code && i.code.toUpperCase() === code.toUpperCase()))
      throw new Error(`${code} is already in the catalogue.`);
    const shown = String(form.shown || '').trim();
    if (!shown) throw new Error('Give the material a description.');
    const listed = this._real(code) && !!form.listDesc;
    const next = this._mk({
      id: it.id, code, listed, retired: it.retired,
      erpDesc: listed ? form.listDesc : shown, desc: listed ? shown : '',
      category: form.category, subcategory: form.subcategory, qtyType: form.qtyType,
    });
    if (adding) this._insert(items, next); else items[items.indexOf(it)] = next;
    return { ...cur, items, nextId };
  },

  // Full backup. Opens in Excel (BOM), and materials.csv can be replaced with
  // it: Data._parseCsv reads the Id and Retired columns, so ids survive.
  toCsv(doc) {
    const q = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [['Id', 'Part Code', 'Description', 'List Description', 'Category', 'Subcategory', 'Quantity Type', 'Retired'].join(',')];
    for (const i of doc.items)
      lines.push([i.id, i.code, this._shown(i), i.listed ? i.erpDesc : '', i.category, i.subcategory, i.qtyType, i.retired ? 'yes' : ''].map(q).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  },

  // ══════════════════════════════════════════
  // SCREEN
  // ══════════════════════════════════════════
  doc: undefined,       // undefined = not heard from the database yet · null = still on materials.csv
  erp: undefined,       // meta/catalogErpParts — the last uploaded part list (undefined = not fetched)
  _erpMap: new Map(),   // CODE → { c, d, u, n }
  _erpShaped: [],       // the same parts in the shape Data.filter searches
  tab: 'materials', filter: 'all', query: '', addQuery: '',
  review: null,         // an upload being reviewed: { parsed, diff, dec, add, retire }
  _extra: { category: [], subcategory: [], qtyType: [] },   // "New…" names typed this session
  _host: null,
  csvUrl: './materials.csv',   // what the list is moved from

  mount(host) {
    this._host = host;
    const panel = document.getElementById('catalogue-panel'); if (!panel) return;
    panel.addEventListener('click',  e => this._onClick(e));
    panel.addEventListener('input',  e => this._onInput(e));
    panel.addEventListener('change', e => this._onChange(e));
  },
  isOpen() { return !!document.getElementById('catalogue-panel')?.classList.contains('open'); },
  open() {
    this._host.openPanel('catalogue-panel');
    this.render();
    this._loadErp();
  },
  close() {
    if (this.review && !confirm('Close without applying this import? Nothing has been changed yet.')) return;
    this.review = null;
    this._host.closePanel('catalogue-panel');
  },
  _by() { return (Settings.get().managerName || 'Manager').trim() || 'Manager'; },
  _toast(msg, warn) { this._host._toast(msg, warn); },
  _fail(e, what) {
    console.error('[Catalogue]', what, e);
    const denied = e && e.code === 'permission-denied';
    this._toast(denied ? `${what}: the database refused it — this account can't change the catalogue.` : `${what}: ${(e && e.message) || 'something went wrong'}`, true);
  },

  // Fed by the page's Data.watch — every change to the catalogue document.
  onDoc(doc) {
    this.doc = doc;
    const sub = document.getElementById('cat-settings-sub');
    if (sub) sub.textContent = this.summary();
    if (!this.isOpen()) return;
    if (this.review) return;          // the review works on its own snapshot; applying re-checks against the live document
    const restoreFocus = captureInputFocus();
    this.renderHead(); this.renderBody();
    restoreFocus();
  },
  summary() {
    if (this.doc === undefined) return 'Checking…';
    if (!this.doc) return 'Still read from materials.csv — open to move the list into the database';
    const n = this.doc.items.filter(i => !i.retired).length;
    return `${n} materials in the database${this.doc.listDate ? ` · part list dated ${this.doc.listDate}` : ''}`;
  },

  async _loadErp(force) {
    if (this.erp !== undefined && !force) return;
    let erp = null;
    try { erp = await DB.getErpParts(); } catch (e) { console.warn('[Catalogue] part list not readable:', e); }
    this._setErp(erp);
    if (this.isOpen() && !this.review) this.renderBody();
  },
  _setErp(erp) {
    this.erp = erp || null;
    const parts = (erp && erp.parts) || [];
    this._erpMap = new Map(parts.map(p => [String(p.c).toUpperCase(), p]));
    this._erpShaped = parts.map(p => ({ partCode: p.c, description: p.d, category: '', subcategory: '', _p: p }));
  },

  _vocab(field) {
    const seen = new Set(), out = [];
    const add = v => { if (v && !seen.has(v)) { seen.add(v); out.push(v); } };
    ((this.doc && this.doc.items) || []).forEach(i => add(i[field]));
    if (field === 'qtyType') ['Length', 'Metre', 'Each', 'Sheet', 'Gram'].forEach(add);
    this._extra[field].forEach(add);
    return out.sort((a, b) => a.localeCompare(b));
  },
  // A dropdown of the names already in use, plus "New…" (which asks for one).
  _pick(field, value, attrs) {
    const opts = this._vocab(field);
    if (value && !opts.includes(value)) opts.unshift(value);
    const label = { category: 'category', subcategory: 'type', qtyType: 'unit' }[field];
    return `<select class="cat-select" data-pick="${field}" ${attrs || ''}>
      <option value=""${value ? '' : ' selected'}>Choose ${label}…</option>
      ${opts.map(o => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('')}
      <option value="__new">New ${label}…</option>
    </select>`;
  },
  // Handles a "New…" choice on any of those dropdowns; returns the final value.
  _pickValue(sel) {
    if (sel.value !== '__new') return sel.value;
    const field = sel.dataset.pick;
    const label = { category: 'category', subcategory: 'type', qtyType: 'unit' }[field];
    const name = (prompt(`Name of the new ${label}:`) || '').trim();
    if (name && !this._vocab(field).includes(name)) this._extra[field].push(name);
    const keep = name || sel.dataset.prev || '';
    sel.outerHTML = this._pick(field, keep, [...sel.attributes].filter(a => a.name !== 'class' && a.name !== 'data-pick').map(a => `${a.name}="${esc(a.value)}"`).join(' '));
    return keep;
  },

  render() { this.renderHead(); this.renderBody(); },

  renderHead() {
    const el = document.getElementById('cat-head'); if (!el) return;
    if (!this.doc || this.review) { el.innerHTML = ''; return; }
    const items = this.doc.items;
    const tab = (k, label, icon) => `<div class="intake-filter-chip${this.tab === k ? ' active' : ''}" data-cat-tab="${k}"><i class="ti ${icon}"></i> ${label}</div>`;
    let extra = '';
    if (this.tab === 'materials') {
      const live = items.filter(i => !i.retired);
      const n = { all: live.length, edited: live.filter(i => i.desc).length, nocode: live.filter(i => !this._real(i.code)).length, retired: items.length - live.length };
      const chip = (k, label) => (k === 'all' || n[k]) ? `<div class="intake-filter-chip${this.filter === k ? ' active' : ''}" data-cat-filter="${k}">${label} · ${n[k]}</div>` : '';
      extra = `<div class="search-wrap"><i class="ti ti-search"></i><input id="cat-search" type="search" placeholder="Search the catalogue" autocomplete="off" value="${esc(this.query)}"></div>
        <div class="intake-filter-bar">${chip('all', 'In use')}${chip('edited', 'Own wording')}${chip('nocode', 'No part code')}${chip('retired', 'Retired')}</div>`;
    } else if (this.tab === 'add') {
      extra = `<div class="search-wrap" style="margin-bottom:10px"><i class="ti ti-search"></i><input id="cat-add-search" type="search" placeholder="Search the part list by code or description" autocomplete="off" value="${esc(this.addQuery)}"></div>`;
    }
    el.innerHTML = `<div class="intake-filter-bar cat-tabs">${tab('materials', 'Materials', 'ti-list')}${tab('import', 'Import part list', 'ti-file-import')}${tab('add', 'Add a material', 'ti-plus')}</div>${extra}`;
  },

  renderBody() {
    const el = document.getElementById('cat-body'); if (!el) return;
    if (this.doc === undefined) { el.innerHTML = `<div class="empty-state"><i class="ti ti-loader-2"></i><p>Checking the database…</p></div>`; return; }
    if (!this.doc) { el.innerHTML = this._moveHtml(); return; }
    if (this.review) { el.innerHTML = this._reviewHtml(); this._updateReviewSummary(); return; }
    el.innerHTML = this.tab === 'import' ? this._importHtml() : this.tab === 'add' ? this._addHtml() : this._materialsHtml();
  },

  // ── Not moved yet ─────────────────────────────────────────────────────
  _moveHtml() {
    const n = (this._host.materials || []).length;
    return `<div class="settings-card"><div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:10px">
        <div class="settings-row-label">The materials list is still read from materials.csv</div>
        <div class="settings-row-sub">Move it into the database to add, edit and import materials on this screen instead of editing the file. The move itself changes nothing on the iPads: the same ${n || ''} materials, in the same order, with the same wording. materials.csv stays where it is as a fallback.</div>
        <button class="btn btn-primary" data-cat-act="move"><i class="ti ti-database-import"></i> Move the list into the database</button>
      </div></div>`;
  },
  async moveToDatabase(btn) {
    if (btn) btn.disabled = true;
    try {
      // Straight from the file — never from a cached or built-in fallback list.
      const res = await fetch(this.csvUrl + '?nocache=' + Date.now());
      if (!res.ok) throw new Error('could not read materials.csv (HTTP ' + res.status + ')');
      const list = Data._parseCsv(Data._decode(await res.arrayBuffer()));
      if (!list.length) throw new Error('materials.csv came back empty');
      const done = await DB.updateCatalog(cur => cur ? null : this.seed(list), { by: this._by() });
      this._toast(done ? `Moved ${list.length} materials into the database` : 'The list was already moved from another device');
    } catch (e) { this._fail(e, 'Move failed'); if (btn) btn.disabled = false; }
  },

  // ── MATERIALS tab ─────────────────────────────────────────────────────
  _materialsHtml() {
    let rows = this.doc.items.filter(i => this.filter === 'retired' ? i.retired : !i.retired);
    if (this.filter === 'edited') rows = rows.filter(i => i.desc);
    if (this.filter === 'nocode') rows = rows.filter(i => !this._real(i.code));
    // Same search as the ordering pages (sizes in mm or inches, typos).
    const found = Data.filter(rows.map(i => ({ ...this._shape(i), _it: i })), null, null, this.query).map(s => s._it);
    const top = `<div class="cat-topline"><span>${found.length} material${found.length === 1 ? '' : 's'}</span>
      <button class="btn-sm" data-cat-act="backup"><i class="ti ti-file-download"></i> Download backup (CSV)</button></div>`;
    if (!found.length) return top + `<div class="empty-state"><i class="ti ti-package-off"></i><p>No materials found.</p></div>`;
    return top + found.map(i => this._rowHtml(i)).join('');
  },
  _rowHtml(i) {
    const code = this._real(i.code) ? esc(i.code) : 'No part code';
    return `<div class="stocktake-row cat-row${i.retired ? ' retired' : ''}" data-cat-edit="${i.id}">
      <div class="stocktake-row-info">
        <div class="stocktake-row-name">${descHtml(this._shown(i))}</div>
        <div class="stocktake-row-meta">${code} · ${esc(i.category)} › ${esc(i.subcategory)} · ${esc(i.qtyType)}${i.desc ? ' · <span class="cat-flag">own wording</span>' : ''}${i.retired ? ' · <span class="cat-flag">retired</span>' : ''}</div>
      </div>
      <i class="ti ti-chevron-right"></i>
    </div>`;
  },
  downloadBackup() {
    const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.toCsv(this.doc)], { type: 'text/csv;charset=utf-8' }));
    a.download = `materials-catalogue-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  // ── ADD tab ───────────────────────────────────────────────────────────
  _addHtml() {
    const byHand = `<button class="btn btn-outline" data-cat-act="add-hand" style="align-self:flex-start"><i class="ti ti-pencil-plus"></i> Add a material by hand</button>`;
    if (this.erp === undefined) return byHand + `<div class="settings-row-sub" style="margin-top:10px">Loading the part list…</div>`;
    if (!this.erp) return byHand + `<div class="settings-row-sub" style="margin-top:10px">No part list has been imported yet, so there is nothing to search. Import one (Import part list), or add the material by hand.</div>`;
    if (!this.addQuery.trim())
      return byHand + `<div class="settings-row-sub" style="margin-top:10px">Or search above to pick it from the part list — ${this.erp.parts.length} parts${this.erp.erpDate ? `, list dated ${esc(this.erp.erpDate)}` : ''}. Picking a part brings its code and wording with it.</div>`;
    const inCat = new Map(this.doc.items.filter(i => i.code).map(i => [i.code.toUpperCase(), i]));
    const found = Data.filter(this._erpShaped, null, null, this.addQuery).slice(0, 60);
    if (!found.length) return byHand + `<div class="empty-state"><i class="ti ti-search-off"></i><p>Nothing on the part list matches.</p></div>`;
    return found.map(s => {
      const p = s._p, have = inCat.get(String(p.c).toUpperCase());
      return `<div class="stocktake-row cat-row${have ? ' retired' : ''}" ${have ? `data-cat-edit="${have.id}"` : `data-cat-add="${esc(p.c)}"`}>
        <div class="stocktake-row-info">
          <div class="stocktake-row-name">${esc(p.d)}</div>
          <div class="stocktake-row-meta">${esc(p.c)}${p.u ? ' · ' + esc(p.u) : ''}${have ? ` · <span class="cat-flag">${have.retired ? 'in the catalogue, retired' : 'already in the catalogue'}</span>` : ''}</div>
        </div>
        <i class="ti ${have ? 'ti-chevron-right' : 'ti-plus'}"></i>
      </div>`;
    }).join('') + `<div style="margin-top:10px">${byHand}</div>`;
  },

  // ── Add / edit form (overlay) ─────────────────────────────────────────
  // opts: { item } to edit · { part } to add from the part list · {} by hand
  openForm(opts = {}) {
    const it = opts.item || null, part = opts.part || null;
    const ow = document.getElementById('overlay-wrap'); if (!ow) return;
    const code = it ? (this._real(it.code) ? it.code : '') : (part ? part.c : '');
    // The part list's wording for a code: what this material was last checked
    // against if it's the material's own code, else the uploaded list's entry.
    const listFor = c => {
      const k = String(c || '').trim().toUpperCase(), p = this._erpMap.get(k);
      const own = it && it.listed && k === String(it.code).toUpperCase();
      return { desc: own ? it.erpDesc : (p ? p.d : ''), unit: p ? p.u : '' };
    };
    const st = this._form = { id: it ? it.id : null, listDesc: listFor(code).desc, listUnit: listFor(code).unit, touched: new Set() };
    const shown = it ? this._shown(it) : (part ? part.d : '');
    const sug = it ? it : this.suggest(shown, st.listUnit, this.doc.items);
    ow.innerHTML = `
      <div class="success-overlay">
        <div class="success-card cat-form" style="max-width:480px;text-align:left">
          <h3>${it ? 'Edit material' : 'Add a material'}</h3>
          <div class="setup-field"><label>Part code</label><input id="cf-code" type="text" autocapitalize="characters" spellcheck="false" autocomplete="off" placeholder="Leave empty if it has no code yet" value="${esc(code)}"></div>
          <div class="cat-form-list" id="cf-list"></div>
          <div class="setup-field"><label>Description shown to the workshop</label><input id="cf-desc" type="text" autocomplete="off" value="${esc(shown)}"></div>
          <div class="cat-form-picks">
            <div class="setup-field"><label>Category</label>${this._pick('category', sug.category)}</div>
            <div class="setup-field"><label>Type</label>${this._pick('subcategory', sug.subcategory)}</div>
            <div class="setup-field"><label>Ordered by</label>${this._pick('qtyType', sug.qtyType)}</div>
          </div>
          <div class="auth-err" id="cf-err"></div>
          <button class="btn btn-primary" id="cf-save" style="width:100%"><i class="ti ti-check"></i> ${it ? 'Save' : 'Add to the catalogue'}</button>
          ${it ? `<button class="btn btn-outline" id="cf-retire" style="width:100%;margin-top:8px">${it.retired ? '<i class="ti ti-arrow-back-up"></i> Restore — show it for ordering again' : '<i class="ti ti-eye-off"></i> Retire — hide it from ordering'}</button>` : ''}
          <button class="btn btn-outline" id="cf-cancel" style="width:100%;margin-top:8px">Cancel</button>
        </div>
      </div>`;
    const $ = id => document.getElementById(id);
    const card = ow.querySelector('.cat-form');
    const listLine = () => {
      const c = $('cf-code').value.trim(), el = $('cf-list');
      if (!c) { el.innerHTML = ''; return; }
      if (!st.listDesc) { el.innerHTML = `<span>${this.erp ? 'Not on the part list — the description is yours to write.' : ''}</span>`; return; }
      const same = $('cf-desc').value.trim() === st.listDesc;
      el.innerHTML = `<span>Part list wording: <strong>${esc(st.listDesc)}</strong></span>${same ? '' : `<button class="btn-sm" id="cf-uselist">Use it</button>`}`;
    };
    const autofill = () => {
      if (it) return;                                   // editing: never second-guess what's already set
      const s = this.suggest($('cf-desc').value, st.listUnit, this.doc.items);
      for (const f of ['category', 'subcategory', 'qtyType']) {
        if (st.touched.has(f) || !s[f]) continue;
        const sel = card.querySelector(`[data-pick="${f}"]`);
        if (sel && sel.value !== s[f]) sel.outerHTML = this._pick(f, s[f]);
      }
    };
    $('cf-code').addEventListener('input', () => {
      const before = st.listDesc, now = listFor($('cf-code').value);
      st.listDesc = now.desc; st.listUnit = now.unit;
      // A blank description, or one that was only ever the previous code's list wording, follows the code.
      if (st.listDesc && (!$('cf-desc').value.trim() || $('cf-desc').value.trim() === before)) { $('cf-desc').value = st.listDesc; autofill(); }
      listLine();
    });
    $('cf-desc').addEventListener('input', () => { autofill(); listLine(); });
    card.addEventListener('click', e => {
      if (e.target.closest('#cf-uselist')) { $('cf-desc').value = st.listDesc; autofill(); listLine(); }
    });
    card.addEventListener('focusin', e => { const s = e.target.closest('[data-pick]'); if (s) s.dataset.prev = s.value; });
    card.addEventListener('change', e => {
      const s = e.target.closest('[data-pick]'); if (!s) return;
      st.touched.add(s.dataset.pick);
      this._pickValue(s);
    });
    $('cf-cancel').addEventListener('click', () => { ow.innerHTML = ''; });
    $('cf-save').addEventListener('click', () => this._saveForm());
    $('cf-retire')?.addEventListener('click', () => this._setRetired(it, !it.retired));
    listLine();
    if (!it && !part) $('cf-desc').focus();
  },
  async _saveForm() {
    const $ = id => document.getElementById(id), st = this._form;
    const card = document.querySelector('.cat-form'); if (!card || !st) return;
    const val = f => card.querySelector(`[data-pick="${f}"]`).value;
    const before = st.id != null ? this.doc.items.find(i => i.id === st.id) : null;
    // Codes are upper case; an untouched code is left exactly as stored, and
    // one that's on the part list takes the list's spelling.
    let code = $('cf-code').value.trim();
    const onList = this._erpMap.get(code.toUpperCase());
    if (before && code.toUpperCase() === String(before.code).toUpperCase()) code = before.code;
    else code = onList ? onList.c : code.toUpperCase();
    const form = {
      id: st.id, code, shown: $('cf-desc').value.trim(), listDesc: st.listDesc,
      category: val('category'), subcategory: val('subcategory'), qtyType: val('qtyType'),
    };
    const err = m => { $('cf-err').textContent = m || ''; };
    if (!form.shown) return err('Give the material a description.');
    if (!form.category || !form.subcategory || !form.qtyType) return err('Choose a category, a type and how it is ordered.');
    const btn = $('cf-save'); btn.disabled = true; err('');
    try {
      const next = await DB.updateCatalog(cur => this.applyForm(cur, form), { by: this._by() });
      // The stocktake count is filed under the code (or the description, with
      // no code) — if that changed, take the count along.
      if (before && next) {
        const after = next.items.find(i => i.id === st.id);
        const from = stockId(this._shape(before)), to = after ? stockId(this._shape(after)) : from;
        if (from !== to) await DB.moveMaterialStock(from, to).catch(e => console.warn('[Catalogue] stock move failed:', e));
      }
      document.getElementById('overlay-wrap').innerHTML = '';
      this._toast(before ? 'Saved' : 'Added to the catalogue');
    } catch (e) {
      btn.disabled = false;
      err(e && e.code === 'permission-denied' ? "The database refused it — this account can't change the catalogue." : ((e && e.message) || 'Could not save.'));
    }
  },
  async _setRetired(it, retired) {
    try {
      await DB.updateCatalog(cur => {
        if (!cur) return null;
        return { ...cur, items: cur.items.map(i => i.id === it.id ? this._mk({ ...i, retired }) : i) };
      }, { by: this._by() });
      document.getElementById('overlay-wrap').innerHTML = '';
      this._toast(retired ? 'Retired — hidden from ordering and stocktake' : 'Restored');
    } catch (e) { this._fail(e, 'Could not save'); }
  },

  // ── IMPORT tab ────────────────────────────────────────────────────────
  _importHtml() {
    const d = this.doc;
    const when = d.listImportedAt ? fmtTime(new Date(d.listImportedAt)) : '';
    const last = d.listImportedAt
      ? `Last import: ${d.listCount || ''} parts${d.listDate ? `, list dated ${esc(d.listDate)}` : ''}${d.listFile ? ` (${esc(d.listFile)})` : ''} · ${esc(when)}`
      : 'No part list has been imported yet.';
    const undo = d.hasUndo
      ? `<div class="settings-row">
          <div><div class="settings-row-label">${d.hasUndo === 'undo' ? 'The last import was undone' : 'Undo the last import'}</div>
          <div class="settings-row-sub">${d.hasUndo === 'undo' ? 'Puts the import back as it was applied.' : 'Puts the catalogue back to how it was just before that import. Edits made here since then go too.'}</div></div>
          <button class="btn-sm" data-cat-act="undo">${d.hasUndo === 'undo' ? 'Put it back' : 'Undo'}</button>
        </div>` : '';
    return `<div class="settings-card">
        <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:10px">
          <div class="settings-row-label">Upload the part list</div>
          <div class="settings-row-sub">The workbook downloaded from the production board's parts page (Drafting Part Codes … .xlsx). You'll see everything it would change — new wording, new parts, parts that have gone — and nothing is saved until you apply it.</div>
          <label class="btn btn-primary" style="cursor:pointer"><i class="ti ti-file-upload"></i> Choose the file<input type="file" id="cat-file" accept=".xlsx,.xlsm,.xls,.csv" style="display:none"></label>
          <div class="settings-row-sub" id="cat-file-status">${last}</div>
        </div>
        ${undo}
      </div>`;
  },
  async _fileChosen(input) {
    const file = input.files && input.files[0]; if (!file) return;
    const status = document.getElementById('cat-file-status');
    if (status) status.textContent = `Reading ${file.name}…`;
    try {
      const parsed = await this.readFile(file);
      await this._loadErp();
      // "New" is measured against the previous upload. Uploading the same
      // list again brings back the new parts that weren't added last time.
      let baseline = null;
      if (this.erp && this.erp.parts) {
        baseline = new Set(this.erp.parts.map(p => String(p.c).toUpperCase()));
        if (this.erp.erpDate && this.erp.erpDate === parsed.erpDate) (this.erp.fresh || []).forEach(c => baseline.delete(String(c).toUpperCase()));
      }
      const diff = this.diff(this.doc, parsed, baseline);
      const dec = {};
      diff.changed.forEach(c => { dec[c.id] = { action: c.hasOverride ? 'ignore' : 'replace', text: c.shown }; });
      const add = {};
      diff.added.forEach(a => { add[a.part.code] = { on: false, category: a.suggest.category, subcategory: a.suggest.subcategory, qtyType: a.suggest.qtyType }; });
      this.review = { parsed, diff, dec, add, retire: new Set() };
      this.render();
      document.querySelector('#catalogue-panel .panel-scroll').scrollTop = 0;
    } catch (e) {
      console.error('[Catalogue] import read failed', e);
      if (status) status.textContent = `Could not read that file: ${(e && e.message) || e}`;
      input.value = '';
    }
  },

  // Words of `a` that don't appear in `b`, marked — makes a one-word change
  // in a long description jump out.
  _mark(a, b) {
    const other = new Set(String(b).split(/\s+/));
    return String(a).split(/(\s+)/).map(w => (!w.trim() || other.has(w)) ? esc(w) : `<mark>${esc(w)}</mark>`).join('');
  },
  _changedRowHtml(c) {
    const d = this.review.dec[c.id];
    const btn = (k, label) => `<button class="intake-filter-chip${d.action === k ? ' active' : ''}" data-rev-act="${k}">${label}</button>`;
    return `<div class="cat-rev" data-rev-id="${c.id}">
      <div class="cat-rev-meta">${esc(c.item.code)} · ${esc(c.item.category)} › ${esc(c.item.subcategory)}</div>
      <div class="cat-rev-line"><span>Shown now</span><div>${this._mark(c.shown, c.to)}</div></div>
      <div class="cat-rev-line"><span>List says</span><div>${this._mark(c.to, c.shown)}</div></div>
      ${c.hasOverride ? `<div class="cat-rev-line dim"><span>List said</span><div>${esc(c.from)}</div></div>` : ''}
      ${c.notes ? `<div class="cat-rev-note"><i class="ti ti-note"></i> ${esc(c.notes)}</div>` : ''}
      <div class="cat-choice">${btn('replace', 'Replace')}${btn('ignore', 'Ignore')}${btn('edit', 'Edit')}
        <span class="cat-choice-hint">${d.action === 'replace' ? 'show the list wording' : d.action === 'ignore' ? 'keep showing what is shown now' : 'show your own wording:'}</span></div>
      ${d.action === 'edit' ? `<input class="cat-input" type="text" data-rev-text autocomplete="off" value="${esc(d.text)}">` : ''}
    </div>`;
  },
  _addRowHtml(a) {
    const s = this.review.add[a.part.code];
    return `<div class="cat-rev${s.on ? '' : ' off'}" data-add-code="${esc(a.part.code)}">
      <label class="cat-check"><input type="checkbox" data-add-tick${s.on ? ' checked' : ''}><span><strong>${esc(a.part.code)}</strong> · ${esc(a.part.desc)}</span></label>
      ${a.part.notes ? `<div class="cat-rev-note"><i class="ti ti-note"></i> ${esc(a.part.notes)}</div>` : ''}
      ${s.on ? `<div class="cat-form-picks">${this._pick('category', s.category)}${this._pick('subcategory', s.subcategory)}${this._pick('qtyType', s.qtyType)}</div>` : ''}
    </div>`;
  },
  _goneRowHtml(g) {
    const on = this.review.retire.has(g.id);
    return `<div class="cat-rev" data-gone-id="${g.id}">
      <label class="cat-check"><input type="checkbox" data-gone-tick${on ? ' checked' : ''}><span><strong>${esc(g.item.code)}</strong> · ${esc(this._shown(g.item))}<br><em>Tick to retire it (hide it from ordering)</em></span></label>
    </div>`;
  },
  _reviewHtml() {
    const r = this.review, d = r.diff, p = r.parsed;
    const sec = (title, n, sub, body) => n ? `<div class="stocktake-section">${title} · ${n}</div>${sub ? `<div class="settings-row-sub" style="margin:-2px 2px 8px">${sub}</div>` : ''}${body}` : '';
    const bulk = d.changed.length > 1
      ? `<div class="cat-bulk"><button class="btn-sm" data-rev-all="replace">Replace all</button><button class="btn-sm" data-rev-all="ignore">Ignore all</button></div>` : '';
    const lots = d.coded && d.gone.length > d.coded / 4;
    return `<div class="cat-rev-head">
        <div class="settings-row-label">${esc(p.fileName || 'Part list')}</div>
        <div class="settings-row-sub">${d.total} parts${p.erpDate ? `, list dated ${esc(p.erpDate)}` : ''}. ${d.same} of your materials match it as they are.${(d.changed.length + d.added.length + d.gone.length) ? '' : ' Nothing to change — applying just records this as the latest list.'}</div>
        ${lots ? `<div class="cat-rev-note warn"><i class="ti ti-alert-triangle"></i> ${d.gone.length} of your ${d.coded} materials aren't in this file. Check it's the full part list before applying.</div>` : ''}
      </div>
      ${sec('Wording differs from the list', d.changed.length, 'Replace takes the list wording. Ignore keeps what the workshop sees now (and stops asking). Edit lets you type your own.', bulk + d.changed.map(c => this._changedRowHtml(c)).join(''))}
      ${sec(d.first ? 'Parts that look like materials' : 'New on the part list', d.added.length,
            d.first ? 'First upload, so only parts that read like raw materials are listed. Tick any that should be orderable; everything else on the list can be added later from Add a material.'
                    : 'Tick the ones that are materials the workshop orders. The rest stay on the part list and can be added later from Add a material.',
            d.added.map(a => this._addRowHtml(a)).join(''))}
      ${sec('No longer on the part list', d.gone.length, 'Still in your catalogue. Leave them, or tick to retire.', d.gone.map(g => this._goneRowHtml(g)).join(''))}
      <div class="cat-apply">
        <span id="cat-rev-sum"></span>
        <button class="btn btn-outline" data-cat-act="rev-cancel">Cancel</button>
        <button class="btn btn-primary" data-cat-act="rev-apply"><i class="ti ti-check"></i> Apply</button>
      </div>`;
  },
  _updateReviewSummary() {
    const el = document.getElementById('cat-rev-sum'), r = this.review; if (!el || !r) return;
    const n = { replace: 0, ignore: 0, edit: 0 };
    r.diff.changed.forEach(c => n[r.dec[c.id].action]++);
    const adds = Object.values(r.add).filter(a => a.on).length;
    const bits = [];
    if (n.replace) bits.push(`${n.replace} replaced`);
    if (n.ignore)  bits.push(`${n.ignore} ignored`);
    if (n.edit)    bits.push(`${n.edit} edited`);
    if (adds)      bits.push(`${adds} added`);
    if (r.retire.size) bits.push(`${r.retire.size} retired`);
    el.textContent = bits.length ? bits.join(' · ') : 'No changes';
  },
  async applyReview(btn) {
    const r = this.review; if (!r) return;
    const add = [];
    for (const a of r.diff.added) {
      const s = r.add[a.part.code];
      if (!s.on) continue;
      if (!s.category || !s.subcategory || !s.qtyType) {
        this._toast(`Choose a category, type and unit for ${a.part.code}`, true);
        document.querySelector(`[data-add-code="${CSS.escape(a.part.code)}"]`)?.scrollIntoView({ block: 'center' });
        return;
      }
      add.push({ code: a.part.code, erpDesc: a.part.desc, category: s.category, subcategory: s.subcategory, qtyType: s.qtyType });
    }
    const dec = { changed: r.dec, add, retire: [...r.retire] };
    btn.disabled = true;
    try {
      await DB.updateCatalog(cur => this.applyImport(cur, r.parsed, dec), { by: this._by(), keepPrevious: 'import' });
    } catch (e) { btn.disabled = false; this._fail(e, 'Import not applied'); return; }
    // The list itself, slimmed, becomes the baseline for the next upload and
    // what "Add a material" searches. `fresh` = the parts offered as new this time.
    const erp = {
      parts: r.parsed.parts.map(p => { const o = { c: p.code, d: p.desc, u: p.unit }; if (p.notes) o.n = p.notes; return o; }),
      erpDate: r.parsed.erpDate || '', downloaded: r.parsed.downloaded || '', fileName: r.parsed.fileName || '',
      count: r.parsed.parts.length, fresh: r.diff.added.map(a => a.part.code), importedBy: this._by(),
    };
    try { await DB.saveErpParts(erp); this._setErp(erp); }
    catch (e) { this._fail(e, 'Catalogue updated, but the part list itself was not stored'); }
    this.review = null;
    this.tab = 'materials'; this.filter = 'all'; this.query = '';
    this.render();
    this._toast('Import applied');
  },
  async undoImport(btn) {
    const redo = this.doc.hasUndo === 'undo';
    if (!confirm(redo ? 'Put the import back as it was applied?' : 'Undo the last import? The catalogue goes back to how it was just before it — edits made on this screen since then are undone too.')) return;
    btn.disabled = true;
    try { await DB.restorePreviousCatalog(this._by()); this._toast(redo ? 'Import put back' : 'Import undone'); }
    catch (e) { btn.disabled = false; this._fail(e, 'Could not undo'); }
  },

  // ── Events (delegated from the panel) ─────────────────────────────────
  _onClick(e) {
    const t = e.target;
    const tab = t.closest('[data-cat-tab]');
    if (tab) { this.tab = tab.dataset.catTab; this.render(); return; }
    const filt = t.closest('[data-cat-filter]');
    if (filt) { this.filter = filt.dataset.catFilter; this.render(); return; }
    const act = t.closest('[data-cat-act]');
    if (act) {
      const a = act.dataset.catAct;
      if (a === 'move')       this.moveToDatabase(act);
      if (a === 'backup')     this.downloadBackup();
      if (a === 'add-hand')   this.openForm({});
      if (a === 'undo')       this.undoImport(act);
      if (a === 'rev-apply')  this.applyReview(act);
      if (a === 'rev-cancel') { this.review = null; this.render(); }
      return;
    }
    const r = this.review;
    if (r) {
      const all = t.closest('[data-rev-all]');
      if (all) { r.diff.changed.forEach(c => { r.dec[c.id].action = all.dataset.revAll; }); this.renderBody(); return; }
      const choice = t.closest('[data-rev-act]');
      if (choice) {
        const row = choice.closest('[data-rev-id]'), id = Number(row.dataset.revId);
        r.dec[id].action = choice.dataset.revAct;
        row.outerHTML = this._changedRowHtml(r.diff.changed.find(c => c.id === id));
        if (r.dec[id].action === 'edit') document.querySelector(`[data-rev-id="${id}"] [data-rev-text]`)?.focus();
        this._updateReviewSummary();
      }
      return;
    }
    const edit = t.closest('[data-cat-edit]');
    if (edit) { const it = this.doc.items.find(i => i.id === Number(edit.dataset.catEdit)); if (it) this.openForm({ item: it }); return; }
    const add = t.closest('[data-cat-add]');
    if (add) { const p = this._erpMap.get(add.dataset.catAdd.toUpperCase()); if (p) this.openForm({ part: p }); }
  },
  _onInput(e) {
    const t = e.target;
    if (t.id === 'cat-search')     { this.query = t.value; this.renderBody(); return; }
    if (t.id === 'cat-add-search') { this.addQuery = t.value; this.renderBody(); return; }
    if (this.review && t.matches('[data-rev-text]')) this.review.dec[Number(t.closest('[data-rev-id]').dataset.revId)].text = t.value;
  },
  _onChange(e) {
    const t = e.target, r = this.review;
    if (t.id === 'cat-file') { this._fileChosen(t); return; }
    if (!r) return;
    if (t.matches('[data-add-tick]')) {
      const row = t.closest('[data-add-code]'), code = row.dataset.addCode;
      r.add[code].on = t.checked;
      row.outerHTML = this._addRowHtml(r.diff.added.find(a => a.part.code === code));
    } else if (t.matches('[data-gone-tick]')) {
      const id = Number(t.closest('[data-gone-id]').dataset.goneId);
      if (t.checked) r.retire.add(id); else r.retire.delete(id);
    } else if (t.matches('[data-pick]')) {
      const code = t.closest('[data-add-code]').dataset.addCode, field = t.dataset.pick;
      t.dataset.prev = r.add[code][field] || '';
      r.add[code][field] = this._pickValue(t);
    }
    this._updateReviewSummary();
  },
};
