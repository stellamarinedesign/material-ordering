// firebase-sync.js — v2026-11-26.1
let _db = null, _configured = false, _config = null, _second = null;

// Signed-in email for stamping writes (null when the device isn't signed in —
// phase 1 of the auth rollout, see js/auth.js). Guarded so the module still
// works on a page that hasn't loaded the auth SDK.
function _who() {
  try { return (typeof firebase.auth === 'function' && firebase.auth().currentUser) ? (firebase.auth().currentUser.email || null) : null; }
  catch { return null; }
}
// A change that reads first, or touches several records. A connection that never answers
// would leave its button locked on "Saving…" for good, so it gets 20 seconds and then
// counts as dropped; nothing is sent after that. If the write had already left, it may
// still land, so this is only for changes that are safe to repeat.
const TX_WAIT = 20000;
function _tx(fn) {
  let over = false, timer;
  const dropped = () => Object.assign(new Error('The connection dropped'), { code: 'deadline-exceeded' });
  const slow = new Promise((_, no) => { timer = setTimeout(() => { over = true; no(dropped()); }, TX_WAIT); });
  const work = _db.runTransaction(async tx => {
    if (over) throw dropped();
    const out = await fn(tx);
    if (over) throw dropped();
    return out;
  });
  return Promise.race([work, slow]).finally(() => clearTimeout(timer));
}
// Listener errors funnel here; a permission-denied means the rules now require
// sign-in and this device has none — pages set DB.onDenied to prompt for it.
function _listenErr(label, err) {
  console.error(label, err);
  if (err && err.code === 'permission-denied' && typeof DB.onDenied === 'function') DB.onDenied(err);
}

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
  onDenied: null,   // set by each page — called on a permission-denied listener error

  async init(config) {
    if (_configured) return true;
    try {
      _config = config;
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
      // ON-DEVICE STORE. Writes made offline are kept in IndexedDB, survive a
      // reload or app restart, and send themselves in order when the
      // connection returns; reads come from the last data seen. One store per
      // origin (synchronizeTabs): the manager PC may have several tabs open,
      // and each iPad page is its own context.
      try { await _db.enablePersistence({ synchronizeTabs: true }); }
      catch (e) { console.warn('[Firestore] no on-device store — queued writes will not survive a reload:', (e && e.code) || e); }
      _configured = true;
      return true;
    }
    catch(e) { console.error('Firebase init failed:', e); return false; }
  },
  isReady() { return _configured && _db !== null; },

  // ── ACCOUNTS & ROLES ──────────────────────────────────────────────
  // settings/access: { managers, engineers, floor, masters } — the one
  // document that says who is what (model in js/auth.js). The rules read it
  // too, so an unlisted account's listener here is refused: callback(null, err).
  async loadAccess() {
    if (!this.isReady()) return null;
    const d = await _db.collection('settings').doc('access').get();
    return d.exists ? d.data() : null;
  },
  listenAccess(callback) {
    if (!this.isReady()) return ()=>{};
    return _db.collection('settings').doc('access').onSnapshot(
      snap => callback(snap.exists ? snap.data() : null, null),
      err  => { console.warn('Access listen error:', err); callback(null, err); }
    );
  },
  // All four lists. The rules let only a master write this — or anyone
  // signed in the first time, when it doesn't exist yet.
  async saveAccess({ managers, engineers, floor, masters }) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('settings').doc('access').set({
      managers: managers || [], engineers: engineers || [], floor: floor || [], masters: masters || [],
      updatedAt: new Date().toISOString(), updatedBy: _who() || '',
    }, { merge: true });
  },
  // Who changed the accounts, append-only. A failed log write is a warning,
  // never a lost change. Newest first (single-field orderBy — no index).
  async logActivity(entry) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('activity').add(entry);
  },
  async listActivity(limitN) {
    if (!this.isReady()) return [];
    const snap = await _db.collection('activity').orderBy('at', 'desc').limit(limitN || 20).get();
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  },
  // Make a Firebase user from the app, as a master. createUserWithEmailAndPassword
  // signs the new user in on whichever app it is called on, so it's done on a
  // SECOND app (same config, named 'accounts') and signed out again at once —
  // the master's own session is untouched. Needs "Enable create (sign-up)" on
  // in the console; the rules make sign-up harmless (unlisted reads nothing).
  async createAccount(email, password) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    if (!_second) _second = firebase.apps.find(a => a.name === 'accounts') || firebase.initializeApp(_config, 'accounts');
    await _second.auth().createUserWithEmailAndPassword(String(email || '').trim().toLowerCase(), password);
    await _second.auth().signOut();
  },

  // ── ORDERS ────────────────────────────────────────────────────────
  async submitOrder(order) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = await _db.collection('orders').add({
      ...order, status:'pending', authEmail: _who(),
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },

  // The offline-safe way to place an order (worker page). The order is written
  // under an id made on the device, and this returns AT ONCE with { id, done }:
  // `done` is the server's confirmation, which may be a long time coming. The
  // write waits in the on-device store meanwhile (see init) and goes by itself
  // when the connection returns. A re-send under the same id overwrites rather
  // than duplicates — see Outbox in shared.js.
  queueOrder(order, id) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = id ? _db.collection('orders').doc(id) : _db.collection('orders').doc();
    const done = ref.set({
      ...order, status: 'pending', authEmail: _who(),
      placedAt: order.placedAt || Date.now(),                        // the device's clock: when it was placed
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),   // the server's: when it arrived
    });
    return { id: ref.id, done };
  },
  // Follows one order's write: callback({ exists, pending, fromCache }) on
  // every change, or ({ error }) if the listener is refused.
  watchOrderWrite(id, callback) {
    if (!this.isReady()) return ()=>{};
    return _db.collection('orders').doc(id).onSnapshot({ includeMetadataChanges: true },
      snap => callback({ exists: snap.exists, pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache }),
      err  => callback({ error: err }));
  },

  // _pendingWrite: true while a doc's latest write came from THIS client and hasn't
  // been acked by the server yet (Firestore latency compensation). The manager page
  // uses it to tell its own just-created orders apart from ones arriving from other
  // devices — the local snapshot fires BEFORE submitOrder's promise resolves, so any
  // "remember my own id after submitting" bookkeeping is inherently too late.
  listenOrders(callback) {
    if (!this.isReady()) return ()=>{};
    return _db.collection('orders').orderBy('submittedAt','desc')
      .onSnapshot(snap=>callback(snap.docs.map(d=>({_id:d.id, _pendingWrite:d.metadata.hasPendingWrites, ...d.data()}))),
        err=>_listenErr('Listen error:',err));
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
    let settled = false, live = false;
    const unsub = _db.collection('meta').doc('version').onSnapshot(
      { includeMetadataChanges: true },
      snap => {
        if (!snap.metadata.fromCache) { settled = live = true; callback(true); }
        // From cache: with the on-device store that is simply the first thing
        // every page sees, so it says nothing until a live snapshot has been
        // seen — after which a cached one means the connection was lost.
        else if (live) { live = false; callback(false); }
      },
      ()   => { settled = true; callback(false); }
    );
    // The browser knows it has no network before Firestore does.
    window.addEventListener('offline', () => { settled = true; live = false; callback(false); });
    // Fallback in case no live snapshot arrives within a few seconds
    // (a fully offline device, or one still waiting on its first connection).
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

  // Manager-facing note on an order (from the worker's or manager's order
  // confirmation, or edited on the queue card). Lives only on the order doc —
  // deliberately never copied into the email body or the delivery cards.
  async updateOrderNote(orderId, note) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(orderId).update({
      note: String(note || '').trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async updateItems(id, items) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).update({
      items, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // What identifies one line of an order, for matching an email's lines to the order.
  lineKey(item) { return [item.id, item.partCode, item.category].map(v => String(v ?? '')).join('|'); },

  // Which of an email's lines no longer match their order, and how: changed since the
  // email was written, removed, rejected, or emailed from somewhere else. A line that
  // already carries this deliveryId is this same email, so it still matches.
  // lines: [{ orderId, key (lineKey), qty }], order: what they came from, or null if it is gone.
  changedLines(lines, order, deliveryId) {
    const all  = order && order.status === 'rejected';
    const pool = ((order && order.items) || []).map(item => ({ item: all ? { ...item, rejected: true } : item, k: this.lineKey(item) })), out = [];
    for (const l of lines) {
      const open = p => !p.item.rejected && (!p.item.emailed || p.item.deliveryId === deliveryId);
      let i = pool.findIndex(p => p.k === l.key && p.item.qty === l.qty && open(p));
      if (i >= 0) { pool.splice(i, 1); continue; }
      i = pool.findIndex(p => p.k === l.key && open(p));
      if (i < 0) i = pool.findIndex(p => p.k === l.key);
      const hit = i >= 0 ? pool.splice(i, 1)[0].item : null;
      out.push({ ...l, now: !hit ? 'removed' : hit.rejected ? 'rejected' : open({ item: hit }) ? hit.qty : 'emailed' });
    }
    return out;
  },

  // One email, one write. `lines` is exactly what the email said — and all of them are
  // marked emailed together or none is. If any no longer match (changedLines), nothing is
  // marked and this throws code 'draft-changed' with them in .changed, so an order is
  // never recorded as sent with a quantity the supplier wasn't given.
  // deliveryId is shared across every order in the email, which is what groups them
  // into one delivery. A line that already carries it counts as done, so a try whose
  // reply was lost can be repeated. A line emailed earlier keeps its own deliveryId.
  async markLinesEmailed(lines, deliveryId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    // A quantity edited a moment ago may still be on its way to the server.
    if (_db.waitForPendingWrites)
      await Promise.race([_db.waitForPendingWrites().catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
    const ids = [...new Set(lines.map(l => l.orderId))];
    await _tx(async tx => {
      const refs = ids.map(id => _db.collection('orders').doc(id));
      const docs = await Promise.all(refs.map(r => tx.get(r)));
      const changed = docs.flatMap((doc, n) =>
        this.changedLines(lines.filter(l => l.orderId === ids[n]), doc.exists ? doc.data() : null, deliveryId));
      if (changed.length) throw Object.assign(new Error('An order changed while its email was open'), { code: 'draft-changed', changed });
      const updates = docs.map((doc, n) => {
        const want = lines.filter(l => l.orderId === ids[n]);
        const ticks = { ...((doc.data().intake && doc.data().intake.items) || {}) };
        let old = false;   // a line starts its new delivery with nothing ticked off
        const items = (doc.data().items || []).map(item => {
          const k = this.lineKey(item);
          const i = want.findIndex(l => l.key === k && l.qty === item.qty);
          if (i < 0 || item.rejected) return item;
          if (item.emailed && item.deliveryId !== deliveryId) return item;
          want.splice(i, 1);
          if (!item.emailed && ticks[String(item.id)]) { delete ticks[String(item.id)]; old = true; }
          return { ...item, emailed: true, deliveryId };
        });
        const live = items.filter(i => !i.rejected);
        return { items, ...(old ? { 'intake.items': ticks } : {}), status: live.length > 0 && live.every(i => i.emailed) ? 'sent' : 'pending' };
      });
      updates.forEach((u, n) => tx.update(refs[n], { ...u, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }));
    });
  },

  // An email sent straight from one of the manager's carts (New Order, Consumables
  // Order): the order and its "emailed" marks in one write, under an id made when the
  // email was opened, so trying again never makes a second order. deliveryIds maps
  // each category in the email to its delivery.
  newOrderId() { return _db.collection('orders').doc().id; },
  async saveEmailedOrder(id, order, deliveryIds) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('orders').doc(id);
    await _tx(async tx => {
      if ((await tx.get(ref)).exists) return;   // an earlier try got through
      tx.set(ref, {
        ...order,
        items: order.items.map(i => ({ ...i, emailed: true, deliveryId: deliveryIds[i.category] })),
        status: 'sent', authEmail: _who(),
        submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
  },

  // Takes an email back. Every line it marked goes back to pending, in every order, together
  // or not at all, along with anything ticked off on its delivery. Lines that went in
  // another email are left alone, even in the same order and category.
  // keys: the deliveries (item.deliveryId, or legacy:<order>:<category> from before those).
  // remove: the lines go back to one of the manager's carts, so they leave the order, and
  // an order with nothing left goes with them. Safe to repeat.
  async putBackEmail(orderIds, keys, remove) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ids = [...new Set(orderIds)];
    await _tx(async tx => {
      const refs = ids.map(id => _db.collection('orders').doc(id));
      const docs = await Promise.all(refs.map(r => tx.get(r)));
      docs.forEach((doc, n) => {
        if (!doc.exists) return;
        const data = doc.data(), was = data.items || [];
        const mine = i => i.emailed && keys.includes(i.deliveryId || `legacy:${ids[n]}:${i.category}`);
        if (!was.some(mine)) return;
        const items = remove ? was.filter(i => !mine(i)) : was.map(i => mine(i) ? { ...i, emailed: false } : i);
        if (!items.length) { tx.delete(refs[n]); return; }
        // Without this, emailing them again makes a delivery that already shows the old ticks.
        const ticks = { ...((data.intake && data.intake.items) || {}) };
        was.filter(mine).forEach(i => delete ticks[String(i.id)]);
        const live = items.filter(i => !i.rejected);
        tx.update(refs[n], {
          items, 'intake.items': ticks,
          status: data.status === 'rejected' ? 'rejected' : live.length > 0 && live.every(i => i.emailed) ? 'sent' : 'pending',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
    });
  },

  // How many lines of these deliveries the server still has as emailed.
  async emailedLines(orderIds, keys) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const docs = await Promise.all([...new Set(orderIds)].map(id => _db.collection('orders').doc(id).get({ source: 'server' })));
    return docs.reduce((n, d) => n + ((d.exists && d.data().items) || [])
      .filter(i => i.emailed && keys.includes(i.deliveryId || `legacy:${d.id}:${i.category}`)).length, 0);
  },

  async deleteOrder(id) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('orders').doc(id).delete();
  },

  async rejectItem(orderId, partCode) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('orders').doc(orderId);
    await _db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      const items = (doc.data().items || []).map(item =>
        item.partCode === partCode ? { ...item, rejected: true } : item
      );
      const nonRejected = items.filter(i => !i.rejected);
      let newStatus = 'pending';
      if (nonRejected.length === 0)               newStatus = 'rejected';
      else if (nonRejected.every(i => i.emailed)) newStatus = 'sent';
      tx.update(ref, {
        items, status: newStatus,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
  },

  // Per-line undo of rejectItem: clears the flag and recomputes the order status
  // with the same rules — so unrejecting the only live line of a fully-rejected
  // order brings the whole order back to pending (or sent, if everything else
  // was already emailed).
  async unrejectItem(orderId, partCode) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('orders').doc(orderId);
    await _db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      const items = (doc.data().items || []).map(item =>
        item.partCode === partCode ? { ...item, rejected: false } : item
      );
      const nonRejected = items.filter(i => !i.rejected);
      let newStatus = 'pending';
      if (nonRejected.length === 0)               newStatus = 'rejected';
      else if (nonRejected.every(i => i.emailed)) newStatus = 'sent';
      tx.update(ref, {
        items, status: newStatus,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
  },

  // Throws unless these lines of an order are still on a delivery — by the same rule the
  // Deliveries lists use (Intake.buildCategoryGroups).
  _stillOn(doc, groupKey, itemIds) {
    const data  = doc.exists ? doc.data() : {}, items = data.items || [];
    const flags = !data.type || data.type === 'materials' || items.some(i => i.emailed);
    const on    = new Set(items
      .filter(i => !i.rejected && (i.emailed || !flags) && (i.deliveryId || `legacy:${doc.id}:${i.category}`) === groupKey)
      .map(i => String(i.id)));
    if (!doc.exists || itemIds.some(id => !on.has(String(id))))
      throw Object.assign(new Error('The delivery has changed'), { code: 'delivery-changed' });
  },

  // Merges an intake patch into an order inside a transaction. patch is a map of
  // bare item ids -> { status, qtyReceived, notes }. Merging (rather than overwriting
  // the whole intake.items map from the client's cached copy) means two devices
  // confirming different items on the same order can no longer clobber each other.
  // The order-level intake.status is recomputed from the merged result in-tx.
  // groupKey: the delivery the lines were ticked on. If one is no longer on it (the manager
  // put it back, or the order is gone), nothing is saved: code 'delivery-changed'.
  async updateIntake(orderId, patch, updatedBy, groupKey) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const RESOLVED = new Set(['ok', 'partial', 'missing', 'backorder']);
    const ref = _db.collection('orders').doc(orderId);
    await _tx(async tx => {
      const doc = await tx.get(ref);
      this._stillOn(doc, groupKey, Object.keys(patch || {}));
      const data   = doc.data();
      const merged = { ...((data.intake && data.intake.items) || {}) };
      // What a line has put into stock is written only by applyDeliveryStock. The copy in
      // the patch may be older, from before another device added it.
      for (const [id, entry] of Object.entries(patch || {})) {
        const { stockAppliedUnits: _old, ...rest } = entry, had = merged[id] || {};
        merged[id] = had.stockAppliedUnits === undefined ? rest : { ...rest, stockAppliedUnits: had.stockAppliedUnits };
      }
      const isMat = !data.type || data.type === 'materials';
      const totalItems = (data.items || []).filter(i => (isMat ? !!i.emailed : true) && !i.rejected).length;
      const statuses = Object.values(merged).map(i => i.status).filter(s => !!s && s !== 'pending');
      let intakeStatus = 'pending';
      if (statuses.length > 0) {
        const allActioned = statuses.length >= (totalItems || 1) && statuses.every(s => RESOLVED.has(s));
        if (!allActioned)                               intakeStatus = 'in_progress';
        else if (statuses.every(s => s === 'ok'))        intakeStatus = 'received';
        else if (statuses.some(s => s === 'backorder'))  intakeStatus = 'backorder';
        else                                              intakeStatus = 'completed';
      }
      tx.update(ref, {
        'intake.items':     merged,
        'intake.status':    intakeStatus,
        'intake.updatedBy': updatedBy || '',
        'intake.updatedByEmail': _who(),
        'intake.updatedAt': firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:          firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
  },

  // Sets/clears cancellation for ONE delivery (groupKey) on an order — deliveries are
  // cancelled individually, so an order's other deliveries stay tracked. Restoring
  // also clears the legacy order-level intakeCancelled flag (which meant "everything
  // on this order is cancelled"), or the delivery would stay cancelled via that path.
  async setDeliveryCancelled(orderId, groupKey, cancelled) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const update = {
      intakeCancelledDeliveries: cancelled
        ? firebase.firestore.FieldValue.arrayUnion(groupKey)
        : firebase.firestore.FieldValue.arrayRemove(groupKey),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (!cancelled) update.intakeCancelled = false;
    await _db.collection('orders').doc(orderId).update(update);
  },

  // Removes a cancelled delivery's items from an order. Deletes the whole document
  // only when nothing would remain on it; otherwise strips just those items (plus
  // their intake entries and the delivery's cancelled marker) so the order's other
  // deliveries and queue history survive.
  async deleteDeliveryItems(orderId, itemIds, groupKey) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('orders').doc(orderId);
    await _db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      const data   = doc.data();
      const remove = new Set(itemIds.map(String));
      const remaining = (data.items || []).filter(i => !remove.has(String(i.id)));
      if (!remaining.length) { tx.delete(ref); return; }
      const intakeItems = { ...((data.intake && data.intake.items) || {}) };
      for (const id of remove) delete intakeItems[id];
      tx.update(ref, {
        items: remaining,
        'intake.items': intakeItems,
        intakeCancelledDeliveries: firebase.firestore.FieldValue.arrayRemove(groupKey),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
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

  // A testing tool. Refuses anything but the test database, whatever asked for it.
  async deleteAllOrders() {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    if (!_config || _config.projectId !== FIREBASE_PROJECTS.test.projectId) throw new Error('Test database only');
    const snap = await _db.collection('orders').get();
    // Firestore batches cap at 500 operations — chunk so large collections don't fail.
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 450) {
      const batch = _db.batch();
      docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  },

  async resetItemEmailed(orderId, category, partCode) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('orders').doc(orderId);
    await _db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      const data  = doc.data();
      const match = item => item.category === category && item.partCode === partCode;
      const items = (data.items || []).map(item => match(item) ? { ...item, emailed: false } : item);
      // Clear stale intake status so re-sending starts fresh (see putBackEmail).
      const intakeItems = { ...((data.intake && data.intake.items) || {}) };
      for (const item of (data.items || [])) if (match(item)) delete intakeItems[String(item.id)];
      const nonRejected = items.filter(i => !i.rejected);
      const allEmailed  = nonRejected.length > 0 && nonRejected.every(i => i.emailed);
      tx.update(ref, {
        items, 'intake.items': intakeItems,
        status: allEmailed ? 'sent' : 'pending',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
  },

  async resetOrderToPending(orderId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('orders').doc(orderId);
    await _db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      const items = (doc.data().items || []).map(item => ({ ...item, emailed: false }));
      tx.update(ref, {
        items,
        'intake.items': {}, // every item is back to pending — no delivery state survives
        status: 'pending',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
  },

  // ── MATERIAL STOCK (periodic stocktake — deliberately NOT live inventory) ──
  // One doc per material keyed by stockId(item). Quantities only change through
  // stocktake submissions from the materials page (set/add/subtract), so there's
  // no per-job usage tracking to keep honest — it's a tax-time snapshot system.

  listenMaterialStock(callback) {
    if (!this.isReady()) return ()=>{};
    return _db.collection('material_stock')
      .onSnapshot(
        snap => callback(snap.docs.map(d => ({ _id: d.id, ...d.data() }))),
        err  => _listenErr('Material stock listen error:', err)
      );
  },

  // Records a stocktake — one item (progressive tick) or many (Review & submit).
  // Each item carries its OWN mode: 'set' replaces the recorded qty, 'add'/'subtract'
  // move it relative to what's there.
  // All the counts are saved together or none is, so a failed submit can be tried
  // again without adding anything twice. opId (OpId in shared.js) is written with
  // them: if the first try did go through and only its reply was lost, the second
  // finds the id and stops. Very long lists go in parts, each with its own id.
  // The submission is merged into ONE session doc per device per day (id
  // "<deviceSlug>-<YYYY-MM-DD>", items keyed by sid, latest count wins) so a day of
  // ticks + submits reads as a single history row rather than flooding it.
  // items: [{ sid, partCode, description, category, subcategory, unit, qty, mode }]
  async recordStocktake(items, deviceName, opId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const slug = String(deviceName || 'device').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'device';
    const sessRef = _db.collection('material_stocktakes').doc(`${slug}-${dateStr}`);
    const PART = 300;   // well inside what one transaction may write
    for (let at = 0; at < items.length; at += PART) {
      const part = items.slice(at, at + PART), partId = opId ? `${opId}:${at}` : null;
      await _tx(async tx => {
        const sess = await tx.get(sessRef);
        const prev = sess.exists ? sess.data() : {};
        const ops  = prev.ops || [];
        if (partId && ops.includes(partId)) return;   // already recorded
        const sids = [...new Set(part.map(i => i.sid))];
        const refs = sids.map(sid => _db.collection('material_stock').doc(sid));
        const docs = await Promise.all(refs.map(r => tx.get(r)));
        const rec  = new Map(sids.map((sid, n) => [sid, { ref: refs[n], qty: docs[n].exists ? (docs[n].data().qty || 0) : 0 }]));
        const bySid = new Map((prev.items || []).map(i => [i.sid, i]));
        for (const item of part) {
          const r = rec.get(item.sid);
          if (item.mode === 'add')           r.qty = Math.round((r.qty + item.qty) * 100) / 100;
          else if (item.mode === 'subtract') r.qty = Math.max(0, Math.round((r.qty - item.qty) * 100) / 100);
          else                               r.qty = item.qty;
          r.item = item;
          bySid.set(item.sid, {
            sid: item.sid, partCode: item.partCode || '', description: item.description || '',
            category: item.category || '', subcategory: item.subcategory || '',
            unit: item.unit || '', qty: item.qty, mode: item.mode || 'set',
          });
        }
        for (const r of rec.values()) tx.set(r.ref, {
          qty:         r.qty,
          unit:        r.item.unit || '',
          partCode:    r.item.partCode || '',
          description: r.item.description || '',
          category:    r.item.category || '',
          subcategory: r.item.subcategory || '',
          updatedBy:   deviceName || '',
          updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        // submittedAt tracks last activity so history sorts newest-first without an index.
        tx.set(sessRef, {
          deviceName: deviceName || '', date: dateStr, authEmail: _who(),
          items: [...bySid.values()],
          ...(partId ? { ops: [...ops, partId].slice(-40) } : {}),
          submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    }
  },

  // ── MATERIALS CATALOGUE ───────────────────────────────────────────
  // The materials list, moved out of materials.csv (manager page → Settings →
  // Materials catalogue; see js/catalogue.js). Three documents under meta/ —
  // a collection every device can already read and write, so the catalogue
  // needed no rules change to go live:
  //   meta/catalogMaterials          { items:[{ id, code, erpDesc, desc?, category, subcategory, qtyType, retired? }], nextId, rev, … }
  //   meta/catalogMaterialsPrevious  the catalogue as it was before the last import — the one-step undo
  //   meta/catalogErpParts           the last uploaded part list, slimmed — what "new since last import" is measured against
  // The whole list is ONE document on purpose (as the production board keeps
  // its parts): one read, one listener, and every change lands atomically.
  async getCatalog() {
    if (!this.isReady()) return null;
    const d = await _db.collection('meta').doc('catalogMaterials').get();
    return d.exists ? d.data() : null;
  },
  // callback(doc|null, fromCache). Errors are only logged — deliberately NOT
  // routed to DB.onDenied: a device that can't read the catalogue carries on
  // with materials.csv, it must never be thrown at a sign-in prompt for it.
  listenCatalog(callback) {
    if (!this.isReady()) return ()=>{};
    return _db.collection('meta').doc('catalogMaterials').onSnapshot(
      snap => callback(snap.exists ? snap.data() : null, snap.metadata.fromCache),
      err  => console.warn('Catalogue listen error:', err)
    );
  },
  // Every catalogue change goes through here: mutate(currentDoc|null) returns
  // the next document (or null to leave it alone) and runs inside a transaction,
  // so two managers editing at once can't overwrite each other's rows.
  // opts.keepPrevious: also park the current document as the undo copy.
  async updateCatalog(mutate, opts = {}) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref  = _db.collection('meta').doc('catalogMaterials');
    const prev = _db.collection('meta').doc('catalogMaterialsPrevious');
    const now  = firebase.firestore.FieldValue.serverTimestamp();
    return _db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const cur  = snap.exists ? snap.data() : null;
      const next = mutate(cur);
      if (!next) return null;
      if (opts.keepPrevious && cur) tx.set(prev, { ...cur, savedAt: now, savedReason: opts.keepPrevious });
      tx.set(ref, { ...next, rev: ((cur && cur.rev) || 0) + 1, updatedAt: now, updatedBy: _who() || opts.by || '' });
      return next;
    });
  },
  async getPreviousCatalog() {
    if (!this.isReady()) return null;
    const d = await _db.collection('meta').doc('catalogMaterialsPrevious').get();
    return d.exists ? d.data() : null;
  },
  // Undo: swaps the catalogue with its undo copy, so the same button puts the
  // import back. nextId only ever goes up — an id handed out by the undone
  // import is never given to a different material.
  async restorePreviousCatalog(by) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref  = _db.collection('meta').doc('catalogMaterials');
    const prev = _db.collection('meta').doc('catalogMaterialsPrevious');
    const now  = firebase.firestore.FieldValue.serverTimestamp();
    await _db.runTransaction(async tx => {
      const curSnap = await tx.get(ref), prevSnap = await tx.get(prev);
      if (!prevSnap.exists) throw new Error('Nothing to undo');
      const cur = curSnap.exists ? curSnap.data() : null;
      const { savedAt, savedReason, ...old } = prevSnap.data();
      const reason = savedReason === 'undo' ? 'import' : 'undo';   // what the swap can be undone as, next time
      tx.set(ref, {
        ...old, hasUndo: reason,
        nextId: Math.max(old.nextId || 1, (cur && cur.nextId) || 1),
        rev: ((cur && cur.rev) || 0) + 1, updatedAt: now, updatedBy: _who() || by || '',
      });
      if (cur) tx.set(prev, { ...cur, savedAt: now, savedReason: reason });
    });
  },
  async getErpParts() {
    if (!this.isReady()) return null;
    const d = await _db.collection('meta').doc('catalogErpParts').get();
    return d.exists ? d.data() : null;
  },
  async saveErpParts(payload) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    await _db.collection('meta').doc('catalogErpParts').set({
      ...payload, importedBy: _who() || payload.importedBy || '',
      importedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },
  // A material's stocktake count is filed under its part code (or, with no
  // code, under its description) — so when that changes, the count moves with
  // it. Adds onto whatever is already recorded at the new place.
  async moveMaterialStock(oldSid, newSid) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    if (!oldSid || !newSid || oldSid === newSid) return;
    const oldRef = _db.collection('material_stock').doc(oldSid);
    const newRef = _db.collection('material_stock').doc(newSid);
    await _db.runTransaction(async tx => {
      const oldDoc = await tx.get(oldRef);
      if (!oldDoc.exists) return;
      const newDoc = await tx.get(newRef);
      const o = oldDoc.data();
      tx.set(newRef, newDoc.exists ? { ...o, ...newDoc.data(), qty: (newDoc.data().qty || 0) + (o.qty || 0) } : o);
      tx.delete(oldRef);
    });
  },

  // Stocktake session history, newest first (single-field orderBy — no index needed).
  async fetchStocktakeSessions(limitN) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const snap = await _db.collection('material_stocktakes')
      .orderBy('submittedAt', 'desc').limit(limitN || 50).get();
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  },

  // ── STOCK ─────────────────────────────────────────────────────────
  // One document per consumable item, keyed by stable stockId.
  // Fields: qty, reorderQty, warningQty, tracked (bool)

  listenStock(callback) {
    if (!this.isReady()) return ()=>{};
    return _db.collection('stock')
      .onSnapshot(
        snap => callback(snap.docs.map(d => ({ _id: d.id, ...d.data() }))),
        err  => _listenErr('Stock listen error:', err)
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

  // Remembers a scanned barcode against a consumable, so the next scan of that box
  // resolves straight to the item. Built up by scanning rather than data entry — the
  // codes are whatever the manufacturer printed, and an item can have several (brands
  // and pack sizes differ). Guards against the same code being linked to two different
  // items (throws BARCODE_IN_USE with the other item's stock id attached). Every link
  // is logged with who/when in barcodeLog — the item's own audit trail, deliberately
  // separate from the stock movement history.
  async linkBarcode(stockId, code, by) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const c = String(code).trim();
    const dup = await _db.collection('stock').where('barcodes', 'array-contains', c).get();
    const other = dup.docs.find(d => d.id !== stockId);
    if (other) {
      const e = new Error('BARCODE_IN_USE');
      e.existingId = other.id;
      throw e;
    }
    await _db.collection('stock').doc(stockId).set({
      barcodes:   firebase.firestore.FieldValue.arrayUnion(c),
      // serverTimestamp() isn't allowed inside arrayUnion — client time is fine for audit
      barcodeLog: firebase.firestore.FieldValue.arrayUnion({ code: c, action: 'linked', by: by || '', email: _who(), at: Date.now() }),
    }, { merge: true });
  },

  // Removes a wrongly-linked barcode (kept in the log so the mistake is traceable).
  async unlinkBarcode(stockId, code, by) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const c = String(code).trim();
    await _db.collection('stock').doc(stockId).set({
      barcodes:   firebase.firestore.FieldValue.arrayRemove(c),
      barcodeLog: firebase.firestore.FieldValue.arrayUnion({ code: c, action: 'unlinked', by: by || '', email: _who(), at: Date.now() }),
    }, { merge: true });
  },

  // Initial shelf count during consumables setup: sets the quantity absolutely,
  // turns tracking on, and records a 'setup' history row so it reads as an initial
  // count in history rather than a fake delivery or checkout. Safe on existing
  // docs — the history delta is computed against whatever was recorded before.
  async setInitialStock(stockId, itemName, qty, by) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('stock').doc(stockId);
    let oldQty = 0;
    await _db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      oldQty = doc.exists ? (doc.data().qty || 0) : 0;
      tx.set(ref, {
        ...(doc.exists ? {} : { reorderQty: 0, warningQty: 0 }),
        qty, tracked: true,
      }, { merge: true });
    });
    _db.collection('stock_history').add({
      stockId,
      itemName:  itemName || '',
      delta:     qty - oldQty,
      newQty:    qty,
      action:    'adjustment',
      subtype:   'setup',
      by:        by || '',
      authEmail: _who(),
      sessionId: null,
      reverted:  false,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(e => console.warn('History write failed:', e));
  },

  // ── GHOST ITEMS (on-device consumables awaiting their consumables.csv row) ──

  // Claims the next free SC placeholder number. A transaction against
  // meta/consumables makes simultaneous claims from two devices impossible;
  // floorNum (computed client-side from the highest SC code visible across
  // catalog + ghosts) keeps the counter ahead of codes ever assigned by hand
  // in the CSV. Returns the formatted code, e.g. "SC0178".
  async claimGhostCode(floorNum) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('meta').doc('consumables');
    let n;
    await _db.runTransaction(async tx => {
      const doc  = await tx.get(ref);
      const last = doc.exists ? (doc.data().lastGhostNum || 0) : 0;
      n = Math.max(last + 1, floorNum || 1);
      tx.set(ref, { lastGhostNum: n }, { merge: true });
    });
    return 'SC' + String(n).padStart(4, '0');
  },

  // Creates the stock document for an on-device item: tracked from birth, zero
  // quantity (the setup flow's count goes through setInitialStock so history
  // stays honest), with the would-be CSV row stored under `ghost`.
  async createGhostItem(sid, ghost) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref = _db.collection('stock').doc(sid);
    await _db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (doc.exists && doc.data().ghost) throw new Error('GHOST_EXISTS');
      tx.set(ref, {
        ...(doc.exists ? {} : { qty: 0, reorderQty: 0, warningQty: 0 }),
        tracked: true,
        ghost,
      }, { merge: true });
    });
  },

  // Clears a ghost marker once its CSV row exists. Same doc id (description kept
  // verbatim, code still the SC placeholder): just removes the flag. Different id
  // (description edited in the CSV, or the SC code swapped for a real supplier
  // code): moves the whole stock record — quantity, barcodes, audit log — onto the
  // new doc id and deletes the old one, merging additively if something already
  // exists at the target. Old stock_history rows keep the old stockId (append-only
  // log, per-item history filter just won't reach behind the rename).
  async resolveGhost(oldSid, newSid) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const oldRef = _db.collection('stock').doc(oldSid);
    if (oldSid === newSid) {
      await oldRef.update({ ghost: firebase.firestore.FieldValue.delete() });
      return;
    }
    const newRef = _db.collection('stock').doc(newSid);
    await _db.runTransaction(async tx => {
      const oldDoc = await tx.get(oldRef);
      if (!oldDoc.exists) return;
      const newDoc = await tx.get(newRef);
      const o = oldDoc.data();
      delete o.ghost;
      if (newDoc.exists) {
        const n = newDoc.data();
        tx.set(newRef, {
          ...o, ...n,
          qty:        (n.qty || 0) + (o.qty || 0),
          tracked:    !!(n.tracked || o.tracked),
          barcodes:   [...new Set([...(o.barcodes || []), ...(n.barcodes || [])])],
          barcodeLog: [...(o.barcodeLog || []), ...(n.barcodeLog || [])],
        });
      } else {
        tx.set(newRef, o);
      }
      tx.delete(oldRef);
    });
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
  // The stock and its history row are one write, and the row's id is made before the
  // first try: if a try went through and only its reply was lost, the next finds the row
  // and stops. opId (OpId in shared.js) carries that across a second press of the button.
  async adjustStock(stockId, itemName, delta, action, by, sessionId, subtype, opId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const ref  = _db.collection('stock').doc(stockId);
    const mark = opId ? _db.collection('stock_history').doc(`${opId}-${stockId}`) : _db.collection('stock_history').doc();
    return _tx(async tx => {
      const done = await tx.get(mark);
      if (done.exists) return done.data().newQty;   // an earlier try got through
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error('Stock record not found');
      const newQty = round2((doc.data().qty || 0) + delta);
      if (newQty < 0) throw new Error('INSUFFICIENT_STOCK');
      tx.update(ref, { qty: newQty });
      tx.set(mark, {
        stockId,
        itemName:  itemName || '',
        delta,
        newQty,
        action,
        subtype:    subtype || null,
        by:         by || '',
        authEmail:  _who(),
        sessionId:  sessionId || null,
        reverted:   false,
        timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
      });
      return newQty;
    });
  },

  // Brings consumables stock into line with what a delivery says was received.
  // lines: [{ orderId, itemId, sid, description, units }] — units is the TOTAL this line
  // should have put into stock. Each order's own record of what it has already put in
  // (intake.items.<id>.stockAppliedUnits) is read, the difference moved, and the record
  // updated in the same write. So it happens whole or not at all, and pressing it twice,
  // or on two devices at once, adds nothing the second time. A correction downwards is
  // floored at zero. Receiving an untracked item starts tracking it.
  async applyDeliveryStock(lines, by, sessionId, groupKey) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const orderIds = [...new Set(lines.map(l => l.orderId))];
    await _tx(async tx => {
      const orderRefs = orderIds.map(id => _db.collection('orders').doc(id));
      const orderDocs = await Promise.all(orderRefs.map(r => tx.get(r)));
      orderDocs.forEach((d, n) => this._stillOn(d, groupKey, lines.filter(l => l.orderId === orderIds[n]).map(l => l.itemId)));
      const intake = new Map(orderIds.map((id, n) => [id, (orderDocs[n].exists && orderDocs[n].data().intake && orderDocs[n].data().intake.items) || {}]));
      const bySid = new Map();
      for (const l of lines) {
        const was = (intake.get(l.orderId)[l.itemId] || {}).stockAppliedUnits || 0;
        if (!bySid.has(l.sid)) bySid.set(l.sid, { description: l.description, delta: 0 });
        bySid.get(l.sid).delta += l.units - was;
      }
      const moves = [...bySid.entries()].filter(([, m]) => m.delta !== 0);
      const refs  = moves.map(([sid]) => _db.collection('stock').doc(sid));
      const docs  = await Promise.all(refs.map(r => tx.get(r)));
      moves.forEach(([sid, m], n) => {
        const current = docs[n].exists ? (docs[n].data().qty || 0) : 0;
        const newQty  = Math.max(0, round2(current + m.delta));
        tx.set(refs[n], { qty: newQty, tracked: true }, { merge: true });
        if (newQty === current) return;
        tx.set(_db.collection('stock_history').doc(), {
          stockId: sid, itemName: m.description || '', delta: round2(newQty - current), newQty,
          action: 'intake', subtype: 'delivery_intake',
          by: by || '', authEmail: _who(), sessionId: sessionId || null, reverted: false,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      orderIds.forEach((id, n) => {
        const update = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
        for (const l of lines) if (l.orderId === id) update[`intake.items.${l.itemId}.stockAppliedUnits`] = l.units;
        tx.update(orderRefs[n], update);
      });
    });
  },

  // Receive Stock (a delivery that isn't on an order): every line in one write, so
  // either the whole list is in stock or none of it is. The history rows are filed
  // under opId, so a try whose reply was lost is recognised and not added again.
  // items: [{ sid, description, units }]
  async receiveStock(items, by, sessionId, opId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const bySid = new Map();
    for (const i of items) {
      if (!bySid.has(i.sid)) bySid.set(i.sid, { description: i.description, units: 0 });
      bySid.get(i.sid).units += i.units;
    }
    const all = [...bySid.entries()];
    await _tx(async tx => {
      const marks = all.map(([sid]) => _db.collection('stock_history').doc(`${opId}-${sid}`));
      if ((await tx.get(marks[0])).exists) return;   // already received
      const refs = all.map(([sid]) => _db.collection('stock').doc(sid));
      const docs = await Promise.all(refs.map(r => tx.get(r)));
      all.forEach(([sid, i], n) => {
        const newQty = round2((docs[n].exists ? (docs[n].data().qty || 0) : 0) + i.units);
        tx.set(refs[n], { ...(docs[n].exists ? {} : { reorderQty: 0, warningQty: 0 }), qty: newQty, tracked: true }, { merge: true });
        tx.set(marks[n], {
          stockId: sid, itemName: i.description || '', delta: i.units, newQty,
          action: 'intake', subtype: 'receive_stock',
          by: by || '', authEmail: _who(), sessionId: sessionId || null, reverted: false,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
    });
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
      authEmail:  _who(),
      sessionId:  sessionId || null,
      reverted:   false,
      timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(e => console.warn('History write failed:', e));
  },

  // Revert a history record: applies a compensating adjustment (−delta) to the
  // affected stock item, then marks the original record reverted (greyed out, ignored).
  // Does not delete or rewrite the original — stays append-only. If the compensation
  // would take stock negative it's clamped at zero, and the amount ACTUALLY applied is
  // stored on the record so unrevert restores exactly that (no permanent drift).
  async revertHistoryRecord(historyId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const histRef = _db.collection('stock_history').doc(historyId);
    await _db.runTransaction(async tx => {
      const histDoc = await tx.get(histRef);
      if (!histDoc.exists) throw new Error('History record not found');
      const rec = histDoc.data();
      if (rec.reverted) return; // already reverted, no-op
      const stockRef = _db.collection('stock').doc(rec.stockId);
      const doc = await tx.get(stockRef);
      const current = doc.exists ? (doc.data().qty || 0) : 0;
      const newQty  = Math.max(0, current - rec.delta);
      tx.set(stockRef, { qty: newQty }, { merge: true });
      tx.update(histRef, { reverted: true, revertAppliedDelta: newQty - current });
    });
  },

  // Reverses a revert: undoes exactly what the revert applied (falling back to the
  // original delta for records reverted before revertAppliedDelta existed).
  async unrevertHistoryRecord(historyId) {
    if (!this.isReady()) throw new Error('Firebase not initialised');
    const histRef = _db.collection('stock_history').doc(historyId);
    await _db.runTransaction(async tx => {
      const histDoc = await tx.get(histRef);
      if (!histDoc.exists) throw new Error('History record not found');
      const rec = histDoc.data();
      if (!rec.reverted) return; // not reverted, no-op
      const stockRef = _db.collection('stock').doc(rec.stockId);
      const doc = await tx.get(stockRef);
      const current = doc.exists ? (doc.data().qty || 0) : 0;
      const applied = (rec.revertAppliedDelta != null) ? rec.revertAppliedDelta : -rec.delta;
      tx.set(stockRef, { qty: Math.max(0, current - applied) }, { merge: true });
      tx.update(histRef, { reverted: false, revertAppliedDelta: firebase.firestore.FieldValue.delete() });
    });
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
