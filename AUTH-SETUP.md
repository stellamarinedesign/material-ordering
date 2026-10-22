# Sign-in and accounts

The app uses Firebase Authentication (email + password), the same model as
the production board:

- **Who has which role is one Firestore document, `settings/access`**, with
  flat lists of lowercase addresses: `managers`, `engineers`, `floor`,
  `masters`. The security rules read that document, so a role given in the
  app is the whole of giving it — the rules are never edited for an account.
- **Every read needs a listed account.** A Firebase user nobody listed can
  sign in and reads nothing. That is what makes it safe to leave "Enable
  create (sign-up)" on in the console, which in turn lets the app create
  users itself.
- **Roles in this app:** `managers` get the manager page, the materials
  catalogue, accounts and permanent deletes; `floor` is every kiosk iPad and
  anyone ordering (the ordering, consumables and deliveries pages).
  `engineers` exists only so the two apps' documents match (treated as floor
  here).
- **Masters are not a role.** A master is whatever role they are, and the
  only one who may change the lists. With no `masters` list, the first
  manager listed is the master. Masters hand it on with a tick in the app,
  never to themselves.
- No address lives in the repository: not in the code, not in the rules.

## Day to day — all in the app, no console

On the manager page, **Settings → Account** shows the signed-in address and
its role, with **Password** (change it here, no email) and **Sign out**.
A master also sees **Accounts**: every listed address with its role in a
dropdown, a **Master** tick, **Make user** and **Remove**, plus an **Add** row.

- **Add** lists the address with the chosen role *and* makes its Firebase
  user, showing a temporary password once (Copy). Pass it on; the person signs
  in with it and presses Password under Settings → Account to make it theirs.
- **Remove** takes the address off every list. Signed in, that account then
  sees "No access" on every page. The Firebase user itself stays until it is
  deleted in the console.
- **Make user** is for an address listed before its user existed, or whose
  temporary password went unseen.
- A master cannot change, un-master or remove their own entry; another
  master can.
- Every change is written to the `activity` collection (who, when, what) and
  the last twenty are shown under Accounts.
- **Forgotten password** — the one console job left: Authentication → Users →
  delete the user, then Make user on its row for a fresh temporary password.
  The user's role and history are untouched (both key on the address).

## Rules are deployed from the repository

`firestore.rules` is the canonical copy. `firebase.json` and `.firebaserc`
point the Firebase CLI at it and at the production project, so publishing is:

```bash
firebase deploy --only firestore:rules
```

Add `--project material-ordering-testing` to publish the same rules to the
test project. (The CLI is installed per-user with winget and logged in; from
the Bash tool it is called by full path, see tools/ notes in the session.)

## The switch-over (2026-10-22 build) — in this order, so no iPad is locked out

Until this build the live rules were still the open phase-1 set (`allow read,
write: if true` per collection), with sign-in optional. The order below takes
the app to the listed-accounts model without a device going down.

1. **`settings/access` exists** with every existing account listed — managers
   on `managers`, every kiosk and ordering account on `floor`. (Created once,
   outside the app; the app can also create it the first time from the
   "Make me the manager" button if it is ever missing.)
2. **Deploy the app build** that reads the document (commit + push; the
   auto-updater rolls the iPads over). From this build a signed-in account that
   is *not* listed already sees "No access" — the app enforces the list before
   the rules do, so a device that would be locked out by step 4 shows up now,
   while it can still be fixed from Accounts.
3. **Walk round:** every iPad's Settings → Account must show its address and
   role. A device that is not signed in will be locked to the sign-in screen
   the moment the rules change (not broken — it shows the login and carries on
   once signed in — but it can't be used until someone types the account in).
4. **Publish the rules:** `firebase deploy --only firestore:rules`.
5. **Console, once:** Authentication → Settings → User actions → **Enable
   create (sign-up)** ticked. Safe now, because an unlisted user reads
   nothing; it is what lets Add make Firebase users from the app.

App Check stays exactly as it is — the anti-bot layer; sign-in is the
identity layer.

## If something goes wrong

- Rules published and an iPad is stuck on the sign-in screen: sign it in with
  a listed account. A device signed in with an account that was never listed
  shows "No access": add that address under Accounts (or sign the device in
  as a listed one).
- Locked out entirely (no master can sign in): in the Firebase console, edit
  `settings/access` by hand — add the address to `managers` — or, as a last
  resort, republish the previous rules from git history.
- An iPad is lost or stolen: Remove its account under Accounts (it reads
  nothing from that moment) and disable the user in Authentication → Users.
