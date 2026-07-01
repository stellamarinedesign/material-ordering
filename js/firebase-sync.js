// firebase-sync.js — v0.37.3
let _db = null, _configured = false;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APP CHECK — Firebase request verification via reCAPTCHA v3.
// Invisible to end users. Blocks bots/scripts that extract the
// Firebase config from page source and try to access Firestore.
//
// TO REMOVE: delete this entire block (between the ━ lines),
// remove the firebase-app-check-compat.js script tag from all
// HTML files, and set enforcement to "unenforced" in the Firebase
// console (App Check → your app → overflow menu → Unenforce).
//
// SITE KEY: replace REPLACE_WITH_RECAPTCHA_SITE_KEY below with
// the key from: Firebase Console → App Check → Apps → Register
// → reCAPTCHA v3 → your site key.
const APPCHECK_SITE_KEY = '6LcvOCctAAAAAFXUhpQRg2c09P1g5l7qULqwZCbh';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DB = {
  async init(config) {
    if (_configured) return true;
    try {
      firebase.initializeApp(config);

      // ── APP CHECK INIT (remove this block to disable App Check) ──
      if (typeof firebase.appCheck === 'function' && APPCHECK_SITE_KEY !== 'REPLACE_WITH_RECAPTCHA_SITE_KEY') {
        try {
          firebase.appCheck().activate(
            new firebase.appCheck.ReCaptchaV3Provider(APPCHECK_SITE_KEY),
            true  // auto-refresh tokens
          );
        } catch(acErr) {
          console.warn('[AppCheck] Activation failed — continuing without it:', acErr.message);
        }
      }
      // ── END APP CHECK INIT ────────────────────────────────────────

      _db = firebase.firestore();
      _configured = true;
      return true;
    }
    catch(e) { console.error('Firebase init failed:', e); return false; }
  },
  isReady() { return _configured && _db !== null; },

  // ── ORDERS ────────────────────────────────────────────────────────
  async submitOrder(order) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = await _db.collection('orders').add({
      ...order, status:'pending',
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },

  listenOrders(callback) {
    if (!this.isReady()) return ()=>{};
    return _db.collection('orders').orderBy('submittedAt','desc')
      .onSnapshot(snap=>callback(snap.docs.map(d=>({_id:d.id,...d.data()}))),
        err=>console.error('Listen error:',err));
  },

  // ── CONNECTION STATUS & APP VERSION ─────────────────────────────────
  // Live connection indicator: fires true/false as Firestore's connection
  // state actually changes. Uses snapshot metadata.fromCache rather than
  // mere snapshot arrival — onSnapshot can resolve instantly from local
  // cache even while fully offline, so "a snapshot arrived" is NOT a
  // reliable signal on its own. fromCache:false means the data was just
  // confirmed live from the server; fromCache:true means it's either
  // served from cache while offline, or a pending local write.
  listenConnectionStatus(callback) {
    if (!this.isReady()) { callback(false); return ()=>{}; }
    let settled = false;
    const unsub = _db.collection('meta').doc('version').onSnapshot(
      { includeMetadataChanges: true },
      snap => { settled = true; callback(!snap.metadata.fromCache); },
      ()   => { settled = true; callback(false); }
    );
    // Fallback in case neither callback fires within a few seconds
    // (e.g. a fully offline device that never gets even a cached read).
    setTimeout(() => { if (!settled) callback(false); }, 5000);
    return unsub;
  },

  // Listens to the shared "latest known version" marker.
  // Doc shape: { latest: "v0.32" } at meta/version.
  listenAppVersion(callback) {
    if (!this.isReady()) return ()=>{};
    return _db.collection('meta').doc('version').onSnapshot(
      doc => callback(doc.exists ? doc.data().latest : null),
      err => console.warn('Version listen error:', err)
    );
  },

  // Announces this client's version as the latest known one, but ONLY if
  // it's numerically higher than what's currently stored — so an old
  // cached tab reconnecting can't drag the marker backwards, and a
  // deliberate rollback (manually editing the Firestore field down) won't
  // immediately get overwritten by a stale client still re-announcing.
  async announceVersionIfNewer(myVersion, isNewerFn) {
    if (!this.isReady()) return;
    const ref = _db.collection('meta').doc('version');
    try {
      const doc = await ref.get();
      const current = doc.exists ? doc.data().latest : null;
      if (!current || isNewerFn(myVersion, current)) {
        await ref.set({ latest: myVersion }, { merge: true });
      }
    } catch(e) { console.warn('Version announce failed:', e); }
  },

  async updateStatus(id, status) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).update({
      status, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async updateItems(id, items) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).update({
      items, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Fresh read-modify-write append — used when a cart session's items need to land on
  // an order doc that may have just been created/updated by a different action moments
  // ago (e.g. New Order tab: email one category, then add the rest to the queue). Reads
  // the doc directly rather than trusting the client's local snapshot cache, which could
  // still be a beat behind the write that just happened. Also skips any item whose id is
  // already present — the New Order/CO cart-saving pattern persists the WHOLE cart on
  // the first email from a session (not just the emailed category), so by the time a
  // later "add remaining to queue" runs, those items are usually already saved; without
  // this dedupe they'd be appended a second time.
  async appendItems(orderId, newItems) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('orders').doc(orderId);
    const doc = await ref.get();
    if (!doc.exists) throw new Error('Order not found');
    const existing = doc.data().items || [];
    const existingIds = new Set(existing.map(i => String(i.id)));
    const toAdd = newItems.filter(i => !existingIds.has(String(i.id)));
    if (!toAdd.length) return;
    await ref.update({
      items: [...existing, ...toAdd],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // deliveryId: shared across every order contributing to the same real email send, so
  // the Deliveries/Sent pages can group them as one delivery instead of one per order.
  // Only items newly transitioning to emailed get stamped — an already-emailed sibling
  // (from an earlier, separate send) must keep its own deliveryId untouched, or a later
  // partial send of the same category would silently merge two unrelated deliveries.
  async markCategoryEmailed(orderId, category, excludePartCodes = [], deliveryId = null) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const doc   = await _db.collection('orders').doc(orderId).get();
    if (!doc.exists) return;
    const order = doc.data();
    const excludeSet = new Set(excludePartCodes);
    const items = (order.items||[]).map(item =>
      item.category === category && !excludeSet.has(item.partCode) && !item.emailed
        ? { ...item, emailed: true, deliveryId }
        : item
    );
    const nonRejected = items.filter(i => !i.rejected);
    const allEmailed  = nonRejected.length > 0 && nonRejected.every(i => i.emailed);
    await _db.collection('orders').doc(orderId).update({
      items,
      status:    allEmailed ? 'sent' : 'pending',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async deleteOrder(id) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).delete();
  },

  async rejectItem(orderId, partCode) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const doc   = await _db.collection('orders').doc(orderId).get();
    if (!doc.exists) return;
    const order = doc.data();
    const items = (order.items || []).map(item =>
      item.partCode === partCode ? { ...item, rejected: true } : item
    );
    const nonRejected = items.filter(i => !i.rejected);
    let newStatus = 'pending';
    if (nonRejected.length === 0)               newStatus = 'rejected';
    else if (nonRejected.every(i => i.emailed)) newStatus = 'sent';
    else                                         newStatus = 'pending';
    await _db.collection('orders').doc(orderId).update({
      items, status: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async resetCategoryEmailed(orderId, category) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const doc = await _db.collection('orders').doc(orderId).get();
    if (!doc.exists) return;
    const items = (doc.data().items || []).map(item =>
      item.category === category ? { ...item, emailed: false } : item
    );
    await _db.collection('orders').doc(orderId).update({
      items, status: 'pending',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Saves a consumables order to Firestore (mirroring materials orders so intake can track it).
  // Called when the first category email is sent from the CO cart.
  async submitConsumablesOrder(order) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = await _db.collection('orders').add({
      ...order,
      type: 'consumables',
      status: 'pending',
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },

  // Marks all items in an order as emailed and sets status to 'sent'.
  // Used for consumables bulk-email ("Email all consumables at once"). Generates a
  // separate deliveryId per category present (not one shared across categories) so
  // every delivery card stays single-category — and, like markCategoryEmailed, only
  // stamps items that are newly transitioning to emailed in this call.
  async markAllEmailed(orderId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const doc = await _db.collection('orders').doc(orderId).get();
    if (!doc.exists) return;
    const catIdMap = {};
    const items = (doc.data().items || []).map(item => {
      if (item.rejected || item.emailed) return item;
      if (!catIdMap[item.category]) catIdMap[item.category] = genDeliveryId();
      return { ...item, emailed: true, deliveryId: catIdMap[item.category] };
    });
    const nonRejected = items.filter(i => !i.rejected);
    const allEmailed  = nonRejected.length > 0 && nonRejected.every(i => i.emailed);
    await _db.collection('orders').doc(orderId).update({
      items,
      status: allEmailed ? 'sent' : 'pending',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Records intake status for one or more items on an order.
  // intakeItems: { [itemId]: { status: 'ok'|'partial'|'missing'|'backorder'|null, qtyReceived, notes } }
  // totalItems: total line-item count in the order (used to compute overall status).
  async updateIntake(orderId, intakeItems, updatedBy, totalItems) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const RESOLVED = new Set(['ok', 'partial', 'missing', 'backorder']);
    const statuses = Object.values(intakeItems || {})
      .map(i => i.status)
      .filter(s => !!s && s !== 'pending');
    let intakeStatus = 'pending';
    if (statuses.length > 0) {
      const allActioned = statuses.length >= (totalItems || 1) && statuses.every(s => RESOLVED.has(s));
      if (!allActioned)                               intakeStatus = 'in_progress';
      else if (statuses.every(s => s === 'ok'))        intakeStatus = 'received';
      else if (statuses.some(s => s === 'backorder'))  intakeStatus = 'backorder';
      else                                              intakeStatus = 'completed';
    }
    await _db.collection('orders').doc(orderId).update({
      'intake.items':     intakeItems || {},
      'intake.status':    intakeStatus,
      'intake.updatedBy': updatedBy || '',
      'intake.updatedAt': firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:          firebase.firestore.FieldValue.serverTimestamp(),
    });
    return intakeStatus;
  },

  // Sets/clears the intake-only cancellation flag for an order. Independent of
  // `status` (Queue/ordering flow) and per-item `rejected` — a cancelled order
  // just stops being tracked for receiving and moves to the Cancelled tab.
  async setOrderIntakeCancelled(orderId, cancelled) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(orderId).update({
      intakeCancelled: !!cancelled,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Manual cleanup tool: merges items[] (and any intake progress) from
  // sourceOrderIds into targetOrderId, then hard-deletes the source docs.
  // Mainly for legacy orders emailed before category-based grouping existed.
  async combineOrders(targetOrderId, sourceOrderIds) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const targetRef = _db.collection('orders').doc(targetOrderId);
    const targetDoc = await targetRef.get();
    if (!targetDoc.exists) throw new Error('Target order not found');
    const targetData = targetDoc.data();
    const items = [...(targetData.items || [])];
    const intakeItems = { ...((targetData.intake && targetData.intake.items) || {}) };
    const seenIds = new Set(items.map(i => String(i.id)));

    for (const srcId of sourceOrderIds) {
      if (srcId === targetOrderId) continue;
      const srcDoc = await _db.collection('orders').doc(srcId).get();
      if (!srcDoc.exists) continue;
      const srcData = srcDoc.data();
      const srcIntake = (srcData.intake && srcData.intake.items) || {};
      for (const item of (srcData.items || [])) {
        let id = String(item.id);
        if (seenIds.has(id)) {
          // Item id collides with one already in the merged set (same catalog item
          // ordered in both orders) — rekey so its intake status doesn't get conflated.
          const newId = `${id}_${srcId.slice(0, 4)}`;
          if (srcIntake[id]) intakeItems[newId] = srcIntake[id];
          items.push({ ...item, id: newId });
          seenIds.add(newId);
        } else {
          if (srcIntake[id] && !intakeItems[id]) intakeItems[id] = srcIntake[id];
          items.push(item);
          seenIds.add(id);
        }
      }
    }

    // Merged items fall back to the legacy (orderId+category) grouping key rather than
    // keep whatever deliveryId they carried before — Combine is specifically the tool for
    // pre-deliveryId legacy data, and a stale id here would misleadingly split the newly
    // merged order back into separate delivery cards.
    items.forEach(i => { i.deliveryId = null; });

    const batch = _db.batch();
    batch.update(targetRef, {
      items,
      'intake.items': intakeItems,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    for (const srcId of sourceOrderIds) {
      if (srcId !== targetOrderId) batch.delete(_db.collection('orders').doc(srcId));
    }
    await batch.commit();
  },

  async rejectOrder(id) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).update({
      status: 'rejected',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async deleteAllOrders() {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const snap = await _db.collection('orders').get();
    const batch = _db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  },

  async resetItemEmailed(orderId, category, partCode) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const doc = await _db.collection('orders').doc(orderId).get();
    if (!doc.exists) return;
    const items = (doc.data().items || []).map(item =>
      (item.category === category && item.partCode === partCode)
        ? { ...item, emailed: false }
        : item
    );
    const nonRejected = items.filter(i => !i.rejected);
    const allEmailed  = nonRejected.length > 0 && nonRejected.every(i => i.emailed);
    await _db.collection('orders').doc(orderId).update({
      items,
      status: allEmailed ? 'sent' : 'pending',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async resetOrderToPending(orderId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const doc = await _db.collection('orders').doc(orderId).get();
    if (!doc.exists) return;
    const items = (doc.data().items || []).map(item => ({ ...item, emailed: false }));
    await _db.collection('orders').doc(orderId).update({
      items,
      status: 'pending',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // ── STOCK ─────────────────────────────────────────────────────────
  // One document per consumable item, keyed by stable stockId.
  // Fields: qty, reorderQty, warningQty, tracked (bool)

  listenStock(callback) {
    if (!this.isReady()) return ()=>{};
    return _db.collection('stock')
      .onSnapshot(
        snap => callback(snap.docs.map(d => ({ _id: d.id, ...d.data() }))),
        err  => console.error('Stock listen error:', err)
      );
  },

  // Enable tracking for an item (creates doc if not exists, or sets tracked=true).
  // Always starts at qty 0 — caller should use adjustStock for any initial qty
  // so the history record and stock total stay in sync (avoids double-counting).
  async enableTracking(stockId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('stock').doc(stockId).set({
      qty:        0,
      reorderQty: 0,
      warningQty: 0,
      tracked:    true,
    }, { merge: true });
  },

  // Disable tracking (keeps doc but sets tracked=false)
  async disableTracking(stockId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('stock').doc(stockId).update({ tracked: false });
  },

  // Update thresholds only (reorderQty / warningQty)
  async updateThresholds(stockId, reorderQty, warningQty) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('stock').doc(stockId).set(
      { reorderQty: reorderQty || 0, warningQty: warningQty || 0 },
      { merge: true }
    );
  },

  // Delta-based adjustment (intake, checkout, or manual override).
  // action: 'intake' | 'checkout' | 'adjustment'
  // by: display string e.g. "John Smith" or "Workshop iPad — Tom"
  // sessionId: optional — groups multiple line items from one checkout/intake batch
  // Returns new qty, throws if checkout would go negative.
  async adjustStock(stockId, itemName, delta, action, by, sessionId, subtype) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('stock').doc(stockId);
    let newQty;
    await _db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error('Stock record not found');
      const current = doc.data().qty || 0;
      newQty = current + delta;
      if (newQty < 0) throw new Error('INSUFFICIENT_STOCK');
      tx.update(ref, { qty: newQty });
    });
    // Write history record outside the transaction (best-effort, non-blocking)
    const histRef = _db.collection('stock_history').doc();
    histRef.set({
      stockId,
      itemName:  itemName || '',
      delta,
      newQty,
      action,
      subtype:    subtype || null,
      by:         by || '',
      sessionId:  sessionId || null,
      reverted:   false,
      timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(e => console.warn('History write failed:', e));
    return newQty;
  },

  // Absolute set (for physical stocktake override).
  async setStock(stockId, itemName, newQty, by, sessionId, subtype) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('stock').doc(stockId);
    const doc = await ref.get();
    const oldQty = doc.exists ? (doc.data().qty || 0) : 0;
    await ref.set({ qty: newQty }, { merge: true });
    _db.collection('stock_history').add({
      stockId,
      itemName:  itemName || '',
      delta:     newQty - oldQty,
      newQty,
      action:    'adjustment',
      subtype:    subtype || 'override',
      by:         by || '',
      sessionId:  sessionId || null,
      reverted:   false,
      timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(e => console.warn('History write failed:', e));
  },

  // Revert a history record: applies a compensating adjustment (−delta) to the
  // affected stock item, then marks the original record reverted (greyed out, ignored).
  // Does not delete or rewrite the original — stays append-only.
  async revertHistoryRecord(historyId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const histRef = _db.collection('stock_history').doc(historyId);
    const histDoc = await histRef.get();
    if (!histDoc.exists) throw new Error('History record not found');
    const rec = histDoc.data();
    if (rec.reverted) return; // already reverted, no-op
    const stockRef = _db.collection('stock').doc(rec.stockId);
    await _db.runTransaction(async tx => {
      const doc = await tx.get(stockRef);
      const current = doc.exists ? (doc.data().qty || 0) : 0;
      const newQty  = current - rec.delta;
      tx.update(stockRef, { qty: newQty < 0 ? 0 : newQty });
    });
    await histRef.update({ reverted: true });
  },

  // Reverses a revert: re-applies the original delta and clears the reverted flag.
  async unrevertHistoryRecord(historyId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const histRef = _db.collection('stock_history').doc(historyId);
    const histDoc = await histRef.get();
    if (!histDoc.exists) throw new Error('History record not found');
    const rec = histDoc.data();
    if (!rec.reverted) return; // not reverted, no-op
    const stockRef = _db.collection('stock').doc(rec.stockId);
    await _db.runTransaction(async tx => {
      const doc = await tx.get(stockRef);
      const current = doc.exists ? (doc.data().qty || 0) : 0;
      tx.update(stockRef, { qty: current + rec.delta });
    });
    await histRef.update({ reverted: false });
  },

  // ── STOCK HISTORY ─────────────────────────────────────────────────
  // Paginated fetch, newest first. Pass lastDoc for subsequent pages.
  async fetchHistory(stockId, limitN, lastDoc) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    let q = _db.collection('stock_history').orderBy('timestamp', 'desc').limit(limitN || 50);
    if (stockId) q = q.where('stockId', '==', stockId);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    return {
      records:  snap.docs.map(d => ({ _id: d.id, ...d.data() })),
      lastDoc:  snap.docs[snap.docs.length - 1] || null,
      hasMore:  snap.docs.length === (limitN || 50),
    };
  },

  // Fetch all records sharing a sessionId (used for whole-session revert/delete)
  async fetchSessionRecords(sessionId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const snap = await _db.collection('stock_history').where('sessionId', '==', sessionId).get();
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  },

  // Permanently deletes a single history record (only meaningful for already-reverted records)
  async deleteHistoryRecord(historyId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('stock_history').doc(historyId).delete();
  },
};
