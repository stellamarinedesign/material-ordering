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

## A new device

Open the page. It asks for a **device name** (what its orders, deliveries
and counts are recorded under), an email and a password — nothing else, the
Firebase connection details are in the code. The device name can be changed
later under Settings → Device.

## Day to day — all in the app, no console

On the manager page, **Settings → Account** shows the signed-in address with
**Password** (change it here, no email) and **Sign out**. A master also sees
the role, the Master chip and **Accounts**: every listed address with its
role in a dropdown, a **Master** tick, **Make user** and **Remove**, plus an
**Add** row.

- **Add** lists the address with the chosen role *and* makes its Firebase
  user, showing a temporary password once (Copy). Pass it on; the person signs
  in with it and presses Password under Settings → Account to make it theirs.
- **Remove** takes the address off every list. Signed in, that account is
  dropped to the sign-in dialog on every page the moment it happens. The
  Firebase user itself stays until it is deleted in the console.
- **Make user** is for an address listed before its user existed, or whose
  temporary password went unseen.
- A master cannot change, un-master or remove their own entry; another
  master can.
- A listed account that isn't a manager, opening the manager page, sees its
  address and an **Enter** button to its own page.
- Every change is written to the `activity` collection (who, when, what) and
  the last twenty are shown under Accounts.
- **Forgotten password** — the one console job left: Authentication → Users →
  delete the user, then Make user on its row for a fresh temporary password.
  The user's role and history are untouched (both key on the address).

## Why the Firebase config sits openly in the code

`FIREBASE_PROJECTS` in `js/shared.js` holds the production and test project
identifiers (apiKey, projectId, appId). They are public identifiers, not
secrets — every visitor's browser needs them — and all protection comes from
sign-in, the rules above and App Check. On top of that each browser key is
restricted in Google Cloud (APIs & Services → Credentials) to **websites
`https://stellamarinedesign.github.io/*`** (the test key also allows
`localhost:8791` for rehearsals) and to the APIs the app calls: Identity
Toolkit, Token Service, Cloud Firestore, Firebase App Check, Firebase
Installations.

**GitHub "secret detected" alert:** secret scanning flags every `AIzaSy…`
string. A Firebase *web* key is public by design
(<https://firebase.google.com/docs/projects/api-keys>). Do not revoke or
rotate it; close the alert as **False positive**.

## Test mode

Settings → Database → **Test mode** (a master sees it; nobody else) points
the whole device at the test project, which has its own users, its own
`settings/access` and the same locked rules. The owner's address has a user
there (temporary password handed over privately when it was made; change it
under Settings → Account on first test-mode sign-in). Anything done in test
mode lands in the test project only; the header shows a Test mode banner.

## Rules are deployed from the repository

`firestore.rules` is the canonical copy. `firebase.json` and `.firebaserc`
point the Firebase CLI at it and at the production project, so publishing is:

```bash
firebase deploy --only firestore:rules
```

Add `--project material-ordering-testing` to publish the same rules to the
test project. (The CLI is installed per-user with winget and logged in.)

## If something goes wrong

- A device shows the sign-in dialog and the account it had no longer works:
  the account was removed from the lists. Sign in with a listed account, or
  add the address back under Accounts.
- Locked out entirely (no master can sign in): in the Firebase console, edit
  `settings/access` by hand — add the address to `managers` — or, as a last
  resort, republish the previous rules from git history.
- An iPad is lost or stolen: Remove its account under Accounts (it reads
  nothing from that moment) and disable the user in Authentication → Users.
- "Could not connect to the database" with a Reload button: Firebase itself
  was unreachable when the page opened (no network, or the SDK blocked).
