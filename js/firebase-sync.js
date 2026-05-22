// firebase-sync.js — Firestore wrapper used by both pages
// Loaded after firebase SDKs via CDN

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

  // Submit a new order from the iPad
  async submitOrder(order) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = await _db.collection('orders').add({
      ...order,
      status: 'pending',
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },

  // Listen for orders in real-time (manager view)
  listenOrders(callback) {
    if (!this.isReady()) return () => {};
    return _db.collection('orders')
      .orderBy('submittedAt', 'desc')
      .onSnapshot(snap => {
        const orders = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        callback(orders);
      }, err => console.error('Firestore listen error:', err));
  },

  // Update order status
  async updateStatus(id, status) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).update({
      status,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Update order items (manager can edit quantities)
  async updateItems(id, items, totals) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).update({
      items, totals,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Delete an order
  async deleteOrder(id) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).delete();
  },

  // Test connection
  async testConnection() {
    try {
      await _db.collection('_test').doc('ping').set({ ping: true });
      await _db.collection('_test').doc('ping').delete();
      return true;
    } catch { return false; }
  },
};
