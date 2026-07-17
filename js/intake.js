// intake.js — v0.45
// Shared intake rendering module used by warehouse.html and manager.html.

const Intake = {
  // UI-only state: which items have their notes field open / explicitly closed.
  // Items with saved note text default to open, so collapsing one needs an explicit
  // "closed" marker — _openNotes alone can't express that. Key format: "orderId__itemId"
  _openNotes:   new Set(),
  _closedNotes: new Set(),

  // Toggles a note field. Visibility is derived (explicitly opened, OR has saved text
  // and not explicitly closed), so read the live DOM state instead of re-deriving it.
  _toggleNotes(orderId, itemId) {
    const key = `${orderId}__${itemId}`;
    const visible = !!document.querySelector(`[data-notes-item="${itemId}"][data-notes-order="${orderId}"]`);
    if (visible) { this._openNotes.delete(key); this._closedNotes.add(key); }
    else         { this._openNotes.add(key);    this._closedNotes.delete(key); }
  },

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

  // Identity key for merging "the same material" across orders in one delivery.
  // Real part codes are unique in the catalogue and survive CSV re-ordering; item.id
  // is just the CSV row index at submit time, so orders submitted before/after a
  // catalogue edit can carry the same id for DIFFERENT materials (or different ids
  // for the same one). Only fall back to id when there's no part code at all.
  mergeKey(item) { return item.partCode ? `pc:${item.partCode}` : `id:${item.id}`; },

  // ── BACK ORDER REMAINDERS ────────────────────────────────────────────
  // A back order is a KNOWN future shipment — the supplier has said the rest is coming —
  // so it's tracked as a quantity ("4 of 10 still to come"), not just a flag, and stays
  // on the Back Orders tab until it's received. This is independent of `status`: an item
  // can be part-received (status 'partial', 6 arrived) AND have 4 outstanding.
  // A short PARTIAL with nothing outstanding is a different thing — an unexplained
  // shortfall the manager chases with purchasing (see needsFollowUp).

  // How many of an item are still expected. Reads a merged/draft map when given one so
  // staged edits show live, otherwise the saved intake.
  outstandingOf(order, item, merged) {
    const it = merged ? (merged[`${order._id}::${item.id}`] || {})
                      : (((order.intake && order.intake.items) || {})[String(item.id)] || {});
    if (it.outstandingQty !== undefined && it.outstandingQty !== null) return it.outstandingQty || 0;
    // Legacy data: a back-ordered item recorded before quantities existed means the
    // whole line is still outstanding.
    return it.status === 'backorder' ? (item.qty || 0) : 0;
  },

  // An UNEXPLAINED shortfall: less arrived than was ordered and nothing has been declared
  // as still coming — nobody has said why. That's a question for purchasing, which is a
  // different thing from a back order (a known future shipment). Cleared either by
  // flagging the rest as coming (it becomes a back order) or by writing it off.
  needsFollowUp(order, item, merged) {
    const it = merged ? (merged[`${order._id}::${item.id}`] || {})
                      : (((order.intake && order.intake.items) || {})[String(item.id)] || {});
    if (it.status !== 'partial' || it.followUpDone) return false;
    if ((it.qtyReceived || 0) >= (item.qty || 0)) return false;   // nothing short
    return this.outstandingOf(order, item, merged) <= 0;          // a back order isn't a follow-up
  },
  deliveryNeedsFollowUp(entries) {
    return entries.some(({ order, item }) => this.needsFollowUp(order, item));
  },

  computeCategoryStatusEntries(entries) {
    if (!entries.length) return 'pending';
    const statuses = entries.map(({ order, item }) => this._itemStatus(order, item));
    if (statuses.every(s => s === 'pending')) return 'pending';
    if (!statuses.every(s => this.RESOLVED_STATUSES.has(s))) return 'in_progress';
    // Anything still expected keeps the delivery on Back Order, even if some arrived.
    if (entries.some(({ order, item }) => this.outstandingOf(order, item) > 0)) return 'backorder';
    if (statuses.every(s => s === 'ok')) return 'received';
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
    // For entries sharing the same mergeKey, the flat display shows only one row
    // (the representative — first entry per key). Only check the representative.
    const checkedKeys = new Set();
    for (const { order, item } of entries) {
      const itemKey = this.mergeKey(item);
      if (checkedKeys.has(itemKey)) continue;
      checkedKeys.add(itemKey);
      const entry = merged[`${order._id}::${item.id}`] || {};
      const s = entry.status;
      if (!s || s === 'pending') return false;
      if (s === 'partial' && !entry.qtyReceived) return false;
    }
    return true;
  },

  // ── DELIVERY → STOCK (consumables) ────────────────────────────────────
  // Individual stock units an item represents as RECEIVED, from a merged status map:
  // ok → full ordered qty, partial → qtyReceived, else 0. Boxed → boxes × boxSize.
  recvUnits(order, item, merged) {
    const st = merged[`${order._id}::${item.id}`] || {};
    let recv = 0;
    if (st.status === 'ok') recv = item.qty || 0;
    else if (st.status === 'partial') recv = st.qtyReceived || 0;
    return hasBoxTracking(item) ? recv * (item.boxSize || 0) : recv;
  },
  // Units of an item already pushed to stock (0 if never, undefined-safe).
  appliedUnits(order, item) {
    const it = ((order.intake && order.intake.items) || {})[String(item.id)] || {};
    return it.stockAppliedUnits || 0;
  },
  // Whether ANY item in the delivery has been stock-applied at least once.
  stockEverApplied(entries) {
    return entries.some(({ order, item }) => {
      const it = ((order.intake && order.intake.items) || {})[String(item.id)] || {};
      return it.stockAppliedUnits !== undefined;
    });
  },
  // Per-stock-item deltas: current received units vs units last pushed to stock.
  // Returns [{ sid, item, current, prev, delta }] (summed across the delivery's orders).
  deliveryStockDeltas(entries, merged) {
    const bySid = new Map();
    for (const { item, order } of entries) {
      const sid = stockId(item);
      if (!bySid.has(sid)) bySid.set(sid, { sid, item, current: 0, prev: 0 });
      const b = bySid.get(sid);
      b.current += this.recvUnits(order, item, merged);
      b.prev    += this.appliedUnits(order, item);
    }
    return [...bySid.values()].map(b => ({ ...b, delta: b.current - b.prev }));
  },
  // Per-item applied-units to record after posting (every entry, keyed by order+item).
  deliveryStockStamp(entries, merged) {
    return entries.map(({ item, order }) => ({
      orderId: order._id, itemId: String(item.id), units: this.recvUnits(order, item, merged),
    }));
  },
  // Total individual units this delivery has pushed to stock (0 if none) — used to warn
  // before resetting/cancelling a delivery whose stock was already banked.
  appliedStockTotal(entries) {
    return entries.reduce((s, { order, item }) => s + this.appliedUnits(order, item), 0);
  },

  // ── CATEGORY-BASED RENDERING (Deliveries page + Sent tab) ─────────────
  // Each "unit" is one delivery — everything emailed together in one real send, which
  // may span multiple orders. Grouped by item.deliveryId (stamped when an item is marked
  // emailed — see DB.markCategoryEmailed/markAllEmailed) so orders that contributed to the
  // same email collapse into one card. Items from before deliveryId existed fall back to
  // a per-order-per-category key — no retroactive merging for those (that's what the
  // Combine debug tool is for).

  // Cancellation is tracked per DELIVERY: order.intakeCancelledDeliveries is an array
  // of groupKeys, so cancelling one delivery never drags an order's other deliveries
  // along with it. The old order-level intakeCancelled flag is still honoured (legacy
  // data) and means "every delivery on this order is cancelled".
  // cancelledOnly=false (default): excludes cancelled entries.
  // cancelledOnly=true: returns ONLY cancelled entries.
  _entryCancelled(order, groupKey) {
    return !!order.intakeCancelled || (order.intakeCancelledDeliveries || []).includes(groupKey);
  },

  buildCategoryGroups(orders, type, cancelledOnly = false) {
    const isMat = type === 'materials';
    const flat = [];
    for (const order of orders) {
      const orderIsMat = !order.type || order.type === 'materials';
      if (orderIsMat !== isMat) continue;
      if (order.status === 'rejected') continue;
      const items = (order.items || []);
      let eligible;
      if (isMat) {
        eligible = items.filter(i => i.emailed && !i.rejected);
      } else {
        // Consumables: only emailed items are real deliveries — a saved cart with
        // un-emailed categories must not show phantom deliveries. Orders from before
        // emailed-stamping (no emailed flag anywhere) keep the legacy all-items view.
        const hasEmailedFlags = items.some(i => i.emailed);
        eligible = hasEmailedFlags
          ? items.filter(i => i.emailed && !i.rejected)
          : items.filter(i => !i.rejected);
      }
      for (const item of eligible) {
        const groupKey = item.deliveryId || `legacy:${order._id}:${item.category}`;
        const isCancelled = this._entryCancelled(order, groupKey);
        if (cancelledOnly ? !isCancelled : isCancelled) continue;
        flat.push({ item, order, groupKey });
      }
    }
    const byKey = new Map();
    for (const { item, order, groupKey } of flat) {
      if (!byKey.has(groupKey)) byKey.set(groupKey, { groupKey, category: item.category, entries: [] });
      byKey.get(groupKey).entries.push({ item, order });
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
        const boEntries = resolved ? g.entries.filter(({ order, item }) => this.outstandingOf(order, item) > 0) : [];

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
      // Drafts are keyed by bare groupKey everywhere — the derived back-order card
      // shares the full card's draft (same underlying items, filtered view).
      draftForCard:   drafts ? drafts.get(c.groupKey) : undefined,
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
    const uniqueItemCount = new Set(entries.map(e => this.mergeKey(e.item))).size;
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

    // Follow-up tag — any line short with no explanation (see needsFollowUp). Reflects
    // staged edits too, so resolving it on the card clears the tag immediately.
    const fuMerged    = this.mergeDraftEntries(entries, draftForCard);
    const hasFollowUp = !isCancelledCard && entries.some(({ order, item }) => this.needsFollowUp(order, item, fuMerged));
    const followUpTag = hasFollowUp
      ? `<span class="intake-followup-tag" title="Short delivery with no explanation — check with purchasing"><i class="ti ti-alert-triangle"></i> Follow up</span>` : '';

    // Consumables stock tag — three states: nothing applied yet ("Add to stock"),
    // applied and matching ("In stock"), or applied but the received quantities have
    // since changed ("Update stock" — a later apply posts just the difference). Only on
    // resolved consumables deliveries; not on cancelled or back-order-derived cards.
    let stockTag = '';
    if (type === 'consumables' && !isDerived && !isCancelledCard && this.TAB_RESOLVED.has(status)) {
      const deltas       = this.deliveryStockDeltas(entries, this.mergeDraftEntries(entries, null));
      const totalCurrent = deltas.reduce((s, d) => s + d.current, 0);
      const anyApplied   = this.stockEverApplied(entries);
      const drifted      = deltas.some(d => d.delta !== 0);
      if (!anyApplied && totalCurrent === 0) {
        stockTag = ''; // nothing was received — nothing to add
      } else if (!anyApplied) {
        stockTag = `<button class="intake-stock-btn" data-apply-stock="${esc(cardKey)}" title="Add the received quantities to stock now"><i class="ti ti-box-seam"></i> Add to stock</button>`;
      } else if (!drifted) {
        stockTag = `<span class="intake-stock-tag applied" title="Received quantities have been added to stock"><i class="ti ti-circle-check"></i> In stock</span>`;
      } else {
        stockTag = `<button class="intake-stock-btn update" data-apply-stock="${esc(cardKey)}" title="Received quantities changed since stock was updated — apply the difference"><i class="ti ti-refresh"></i> Update stock</button>`;
      }
    }

    // For resolved deliveries, show intake completion time instead of order submission date.
    const metaTs = (() => {
      if (!this.TAB_RESOLVED.has(status)) return ts;
      const intakeDates = entries
        .map(e => e.order.intake && e.order.intake.updatedAt && e.order.intake.updatedAt.toDate
          ? e.order.intake.updatedAt.toDate() : null)
        .filter(Boolean);
      if (!intakeDates.length) return ts;
      const latest = new Date(Math.max(...intakeDates.map(d => d.getTime())));
      return 'Received ' + latest.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    })();

    return `
      <div class="intake-card${isOpen ? ' open' : ''}" id="intake-card-${esc(safeId)}">
        <div class="intake-card-hdr" data-toggle-order="${esc(cardKey)}">
          <div class="intake-card-title">
            <div class="intake-card-ref">${esc(category)}${esc(suffix)}</div>
            <div class="intake-card-meta">${esc(metaTs)}${deviceLabel ? ' &middot; ' + esc(deviceLabel) : ''} &middot; ${uniqueItemCount} item${uniqueItemCount !== 1 ? 's' : ''}</div>
          </div>
          <div class="intake-card-right">
            ${readOnly && showRestore ? `<button class="intake-restore-btn" data-restore="${esc(groupKey)}" title="Restore to active tracking"><i class="ti ti-arrow-back-up"></i> Restore</button>` : ''}
            ${isOpen && hasDraft && !canConfirm ? `<button class="intake-save-btn" data-save="${esc(cardKey)}" title="Save progress — some items still need a status"><i class="ti ti-device-floppy"></i> Save</button>` : ''}
            ${isOpen && hasDraft && canConfirm ? `<button class="intake-confirm-btn" data-confirm="${esc(cardKey)}" title="Confirm and save changes"><i class="ti ti-check"></i> Confirm</button>` : ''}
            ${followUpTag}
            ${stockTag}
            ${this.statusBadge(badgeStatus)}
            <i class="ti ${isOpen ? 'ti-chevron-up' : 'ti-chevron-down'} intake-chevron"></i>
          </div>
        </div>
        ${isOpen ? `<div class="intake-card-body">
          ${this._renderMergedEntries(entries, { draftForCard, readOnly })}
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
    const notesOpen  = !readOnly && (this._openNotes.has(noteKey) || (!!notes && !this._closedNotes.has(noteKey)));
    const showCode   = item.partCode && !Data.isDummyCode(item.partCode);
    const orderLabel = showOrderLabel ? (order.deviceName || order.ref || order._id) : '';
    // "Still to come" (a known future shipment) applies once the line is short: B/O means
    // the whole line is coming, a short Partial can have some of it coming. Defaults are
    // set when the status button is pressed (see the host pages' intakeSetStatus).
    const outstanding     = istate.outstandingQty != null ? istate.outstandingQty : 0;
    const showOutstanding = !readOnly && (status === 'backorder' || status === 'partial');
    // A short Partial with nothing declared as coming is an unexplained shortfall —
    // flag it for the manager to chase purchasing (see needsFollowUp).
    const shortBy       = (item.qty || 0) - (qtyRecv || 0);
    const needsFollowUp = !readOnly && status === 'partial' && !istate.followUpDone
      && shortBy > 0 && outstanding <= 0;

    if (readOnly) {
      return `
        <div class="intake-item" data-item="${esc(String(item.id))}" data-order="${esc(order._id)}">
          <div class="intake-item-main">
            <div class="intake-item-info">
              <div class="intake-item-name">${esc(item.description)}</div>
              ${showCode ? `<div class="intake-item-code">${esc(item.partCode)}</div>` : ''}
              ${orderLabel ? `<div class="intake-item-order-label">${esc(orderLabel)}</div>` : ''}
              <div class="intake-item-ordered">Ordered: <strong>${esc(orderQtyDisplay(item, item.qty))}</strong></div>
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
            <div class="intake-item-ordered">Ordered: <strong>${esc(orderQtyDisplay(item, item.qty))}</strong></div>
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
          <span class="intake-of-label">of ${esc(orderQtyDisplay(item, item.qty))}</span>
        </div>` : ''}
        ${showOutstanding ? `
        <div class="intake-partial-row intake-outstanding-row">
          <label>Still to come:</label>
          <input class="intake-partial-input" type="number" min="0" step="1"
            value="${outstanding || ''}" placeholder="0"
            data-outstanding-item="${esc(String(item.id))}" data-outstanding-order="${esc(order._id)}">
          <span class="intake-of-label">of ${esc(orderQtyDisplay(item, item.qty))}</span>
          ${outstanding > 0 ? `<button class="intake-arrived-btn" data-arrived-item="${esc(String(item.id))}" data-arrived-order="${esc(order._id)}" title="The outstanding amount has now arrived"><i class="ti ti-check"></i> Arrived</button>` : ''}
        </div>` : ''}
        ${needsFollowUp ? `
        <div class="intake-followup-row">
          <i class="ti ti-alert-triangle"></i>
          <span>Short by ${shortBy} — check with purchasing</span>
          <button class="intake-fu-btn coming" data-followup-action="coming" data-followup-item="${esc(String(item.id))}" data-followup-order="${esc(order._id)}" title="Purchasing confirmed the rest is on its way — track it as a back order">Rest is coming</button>
          <button class="intake-fu-btn" data-followup-action="dismiss" data-followup-item="${esc(String(item.id))}" data-followup-order="${esc(order._id)}" title="Nothing more is coming — close this line">No more coming</button>
        </div>` : ''}
        ${notesOpen ? `
        <div class="intake-notes-row">
          <textarea class="intake-notes-input" rows="2"
            data-notes-item="${esc(String(item.id))}" data-notes-order="${esc(order._id)}"
            placeholder="Back order, wrong sizes, delivery notes…">${esc(notes)}</textarea>
        </div>` : ''}
      </div>`;
  },

  // Groups entries with the same mergeKey and renders a single flat row per unique item.
  // When multiple orders contributed the same catalog item to a delivery, their quantities
  // are summed into one row — indistinguishable from a single-order item at the delivery stage.
  // Rows are sorted by description, then grouped by subcategory when multiple exist.
  _renderMergedEntries(entries, { draftForCard, readOnly }) {
    const byItemId = new Map();
    for (const entry of entries) {
      const key = this.mergeKey(entry.item);
      if (!byItemId.has(key)) byItemId.set(key, []);
      byItemId.get(key).push(entry);
    }

    // Merge multi-order groups into a single representative row object.
    const rows = [...byItemId.values()].map(group => {
      const { item, order } = group[0];
      const mergedItem = group.length === 1 ? item : { ...item, qty: group.reduce((s, e) => s + (e.item.qty || 0), 0) };
      return { order, item: mergedItem };
    });

    // Sort by description, same natural order as the material ordering form.
    rows.sort((a, b) => naturalCompare(a.item.description || '', b.item.description || ''));

    // Group by subcategory. If only one subcategory, render flat without labels.
    const subcats = [...new Set(rows.map(r => r.item.subcategory || 'General'))];
    if (subcats.length <= 1) {
      return rows.map(r => this.renderItemRow(r.order, r.item, { draftForCard, readOnly })).join('');
    }
    return subcats.map(sub => {
      const subRows = rows.filter(r => (r.item.subcategory || 'General') === sub);
      return `<div class="intake-subcat-label">${esc(sub)}</div>` +
        subRows.map(r => this.renderItemRow(r.order, r.item, { draftForCard, readOnly })).join('');
    }).join('');
  },

  // ── EVENT WIRING ─────────────────────────────────────────────────────
  // Attach all intake interactions to a container element.
  // callbacks: { onAction(orderId, itemId, action), onQtyChange(orderId, itemId, qty),
  //   onNoteChange(orderId, itemId, text), onRerender(cardKey), onConfirm(cardKey),
  //   onSave(cardKey), onRestore(groupKey) }
  attachListeners(container, callbacks) {
    container.addEventListener('click', e => {
      // Confirm button — sits inside the header, must be checked before the toggle handler.
      const confirmBtn = e.target.closest('[data-confirm]');
      if (confirmBtn) {
        if (confirmBtn.disabled) return;
        if (callbacks.onConfirm) callbacks.onConfirm(confirmBtn.dataset.confirm);
        return;
      }

      // Save button — partial progress save, same position as confirm.
      const saveBtn = e.target.closest('[data-save]');
      if (saveBtn) {
        if (callbacks.onSave) callbacks.onSave(saveBtn.dataset.save);
        return;
      }

      // "Add to stock" tag-button on a resolved consumables delivery.
      const applyStockBtn = e.target.closest('[data-apply-stock]');
      if (applyStockBtn) {
        if (callbacks.onApplyStock) callbacks.onApplyStock(applyStockBtn.dataset.applyStock);
        return;
      }

      // "Arrived" on a back-ordered line — books the outstanding amount as received.
      const arrivedBtn = e.target.closest('[data-arrived-item]');
      if (arrivedBtn) {
        if (callbacks.onArrived) callbacks.onArrived(arrivedBtn.dataset.arrivedOrder, arrivedBtn.dataset.arrivedItem);
        return;
      }

      // Resolving a short-delivery follow-up: 'coming' (becomes a back order) or 'dismiss'.
      const fuBtn = e.target.closest('[data-followup-action]');
      if (fuBtn) {
        if (callbacks.onFollowUp) callbacks.onFollowUp(fuBtn.dataset.followupOrder, fuBtn.dataset.followupItem, fuBtn.dataset.followupAction);
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
        this._toggleNotes(infoEl.dataset.notesOrder, infoEl.dataset.notesToggle);
        if (callbacks.onRerender) callbacks.onRerender(infoEl.dataset.notesOrder);
        return;
      }

      // Status / notes button
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, item: itemId, order: orderId } = btn.dataset;

      if (action === 'notes') {
        this._toggleNotes(orderId, itemId);
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
      const out = e.target.closest('[data-outstanding-item]');
      if (out && callbacks.onOutstandingChange) {
        callbacks.onOutstandingChange(out.dataset.outstandingOrder, out.dataset.outstandingItem, parseInt(out.value) || 0);
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
