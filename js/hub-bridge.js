// hub-bridge.js — v2026-11-27.11
//
// THE HUB: one sign-in for every Stella app (the Stella-Hubinator repo). This
// app keeps its own Firebase project, rules, data and roles; joining adds one
// question at start-up: is the person signed in here the person signed in to
// the hub? The hub's shared file, /core/v1/hub.js, answers it, and signs this
// app in to its OWN project as that person, with a key the hub holds. The
// contract is the comment at the top of that file. It is never copied here:
// it is loaded from the site root, the same way the production board and
// design scheduling load it (their js/hub-bridge.js, from which this is made;
// those are ES modules, this is a classic script, so one global, HubBridge).
//
// FAIL OPEN. The hub is tried wherever /core/v1/hub.js answers: the live site,
// and the hub's own rehearsal server (Stella-Hubinator\hub, `python
// tools/site.py`: the hub at / and this app at /material-ordering/ on one
// local address). Anywhere else (this repo served alone, the _local
// harnesses) the file is not found, nothing changes, and a device signs in
// with the app's own form, as before. On the live site, when the file is
// slow or broken, a device already signed in carries on exactly as it did;
// with nobody signed in, the app draws a copy of the hub's own card, "The hub
// cannot be reached" (Pete, 27 Nov 2026: no sign-in form of the app's own on
// the live site). That copy is drawn on the live site only.
//
// The decisions are small pure functions (noUserAction, shouldReload,
// testSwitch), so the tests (_local/hub-tests.html) reach them with stand-ins.

