# Sign-in and accounts

**The app has joined the hub**, the one sign-in for every Stella app
(the Stella-Hubinator repository; this app's own part is `js/hub-bridge.js`).
People, their roles and their passwords are looked after in the hub. The app
keeps its own Firebase project, its own data, its own rules and its own
access list; the hub signs the app in to its own project as the hub's person,
with a key the hub holds.

- **Who has which role is one Firestore document, `settings/access`**, with
  flat lists of lowercase addresses: `managers`, `engineers`, `floor`,
  `masters` (shown as "admin" wherever a person reads it). The security rules
  read that document. The hub's **Accounts** page writes it.
- **Every read needs a listed account.** A Firebase user nobody listed can
  sign in and reads nothing: the device shows "No current account assigned".
- **Roles in this app:** `managers` get the manager page, the materials
  catalogue and permanent deletes; `floor` is every kiosk iPad and anyone
  ordering (the ordering, consumables and deliveries pages). `engineers`
  exists only so the apps' documents match (treated as floor here).
- No address lives in the repository: not in the code, not in the rules.

## Signing in

- **On the live site the app shows no sign-in form of its own.** A device
  with nobody signed in shows the hub's sign-in. If the hub cannot be
  reached, it shows the hub's card, "The hub cannot be reached", with Try
  again.
- **A device signed in before it met the hub carries on exactly as it was**
  until its login is linked in the hub. Linking takes over the same Firebase
  account, never a new one, so orders waiting offline on a kiosk still send.
- **After a sign-in through the hub**, a page whose device name is empty asks
  for it once (one field, Save). A kiosk already named keeps its name. The
  name can be changed later under Settings → Device (behind the admin lock on
  the iPads).
- **Off the live site** (localhost, the `_local` harnesses) the app's old form
  is drawn as before, for building and testing.

## Day to day

- **Settings → Account** shows the signed-in address with **Change password**
  and **Sign out**. Signed in through the hub, both are the hub's: the
  password is the hub password, and signing out signs out of the hub on that
  device too.
- **On the floor iPads** those sit behind the **admin lock**, which unlocks
  with the floor login's hub password (5 minutes, or until Settings closes).
- An admin sees **Accounts**: one line pointing to the hub, where roles and
  new people are set.
- A listed account that isn't a manager, opening the manager page, sees its
  address and an **Enter** button to its own page.
- **A forgotten password** goes through the hub's admin. Nobody deletes a user
  and makes it again any more: a kiosk's offline queue belongs to its account.

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

The test project has its own data, its own `settings/access` and the same
locked rules. A device enters it with **`?test=1`** on the address (the hub's
Material ordering (test) tile opens `/material-ordering/?test=1`), and leaves
it with **`?test=0`**. `?test=1` counts only on a device whose hub sign-in has
the test project, so nobody can switch a kiosk into test mode by editing an
address. An admin can also switch it under Settings → Database → Test mode.
In test mode the device signs in through the hub with the key for the test
project, so its person needs a hub login linked there; without one it shows
the hub's no-access card, and `?test=0` takes it out of test mode. The header
shows a Test mode banner.

## Rules are deployed from the repository

`firestore.rules` is the canonical copy. `firebase.json` and `.firebaserc`
point the Firebase CLI at it and at the production project, so publishing is:

```bash
firebase deploy --only firestore:rules --project material-ordering-41851
```

Use `--project material-ordering-testing` to publish the same rules to the
test project first. (The CLI is installed per-user with winget and logged
in.) Release rules before the code that needs them.

## If something goes wrong

- **"No current account assigned"**: the signed-in login is on none of this
  app's lists. Give it a role in the hub's Accounts.
- **Locked out entirely** (no admin can sign in): in the Firebase console,
  edit `settings/access` by hand (add the address to `managers`), or, as a
  last resort, republish the previous rules from git history.
- **An iPad is lost or stolen**: take its login off the lists in the hub (it
  reads nothing from that moment) and change the floor login's hub password.
- **"The hub cannot be reached"**: nobody is signed in on that device and the
  hub did not answer (no network, or the hub's files did not load). Try again
  once the connection is back.
- **"This device's saved copy did not open"**: the device's own copy of the
  data was held by another page of the site twice in a row. Close the app
  completely (swipe it away) and open it again. Nothing waiting is lost.
