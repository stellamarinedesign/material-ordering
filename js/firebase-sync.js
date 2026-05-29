// firebase-sync.js — v17
let _db = null, _configured = false;

const DB = {
  async init(config) {
    if (_configured) return true;
    try { firebase.initializeApp(config); _db = firebase.firestore(); _configured = true; return true; }
    catch(e) { console.error('Firebase init failed:', e); return false; }
  },
  isReady() { return _configured && _db !== null; },

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

  // Mark specific category as emailed within an order.
  // Sets item.emailed=true for all items in that category.
  // If all items in the order are now emailed, marks order status='sent'.
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

  async deleteAllOrders() {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const snap = await _db.collection('orders').get();
    const batch = _db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  },
};
