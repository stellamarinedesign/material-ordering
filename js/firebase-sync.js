// firebase-sync.js — Firestore wrapper

let _db = null;
let _configured = false;

const DB = {
  async init(config) {
    if (_configured) return true;
    try {
      firebase.initializeApp(config);
      _db = firebase.firestore();
      _configured = true;
      return true;
    } catch (e) {
      console.error('Firebase init failed:', e);
      return false;
    }
  },

  isReady() { return _configured && _db !== null; },

  // ── ORDERS ──
  async submitOrder(order) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = await _db.collection('orders').add({
      ...order,
      status: 'pending',
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },

  listenOrders(callback) {
    if (!this.isReady()) return () => {};
    return _db.collection('orders')
      .orderBy('submittedAt', 'desc')
      .onSnapshot(snap => {
        const orders = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        callback(orders);
      }, err => console.error('Firestore listen error:', err));
  },

  async updateStatus(id, status) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).update({
      status,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async updateItems(id, items) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).update({
      items,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async deleteOrder(id) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).delete();
  },

  // ── MATERIALS SYNC (manager pushes, worker receives) ──
  async pushMaterials(materials) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('config').doc('materials').set({
      list: materials,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async fetchMaterials() {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const doc = await _db.collection('config').doc('materials').get();
    if (doc.exists) return doc.data().list;
    return null;
  },

  listenMaterials(callback) {
    if (!this.isReady()) return () => {};
    return _db.collection('config').doc('materials')
      .onSnapshot(doc => {
        if (doc.exists) callback(doc.data().list);
      }, err => console.error('Materials listen error:', err));
  },
};
