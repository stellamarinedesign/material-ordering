// auth.js — v2026-11-27.4
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
// Passwords are changed in the app (Settings → Account → Password), proving
// the current one first. Firebase's reset mail is avoided (unrecognisable
// sender, lands in junk, slow); a forgotten password is the one console job
// left — delete the user there, then Make user again from Accounts.
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
  ROLE_LABEL: { manager: 'Manager', engineer: 'Engineer', floor: 'Floor' },
  ROLE_WORDS: {
    manager:  'the manager page, the materials catalogue, accounts',
    engineer: 'ordering, consumables and deliveries',
    floor:    'ordering, consumables and deliveries',
  },
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
  // consumables: ConsumablesDeviceName, warehouse: WarehouseDeviceName. With
  // every iPad on one shared login, the device's own label is what tells
  // their orders apart, so the sign-in dialog carries it, as the setup screen
  // does. The manager page has none (it uses the manager name in Settings).
  deviceName: null,

  // Call once, after DB.init has succeeded. onChange(user|null) fires on every
  // auth state change AND again once the access document has been read, so a
  // page's role decisions (the manager guard) are made on real information.
  start(onChange) {
    if (this._started) return;
    if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') { Boot.ready('sign-in'); return; }
    this._started = true;
    this._onChange = onChange || null;
    // Nothing shows until a sign-in is known: the page's opaque start-up cover (Boot) stays
    // until Firebase reports a user, or the sign-in dialog takes its place if there is
    // none. No page content is ever glimpsed signed out.
    firebase.auth().onAuthStateChanged(user => {
      this._user = user || null;
      if (user) { this._closeGate(); Boot.ready('sign-in'); }
      this._stopAccess();
      this._access = null;
      this._accessState = user ? 'loading' : 'none';
      this._refresh(); this._emit();
      if (user) this._watchAccess();
    });
    // One delegated handler for the pill / Account buttons on every page.
    document.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('[data-auth-signin]'))   { e.preventDefault(); this.openDialog(); }
      // Sign out and Change password on a floor iPad only while the admin lock is open
      if (t.closest('[data-auth-signout]'))  { e.preventDefault(); if (this.adminOpen()) this.signOut(); }
      if (t.closest('[data-auth-password]')) { e.preventDefault(); if (this.adminOpen()) this.openPasswordDialog(); }
      if (t.closest('[data-auth-unlock]'))   { e.preventDefault(); this.openUnlockDialog(); }
      if (t.closest('[data-auth-lock]'))     { e.preventDefault(); this.lockAdmin(); }
      if (t.closest('[data-auth-claim]'))    { e.preventDefault(); this.claim(t.closest('[data-auth-claim]')); }
    });
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
  // sign-in, sign-out and list change. Not signed in at all still gets in
  // until the rules require sign-in.
  guardManagerPage() {
    const blocked = this.isSignedIn() && this._accessState === 'ready' && this.isListed() && !this.isManager();
    if (blocked) this._block(); else this._clearBlock();
  },
  homeFor(role) { return role === 'manager' ? 'manager.html' : 'index.html'; },

  // A listener was refused (DB.onDenied), or this account isn't on the list:
  // either way the device needs a listed account, so the sign-in dialog, with
  // no way past it. An unlisted account is simply not one for this app.
  denied() { this.openDialog(); },

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
        ? 'Refused — an accounts list already exists, so a master has to add this account.'
        : `Not saved: ${whyFailed(e)}. Try again.`;
    }
  },

  async signIn(email, password) {
    await firebase.auth().signInWithEmailAndPassword(String(email || '').trim(), String(password || ''));
  },
  async signOut() {
    if (!await Ask.confirm({ title: 'Sign out on this device?', body: 'It needs the email and password to get back in.', yes: 'Sign out', no: 'Stay signed in', danger: true })) return;
    await firebase.auth().signOut();
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
    await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
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
        err(this._badCredential(e) ? 'The password is not right.' : this._friendly(e, 'unlock'));
        refuseField($('unlock-pass'));
      }
    });
    $('unlock-cancel').addEventListener('click', () => { ow.innerHTML = ''; });
    $('unlock-pass').focus();
  },

  // ── DOM slots ─────────────────────────────────────────────────────────
  // Pages drop `<span id="auth-pill"></span>` in their header actions and the
  // Settings panels render `Auth.settingsSection()`; both are refreshed here.
  pillHtml() { return ''; },   // kept for the header slots; sign-in is a dialog now, never optional
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
      // Role words and the Master chip for a master only — everyone else sees
      // their address; which page they get is the whole of their role.
      const master = this.isMaster(), role = this.role();
      const sub = master ? `${Access.ROLE_LABEL[role]}: ${Access.ROLE_WORDS[role]}` : (this._accessState === 'missing' ? 'No accounts list exists yet' : '');
      body = `<div><div class="settings-row-label">${esc(this._user.email || '')}${master ? ' <span class="master-chip">Master</span>' : ''}</div>${sub ? `<div class="settings-row-sub">${esc(sub)}</div>` : ''}</div>
         <div class="settings-acts"><button class="btn-sm" data-auth-password>Change password</button><button class="btn-sm" data-auth-signout>Sign out</button>${this._floor() ? '<button class="btn-sm" data-auth-lock><i class="ti ti-lock"></i> Lock</button>' : ''}</div>`;
    }
    const setup = this._user && this._accessState === 'missing' ? `
          <div class="settings-row">
            <div><div class="settings-row-label">Set up accounts</div><div class="settings-row-sub">Lists ${esc(this.email())} as the first manager and master</div></div>
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
    if (!this._user) { this._clearBlock(); this.denied(); }      // the rules need a sign-in for everything: ask at once
    else if (this._accessState === 'ready' && !this.isListed()) this.denied();
    // Anything a master alone should see (the test-mode switch in Settings).
    document.querySelectorAll('[data-master-only]').forEach(el => { el.hidden = !this.isMaster(); });
    // The admin lock: fields that change only when unlocked, and their read-only stand-ins.
    const open = this.adminOpen();
    document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !open; });
    document.querySelectorAll('[data-admin-locked]').forEach(el => { el.hidden = open; });
    if (typeof Accounts !== 'undefined' && Accounts.refresh) Accounts.refresh();
  },

  // ── Sign-in dialog ────────────────────────────────────────────────────
  // Lives in the opaque gate, so nothing of the page shows behind it, and has
  // no way past it. A successful sign-in reloads, so every listener attaches
  // with the new credentials.
  openDialog() {
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
