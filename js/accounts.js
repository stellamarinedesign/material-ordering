// accounts.js — v2026-10-22.3
//
// Manager page only: the Accounts section of Settings, for a MASTER and for
// nobody else — absent otherwise, not greyed. Every listed address with its
// role in a dropdown, a Master tick, Make user and Remove; and an Add row
// that lists an address AND makes its Firebase user, showing a temporary
// password once. Each change is written to settings/access (see js/auth.js
// for the model) and logged to the append-only `activity` collection.
//
// ADD LISTS FIRST, THEN MAKES THE USER. The rules read the list, so a user
// that exists but isn't listed can sign in and read nothing, while a listed
// address whose user doesn't exist yet is harmless. The user is made on a
// second Firebase app (DB.createAccount) so the master stays signed in.
const Accounts = {
  _fresh: null,       // { email, password } | { email, exists } | { email, failed } — what became of the last user made
  _activity: null,    // recent access changes, newest first (null = not fetched)
  _err: '',
  _busy: false,
  _mounted: false,

  section() { return `<div class="settings-section" id="auth-accounts">${this._inner()}</div>`; },
  refresh() {
    const el = document.getElementById('auth-accounts'); if (!el) return;
    const restore = captureInputFocus();
    el.innerHTML = this._inner();
    restore();
  },
  mount() {
    if (this._mounted) return;
    this._mounted = true;
    document.addEventListener('click',  e => this._onClick(e));
    document.addEventListener('change', e => this._onChange(e));
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'acct-new-email') this._add(); });
  },

  _inner() {
    if (!Auth.isMaster()) { this._fresh = null; return ''; }
    if (this._activity === null) this._loadActivity();
    const me = Auth.email(), rows = Access.rows(Auth.access());
    const roleSel = (value, attrs) => `<select class="acct-role" ${attrs || ''}>${
      [...Access.ROLES, ...(value === 'engineer' ? ['engineer'] : [])].map(r => `<option value="${r}"${r === value ? ' selected' : ''}>${Access.ROLE_LABEL[r]}</option>`).join('')}</select>`;
    const rowHtml = r => {
      const self = r.email === me;
      return `<div class="acct-row" data-acct-row="${esc(r.email)}">
        <span class="acct-email">${esc(r.email)}${r.master ? ' <span class="master-chip">Master</span>' : ''}</span>
        ${roleSel(r.role, `data-acct-role${self ? ' disabled title="Your own role; another master can change it."' : ''}`)}
        <label class="acct-master" title="${self ? 'Your own; another master can change it.' : 'May change this list'}"><input type="checkbox" data-acct-master${r.master ? ' checked' : ''}${self ? ' disabled' : ''}> Master</label>
        <button class="btn-sm" data-acct-make${self ? ' disabled title="Your own account exists: you are signed in with it."' : ' title="Make the Firebase user for this address, temporary password shown once"'}>Make user</button>
        <button class="btn-sm btn-sm-danger" data-acct-remove${self ? ' disabled title="You cannot remove yourself; another master can."' : ' title="Off every list: signed in, this account then sees nothing"'}>Remove</button>
      </div>`;
    };
    return `
      <div class="settings-label">Accounts</div>
      <div class="settings-card">
        <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:0">
          <div class="settings-row-sub" style="margin-bottom:8px">Manager: ${esc(Access.ROLE_WORDS.manager)}. Floor: ${esc(Access.ROLE_WORDS.floor)}. An account on no list can sign in and sees nothing. Master: may change this list; not a role.</div>
          <div class="acct-table">
            ${rows.length ? rows.map(rowHtml).join('') : '<div class="settings-row-sub">nobody listed yet</div>'}
          </div>
          <div class="acct-add">
            <input type="email" id="acct-new-email" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="name@example.com" value="${esc(this._newEmail || '')}">
            ${roleSel('floor', 'id="acct-new-role"')}
            <button class="btn-sm btn-sm-save" data-acct-add${this._busy ? ' disabled' : ''}>Add</button>
          </div>
          <div class="auth-err" id="acct-err">${esc(this._err)}</div>
          ${this._fresh ? this._freshHtml(this._fresh) : ''}
        </div>
      </div>
      ${this._activityHtml()}`;
  },

  // What became of the Firebase user: made, with its temporary password shown
  // once and a Copy; already there; or not made, with why and what to press.
  _freshHtml(f) {
    if (f.exists) return `<div class="acct-fresh">
        <div class="acct-fresh-head">${esc(f.email)} already has a Firebase user</div>
        <div class="settings-row-sub">Its password is unchanged. If that password is lost: delete the user in the Firebase console (Authentication → Users) and press Make user here again for a fresh temporary one.</div>
      </div>`;
    if (f.failed) return `<div class="acct-fresh">
        <div class="acct-fresh-head">${esc(f.email)} is listed, but its Firebase user was not made</div>
        <div class="settings-row-sub">${esc(f.failed)} Press Make user on its row to try again.</div>
      </div>`;
    return `<div class="acct-fresh">
        <div class="acct-fresh-head">Account made for ${esc(f.email)}</div>
        <div class="acct-fresh-line">Temporary password: <code id="acct-temp-pass">${esc(f.password)}</code> <button class="btn-sm" data-acct-copy>Copy</button></div>
        <div class="settings-row-sub">Shown once — it goes when Settings closes. They sign in with it and press Password under Settings → Account to make it theirs.</div>
      </div>`;
  },
  _activityHtml() {
    const a = this._activity;
    if (!a || !a.length) return '';
    return `<div class="settings-label" style="margin-top:6px">Recent account changes</div>
      <div class="settings-card"><div class="acct-log">${a.map(e => `<div class="acct-log-row"><span>${esc(this._when(e.at))}</span><span>${esc(String(e.by || '').split('@')[0] || 'unknown')}</span><span>${esc(e.text || '')}</span></div>`).join('')}</div></div>`;
  },
  _when(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  async _loadActivity() {
    this._activity = [];
    try { this._activity = await DB.listActivity(20); this.refresh(); }
    catch (e) { console.warn('[accounts] activity not readable:', e); }
  },

  // ── actions ───────────────────────────────────────────────────────────
  _onClick(e) {
    const t = e.target;
    if (t.closest('[data-acct-add]')) { this._add(); return; }
    if (t.closest('[data-acct-copy]')) {
      const btn = t.closest('[data-acct-copy]'), text = document.getElementById('acct-temp-pass')?.textContent || '';
      navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied'; }, () => { btn.textContent = 'Select and copy it'; });
      return;
    }
    const row = t.closest('[data-acct-row]'); if (!row) return;
    const email = row.dataset.acctRow;
    if (t.closest('[data-acct-make]'))   this._makeUser(email, t.closest('[data-acct-make]'));
    if (t.closest('[data-acct-remove]')) this._save(Access.withoutAccount(Auth.access(), email), `${email} removed from the lists.`);
  },
  _onChange(e) {
    const t = e.target, row = t.closest('[data-acct-row]'); if (!row) return;
    const email = row.dataset.acctRow;
    if (t.matches('[data-acct-role]'))   this._save(Access.withRole(Auth.access(), email, t.value), `${email} is now ${Access.ROLE_LABEL[t.value].toLowerCase()}.`);
    if (t.matches('[data-acct-master]')) this._save(Access.withMaster(Auth.access(), email, t.checked), t.checked ? `${email} is now a master.` : `${email} is no longer a master.`);
  },

  // Write the lists; log it; redraw. Returns whether it saved.
  async _save(next, note) {
    this._err = 'Saving…'; this.refresh();
    try {
      await DB.saveAccess(next);
      this._err = '';
      Auth.setAccess(next);        // redraws this section too
      this._log(note);
      Manager._toast(note);
      return true;
    } catch (e) {
      this._err = 'Could not save — ' + (e && e.code === 'permission-denied' ? 'the database refused it (not a master?)' : ((e && e.message) || e));
      this.refresh();
      return false;
    }
  },
  async _add() {
    const input = document.getElementById('acct-new-email'), sel = document.getElementById('acct-new-role');
    if (!input || this._busy) return;
    const email = tidyEmail(input.value), role = sel.value;
    this._newEmail = input.value;
    if (!isEmail(email)) { this._err = 'That does not look like an email address.'; this.refresh(); return; }
    if (Access.rows(Auth.access()).some(r => r.email === email)) {
      this._err = `${email} is already listed, as ${Access.roleOf(Auth.access(), email)}; change the role on its row.`; this.refresh(); return;
    }
    this._busy = true; this._err = ''; this._fresh = null;
    try {
      if (!await this._save(Access.withRole(Auth.access(), email, role), `${email} added as ${role}.`)) return;
      this._newEmail = '';
      await this._makeUser(email);
    } finally { this._busy = false; this.refresh(); }
  },
  async _makeUser(email, btn) {
    if (btn) btn.disabled = true;
    const password = Access.tempPassword();
    try {
      await DB.createAccount(email, password);
      this._fresh = { email, password };
      this._log(`${email}: Firebase user made.`);
    } catch (e) {
      const code = (e && e.code) || '';
      this._fresh = code === 'auth/email-already-in-use' ? { email, exists: true } : { email, failed: Auth._friendly(e) };
    } finally {
      if (btn) btn.disabled = false;
      this.refresh();
      document.querySelector('.acct-fresh')?.scrollIntoView({ block: 'nearest' });
    }
  },
  _log(text) {
    DB.logActivity({ at: new Date().toISOString(), by: Auth.email() || 'unknown', action: 'access', text })
      .then(() => this._loadActivity())
      .catch(e => console.warn('[accounts] activity not logged:', e));
  },
};
