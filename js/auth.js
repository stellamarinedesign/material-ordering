// auth.js — v0.54
//
// Firebase Authentication (email + password) for every page, added as a layer
// ON TOP of the existing pasted-config setup so nothing already running is
// disturbed:
//
//   PHASE 1 (this build)  Firestore rules are still open. Sign-in is optional:
//                         a device that isn't signed in works exactly as before
//                         and shows an amber "Sign in" pill in its header, so
//                         the manager can sign each iPad in at a convenient
//                         moment. Every write carries the signed-in email where
//                         there is one (see firebase-sync.js).
//   PHASE 2 (a console change, not a deploy)  Once every device shows signed
//                         in, the rules in firestore.rules are published and
//                         require a signed-in user. A device that somehow
//                         isn't gets a permission-denied from Firestore, which
//                         DB.onDenied turns into a blocking sign-in prompt —
//                         a locked page, never a broken one.
//   PHASE 3 (later build) The Firebase config can be embedded in the code
//                         (it's public by design once rules require auth), so
//                         a new iPad needs only an email and password.
//
// Accounts are created in the Firebase console (self sign-up is disabled
// there). Kiosk iPads get one account each; managers use personal accounts.
// Persistence is Firebase's default LOCAL, so a sign-in survives reloads and
// home-screen app restarts until the account is disabled or signed out.
const Auth = {
  _user: null,
  _started: false,
  _onChange: null,

  // Call once, after DB.init has succeeded. onChange(user|null) fires on every
  // auth state change; the header pill and Settings account block refresh
  // themselves (they're identified by id, so pages just leave the slots).
  start(onChange) {
    if (this._started || typeof firebase === 'undefined' || typeof firebase.auth !== 'function') return;
    this._started = true;
    this._onChange = onChange || null;
    firebase.auth().onAuthStateChanged(user => {
      this._user = user || null;
      this._refresh();
      if (this._onChange) this._onChange(this._user);
    });
    // One delegated handler for the pill / account buttons on every page.
    document.addEventListener('click', e => {
      if (e.target.closest('[data-auth-signin]'))  { e.preventDefault(); this.openDialog(); }
      if (e.target.closest('[data-auth-signout]')) { e.preventDefault(); this.signOut(); }
    });
  },

  user()       { return this._user; },
  email()      { return this._user ? (this._user.email || '') : ''; },
  isSignedIn() { return !!this._user; },

  async signIn(email, password) {
    await firebase.auth().signInWithEmailAndPassword(String(email || '').trim(), String(password || ''));
  },
  async signOut() {
    if (!confirm('Sign out on this device? It keeps working while the rules are open; once sign-in is required it will ask for a login.')) return;
    await firebase.auth().signOut();
  },
  async resetPassword(email) {
    await firebase.auth().sendPasswordResetEmail(String(email || '').trim());
  },

  // ── DOM slots ─────────────────────────────────────────────────────────
  // Pages drop `<span id="auth-pill"></span>` in their header actions and the
  // Settings panels render `Auth.settingsSection()`; both are refreshed here.
  pillHtml() {
    if (this._user) return '';   // signed in: quiet — the email lives in Settings
    return `<button class="auth-pill" data-auth-signin title="Sign in on this device"><i class="ti ti-user-exclamation"></i> Sign in</button>`;
  },
  settingsSection() {
    const body = this._user
      ? `<div><div class="settings-row-label">Signed in as ${esc(this._user.email || '')}</div><div class="settings-row-sub">This device's identity is recorded on orders, stock changes and deliveries</div></div>
         <button class="btn-sm" data-auth-signout>Sign out</button>`
      : `<div><div class="settings-row-label">Not signed in</div><div class="settings-row-sub">Sign-in will become required once every device has been set up — do it now so this one isn't caught out</div></div>
         <button class="btn-sm btn-sm-save" data-auth-signin>Sign in</button>`;
    return `<div class="settings-section" id="auth-account">
        <div class="settings-label">Account</div>
        <div class="settings-card"><div class="settings-row">${body}</div></div>
      </div>`;
  },
  _refresh() {
    const pill = document.getElementById('auth-pill');
    if (pill) pill.innerHTML = this.pillHtml();
    const acct = document.getElementById('auth-account');
    if (acct) acct.outerHTML = this.settingsSection();
  },

  // ── Sign-in dialog ────────────────────────────────────────────────────
  // Optional (phase 1): a dismissable overlay. Required (rules flipped and this
  // device isn't signed in): the same card without a way to dismiss it, and a
  // reload on success so every listener re-attaches with credentials.
  openDialog(opts = {}) {
    const required = !!opts.required;
    let ow = document.getElementById('overlay-wrap');
    if (!ow) { ow = document.createElement('div'); ow.id = 'overlay-wrap'; document.body.appendChild(ow); }
    if (document.getElementById('auth-card')) return;   // already open
    ow.innerHTML = `
      <div class="success-overlay">
        <div class="success-card auth-card" id="auth-card" style="max-width:380px;text-align:left">
          <div class="auth-logo"></div>
          <h3 style="text-align:center">Sign in</h3>
          <p style="text-align:center;margin-bottom:14px">${required
            ? 'Sign-in is now required on every device. Use the account set up for this iPad, or your own.'
            : 'Use the account set up for this device, or your own.'}</p>
          <div class="setup-field"><label>Email</label><input id="auth-email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="name@stellamarine.com.au"></div>
          <div class="setup-field"><label>Password</label><input id="auth-pass" type="password" autocomplete="current-password"></div>
          <div class="auth-err" id="auth-err"></div>
          <button class="btn btn-primary" id="auth-submit" style="width:100%;margin-top:4px"><i class="ti ti-login"></i> Sign in</button>
          <button class="btn btn-outline" id="auth-reset" style="width:100%;margin-top:8px">Set or reset my password</button>
          ${required ? '' : `<button class="btn btn-outline" id="auth-later" style="width:100%;margin-top:8px">Not now</button>`}
        </div>
      </div>`;
    const err = msg => { document.getElementById('auth-err').textContent = msg || ''; };
    const submit = async () => {
      const email = document.getElementById('auth-email').value.trim();
      const pass  = document.getElementById('auth-pass').value;
      if (!email || !pass) { err('Enter the email and password.'); return; }
      const btn = document.getElementById('auth-submit'); btn.disabled = true; err('');
      try {
        await this.signIn(email, pass);
        ow.innerHTML = '';
        if (required) location.reload();
      } catch (e) { err(this._friendly(e)); btn.disabled = false; }
    };
    document.getElementById('auth-submit').addEventListener('click', submit);
    document.getElementById('auth-pass').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    document.getElementById('auth-email').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('auth-pass').focus(); });
    document.getElementById('auth-reset').addEventListener('click', async () => {
      const email = document.getElementById('auth-email').value.trim();
      if (!email) { err('Type the account email first, then tap reset.'); return; }
      try { await this.resetPassword(email); err(`Reset email sent to ${email} — follow the link in it, then sign in here.`); }
      catch (e) { err(this._friendly(e)); }
    });
    document.getElementById('auth-later')?.addEventListener('click', () => { ow.innerHTML = ''; });
    document.getElementById('auth-email').focus();
  },

  _friendly(e) {
    const code = (e && e.code) || '';
    if (code === 'auth/invalid-email') return "That email address doesn't look right.";
    if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(code))
      return 'Email or password is incorrect.';
    if (code === 'auth/too-many-requests') return 'Too many attempts — wait a few minutes, or reset the password.';
    if (code === 'auth/network-request-failed') return 'No connection — check the wifi and try again.';
    if (code === 'auth/user-disabled') return 'This account has been disabled.';
    return (e && e.message) || 'Sign-in failed.';
  },
};