const HubBridge = {
  URL:  '/core/v1/hub.js',
  NOTE: 'stella.hub.session',            // the hub's note on this device; its states are in the contract
  HOST: 'stellamarinedesign.github.io',  // where the hub is served
  SCREEN: '.shub-screen',                // every full screen the hub draws over the page
  WAIT_MS: 4000,
  TEST_PROJECT: 'material-ordering-testing',

  /** The app's name on the hub's own screens: "No access to Material ordering". */
  title() { return FirebaseConfig.isTestMode() ? 'Material ordering (test)' : 'Material ordering'; },
  onLiveSite(host = location.hostname) { return host === this.HOST; },

  // ── loading the hub's file ──
  _asked: null,
  /** Ask for the hub's file now, beside Firebase, and wait for it later. Wherever it answers (see FAIL OPEN). */
  ask(load = u => import(u)) {
    if (this._asked || !/^https?:$/.test(location.protocol)) return this._asked;
    this._asked = Promise.resolve().then(() => load(this.URL));
    this._asked.catch(() => {});          // load() says so when it is waited for
    return this._asked;
  },
  /** The Hub, or null on any failure: not asked for, not found, an error in it, or slower than 4 s. Never rejects. */
  async load({ wait = this.WAIT_MS, asked = this._asked } = {}) {
    if (!asked) return null;
    let timer = null;
    try {
      const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error('timed out')), wait); });
      const mod = await Promise.race([asked, late]);
      return (mod && mod.Hub) || null;
    } catch (e) {
      console.warn('[hub] not loaded:', (e && e.message) || e);
      return null;
    } finally { clearTimeout(timer); }
  },

  /** This app's own session as Firebase first reports it. Once. */
  firstUser(auth = firebase.auth()) {
    return new Promise(resolve => {
      let done = false, stop = null;
      stop = auth.onAuthStateChanged(user => {
        if (done) return;
        done = true;
        resolve(user);
        Promise.resolve().then(() => stop && stop());
      });
    });
  },

  /**
   * What Hub.connect is asked. `session` is Firebase's own user, never a remembered one.
   * `signIn` takes a token as well as a password: nothing sends one today; it is the seam a
   * token service could use later with no release here. No `legacy` (no form on the live
   * site) and no `strict` until the clean-up release: strict would sign out every device
   * that has never met the hub.
   */
  connectOptions(auth = firebase.auth(), projectId = FirebaseConfig.get().projectId, title = this.title()) {
    return {
      project: projectId,
      title,
      session: () => (auth.currentUser && auth.currentUser.email) || null,
      signIn: ({ email, password, token } = {}) => (token
        ? auth.signInWithCustomToken(token)
        : auth.signInWithEmailAndPassword(email, password)),
      signOut: () => auth.signOut(),
    };
  },

  /**
   * Firebase reports no user: what the page does.
   *   reload  a user had been seen on this page and the hub had answered (anything but
   *           `legacy`): the session went while the page was open — a login just linked
   *           or given a new key, or signed out in another app. Reload; the reload asks
   *           the hub again. Nothing that holds orders is forgotten.
   *   card    the hub has drawn its full-screen card (no access here, a key it could not
   *           mend, or it cannot be reached with its screen up): nothing is drawn behind it.
   *   down    the live site, and the hub could draw nothing: its file did not load, its
   *           connect failed, or it answered `unreachable` with no screen of its own. The
   *           app draws a copy of the hub's card itself (downCard). No form.
   *   own     off the live site: the app's own sign-in form, as before the hub. On the
   *           live site this is a device the hub left alone that has just signed out:
   *           the page reloads, and the hub's sign-in takes it from there.
   */
  noUserAction({ seen = false, hubState = null, loaded = false, drawn = false, host = location.hostname } = {}) {
    if (seen && hubState && hubState !== 'legacy') return 'reload';
    if (hubState === 'none' || hubState === 'broken') return 'card';
    if (hubState === 'unreachable' && drawn) return 'card';
    if (host === this.HOST && (!loaded || hubState === 'unreachable')) return 'down';
    return 'own';
  },
  /** The hub's person changed in another tab: reload when they are no longer this app's. A device the hub left alone is never troubled. */
  shouldReload({ state, hubEmail, appEmail }) {
    if (state === 'legacy') return false;
    return tidyEmail(hubEmail) !== tidyEmail(appEmail);
  },

  /**
   * The app switcher into the header's slot (#hubSlot, just before the cog), as soon as the
   * hub's file is here. Every page draws its header after start-up has begun, so the slot is
   * looked for when the file arrives and watched for after that (a header drawn again gets
   * it again). The hub draws nothing for a login with fewer than two apps, or inside a
   * per-app iPad icon.
   */
  _slot: null,
  showSwitcher(projectId = FirebaseConfig.get().projectId) {
    if (!this._asked) return;
    this._asked.then(mod => {
      if (!mod || !mod.Hub) return;
      const draw = () => {
        const slot = document.getElementById('hubSlot');
        if (!slot || slot === this._slot) return;
        this._slot = slot;
        mod.Hub.switcher(slot, { current: projectId });
      };
      draw();
      new MutationObserver(draw).observe(document.body, { childList: true, subtree: true });
    }, () => {}).catch(e => console.warn('[hub] switcher:', (e && e.message) || e));
  },

  /**
   * The whole of the sign-in side, run once at start-up before the app's own auth
   * listener: the first auth state, the hub's file, connect, and a watch for the hub's
   * person changing. null with no hub; `drawn` when the hub left a screen of its own up.
   */
  async join({ reload = () => location.reload(), shown = () => !!document.querySelector(this.SCREEN) } = {}) {
    const auth = firebase.auth();
    await this.firstUser(auth);
    const Hub = await this.load();
    if (!Hub) return null;
    let state;
    try {
      const r = await Hub.connect(this.connectOptions(auth));
      state = (r && r.state) || 'unreachable';
    } catch (e) {
      console.warn('[hub] connect failed:', (e && e.message) || e);   // a fault in the hub's code locks nobody out
      return null;
    }
    try {
      Hub.onChange(me => {
        if (this.shouldReload({ state, hubEmail: me && me.email, appEmail: auth.currentUser && auth.currentUser.email })) reload();
      });
    } catch (e) { console.warn('[hub] onChange:', (e && e.message) || e); }
    return { Hub, state, drawn: shown() };
  },

  // ── the hub cannot be reached ──
  // The hub's own words for its card, so whichever draws it, it reads the same.
  DOWN: { title: 'The hub cannot be reached', say: 'Check the connection, then try again.', again: 'Try again' },
  /** Nobody signed in, and the hub drew nothing: the app draws the card itself, once. Try again reloads; so does the connection coming back. */
  downCard() {
    if (document.getElementById('hub-down')) return;
    Boot.gone();
    const g = document.createElement('div');
    g.id = 'auth-gate';
    g.innerHTML = `<section class="success-card auth-card" id="hub-down" aria-labelledby="hub-down-title">
        <div class="auth-logo"></div>
        <h3 id="hub-down-title">${esc(this.DOWN.title)}</h3>
        <p>${esc(this.DOWN.say)}</p>
        <button type="button" class="btn btn-primary" id="hub-down-again">${esc(this.DOWN.again)}</button>
      </section>`;
    document.getElementById('auth-gate')?.remove();
    document.body.appendChild(g);
    const again = () => location.reload();
    document.getElementById('hub-down-again').addEventListener('click', again);
    window.addEventListener('online', again, { once: true });
    document.getElementById('hub-down-again').focus({ preventScroll: true });
  },

  // ── test mode from the address ──
  // `?test=1` and `?test=0` put a device into test mode and out of it without the setting
  // behind the sign-in. `?test=1` counts only where the hub's note on this device lists the
  // test project, so nobody can switch a kiosk into test mode by editing an address;
  // `?test=0` always works. Read before anything starts, then taken out of the address.
  /** 'on' | 'off' | null, from the address's query and the hub's note as stored. */
  testSwitch(search, rawNote) {
    const v = new URLSearchParams(search || '').get('test');
    if (v === '0') return 'off';
    if (v !== '1') return null;
    let n = null;
    try { n = JSON.parse(rawNote || 'null'); } catch { n = null; }
    const apps = n && typeof n.uid === 'string' && n.apps && typeof n.apps === 'object' ? n.apps : null;
    return apps && apps[this.TEST_PROJECT] ? 'on' : null;
  },
  applyTestSwitch() {
    const params = new URLSearchParams(location.search);
    if (!params.has('test')) return;
    let note = null;
    try { note = localStorage.getItem(this.NOTE); } catch { note = null; }
    const to = this.testSwitch(location.search, note);
    if (to) FirebaseConfig.setTestMode(to === 'on');
    params.delete('test');
    const rest = params.toString();
    try { history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash); } catch {}
  },
};

// Before anything starts: the address's test switch, then the hub's file, asked for
// beside Firebase (it is waited for once Firebase has said who is signed in here).
HubBridge.applyTestSwitch();
HubBridge.ask();
