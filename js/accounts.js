// accounts.js — v2026-11-27.9
//
// Manager page only: the Accounts section of Settings, for an ADMIN (a
// "master" in settings/access) and for nobody else — absent otherwise.
//
// SINCE THE APP JOINED THE HUB, people, their roles and their passwords are
// looked after in the hub (its Accounts page), which writes this app's
// settings/access itself. Two editors would overwrite each other, so the
// role dropdowns, the Admin tick, Make user, Remove and Add went in the same
// release, and this section is one line pointing there. The second Firebase
// app that made users (DB.createAccount) stays unused until the clean-up
// release.
const Accounts = {
  HUB_ACCOUNTS: '/#/accounts',

  section() { return `<div class="settings-section" id="auth-accounts">${this._inner()}</div>`; },
  refresh() {
    const el = document.getElementById('auth-accounts'); if (!el) return;
    el.innerHTML = this._inner();
  },
  forget() {},     // nothing is held any more
  mount() {},

  _inner() {
    if (!Auth.isMaster()) return '';
    return `
      <div class="settings-label">Accounts</div>
      <div class="settings-card">
        <div class="settings-row">
          <div class="settings-row-label">Roles and new people are set in the hub, under <a href="${this.HUB_ACCOUNTS}" class="acct-hub-link">Accounts</a>.</div>
        </div>
      </div>`;
  },
};
