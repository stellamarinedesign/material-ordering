// auth.js — v2026-11-27.12
//
// Sign-in (Firebase email + password, compat SDK) and WHO IS WHAT, on every
// page. The same model as the production board:
//
//   · Who has which role is ONE Firestore document, settings/access, with
//     flat arrays of lowercase addresses: managers, engineers, floor, masters.
//     The security rules read that same document, so giving a role in the
//     app is the whole of giving it — the rules are never edited for an
//     account again.
//   · Every read needs a LISTED account. A Firebase user that nobody listed
//     can sign in and reads nothing, which is what makes it safe to let the
//     app create users itself (sign-up stays on in the console).
//   · MASTERS is not a role: a master is whatever role they are, and the only
//     one who may change the lists (js/accounts.js, manager page). With no
//     masters list, the first manager listed is the master — the rules apply
//     the same default. Masters hand it on with a tick, never to themselves.
//   · In this app: managers = the manager page, the catalogue, accounts and
//     permanent deletes; floor = the kiosk iPads and anyone ordering (the
//     ordering, consumables and deliveries pages). `engineers` exists for
//     parity with the board (a hub may merge the two apps' lists one day)
//     and is treated as floor here.
//
// No address lives in this file or anywhere in the repo: a static site hands
// its JavaScript to anyone who asks for it.
//
// SINCE THE APP JOINED THE HUB (js/hub-bridge.js), a new sign-in goes through
// the hub's own screen, which signs this app in to its own project as the
// hub's person; people, roles and passwords are looked after in the hub. On
// the live site the app draws no sign-in form of its own: with nobody signed
// in and the hub out of reach, a copy of the hub's card says so. A device
// signed in before it met the hub carries on exactly as it was. Off the live
// site (localhost, the _local harnesses) the old form is drawn as before, for
// building and testing, until the clean-up release.
//
// Persistence is Firebase's default LOCAL, so a sign-in survives reloads and
// home-screen app restarts until the account is signed out or removed.

const tidyEmail = e => String(e == null ? '' : e).trim().toLowerCase();
const isEmail   = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));

// ── The access document, as data ──────────────────────────────────────────
// Pure functions over { managers, engineers, floor, masters }; nothing here
// touches the DOM or Firebase. Ported from the board's access.js.
const Access = {
  LISTS: ['managers', 'engineers', 'floor', 'masters'],
  ROLES: ['manager', 'floor'],                                 // what this app offers; 'engineer' is still read
  ROLE_LIST:  { manager: 'managers', engineer: 'engineers', floor: 'floor' },
  _tidyList(xs) { return [...new Set((Array.isArray(xs) ? xs : []).map(tidyEmail).filter(Boolean))]; },

  // The document as the app holds it: four tidy, de-duplicated lists. With no
  // masters, the first manager listed is the master — the rules' default too.
  normalise(d) {
    const out = {};
    for (const k of this.LISTS) out[k] = this._tidyList(d && d[k]);
    if (!out.masters.length && out.managers.length) out.masters = [out.managers[0]];
    return out;
  },
  roleOf(a, email) {
    const e = tidyEmail(email);
    if (a && a.managers && a.managers.includes(e))  return 'manager';
    if (a && a.engineers && a.engineers.includes(e)) return 'engineer';
    return 'floor';
  },
  // On one of the three role lists — exactly what the rules' listed() checks.
  isListed(a, email) {
    const e = tidyEmail(email);
    return !!a && ['managers', 'engineers', 'floor'].some(k => (a[k] || []).includes(e));
  },
  isMaster(a, email) { return !!a && (a.masters || []).includes(tidyEmail(email)); },

  // Every listed account as a row: masters first, then by role, then by address.
  rows(a) {
    const n = this.normalise(a);
    const all = [...new Set([...n.managers, ...n.engineers, ...n.floor, ...n.masters])];
    const rank = { manager: 0, engineer: 1, floor: 2 };
    const onRole = email => Object.values(this.ROLE_LIST).some(k => n[k].includes(email));
    return all.map(email => ({ email, role: onRole(email) ? this.roleOf(n, email) : 'none', master: n.masters.includes(email) }))
      .sort((x, y) => Number(y.master) - Number(x.master) || (rank[x.role] ?? 3) - (rank[y.role] ?? 3) || x.email.localeCompare(y.email));
  },
  // The lists with this address in exactly the one role. Masters untouched.
  withRole(a, email, role) {
    if (!this.ROLE_LIST[role]) throw new Error('Not a role: ' + role);
    const e = tidyEmail(email), n = this.normalise(a);
    for (const r of Object.keys(this.ROLE_LIST)) n[this.ROLE_LIST[r]] = n[this.ROLE_LIST[r]].filter(x => x !== e);
    n[this.ROLE_LIST[role]] = [...n[this.ROLE_LIST[role]], e];
    return n;
  },
  // The lists without this address on any role list. Masters untouched.
  withoutAccount(a, email) {
    const e = tidyEmail(email), n = this.normalise(a);
    for (const r of Object.keys(this.ROLE_LIST)) n[this.ROLE_LIST[r]] = n[this.ROLE_LIST[r]].filter(x => x !== e);
    n.masters = n.masters.filter(x => x !== e);   // a master on no role list could still change the lists
    return n;
  },
  withMaster(a, email, on) {
    const e = tidyEmail(email), n = this.normalise(a);
    n.masters = on ? [...new Set([...n.masters, e])] : n.masters.filter(x => x !== e);
    return n;
  },
  // A temporary password for an account just made: readable aloud, no
  // lookalikes. Changed by its owner under Settings on first sign-in.
  tempPassword() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const pick = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => alphabet[b % alphabet.length]).join('');
    return `${pick(4)}-${pick(4)}-${pick(4)}`;
  },
};

