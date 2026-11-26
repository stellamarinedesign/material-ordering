// Lets the pages open with no connection. Registered by js/shared.js ("Opening offline").
//
//  · The pages and the app's own files: the network first, so a new version shows as
//    soon as the site can be reached. The copy kept on the device is used only when the
//    site can't be reached, or hasn't answered within 4 seconds.
//  · Firebase's libraries and the fonts: the kept copy first. Their addresses carry their
//    version, so a kept copy never goes out of date.
//  · Nothing else is touched: the database, sign-in and App Check talk to their servers
//    as before (the database keeps its own copy on the device, see DB.init).
//  · A check that asks for no stored copy (AutoUpdate's "is the site there?") always goes
//    to the network, so it still tells the truth when offline.
//
// One copy of each page, and of each file stamped with ?v= only the newest version
// (tools/bump-version.py stamps them), so the store does not grow with every release.

const CACHE = 'mo-files-1';
const WAIT_MS = 4000;
const LIBS = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// Where a file is kept: a page under its address without the query (?v= from an update,
// a home-screen start); a stamped file under its version; anything else under its address
// without the query (the lists are fetched with ?nocache=).
function keyOf(url, isPage) {
  const u = new URL(url);
  if (u.origin !== location.origin) return url;
  const base = u.origin + u.pathname;
  if (isPage || u.pathname.endsWith('/') || u.pathname.endsWith('.html')) return base;
  return u.searchParams.has('v') ? `${base}?v=${u.searchParams.get('v')}` : base;
}

async function keep(cache, key, res) {
  const u = new URL(key);
  if (u.origin === location.origin && u.searchParams.has('v')) {
    for (const r of await cache.keys()) {
      const o = new URL(r.url);
      if (o.origin === u.origin && o.pathname === u.pathname && o.href !== u.href) await cache.delete(r);
    }
  }
  await cache.put(key, res);
}

async function kept(cache, key) {
  return (await cache.match(key)) || (key.endsWith('/') ? cache.match(key + 'index.html') : undefined);
}

// A response worth keeping: a real answer, not one that came by a redirect (Safari won't
// open a page from a redirected copy).
const keepable = res => res && !res.redirected && (res.ok || res.type === 'opaque');

// The worker may stop once the page has its answer, so the saving is registered with the
// event straight away and settled when the network answers.
function saver(e) {
  let settle;
  e.waitUntil(new Promise(r => { settle = r; }));
  return settle;
}

async function networkFirst(net, key) {
  net.catch(() => {});   // answered from the kept copy: a late failure is nobody's concern
  try {
    return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('slow')), WAIT_MS))]);
  } catch {
    const copy = await kept(await caches.open(CACHE), key);
    return copy || net;   // nothing kept: wait for the network, or its error
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'no-store' || req.cache === 'reload') return;
  const lib = LIBS.test(req.url);
  const u = new URL(req.url);
  if (!lib && (u.origin !== location.origin || u.pathname.endsWith('/sw.js'))) return;

  const settle = saver(e);
  const key = lib ? req.url : keyOf(req.url, req.mode === 'navigate');
  const fromNet = () => fetch(req).then(res => {
    settle(keepable(res) ? caches.open(CACHE).then(c => keep(c, key, res.clone())) : null);
    return res;
  }, err => { settle(null); throw err; });

  if (lib) {
    e.respondWith(caches.open(CACHE).then(c => c.match(key)).then(copy => {
      if (copy) { settle(null); return copy; }
      return fromNet();
    }).catch(() => { settle(null); return fetch(req); }));
    return;
  }
  e.respondWith(networkFirst(fromNet(), key));
});

// The first time a page is opened, it loads before this worker can see it. The page then
// sends the addresses it used, and they are kept here.
self.addEventListener('message', e => {
  const files = e.data && e.data.keep;
  if (!Array.isArray(files)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of files.slice(0, 80)) {
      try {
        const lib = LIBS.test(url);
        if (!lib && new URL(url).origin !== location.origin) continue;
        if (!lib && new URL(url).pathname.endsWith('/sw.js')) continue;
        const key = lib ? url : keyOf(url, false);
        if (await cache.match(key)) continue;
        const res = await fetch(url, lib && url.includes('/firebasejs/') ? { mode: 'no-cors' } : {});
        if (keepable(res)) await keep(cache, key, res);
      } catch { /* not kept this time; the next visit keeps it */ }
    }
  })());
});
