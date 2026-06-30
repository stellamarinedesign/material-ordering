// intake.js — v0.36
// Shared intake rendering module used by warehouse.html and manager.html.

const Intake = {
  // UI-only state: which items have their notes field open.
  // Key format: "orderId__itemId"
  _openNotes: new Set(),

  // ── STATUS LOGIC ────────────────────────────────────────────────────

  // Computes the overall intake status for an order.
  // For materials orders, only emailed items are considered (others not yet ordered).
  // For consumables orders, all items are considered.
  computeStatus(order) {
    const isMaterials = !order.type || order.type === 'materials';
    const items = (order.items || []).filter(i => isMaterials ? !!i.emailed : true);
    if (!items.length) return 'pending';
    const intakeItems = (order.intake && order.intake.items) || {};
    const statuses = items.map(i => (intakeItems[String(i.id)] || {}).status || 'pending');
    if (statuses.every(s => s === 'pending'))  return 'pending';
    if (statuses.every(s => s === 'ok'))       return 'received';
    const allResolved = statuses.every(s => s === 'ok' || s === 'backorder');
    if (allResolved && statuses.some(s => s === 'backorder')) return 'backorder';
    return 'in_progress';
  },

  statusBadge(status) {
    const cfg = {
      pending:     { icon: 'ti-clock',         label: 'Pending',      col: 'var(--text3)',       bg: 'var(--bg2)'       },
      in_progress: { icon: 'ti-loader-2',       label: 'In Progress',  col: 'var(--amber-text)',  bg: 'var(--amber-bg)'  },
      received:    { icon: 'ti-circle-check',   label: 'Received',     col: 'var(--green-text)',  bg: 'var(--green-bg)'  },
      backorder:   { icon: 'ti-clock-pause',    label: 'Back Order',   col: 'var(--blue-text)',   bg: 'var(--blue-bg)'   },
    };
    const c = cfg[status] || cfg.pending;
    return `<span class="intake-status-badge" style="color:${c.col};background:${c.bg}"><i class="ti ${c.icon}"></i> ${c.label}</span>`;
  },

  // ── FILTERING ────────────────────────────────────────────────────────

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

  // ── RENDERING ────────────────────────────────────────────────────────

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

  renderItemRow(order, item) {
    const intakeMap  = (order.intake && order.intake.items) || {};
    const istate     = intakeMap[String(item.id)] || {};
    const status     = istate.status || null;
    const qtyRecv    = istate.qtyReceived;
    const notes      = istate.notes || '';
    const noteKey    = `${order._id}__${item.id}`;
    const notesOpen  = this._openNotes.has(noteKey) || !!notes;
    const showCode   = item.partCode && !Data.isDummyCode(item.partCode);

    return `
      <div class="intake-item" data-item="${esc(String(item.id))}" data-order="${esc(order._id)}">
        <div class="intake-item-main">
          <div class="intake-item-info" data-notes-toggle="${esc(String(item.id))}" data-notes-order="${esc(order._id)}">
            <div class="intake-item-name">${esc(item.description)}</div>
            ${showCode ? `<div class="intake-item-code">${esc(item.partCode)}</div>` : ''}
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

  // ── EVENT WIRING ─────────────────────────────────────────────────────
  // Attach all intake interactions to a container element.
  // callbacks: { onAction(orderId, itemId, action), onQtyChange(orderId, itemId, qty), onNoteChange(orderId, itemId, text), onRerender(orderId) }
  attachListeners(container, callbacks) {
    container.addEventListener('click', e => {
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