const Auth = {
  _user: null,
  _started: false,
  _onChange: null,
  _access: null,            // normalised settings/access, once read
  _accessState: 'none',     // none (signed out) · loading · ready · missing (no document) · denied (couldn't read it)
  _unsubAccess: null,
  _blocked: false,          // the "Enter" card is up (listed, but not for this page)
  // A page's device-name store ({ get, save }) — index: DeviceName,
  // consumables: ConsumablesDeviceName, warehouse: WarehouseDeviceName,
  // manager: ManagerDeviceName (the manager name in Settings). With every
  // iPad on one shared login, the device's own label is what tells their
  // orders apart: the old form carries the field, and after a sign-in through
  // the hub a page whose store is empty asks for it once (namePrompt).
  deviceName: null,

  hub: null,          // the hub (js/hub-bridge.js), when it loaded
  hubState: null,     // what it answered: in | legacy | none | broken | unreachable
  hubDrawn: false,    // one of its own screens was up as it answered: its card
  _joining: false,    // the hub has been asked and has not answered yet

  // Call once, after DB.init has succeeded. onChange(user|null) fires on every
  // auth state change AND again once the access document has been read, so a
  // page's role decisions (the manager guard) are made on real information.
  async start(onChange) {
    if (this._started) return;
    if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') { Boot.ready('sign-in'); return; }
    this._started = true;
    this._onChange = onChange || null;
    // One delegated handler for the Account buttons on every page.
    document.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('[data-auth-signin]'))   { e.preventDefault(); this.openDialog(); }
      // Sign out and Change password on a floor iPad only while the admin lock is open
      if (t.closest('[data-auth-signout]'))  { e.preventDefault(); if (this.adminOpen()) this.signOut(); }
      if (t.closest('[data-auth-password]')) { e.preventDefault(); if (this.adminOpen()) this.changePasswordHere(); }
      if (t.closest('[data-auth-unlock]'))   { e.preventDefault(); this.openUnlockDialog(); }
      if (t.closest('[data-auth-lock]'))     { e.preventDefault(); this.lockAdmin(); }
      if (t.closest('[data-auth-claim]'))    { e.preventDefault(); this.claim(t.closest('[data-auth-claim]')); }
      if (t.closest('[data-auth-out-here]')) { e.preventDefault(); this.signOutEverywhere().then(() => this._reload()); }
    });
    // The app switcher beside the cog, as soon as the hub's file is here and the header is.
    HubBridge.showSwitcher();
    // THE HUB, before the app's own listener: it may sign this app in, or out, as the
    // hub's person first, and its sign-in screen waits for one. The start-up cover stays
    // up meanwhile, so nothing of the page shows for the wrong person. Fails open.
    const atStart = await HubBridge.firstUser();
    let wentOut = false;
    const stopWatch = firebase.auth().onAuthStateChanged(u => { if (!u) wentOut = true; });
    this._joining = true;
    const joined = await HubBridge.join({ reload: () => this._again() }).finally(() => { this._joining = false; stopWatch(); });
    this.hub = (joined && joined.Hub) || null;
    this.hubState = (joined && joined.state) || null;
    this.hubDrawn = !!(joined && joined.drawn);
    // SIGNED IN BY THE HUB JUST NOW (its sign-in screen, or a key it holds): the page opened
    // with nobody signed in, or with someone the hub signed out first (signed out of the hub
    // in another app, or somebody else signed in to it). The page's lists started before
    // that and were refused, and a refused list stays stopped. Reload, as the app's own form
    // always has after a sign-in, so every list starts signed in. The start-up cover is still up.
    if (this._signedInAfterOpen(this._signedInSince(atStart, wentOut, firebase.auth().currentUser))) { this._again(); return; }
    // Nothing shows until a sign-in is known: the page's opaque start-up cover (Boot) stays
    // until Firebase reports a user, or the hub's screen, its card or the old form (off the
    // live site) takes its place. No page content is ever glimpsed signed out.
    let seen = false;
    firebase.auth().onAuthStateChanged(user => {
      // A SESSION THAT WENT WHILE THE PAGE WAS OPEN, with the hub in charge of it: a login
      // just linked or given a new key, or signed out in another app. Reload; the reload
      // asks the hub again. Orders waiting on this device are kept (Firestore's own queue
      // belongs to the account, which linking takes over, never replaces).
      if (!user && HubBridge.noUserAction({ seen, hubState: this.hubState }) === 'reload') { this._again(); return; }
      if (user) seen = true;
      this._user = user || null;
      if (user) { this._closeGate(); Boot.ready('sign-in'); }
      this._stopAccess();
      this._access = null;
      this._accessState = user ? 'loading' : 'none';
      this._refresh(); this._emit();
      if (user) { this._watchAccess(); this.namePrompt(); }
    });
  },
  _leaving: false,
  _again() { if (this._leaving) return; this._leaving = true; location.reload(); },
  SIGNED_IN_RELOAD: 'mo_signed_in_reload',
  /** Signed in now, and not simply as the page opened: nobody then, a sign-out since, or somebody else. */
  _signedInSince(atStart, wentOut, now) { return !!now && (!atStart || wentOut || now.uid !== atStart.uid); },
  /**
   * Reload after a sign-in that came after the page opened? Once in a row per tab: if the
   * reloaded page needs one again (a browser that keeps no sign-in), it carries on rather
   * than reloading for ever.
   */
  _signedInAfterOpen(signedInSinceOpen) {
    let tried = false;
    try {
      tried = sessionStorage.getItem(this.SIGNED_IN_RELOAD) === '1';
      sessionStorage.removeItem(this.SIGNED_IN_RELOAD);
      if (!signedInSinceOpen || tried) return false;
      sessionStorage.setItem(this.SIGNED_IN_RELOAD, '1');
    } catch { return false; }   // nowhere to note the try: never risk reloading for ever
    return true;
  },

  /** Signed in as the hub's person: Password and Sign out behind the lock are the hub's. */
  get viaHub() { return this.hubState === 'in' && !!this.hub; },
  /** Nobody signed in: what to draw (HubBridge.noUserAction). */
  _noUser() { return HubBridge.noUserAction({ hubState: this.hubState, loaded: !!this.hub, drawn: this.hubDrawn }); },

  /** Sign out of the hub as well, when signed in through it (it leaves a mark, so the other apps on this device follow), then out of this app. */
  async signOutEverywhere() {
    if (this.viaHub) {
      try { await this.hub.signOut(); } catch (e) { console.warn('[hub] sign-out failed:', (e && e.message) || e); }
    }
    await firebase.auth().signOut();
  },
  /** Change password: the hub's dialog when signed in through it, else the app's own. */
  changePasswordHere() {
    if (this.viaHub && typeof this.hub.openPassword === 'function') {
      this.hub.openPassword().catch(e => tellFailed('Password not changed', e));
      return;
    }
    this.openPasswordDialog();
  },
  _emit() { if (this._onChange) this._onChange(this._user); },

  // Live copy of settings/access while signed in. A refused read means this
  // account isn't listed (the rules fail closed), and the page says so.
  _watchAccess() {
    if (typeof DB === 'undefined' || !DB.listenAccess) return;
    this._unsubAccess = DB.listenAccess((doc, err) => {
      if (err) { this._access = null; this._accessState = 'denied'; }
      else     { this._access = doc ? Access.normalise(doc) : null; this._accessState = doc ? 'ready' : 'missing'; }
      this._refresh(); this._emit();
      if (err) this.denied(err);
    });
  },
  _stopAccess() { if (this._unsubAccess) { try { this._unsubAccess(); } catch {} this._unsubAccess = null; } },
  // After a save from the Accounts panel — the listener catches up a moment later.
  setAccess(a) { this._access = Access.normalise(a); this._accessState = 'ready'; this._refresh(); this._emit(); },

  user()        { return this._user; },
  email()       { return this._user ? tidyEmail(this._user.email) : ''; },
  isSignedIn()  { return !!this._user; },
  access()      { return this._access; },
  accessState() { return this._accessState; },
  // 'manager' | 'engineer' | 'floor' once known; 'unknown' until the document
  // has been read; 'none' when signed out. Nothing is granted on 'unknown'.
  role()        { if (!this._user) return 'none'; if (this._accessState !== 'ready') return 'unknown'; return Access.roleOf(this._access, this.email()); },
  isListed()    { return this._accessState === 'ready' && Access.isListed(this._access, this.email()); },
  isManager()   { return this.role() === 'manager'; },
  isMaster()    { return this._accessState === 'ready' && Access.isMaster(this._access, this.email()); },

  // Manager page only. A listed account that isn't a manager gets a quiet
  // card — the address and an Enter button to its own page — nothing that
  // reads as an error. Pass it as start()'s onChange so it follows every
  // sign-in, sign-out and list change.
  guardManagerPage() {
    const blocked = this.isSignedIn() && this._accessState === 'ready' && this.isListed() && !this.isManager();
    if (blocked) this._block(); else this._clearBlock();
  },
  homeFor(role) { return role === 'manager' ? 'manager.html' : 'index.html'; },

  // A listener was refused (DB.onDenied), or this account isn't on the list. Signed in,
  // that account is simply not one for this app: a plain screen says so, with Sign out.
  // Signed out, whatever the sign-in way is here (_signInWay). Nothing about roles or
  // lists: only the admin knows they exist.
  denied() {
    if (!this._user) { this._signInWay(); return; }
    if (document.getElementById('auth-none')) return;
    Boot.gone();
    this._gate(`
        <section class="success-card auth-card" id="auth-none">
          <div class="auth-logo"></div>
          <h3>No current account assigned</h3>
          <p>Signed in as ${esc(this.email())}. Notify the admin.</p>
          <button type="button" class="btn btn-outline" data-auth-out-here>Sign out</button>
        </section>`);
  },
  // Nobody signed in: the hub's card is the answer when it drew one; on the live site with
  // the hub drawing nothing, the app's copy of its card; a device the hub left alone that
  // has just signed out reloads into the hub's sign-in; off the live site, the old form.
  _signInWay() {
    if (this._joining) return;      // a list refused while the hub is still answering (its sign-in screen may be up): its answer decides
    const way = this._noUser();
    if (way === 'card') return;
    if (way === 'down') { HubBridge.downCard(); return; }
    if (HubBridge.onLiveSite()) { this._again(); return; }
    this.openDialog();
  },

  _block() {
    this._blocked = true;
    let el = document.getElementById('auth-block');
    if (!el) { el = document.createElement('div'); el.id = 'auth-block'; document.body.appendChild(el); }
    el.innerHTML = `
      <div class="success-card" style="max-width:360px">
        <div class="auth-logo"></div>
        <p>Signed in as <strong>${esc(this.email())}</strong></p>
        <a class="btn btn-primary" style="width:100%;display:flex;justify-content:center" href="${this.homeFor(this.role())}">Enter <i class="ti ti-arrow-right"></i></a>
      </div>`;
  },
  _clearBlock() { this._blocked = false; document.getElementById('auth-block')?.remove(); },
  // The full-screen, opaque layer the curtain and the sign-in dialog live in.
  _gate(html) {
    let g = document.getElementById('auth-gate');
    if (!g) { g = document.createElement('div'); g.id = 'auth-gate'; document.body.appendChild(g); }
    g.innerHTML = html;
    return g;
  },
  _closeGate() { document.getElementById('auth-gate')?.remove(); },
  _reload() { location.reload(); },

  // First-time setup: write settings/access with this account as the only
  // manager (and so the master). The rules allow it only while no document
  // exists; afterwards it is refused, and the refusal is the point.
  async claim(btn) {
    const err = document.getElementById('auth-claim-err');
    if (!this.isSignedIn()) return;
    const back = busyBtn(btn, 'Saving…');
    try {
      await DB.saveAccess({ managers: [this.email()], engineers: [], floor: [], masters: [] });
      this._reload();
    } catch (e) {
      back();
      if (err) err.textContent = (e && e.code === 'permission-denied')
        ? 'Refused — an accounts list already exists, so the admin has to add this account.'
        : `Not saved: ${whyFailed(e)}. Try again.`;
    }
  },

  async signIn(email, password) {
    await firebase.auth().signInWithEmailAndPassword(String(email || '').trim(), String(password || ''));
  },
  async signOut() {
    if (!await Ask.confirm({ title: 'Sign out on this device?',
      body: this.viaHub ? 'Getting back in needs the hub sign-in.' : 'It needs the email and password to get back in.',
      yes: 'Sign out', no: 'Stay signed in', danger: true })) return;
    await this.signOutEverywhere();
  },
  // Change the signed-in account's password, here, no email in the loop.
  // Firebase won't change a password on a stale sign-in, so the current one
  // is proved first; a wrong one fails there, before anything changes.
  async changePassword(current, next) {
    const user = firebase.auth().currentUser;
    if (!user || !user.email) throw new Error('Not signed in.');
    await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, current));
    await user.updatePassword(next);
  },

  // ── Admin lock (the floor iPads) ──────────────────────────────────────
  // The iPads share one login, so anyone could sign one out or change its password.
  // There, the device name, Change password and Sign out wait behind the password the
  // iPad was signed in with, which floor staff never type. Unlocked for 5 minutes, or
  // until Settings closes. A deterrent, not security: the database rules are that.
  // Signed in through the hub, the app's own password is a key nobody knows, so the
  // lock takes the floor login's HUB password instead (Hub.confirmPassword: true or
  // false; it rejects only when the hub cannot be reached). A hub too old to have it
  // keeps the lock shut: "Ask the admin."
  ADMIN_MS: 5 * 60 * 1000,
  _adminUntil: 0,
  _adminTimer: null,
  _floor() { return document.body.classList.contains('floor'); },
  adminOpen() { return !this._floor() || Date.now() < this._adminUntil; },
  lockAdmin() {
    if (!this._adminUntil) return;
    this._adminUntil = 0; clearTimeout(this._adminTimer);
    this._refresh();
  },
  async unlockAdmin(password) {
    const user = firebase.auth().currentUser;
    if (!user || !user.email) throw new Error('Not signed in.');
    if (this.viaHub) {
      if (typeof this.hub.confirmPassword !== 'function') throw Object.assign(new Error('The hub cannot check it'), { code: 'hub/no-confirm' });
      let ok;
      try { ok = await this.hub.confirmPassword(password); }
      catch (e) { throw Object.assign(new Error('The hub cannot be reached'), { code: 'hub/unreachable' }); }
      if (ok !== true) throw Object.assign(new Error('Not the password'), { code: 'auth/wrong-password' });
    } else {
      await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
    }
    this._adminUntil = Date.now() + this.ADMIN_MS;
    clearTimeout(this._adminTimer);
    this._adminTimer = setTimeout(() => this.lockAdmin(), this.ADMIN_MS);
    this._refresh();
  },
  openUnlockDialog() {
    if (!this.isSignedIn() || document.getElementById('unlock-card')) return;
    let ow = document.getElementById('overlay-wrap');
    if (!ow) { ow = document.createElement('div'); ow.id = 'overlay-wrap'; document.body.appendChild(ow); }
    ow.innerHTML = `
      <div class="success-overlay">
        <form class="success-card auth-card" id="unlock-card" style="max-width:380px;text-align:left" novalidate>
          <h3 style="text-align:center">Unlock admin</h3>
          <p style="text-align:center;margin-bottom:14px">Password for ${esc(this.email())}.</p>
          <div class="setup-field"><label for="unlock-pass">Password</label><input id="unlock-pass" type="password" autocomplete="current-password"></div>
          <div class="auth-err" id="unlock-err" role="alert"></div>
          <button type="submit" class="btn btn-primary" id="unlock-go" style="width:100%;margin-top:4px"><i class="ti ti-lock-open"></i> Unlock</button>
          <button type="button" class="btn btn-outline" id="unlock-cancel" data-esc style="width:100%;margin-top:8px">Keep locked</button>
        </form>
      </div>`;
    const $ = id => document.getElementById(id);
    const err = msg => { $('unlock-err').textContent = msg || ''; };
    $('unlock-card').addEventListener('submit', async e => {
      e.preventDefault();
      const pass = $('unlock-pass').value;
      if (!pass) { refuseField($('unlock-pass')); return err('Type the password first.'); }
      const back = busyBtn($('unlock-go'), 'Unlocking…'); err('');
      try {
        await this.unlockAdmin(pass);
        ow.innerHTML = '';
      } catch (e) {
        back();
        const code = (e && e.code) || '';
        err(this._badCredential(e) ? 'The password is not right.'
          : code === 'hub/no-confirm' ? 'Ask the admin.'
          : code === 'hub/unreachable' ? 'The hub cannot be reached. Check the connection, then try again.'
          : this._friendly(e, 'unlock'));
        refuseField($('unlock-pass'));
      }
    });
    $('unlock-cancel').addEventListener('click', () => { ow.innerHTML = ''; });
    $('unlock-pass').focus();
  },

  // ── DOM slots ─────────────────────────────────────────────────────────
  // Pages drop `<span id="auth-pill"></span>` in their header actions and the
  // Settings panels render `Auth.settingsSection()`; both are refreshed here.
  pillHtml() { return ''; },   // no header pill: sign-in is the hub's screen (or, off the live site, a dialog)
  settingsSection() {
    let body;
    if (!this._user) {
      body = `<div><div class="settings-row-label">Not signed in</div></div>
         <button class="btn-sm btn-sm-save" data-auth-signin>Sign in</button>`;
    } else if (!this.adminOpen()) {
      body = `<i class="ti ti-lock admin-lock" aria-hidden="true"></i>
         <div style="flex:1"><div class="settings-row-label">Admin</div><div class="settings-row-sub">Device name, password, sign out</div></div>
         <button class="btn-sm" data-auth-unlock>Unlock</button>`;
    } else {
      // The address only. Roles are shown nowhere but the hub's Accounts (Pete, 27 Nov):
      // which page a person gets is the whole of their role here, admin or not.
      const sub = this._accessState === 'missing' ? 'No accounts list exists yet' : '';
      body = `<div><div class="settings-row-label">${esc(this._user.email || '')}</div>${sub ? `<div class="settings-row-sub">${esc(sub)}</div>` : ''}</div>
         <div class="settings-acts"><button class="btn-sm" data-auth-password>Change password</button><button class="btn-sm" data-auth-signout>Sign out</button>${this._floor() ? '<button class="btn-sm" data-auth-lock><i class="ti ti-lock"></i> Lock</button>' : ''}</div>`;
    }
    const setup = this._user && this._accessState === 'missing' ? `
          <div class="settings-row">
            <div><div class="settings-row-label">Set up accounts</div><div class="settings-row-sub">Lists ${esc(this.email())} as the first manager and admin</div></div>
            <button class="btn-sm btn-sm-save" data-auth-claim>Make me the manager</button>
          </div>
          <div class="auth-err" id="auth-claim-err" style="padding:0 14px"></div>` : '';
    return `<div class="settings-section" id="auth-account">
        <div class="settings-label">Account</div>
        <div class="settings-card"><div class="settings-row">${body}</div>${setup}</div>
      </div>`;
  },
  _refresh() {
    const pill = document.getElementById('auth-pill');
    if (pill) pill.innerHTML = this.pillHtml();
    const acct = document.getElementById('auth-account');
    if (acct) acct.outerHTML = this.settingsSection();
    if (!this._user) { this._clearBlock(); this._signInWay(); }   // the rules need a sign-in for everything
    else if (this._accessState === 'ready' && !this.isListed()) this.denied();
    // Anything an admin alone should see (the test-mode switch in Settings).
    document.querySelectorAll('[data-master-only]').forEach(el => { el.hidden = !this.isMaster(); });
    // The admin lock: fields that change only when unlocked, and their read-only stand-ins.
    const open = this.adminOpen();
    document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !open; });
    document.querySelectorAll('[data-admin-locked]').forEach(el => { el.hidden = open; });
    if (typeof Accounts !== 'undefined' && Accounts.refresh) Accounts.refresh();
  },

  // ── The device name, after a sign-in through the hub ──────────────────
  // The hub's screen has no device-name field, so a page whose store is empty asks for
  // it once: one field and Save. A device already named keeps its name. The old form
  // (off the live site) still asks in its own field.
  namePrompt() {
    const dn = this.deviceName;
    if (!dn || dn.get() || !this._user || document.getElementById('auth-name-card') || document.getElementById('auth-card')) return;
    this._gate(`
        <form class="success-card auth-card" id="auth-name-card" style="max-width:380px;text-align:left" novalidate>
          <h3 style="text-align:center" id="auth-name-title">Device name</h3>
          <div class="setup-field"><input id="auth-name" type="text" aria-labelledby="auth-name-title" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false"></div>
          <div class="auth-err" id="auth-name-err" role="alert"></div>
          <button type="submit" class="btn btn-primary" id="auth-name-save" style="width:100%;margin-top:4px"><i class="ti ti-check"></i> Save</button>
        </form>`);
    const $ = id => document.getElementById(id);
    $('auth-name-card').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('auth-name').value.trim();
      if (!name) { $('auth-name-err').textContent = 'Enter a device name.'; refuseField($('auth-name')); return; }
      dn.save(name);
      this._reload();             // every header and list drawn with the name
    });
    $('auth-name').focus();
  },

  // ── Sign-in dialog ────────────────────────────────────────────────────
  // OFF THE LIVE SITE ONLY since the hub (above). Lives in the opaque gate, so nothing
  // of the page shows behind it, and has no way past it. A successful sign-in reloads,
  // so every listener attaches with the new credentials.
  openDialog() {
    if (HubBridge.onLiveSite()) { this._signInWay(); return; }   // never a form of the app's own there
    if (document.getElementById('auth-card')) return;   // already open
    const dn = this.deviceName;
    Boot.gone();
    this._gate(`
        <form class="success-card auth-card" id="auth-card" style="max-width:380px;text-align:left" novalidate>
          <div class="auth-logo"></div>
          <h3 style="text-align:center">Sign in</h3>
          <p style="text-align:center;margin-bottom:14px">Use the account set up for this device.</p>
          ${dn ? `<div class="setup-field"><label for="auth-device">Device name</label><input id="auth-device" type="text" autocomplete="off" autocapitalize="words" value="${esc(dn.get())}"></div>` : ''}
          <div class="setup-field"><label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></div>
          <div class="setup-field"><label for="auth-pass">Password</label><input id="auth-pass" type="password" autocomplete="current-password"></div>
          <div class="auth-err" id="auth-err" role="alert"></div>
          <button type="submit" class="btn btn-primary" id="auth-submit" style="width:100%;margin-top:4px"><i class="ti ti-login"></i> Sign in</button>
        </form>`);
    const $ = id => document.getElementById(id);
    const err = msg => { $('auth-err').textContent = msg || ''; };
    const submit = async () => {
      const email  = $('auth-email').value.trim();
      const pass   = $('auth-pass').value;
      const device = dn ? $('auth-device').value.trim() : '';
      if (dn && !device) { err('Enter a device name.'); refuseField($('auth-device')); return; }
      if (!email || !pass) { err('Enter the email and password.'); refuseField(email ? $('auth-pass') : $('auth-email')); return; }
      const back = busyBtn($('auth-submit'), 'Signing in…'); err('');
      try {
        await this.signIn(email, pass);
        if (dn) dn.save(device);
        this._reload();
      } catch (e) {
        err(this._friendly(e)); back();
        if (e && e.code === 'auth/invalid-email') refuseField($('auth-email'));
        else if (this._badCredential(e)) refuseField($('auth-pass'));
      }
    };
    // Enter in a field goes on to the next empty one, then signs in.
    $('auth-card').addEventListener('submit', e => {
      e.preventDefault();
      const at = document.activeElement, empty = [...$('auth-card').querySelectorAll('input')].find(i => !i.value.trim());
      if (empty && at && at.tagName === 'INPUT' && at !== empty) { empty.focus(); return; }
      submit();
    });
    (dn && !dn.get() ? $('auth-device') : $('auth-email')).focus();
  },

  // ── Change password dialog ────────────────────────────────────────────
  PASSWORD_MIN: 8,
  openPasswordDialog() {
    if (!this.isSignedIn()) return;
    let ow = document.getElementById('overlay-wrap');
    if (!ow) { ow = document.createElement('div'); ow.id = 'overlay-wrap'; document.body.appendChild(ow); }
    if (document.getElementById('pw-card')) return;
    ow.innerHTML = `
      <div class="success-overlay">
        <div class="success-card auth-card" id="pw-card" style="max-width:380px;text-align:left">
          <h3 style="text-align:center">Change password</h3>
          <p style="text-align:center;margin-bottom:14px">For ${esc(this.email())}.</p>
          <div class="setup-field"><label>Current password</label><input id="pw-current" type="password" autocomplete="current-password"></div>
          <div class="setup-field"><label>New password</label><input id="pw-new" type="password" autocomplete="new-password" placeholder="At least ${this.PASSWORD_MIN} characters"></div>
          <div class="setup-field"><label>New password, again</label><input id="pw-again" type="password" autocomplete="new-password"></div>
          <div class="auth-err" id="pw-err" role="alert"></div>
          <button class="btn btn-primary" id="pw-save" style="width:100%;margin-top:4px"><i class="ti ti-key"></i> Change password</button>
          <button class="btn btn-outline" id="pw-cancel" data-esc style="width:100%;margin-top:8px">Keep current password</button>
        </div>
      </div>`;
    const $ = id => document.getElementById(id);
    const err = msg => { $('pw-err').textContent = msg || ''; };
    const submit = async () => {
      const current = $('pw-current').value, next = $('pw-new').value, again = $('pw-again').value;
      if (!current) { refuseField($('pw-current')); return err('Type the current password first.'); }
      if (next.length < this.PASSWORD_MIN) { refuseField($('pw-new')); return err(`The new password needs at least ${this.PASSWORD_MIN} characters.`); }
      if (next !== again) { refuseField($('pw-again')); return err('The two new passwords are not the same.'); }
      if (next === current) { refuseField($('pw-new')); return err('That is the current password.'); }
      const back = busyBtn($('pw-save'), 'Changing…'); err('');
      try {
        await this.changePassword(current, next);
        ow.innerHTML = '';
        this._toast('Password changed. Use the new one from now on.');
      } catch (e) {
        err(this._friendly(e, 'password')); back();
        if (this._badCredential(e)) refuseField($('pw-current'));
        else if (e && e.code === 'auth/weak-password') refuseField($('pw-new'));
      }
    };
    $('pw-save').addEventListener('click', submit);
    for (const id of ['pw-current', 'pw-new', 'pw-again']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    $('pw-cancel').addEventListener('click', () => { ow.innerHTML = ''; });
    $('pw-current').focus();
  },

  _toast(msg) { toast(msg); },

  // Firebase's error codes are not sentences. Make them ones.
  _badCredential(e) {
    return ['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes((e && e.code) || '');
  },
  // where: 'password' (changing it) or 'account' (making one); otherwise signing in.
  _friendly(e, where) {
    const code = (e && e.code) || '';
    if (code === 'auth/invalid-email') return "That email address doesn't look right.";
    if (this._badCredential(e)) return where === 'password' ? 'The current password is not right.' : 'Email or password is incorrect.';
    if (code === 'auth/weak-password') return `The password needs at least ${this.PASSWORD_MIN} characters.`;
    if (code === 'auth/email-already-in-use') return 'That address already has a Firebase user.';
    if (code === 'auth/operation-not-allowed') return 'Making accounts from the app is switched off in the Firebase console (Authentication → Settings → User actions → Enable create).';
    if (code === 'auth/requires-recent-login') return 'Sign out, sign in again, and then change it.';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes, then try again.';
    if (code === 'auth/network-request-failed') return 'No connection. Check the Wi-Fi, then try again.';
    if (code === 'auth/user-disabled') return 'This account has been switched off.';
    console.error('Auth:', e);
    return where === 'password' ? 'Password not changed. Try again.' : where === 'account' ? 'Account not made. Try again.'
      : where === 'unlock' ? 'Not unlocked. Try again.' : 'Not signed in. Try again.';
  },
};
