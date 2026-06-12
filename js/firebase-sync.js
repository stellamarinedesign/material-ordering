// firebase-sync.js — v18
let _db = null, _configured = false;

const DB = {
  async init(config) {
    if (_configured) return true;
    try { firebase.initializeApp(config); _db = firebase.firestore(); _configured = true; return true; }
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

  async markCategoryEmailed(orderId, category) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const doc   = await _db.collection('orders').doc(orderId).get();
    if (!doc.exists) return;
    const order = doc.data();
    const items = (order.items||[]).map(item =>
      item.category === category ? { ...item, emailed: true } : item
    );
    const allEmailed = items.every(i => i.emailed);
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
    const allEmailed = items.every(i => i.emailed);
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

  // Enable tracking for an item (creates doc if not exists, or sets tracked=true)
  async enableTracking(stockId, initialQty) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('stock').doc(stockId).set({
      qty:        initialQty || 0,
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
  // Returns new qty, throws if checkout would go negative.
  async adjustStock(stockId, itemName, delta, action, by) {
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
    _db.collection('stock_history').add({
      stockId,
      itemName:  itemName || '',
      delta,
      newQty,
      action,
      by:        by || '',
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(e => console.warn('History write failed:', e));
    return newQty;
  },

  // Absolute set (for physical stocktake override).
  async setStock(stockId, itemName, newQty, by) {
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
      by:        by || '',
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(e => console.warn('History write failed:', e));
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
};
