// hub-card.js — v2026-11-27.11
//
// THIS APP'S CARD ON THE HUB'S FRONT PAGE: the orders waiting for the manager.
//
// WHERE EACH THING IS CHANGED
//   What the card says ... the SETTINGS just below, in this file. Nothing else
//                          here needs touching to change the words, the lines,
//                          their order or what makes one amber.
//   How every card looks . the hub (Stella-Hubinator): its js/views/launcher.js
//                          and css/hub.css. Every app's card looks the same.
//   Which fields a card    the hub's js/cards.js (normaliseCard): title 40
//   may have, and limits   characters, 3 lines, a line's title and sub 120
//                          each, when 24, count 1-999, `late` draws the when in
//                          amber, `empty` 80. A new kind of field is a hub
//                          change first.
//
// HOW THE HUB USES IT. The hub page imports this file by its plain address
// (/material-ordering/js/hub-card.js) and calls card() as the person looking,
// with a Firestore LITE handle on this app's project, signed in as them (the
// recipe: Stella-Hubinator, "Overview cards"). It returns data, never markup;
// the hub draws it. It imports nothing: no Firebase, no app code. A refused or
// failed read throws, and the hub says "Not available just now".
//
// ONE READ per hub page load: the orders marked pending (up to MOST), against
// this project's daily quota. Which of those are really waiting is decided
// below exactly as the manager page's queue decides it (manager.html,
// _materialsOrders and _orderHasPendingItems): a materials order, not
// rejected, with a line neither emailed nor rejected.
//
// The tests are _local/hub-card-tests.html (never committed), on invented orders.

// ━━ SETTINGS: what the card says ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const FOR_ROLES        = ['manager'];         // who gets the card: the hub's role ids here are manager, engineer, floor
const TITLE            = 'Orders waiting';    // the label over the lines
const EMPTY            = 'No more pending orders.';  // said when nothing is waiting: the manager page's own words when its queue is clear
const LINES            = 3;                   // lines shown (the hub draws 3 at most)
const OLDEST_FIRST     = true;                // true: the order that has waited longest first; false: the newest first, as on the manager page
const LATE_AFTER_HOURS = 24;                  // a line's time turns amber once its order has waited this long; null: never
const SHOW_COUNT       = true;                // the number of orders waiting, in a bubble beside the label
const PAGE             = '/material-ordering/manager.html';  // where the label and every line go
const WAITING_STATUSES = ['pending'];         // the order statuses read as possibly waiting
const MOST             = 200;                 // orders read at most: far more than ever wait at once

// What one line says. Each part is given the order, and the order's lines that are
// still waiting; it returns text, and '' or null leaves that part out.
//   order.ref          'ORD-2026-1127-534'
//   order.deviceName   'Bay 2 iPad'
//   order.note         the note sent with it
//   order.items        [{ description, partCode, qty, qtyType, category, emailed, rejected }]
//   waiting            order.items still waiting (not emailed, not rejected)
//   at                 when the order arrived, in milliseconds;  now: the time now
const LINE = {
  title: (order, waiting) => {
    const first = waiting[0];
    return first ? `${first.description || first.partCode || 'Item'} × ${first.qty}` : (order.ref || 'Order');
  },
  sub:   (order, waiting) => [order.deviceName, waiting.length > 1 ? `${waiting.length} lines` : null].filter(Boolean).join(' · '),
  when:  (order, waiting, at, now) => ago(at, now),
};
// ━━ end of settings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Is this order waiting for the manager? As the manager page's queue decides it. */
export function isWaiting(o) {
  if (!o || o.status === 'rejected') return false;
  if (o.type && o.type !== 'materials') return false;              // consumables orders are not in the queue
  return waitingLines(o).length > 0;
}
const waitingLines = (o) => (Array.isArray(o && o.items) ? o.items : []).filter((i) => i && !i.emailed && !i.rejected);

/** When an order arrived, in ms: the server's time, else the device's; 0 when neither is known. */
export function arrivedAt(o) {
  const t = o && o.submittedAt;
  if (t && typeof t.toMillis === 'function') return t.toMillis();
  if (t && typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof t === 'number') return t;
  return typeof (o && o.placedAt) === 'number' ? o.placedAt : 0;
}

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago", or a date for anything older than a fortnight. */
export function ago(at, now) {
  if (!at) return '';
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  if (at >= midnight.getTime()) return `${Math.floor(mins / 60)} h ago`;
  const days = Math.round((midnight.getTime() - new Date(at).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 1) return 'Yesterday';
  if (days <= 14) return `${days} days ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** The card, from the orders read (plain objects). Pure: the settings above decide everything it says. */
export function cardFrom(orders, now = Date.now()) {
  const waiting = (Array.isArray(orders) ? orders : [])
    .filter(isWaiting)
    .map((order) => ({ order, at: arrivedAt(order) }))
    .sort((a, b) => (OLDEST_FIRST ? a.at - b.at : b.at - a.at));
  const late = (at) => LATE_AFTER_HOURS != null && at > 0 && now - at >= LATE_AFTER_HOURS * 3600000;
  const out = {
    title: TITLE,
    href: PAGE,
    empty: EMPTY,
    items: waiting.slice(0, LINES).map(({ order, at }) => {
      const lines = waitingLines(order);
      return {
        title: LINE.title(order, lines) || '',
        sub:   LINE.sub(order, lines) || '',
        when:  LINE.when(order, lines, at, now) || '',
        href:  PAGE,
        late:  late(at),
      };
    }),
  };
  if (SHOW_COUNT && waiting.length) out.count = waiting.length;
  return out;
}

/** Read by the hub page. Throws on a refused or failed read: the hub says "Not available just now". */
export async function card({ db, fs, role }) {
  if (!FOR_ROLES.includes(role)) return null;
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'orders'), fs.where('status', 'in', WAITING_STATUSES), fs.limit(MOST)));
  return cardFrom(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
}
