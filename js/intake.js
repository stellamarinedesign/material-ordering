// intake.js — v0.37.4
// Shared intake rendering module used by warehouse.html and manager.html.

const Intake = {
  // UI-only state: which items have their notes field open.
  // Key format: "orderId__itemId"
  _openNotes: new Set(),

  // Item statuses that count as "actioned" — once every item in a category
  // has one of these, the category is resolved and leaves Outstanding.
  RESOLVED_STATUSES: new Set(['ok', 'partial', 'missing', 'backorder']),

  // Resolved category statuses that qualify a card for the Completed tab.
  TAB_RESOLVED: new Set(['received', 'backorder', 'completed']),

  // ── STATUS LOGIC ────────────────────────────────────────────────────

  _itemStatus(order, item) {
    const intakeItems = (order.intake && order.intake.items) || {};
    return (intakeItems[String(item.id)] || {}).status || 'pending';
  },

  // Computes the intake status for a set of items against an order's saved
  // (or draft-merged, if the caller passes a synthetic order) intake data.
  computeCategoryStatus(order, catItems) {
    if (!catItems.length) return 'pending';
    const statuses = catItems.map(i => this._itemStatus(order, i));
    if (statuses.every(s => s === 'pending')) return 'pending';
    if (!statuses.every(s => this.RESOLVED_STATUSES.has(s))) return 'in_progress';
    if (statuses.every(s => s === 'ok')) return 'received';
    if (statuses.some(s => s === 'backorder')) return 'backorder';
    return 'completed'; // fully actioned, no backorder, mix of ok/partial/missing
  },

  // Legacy order-level status (kept for compatibility — see renderList/renderCard below).
  computeStatus(order) {
    const isMaterials = !order.type || order.type === 'materials';
    const items = (order.items || []).filter(i => isMaterials ? !!i.emailed : true);
    return this.computeCategoryStatus(order, items);
  },

  statusBadge(status) {
    const cfg = {
      pending:     { icon: 'ti-clock',         label: 'Pending',      col: 'var(--text3)',       bg: 'var(--bg2)'       },
      in_progress: { icon: 'ti-loader-2',       label: 'In Progress',  col: 'var(--amber-text)',  bg: 'var(--amber-bg)'  },
      received:    { icon: 'ti-circle-check',   label: 'Received',     col: 'var(--green-text)',  bg: 'var(--green-bg)'  },
      backorder:   { icon: 'ti-clock-pause',    label: 'Back Order',   col: 'var(--blue-text)',   bg: 'var(--blue-bg)'   },
      completed:   { icon: 'ti-circle-check',   label: 'Completed',    col: 'var(--text2)',       bg: 'var(--bg2)'       },
      cancelled:   { icon: 'ti-ban',            label: 'Cancelled',    col: 'var(--text3)',       bg: 'var(--bg2)'       },
    };
    const c = cfg[status] || cfg.pending;
    return `<span class="intake-status-badge" style="color:${c.col};background:${c.bg}"><i class="ti ${c.icon}"></i> ${c.label}</span>`;
  },

  // ── FILTERING (legacy order-level — see renderList/renderCard below) ──

  filterOrders(orders, type, filter) {
    const isMat = type === 'materials';
    const relevant = orders.filter(o => {
      const oIsMat = !o.type || o.type === 'materials';
      if (oIsMat !== isMat) return false;
      if (o.status === 'rejected') return false;
      if (isMat) return (o.items || []).some(i => i.emailed) || o.status === 'sent';
      return true; // consumables orders are always relevant once saved
    });
    if (filter === 'outstanding') {
      return relevant.filter(o => { const s = this.computeStatus(o); return s === 'pending' || s === 'in_progress'; });
    }
    if (filter === 'backorder') {
      return relevant.filter(o => this.computeStatus(o) === 'backorder');
    }
    return relevant; // 'all'
  },

  // ── DRAFT OVERLAY (stage-then-confirm) ─────────────────────────────────
  // draftForCard: sparse map { [itemId]: { status, qtyReceived, notes } } of
  // unconfirmed edits for one category card, held by the host page outside
  // its `orders` cache so a Firestore snapshot can never silently wipe it.

  mergeDraft(order, draftForCard) {
    const saved = (order.intake && order.intake.items) || {};
    if (!draftForCard || !Object.keys(draftForCard).length) return saved;
    const merged = { ...saved };
    for (const [id, patch] of Object.entries(draftForCard)) {
      merged[id] = { ...(saved[id] || {}), ...patch };
    }
    return merged;
  },

  // Whether every item in catItems has a non-pending status once the draft is applied.
  canConfirm(order, catItems, draftForCard) {
    const merged = this.mergeDraft(order, draftForCard);
    return catItems.every(i => {
      const s = (merged[String(i.id)] || {}).status;
      return !!s && s !== 'pending';
    });
  },

  // ── ENTRIES-AWARE VARIANTS (a delivery can now span multiple orders) ──
  // An "entry" is { item, order } — needed because a delivery's items can belong to
  // DIFFERENT order docs, each with its own intake.items map. item.id is the catalog
  // item's id (shared across orders that ordered the same material — see combineOrders),
  // so any per-item state that spans orders must be keyed by the composite
  // "orderId::itemId", never bare itemId, or two unrelated items could conflate.

  computeCategoryStatusEntries(entries) {
    if (!entries.length) return 'pending';
    const statuses = entries.map(({ order, item }) => this._itemStatus(order, item));
    if (statuses.every(s => s === 'pending')) return 'pending';
    if (!statuses.every(s => this.RESOLVED_STATUSES.has(s))) return 'in_progress';
    if (statuses.every(s => s === 'ok')) return 'received';
    if (statuses.some(s => s === 'backorder')) return 'backorder';
    return 'completed';
  },

  // Returns a map keyed "orderId::itemId" -> {status, qtyReceived, notes}, merging each
  // entry's own order.intake.items with any staged draft patch.
  mergeDraftEntries(entries, draftForCard) {
    const merged = {};
    for (const { order, item } of entries) {
      const saved = (order.intake && order.intake.items) || {};
      merged[`${order._id}::${item.id}`] = { ...(saved[String(item.id)] || {}) };
    }
    if (draftForCard) {
      for (const [key, patch] of Object.entries(draftForCard)) {
        merged[key] = { ...(merged[key] || {}), ...patch };
      }
    }
    return merged;
  },

  canConfirmEntries(entries, draftForCard) {
    const merged = this.mergeDraftEntries(entries, draftForCard);
    // For entries sharing the same item.id, the flat display shows only one row
    // (the representative — first entry per item.id). Only check the representative.
    const checkedItemIds = new Set();
    for (const { order, item } of entries) {
      const itemKey = String(item.id);
      if (checkedItemIds.has(itemKey)) continue;
      checkedItemIds.add(itemKey);
      const entry = merged[`${order._id}::${item.id}`] || {};
      const s = entry.status;
      if (!s || s === 'pending') return false;
      if (s === 'partial' && !entry.qtyReceived) return false;
    }
    return true;
  },

  // ── CATEGORY-BASED RENDERING (Deliveries page + Sent tab) ─────────────
  // Each "unit" is one delivery — everything emailed together in one real send, which
  // may span multiple orders. Grouped by item.deliveryId (stamped when an item is marked
  // emailed — see DB.markCategoryEmailed/markAllEmailed) so orders that contributed to the
  // same email collapse into one card. Items from before deliveryId existed fall back to
  // a per-order-per-category key — no retroactive merging for those (that's what the
  // Combine debug tool is for).

  // cancelledOnly=false (default): excludes orders flagged intakeCancelled.
  // cancelledOnly=true: returns ONLY orders flagged intakeCancelled.
  // NOTE: the cancelled/active split happens here, per-order, BEFORE grouping by
  // deliveryId — so a delivery whose contributing orders have mixed cancelled state
  // naturally partitions into two same-groupKey cards, one per tab (each showing only
  // the entries from orders in that tab's state). This is intentional, not a bug.
  buildCategoryGroups(orders, type, cancelledOnly = false) {
    const isMat = type === 'materials';
    const flat = [];
    for (const order of orders) {
      const orderIsMat = !order.type || order.type === 'materials';
      if (orderIsMat !== isMat) continue;
      if (order.status === 'rejected') continue;
      const isCancelled = !!order.intakeCancelled;
      if (cancelledOnly ? !isCancelled : isCancelled) continue;
      const items = (order.items || []);
      const eligible = isMat
        ? items.filter(i => i.emailed && !i.rejected)
        : items.filter(i => !i.rejected);
      for (const item of eligible) flat.push({ item, order });
    }
    const byKey = new Map();
    for (const entry of flat) {
      const { item, order } = entry;
      const groupKey = item.deliveryId || `legacy:${order._id}:${item.category}`;
      if (!byKey.has(groupKey)) byKey.set(groupKey, { groupKey, category: item.category, entries: [] });
      byKey.get(groupKey).entries.push(entry);
    }
    return [...byKey.values()];
  },

  // filter: 'all' | 'outstanding' | 'backorder' | 'completed' | 'cancelled'
  // drafts (optional): Map of groupKey (+"|||bo" for the derived card) -> draftForCard,
  // so an open card keeps showing staged-but-unconfirmed edits across re-renders.
  // showRestore (optional): whether cancelled cards get a Restore button (manager.html only).
  renderCategoryList(orders, type, filter, openCards, drafts, showRestore) {
    let cards = [];

    if (filter === 'cancelled') {
      cards = this.buildCategoryGroups(orders, type, true)
        .map(g => ({ ...g, isCancelledCard: true }));
    } else {
      const groups = this.buildCategoryGroups(orders, type, false);
      for (const g of groups) {
        const status   = this.computeCategoryStatusEntries(g.entries);
        const resolved = this.TAB_RESOLVED.has(status);
        const boEntries = resolved ? g.entries.filter(({ order, item }) => this._itemStatus(order, item) === 'backorder') : [];

        if (filter === 'all') {
          cards.push(g);
          if (resolved && boEntries.length) cards.push({ groupKey: g.groupKey, category: g.category, entries: boEntries, isDerived: true });
        } else if (filter === 'completed') {
          if (resolved) cards.push(g);
        } else if (filter === 'outstanding') {
          if (!resolved) cards.push(g);
          else if (boEntries.length) cards.push({ groupKey: g.groupKey, category: g.category, entries: boEntries, isDerived: true });
        } else if (filter === 'backorder') {
          if (boEntries.length) cards.push({ groupKey: g.groupKey, category: g.category, entries: boEntries, isDerived: true });
        }
      }
    }

    if (!cards.length) {
      const labels = { outstanding: 'outstanding', backorder: 'back order', completed: 'completed', cancelled: 'cancelled' };
      const label = labels[filter] || '';
      return `<div class="empty-state"><i class="ti ti-inbox-off"></i><p>No${label ? ' ' + label : ''} ${type} deliveries.</p></div>`;
    }

    return cards.map(c => this.renderCategoryCard(c.groupKey, c.category, c.entries, type, openCards, {
      isDerived:      !!c.isDerived,
      readOnly:       !!c.isCancelledCard,
      isCancelledCard:!!c.isCancelledCard,
      showRestore:    !!c.isCancelledCard && !!showRestore,
      draftForCard:   drafts ? drafts.get(`${c.groupKey}${c.isDerived ? '|||bo' : ''}`) : undefined,
    })).join('');
  },

  // Card key = groupKey, with a |||bo suffix for the derived back-order-only card so it
  // never collides (open state, draft, DOM id) with the full delivery card. groupKey is
  // always either a DLV-... deliveryId or a legacy:orderId:category fallback — never a
  // bare Firestore doc id, which callers rely on to distinguish it from a plain orderId.
  // entries: [{item, order}, ...] — may span multiple orders.
  // opts: { isDerived, readOnly, isCancelledCard, draftForCard, showRestore }
  renderCategoryCard(groupKey, category, entries, type, openCards, opts = {}) {
    const { isDerived = false, readOnly = false, isCancelledCard = false, draftForCard, showRestore = false } = opts;
    const cardKey = `${groupKey}${isDerived ? '|||bo' : ''}`;
    const safeId  = cardKey.replace(/[^a-zA-Z0-9]/g, '_');
    const isOpen  = openCards && openCards.has(cardKey);

    const distinctOrderIds = [...new Set(entries.map(e => e.order._id))];
    const spansMultipleOrders = distinctOrderIds.length > 1;
    const uniqueItemCount = new Set(entries.map(e => String(e.item.id))).size;
    const submittedDates = entries
      .map(e => e.order.submittedAt && e.order.submittedAt.toDate ? e.order.submittedAt.toDate() : null)
      .filter(Boolean);
    const ts = submittedDates.length
      ? new Date(Math.min(...submittedDates.map(d => d.getTime()))).toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' })
      : '';
    const deviceNames = [...new Set(entries.map(e => e.order.deviceName || ''))].filter(Boolean);
    const deviceLabel = deviceNames.length === 0 ? '' : (deviceNames.length === 1 ? deviceNames[0] : 'Multiple devices');

    const status = this.computeCategoryStatusEntries(entries);
    const badgeStatus = isCancelledCard ? 'cancelled' : status;
    const suffix = isDerived ? ' — Back Order' : '';
    const hasDraft   = !readOnly && draftForCard && Object.keys(draftForCard).length > 0;
    const canConfirm = hasDraft && this.canConfirmEntries(entries, draftForCard);

    return `
      <div class="intake-card${isOpen ? ' open' : ''}" id="intake-card-${esc(safeId)}">
        <div class="intake-card-hdr" data-toggle-order="${esc(cardKey)}">
          <div class="intake-card-title">
            <div class="intake-card-ref">${esc(category)}${esc(suffix)}</div>
            <div class="intake-card-meta">${esc(ts)}${deviceLabel ? ' &middot; ' + esc(deviceLabel) : ''} &middot; ${uniqueItemCount} item${uniqueItemCount !== 1 ? 's' : ''}</div>
          </div>
          <div class="intake-card-right">
            ${readOnly && showRestore ? `<button class="intake-restore-btn" data-restore="${esc(distinctOrderIds[0])}" title="Restore to active tracking"><i class="ti ti-arrow-back-up"></i> Restore</button>` : ''}
            ${isOpen && hasDraft ? `<button class="intake-confirm-btn" data-confirm="${esc(cardKey)}" ${!canConfirm ? 'disabled' : ''} title="${canConfirm ? 'Confirm and save changes' : 'Set a status for every item, and enter a quantity for any partial items'}"><i class="ti ti-check"></i> Confirm</button>` : ''}
            ${this.statusBadge(badgeStatus)}
            <i class="ti ${isOpen ? 'ti-chevron-up' : 'ti-chevron-down'} intake-chevron"></i>
          </div>
        </div>
        ${isOpen ? `<div class="intake-card-body">
          ${this._renderMergedEntries(entries, { draftForCard, readOnly, spansMultipleOrders })}
        </div>` : ''}
      </div>`;
  },

  // ── LEGACY ORDER-LEVEL RENDERING (currently unused by warehouse.html/manager.html,
  // both of which call renderCategoryList/renderCategoryCard — kept for compatibility) ──

  renderList(orders, type, filter, openOrderIds) {
    const filtered = this.filterOrders(orders, type, filter);
    if (!filtered.length) {
      const label = filter === 'outstanding' ? 'outstanding' : filter === 'backorder' ? 'back order' : '';
      return `<div class="empty-state"><i class="ti ti-inbox-off"></i><p>No${label ? ' ' + label : ''} ${type} orders.</p></div>`;
    }
    return filtered.map(o => this.renderCard(o, type, openOrderIds)).join('');
  },

  renderCard(order, type, openOrderIds) {
    const status    = this.computeStatus(order);
    const isOpen    = openOrderIds && openOrderIds.has(order._id);
    const suffix    = status === 'backorder' ? ' — Back Order' : '';
    const isMat     = !order.type || order.type === 'materials';
    const ts        = order.submittedAt && order.submittedAt.toDate
      ? order.submittedAt.toDate().toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' })
      : '';
    const displayItems = (order.items || []).filter(i => isMat ? !!i.emailed : true);
    const cats = [...new Set(displayItems.map(i => i.category))];

    return `
      <div class="intake-card${isOpen ? ' open' : ''}" id="intake-card-${esc(order._id)}">
        <div class="intake-card-hdr" data-toggle-order="${esc(order._id)}">
          <div class="intake-card-title">
            <div class="intake-card-ref">${esc(order.ref || 'Order')}${esc(suffix)}</div>
            <div class="intake-card-meta">${esc(ts)}${order.deviceName ? ' &middot; ' + esc(order.deviceName) : ''} &middot; ${displayItems.length} item${displayItems.length !== 1 ? 's' : ''}</div>
          </div>
          <div class="intake-card-right">
            ${this.statusBadge(status)}
            <i class="ti ${isOpen ? 'ti-chevron-up' : 'ti-chevron-down'} intake-chevron"></i>
          </div>
        </div>
        ${isOpen ? `<div class="intake-card-body">
          ${cats.map(cat => this.renderCategory(order, cat, displayItems.filter(i => i.category === cat))).join('')}
        </div>` : ''}
      </div>`;
  },

  renderCategory(order, category, items) {
    return `
      <div class="intake-category">
        <div class="intake-category-label">${esc(category)}</div>
        ${items.map(i => this.renderItemRow(order, i)).join('')}
      </div>`;
  },

  // ── RENDERING ────────────────────────────────────────────────────────

  // Reads an item row's effective status/qty/notes: its own order's saved intake data,
  // overlaid with a draft patch stored under the composite "orderId::itemId" key (never
  // bare itemId — item.id is the catalog item's id, shared across orders that ordered the
  // same material, so a delivery spanning multiple orders needs the composite key to
  // avoid conflating two unrelated items' statuses).
  _rowState(order, item, draftForCard) {
    const saved = (order.intake && order.intake.items) || {};
    const base  = saved[String(item.id)] || {};
    const patch = draftForCard ? draftForCard[`${order._id}::${item.id}`] : undefined;
    return patch ? { ...base, ...patch } : base;
  },

  // opts: { draftForCard, readOnly, showOrderLabel }
  renderItemRow(order, item, opts = {}) {
    const { draftForCard, readOnly = false, showOrderLabel = false } = opts;
    const istate     = this._rowState(order, item, draftForCard);
    const status     = istate.status || null;
    const qtyRecv    = istate.qtyReceived;
    const notes      = istate.notes || '';
    const noteKey    = `${order._id}__${item.id}`;
    const notesOpen  = !readOnly && (this._openNotes.has(noteKey) || !!notes);
    const showCode   = item.partCode && !Data.isDummyCode(item.partCode);
    const orderLabel = showOrderLabel ? (order.deviceName || order.ref || order._id) : '';

    if (readOnly) {
      return `
        <div class="intake-item" data-item="${esc(String(item.id))}" data-order="${esc(order._id)}">
          <div class="intake-item-main">
            <div class="intake-item-info">
              <div class="intake-item-name">${esc(item.description)}</div>
              ${showCode ? `<div class="intake-item-code">${esc(item.partCode)}</div>` : ''}
              ${orderLabel ? `<div class="intake-item-order-label">${esc(orderLabel)}</div>` : ''}
              <div class="intake-item-ordered">Ordered: <strong>${item.qty}</strong>${item.qtyType ? ' ' + esc(item.qtyType) : ''}</div>
            </div>
          </div>
          ${notes ? `<div class="intake-notes-row"><div class="intake-notes-readonly">${esc(notes)}</div></div>` : ''}
        </div>`;
    }

    return `
      <div class="intake-item" data-item="${esc(String(item.id))}" data-order="${esc(order._id)}">
        <div class="intake-item-main">
          <div class="intake-item-info" data-notes-toggle="${esc(String(item.id))}" data-notes-order="${esc(order._id)}">
            <div class="intake-item-name">${esc(item.description)}</div>
            ${showCode ? `<div class="intake-item-code">${esc(item.partCode)}</div>` : ''}
            ${orderLabel ? `<div class="intake-item-order-label">${esc(orderLabel)}</div>` : ''}
            <div class="intake-item-ordered">Ordered: <strong>${item.qty}</strong>${item.qtyType ? ' ' + esc(item.qtyType) : ''}</div>
          </div>
          <div class="intake-item-btns">
            <button class="intake-btn intake-ok${status === 'ok' ? ' active' : ''}"
              data-action="ok" data-item="${esc(String(item.id))}" data-order="${esc(order._id)}" title="Received OK">
              <i class="ti ti-check"></i><span>OK</span>
            </button>
            <button class="intake-btn intake-partial${status === 'partial' ? ' active' : ''}"
              data-action="partial" data-item="${esc(String(item.id))}" data-order="${esc(order._id)}" title="Partial quantity received">
              <i class="ti ti-adjustments-horizontal"></i><span>Partial</span>
            </button>
            <button class="intake-btn intake-missing${status === 'missing' ? ' active' : ''}"
              data-action="missing" data-item="${esc(String(item.id))}" data-order="${esc(order._id)}" title="Not received">
              <i class="ti ti-x"></i><span>Missing</span>
            </button>
            <button class="intake-btn intake-backorder${status === 'backorder' ? ' active' : ''}"
              data-action="backorder" data-item="${esc(String(item.id))}" data-order="${esc(order._id)}" title="Back order">
              <i class="ti ti-clock-pause"></i><span>B/O</span>
            </button>
            <button class="intake-btn intake-notes-btn${notes ? ' has-note' : ''}${notesOpen ? ' note-open' : ''}"
              data-action="notes" data-item="${esc(String(item.id))}" data-order="${esc(order._id)}" title="Add note">
              <i class="ti ti-message-circle"></i>
            </button>
          </div>
        </div>
        ${status === 'partial' ? `
        <div class="intake-partial-row">
          <label>Received:</label>
          <input class="intake-partial-input" type="number" min="0" step="1"
            value="${qtyRecv != null ? qtyRecv : ''}" placeholder="qty"
            data-partial-item="${esc(String(item.id))}" data-partial-order="${esc(order._id)}">
          <span class="intake-of-label">of ${item.qty}${item.qtyType ? ' ' + esc(item.qtyType) : ''}</span>
        </div>` : ''}
        ${notesOpen ? `
        <div class="intake-notes-row">
          <textarea class="intake-notes-input" rows="2"
            data-notes-item="${esc(String(item.id))}" data-notes-order="${esc(order._id)}"
            placeholder="Back order, wrong sizes, delivery notes…">${esc(notes)}</textarea>
        </div>` : ''}
      </div>`;
  },

  // Groups entries with the same item.id and renders a single flat row per unique item.
  // When multiple orders contributed the same catalog item to a delivery, their quantities
  // are summed into one row — indistinguishable from a single-order item at the delivery stage.
  _renderMergedEntries(entries, { draftForCard, readOnly, spansMultipleOrders }) {
    const byItemId = new Map();
    for (const entry of entries) {
      const key = String(entry.item.id);
      if (!byItemId.has(key)) byItemId.set(key, []);
      byItemId.get(key).push(entry);
    }
    return [...byItemId.values()].map(group => {
      const { item, order } = group[0];
      if (group.length === 1) {
        return this.renderItemRow(order, item, { draftForCard, readOnly, showOrderLabel: spansMultipleOrders });
      }
      // Render as a single flat row with total qty — the first entry's order is the representative
      // (its orderId is used as the draft key; intakeConfirm propagates to all contributing orders).
      const totalQty = group.reduce((s, e) => s + (e.item.qty || 0), 0);
      return this.renderItemRow(order, { ...item, qty: totalQty }, { draftForCard, readOnly });
    }).join('');
  },

  // ── EVENT WIRING ─────────────────────────────────────────────────────
  // Attach all intake interactions to a container element.
  // callbacks: { onAction(orderId, itemId, action), onQtyChange(orderId, itemId, qty),
  //   onNoteChange(orderId, itemId, text), onRerender(cardKey), onConfirm(cardKey), onRestore(orderId) }
  attachListeners(container, callbacks) {
    container.addEventListener('click', e => {
      // Confirm button — sits inside the header, must be checked before the toggle handler.
      const confirmBtn = e.target.closest('[data-confirm]');
      if (confirmBtn) {
        if (confirmBtn.disabled) return;
        if (callbacks.onConfirm) callbacks.onConfirm(confirmBtn.dataset.confirm);
        return;
      }

      // Restore button (cancelled cards) — also sits inside the header.
      const restoreBtn = e.target.closest('[data-restore]');
      if (restoreBtn) {
        if (callbacks.onRestore) callbacks.onRestore(restoreBtn.dataset.restore);
        return;
      }

      // Card header toggle
      const hdr = e.target.closest('[data-toggle-order]');
      if (hdr && !e.target.closest('[data-action]') && !e.target.closest('[data-notes-toggle]')) {
        if (callbacks.onRerender) callbacks.onRerender(hdr.dataset.toggleOrder);
        return;
      }

      // Clicking the item info text area opens/closes notes
      const infoEl = e.target.closest('[data-notes-toggle]');
      if (infoEl && !e.target.closest('[data-action]')) {
        const key = `${infoEl.dataset.notesOrder}__${infoEl.dataset.notesToggle}`;
        if (this._openNotes.has(key)) this._openNotes.delete(key);
        else this._openNotes.add(key);
        if (callbacks.onRerender) callbacks.onRerender(infoEl.dataset.notesOrder);
        return;
      }

      // Status / notes button
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, item: itemId, order: orderId } = btn.dataset;

      if (action === 'notes') {
        const key = `${orderId}__${itemId}`;
        if (this._openNotes.has(key)) this._openNotes.delete(key);
        else this._openNotes.add(key);
        if (callbacks.onRerender) callbacks.onRerender(orderId);
        return;
      }

      if (callbacks.onAction) callbacks.onAction(orderId, itemId, action);
    });

    container.addEventListener('change', e => {
      const inp = e.target.closest('[data-partial-item]');
      if (inp && callbacks.onQtyChange) {
        callbacks.onQtyChange(inp.dataset.partialOrder, inp.dataset.partialItem, parseInt(inp.value) || 0);
      }
    });

    let _noteTimer = null;
    container.addEventListener('input', e => {
      const ta = e.target.closest('[data-notes-item]');
      if (ta && callbacks.onNoteChange) {
        clearTimeout(_noteTimer);
        _noteTimer = setTimeout(() => {
          callbacks.onNoteChange(ta.dataset.notesOrder, ta.dataset.notesItem, ta.value);
        }, 800);
      }
    });
  },
};
