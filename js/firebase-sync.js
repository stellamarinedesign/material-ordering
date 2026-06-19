// firebase-sync.js — v0.32
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
  async adjustStock(stockId, itemName, delta, action, by, sessionId) {
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
      by:         by || '',
      sessionId:  sessionId || null,
      reverted:   false,
      timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(e => console.warn('History write failed:', e));
    return newQty;
  },

  // Absolute set (for physical stocktake override).
  async setStock(stockId, itemName, newQty, by, sessionId) {
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
