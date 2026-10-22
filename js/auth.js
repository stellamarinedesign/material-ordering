// auth.js — v2026-10-22.1
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
    return all.map(email => ({ email, role: this.roleOf(n, email), master: n.masters.includes(email) }))
      .sort((x, y) => Number(y.master) - Number(x.master) || rank[x.role] - rank[y.role] || x.email.localeCompare(y.email));
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
    if (this._started || typeof firebase === 'undefined' || typeof firebase.auth !== 'function') return;
    this._started = true;
    this._onChange = onChange || null;
    firebase.auth().onAuthStateChanged(user => {
      this._user = user || null;
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
      if (t.closest('[data-auth-signout]'))  { e.preventDefault(); this.signOut(); }
      if (t.closest('[data-auth-password]')) { e.preventDefault(); this.openPasswordDialog(); }
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
  denied() { this.openDialog({ required: true }); },

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
  _reload() { location.reload(); },

  // First-time setup: write settings/access with this account as the only
  // manager (and so the master). The rules allow it only while no document
  // exists; afterwards it is refused, and the refusal is the point.
  async claim(btn) {
    const err = document.getElementById('auth-claim-err');
    if (!this.isSignedIn()) return;
    if (btn) btn.disabled = true;
    try {
      await DB.saveAccess({ managers: [this.email()], engineers: [], floor: [], masters: [] });
      this._reload();
    } catch (e) {
      if (btn) btn.disabled = false;
      if (err) err.textContent = (e && e.code === 'permission-denied')
        ? 'Refused — an accounts list already exists, so a master has to add this account.'
        : 'Could not save — ' + ((e && e.message) || e);
    }
  },

  async signIn(email, password) {
    await firebase.auth().signInWithEmailAndPassword(String(email || '').trim(), String(password || ''));
  },
  async signOut() {
    if (!confirm('Sign out on this device?')) return;
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

  // ── DOM slots ─────────────────────────────────────────────────────────
  // Pages drop `<span id="auth-pill"></span>` in their header actions and the
  // Settings panels render `Auth.settingsSection()`; both are refreshed here.
  pillHtml() {
    if (this._user) return '';   // signed in: quiet — the account lives in Settings
    return `<button class="auth-pill" data-auth-signin title="Sign in on this device"><i class="ti ti-user-exclamation"></i> Sign in</button>`;
  },
  settingsSection() {
    let body;
    if (!this._user) {
      body = `<div><div class="settings-row-label">Not signed in</div></div>
         <button class="btn-sm btn-sm-save" data-auth-signin>Sign in</button>`;
    } else {
      // Role words and the Master chip for a master only — everyone else sees
      // their address; which page they get is the whole of their role.
      const master = this.isMaster(), role = this.role();
      const sub = master ? `${Access.ROLE_LABEL[role]}: ${Access.ROLE_WORDS[role]}` : (this._accessState === 'missing' ? 'No accounts list exists yet' : '');
      body = `<div><div class="settings-row-label">${esc(this._user.email || '')}${master ? ' <span class="master-chip">Master</span>' : ''}</div>${sub ? `<div class="settings-row-sub">${esc(sub)}</div>` : ''}</div>
         <div class="settings-acts"><button class="btn-sm" data-auth-password>Password</button><button class="btn-sm" data-auth-signout>Sign out</button></div>`;
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
    if (!this._user) this._clearBlock();
    else if (this._accessState === 'ready' && !this.isListed()) this.denied();
    // Anything a master alone should see (the test-mode switch in Settings).
    document.querySelectorAll('[data-master-only]').forEach(el => { el.hidden = !this.isMaster(); });
    if (typeof Accounts !== 'undefined' && Accounts.refresh) Accounts.refresh();
  },

  // ── Sign-in dialog ────────────────────────────────────────────────────
  // Optional: a dismissable overlay. Required (sign-in needed and this device
  // has none): the same card without a way to dismiss it. Either way a
  // sign-in from a locked state reloads, so every listener re-attaches with
  // the new credentials.
  openDialog(opts = {}) {
    const required = !!opts.required;
    let ow = document.getElementById('overlay-wrap');
    if (!ow) { ow = document.createElement('div'); ow.id = 'overlay-wrap'; document.body.appendChild(ow); }
    if (document.getElementById('auth-card')) return;   // already open
    const dn = this.deviceName;
    ow.innerHTML = `
      <div class="success-overlay">
        <div class="success-card auth-card" id="auth-card" style="max-width:380px;text-align:left">
          <div class="auth-logo"></div>
          <h3 style="text-align:center">Sign in</h3>
          <p style="text-align:center;margin-bottom:14px">Use the account set up for this device.</p>
          ${dn ? `<div class="setup-field"><label>Device name</label><input id="auth-device" type="text" autocomplete="off" value="${esc(dn.get())}"></div>` : ''}
          <div class="setup-field"><label>Email</label><input id="auth-email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
          <div class="setup-field"><label>Password</label><input id="auth-pass" type="password" autocomplete="current-password"></div>
          <div class="auth-err" id="auth-err"></div>
          <button class="btn btn-primary" id="auth-submit" style="width:100%;margin-top:4px"><i class="ti ti-login"></i> Sign in</button>
          ${required ? '' : `<button class="btn btn-outline" id="auth-later" style="width:100%;margin-top:8px">Not now</button>`}
        </div>
      </div>`;
    const err = msg => { document.getElementById('auth-err').textContent = msg || ''; };
    const reloadAfter = required || this._blocked;
    const submit = async () => {
      const email  = document.getElementById('auth-email').value.trim();
      const pass   = document.getElementById('auth-pass').value;
      const device = dn ? document.getElementById('auth-device').value.trim() : '';
      if (dn && !device) { err('Enter a device name.'); return; }
      if (!email || !pass) { err('Enter the email and password.'); return; }
      const btn = document.getElementById('auth-submit'); btn.disabled = true; err('');
      try {
        await this.signIn(email, pass);
        if (dn) dn.save(device);
        ow.innerHTML = '';
        if (reloadAfter) this._reload();
      } catch (e) { err(this._friendly(e)); btn.disabled = false; }
    };
    document.getElementById('auth-submit').addEventListener('click', submit);
    document.getElementById('auth-pass').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    document.getElementById('auth-email').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('auth-pass').focus(); });
    document.getElementById('auth-later')?.addEventListener('click', () => { ow.innerHTML = ''; });
    document.getElementById('auth-email').focus();
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
          <div class="auth-err" id="pw-err"></div>
          <button class="btn btn-primary" id="pw-save" style="width:100%;margin-top:4px"><i class="ti ti-key"></i> Change password</button>
          <button class="btn btn-outline" id="pw-cancel" style="width:100%;margin-top:8px">Cancel</button>
        </div>
      </div>`;
    const $ = id => document.getElementById(id);
    const err = msg => { $('pw-err').textContent = msg || ''; };
    const submit = async () => {
      const current = $('pw-current').value, next = $('pw-new').value, again = $('pw-again').value;
      if (!current) return err('Type the current password first.');
      if (next.length < this.PASSWORD_MIN) return err(`The new password needs at least ${this.PASSWORD_MIN} characters.`);
      if (next !== again) return err('The two new passwords are not the same.');
      if (next === current) return err('That is the current password.');
      const btn = $('pw-save'); btn.disabled = true; err('');
      try {
        await this.changePassword(current, next);
        ow.innerHTML = '';
        this._toast('Password changed. Use the new one from now on.');
      } catch (e) { err(this._friendly(e)); btn.disabled = false; }
    };
    $('pw-save').addEventListener('click', submit);
    for (const id of ['pw-current', 'pw-new', 'pw-again']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    $('pw-cancel').addEventListener('click', () => { ow.innerHTML = ''; });
    $('pw-current').focus();
  },

  // The page's toast where there is one (the manager page), else an alert.
  _toast(msg) {
    const page = (typeof Manager !== 'undefined' && Manager._toast) ? Manager : null;
    if (page) page._toast(msg); else alert(msg);
  },

  // Firebase's error codes are not sentences. Make them ones.
  _friendly(e) {
    const code = (e && e.code) || '';
    if (code === 'auth/invalid-email') return "That email address doesn't look right.";
    if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(code))
      return 'Email or password is incorrect.';
    if (code === 'auth/weak-password') return 'Firebase wants a stronger password — at least six characters.';
    if (code === 'auth/email-already-in-use') return 'That address already has a Firebase user.';
    if (code === 'auth/operation-not-allowed') return 'Making accounts from the app is switched off in the Firebase console (Authentication → Settings → User actions → Enable create).';
    if (code === 'auth/requires-recent-login') return 'Sign out, sign in again, and then change it.';
    if (code === 'auth/too-many-requests') return 'Too many attempts — wait a few minutes and try again.';
    if (code === 'auth/network-request-failed') return 'No connection — check the wifi and try again.';
    if (code === 'auth/user-disabled') return 'This account has been disabled.';
    return (e && e.message) || 'Sign-in failed.';
  },
};
