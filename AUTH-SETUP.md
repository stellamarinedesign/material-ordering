# Sign-in rollout — no device goes down

The app is moving from "paste the Firebase config on each iPad" to proper
sign-in (Firebase Authentication, email + password), the same model as the
Drawings and Production Board apps. It is done in three phases so that every
iPad keeps working the whole way through. **Nothing locks a device out until
step 2 below, and step 2 is a change you make in the console only after
checking every device.**

## Why

With the current open rules, the pasted config is effectively the one shared
password for the whole database — Firebase itself says the config isn't a
secret and that security must come from rules. Sign-in gives each device (and
each manager) its own revocable account, lets the rules require a real user,
and records *who* did each order, delivery and stock change.

## Phase 1 — this build (v0.54): sign-in is optional

Deploys like any other version; the auto-updater rolls the iPads over.

- Every existing iPad keeps its pasted config and keeps working exactly as now.
- Each page shows a small amber **Sign in** pill in the header until that
  device is signed in. Tap it, enter the device's account, done — the pill
  disappears. Settings → **Account** shows "Signed in as …" and has Sign out.
- Writes made while signed in carry the account email (`authEmail`).

### Console setup (once, ~15 minutes, you)

Firebase console → the **production** project (repeat for the test project if
you use test mode):

1. **Authentication → Sign-in method** → enable **Email/Password**.
   Leave "Email link (passwordless)" off.
2. **Authentication → Settings → User actions** → untick **Enable create
   (sign-up)**, so only accounts you make can exist. Tick **Email enumeration
   protection**.
3. **Authentication → Users → Add user** for:
   - one account per kiosk iPad, e.g. `consumables-ipad@stellamarine.com.au`,
     `warehouse-ipad@…`, `workshop-ipad@…` (they can be aliases of a real
     mailbox so password-reset emails arrive somewhere);
   - each manager's own address.
4. On each iPad, tap the **Sign in** pill and enter its account. On the PC,
   sign in on the manager page with your own account.

Sign-ins persist across app restarts (Firebase keeps a refresh token on the
device), so this is a one-time job per device.

## Phase 2 — flip the rules (console only, no deploy)

**Before this step, walk round and confirm every iPad's Settings → Account
says "Signed in as …".** A device that isn't will be locked to a sign-in
screen the moment the rules change (not broken — it shows the login and
carries on once signed in — but it can't be used until someone types the
account in).

Then: Firestore Database → Rules → paste `firestore.rules` from this repo →
fill in the manager email list in `isManager()` → Publish. The new rules:

- require a signed-in user for everything the app does;
- restrict permanent deletes (order records, history records) to the manager
  accounts listed.

App Check stays exactly as it is — it's the anti-bot layer, sign-in is the
identity layer, and they work together.

## Phase 3 — later build: embed the config

Once the rules require sign-in, the Firebase config is safe to embed in the
code (Firebase designs it to be public). A fresh iPad then needs only its
email and password — no config paste. Until phase 2 is done the config must
**not** be in the repo: with open rules it would be a public password.

## If something goes wrong

- Rules flipped and an iPad is stuck on the sign-in screen: sign it in, or
  temporarily republish the open rules (`allow read, write: if true` per
  collection) from the previous version of `firestore.rules` in git history.
- An iPad is lost or stolen: Authentication → Users → disable that account.
  Every other device is unaffected. (With the old model you'd have had to
  redo every iPad.)
- Forgotten password: the sign-in dialog's **Set or reset my password** sends
  a reset link to the account's address.
