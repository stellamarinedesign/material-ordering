# Material Orders

Two-page web app for material ordering:
- **iPad** (`index.html`) — worker selects materials and submits orders
- **Windows PC** (`manager.html`) — production manager reviews, edits, and emails orders to supplier

Orders sync in real-time via Firebase Firestore (free).

---

## Step 1 — Set up Firebase (free, ~10 minutes)

Firebase is the cloud database that connects the iPad to the Windows PC.

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. `material-orders`) → Continue → Create project
3. In the left sidebar click **Firestore Database** → **Create database**
   - Choose **Start in test mode** → Next → select a region close to you → Enable
4. In the left sidebar click **Project settings** (gear icon)
5. Scroll down to **Your apps** → click the `</>` (Web) icon
6. Register the app (any nickname) → **Register app**
7. You'll see a config block like this — **copy these three values:**

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",          ← copy this
  projectId: "material-orders", ← copy this
  appId: "1:123456:web:abc...", ← copy this
  ...
};
```

You'll paste these into both the iPad and Windows PC when you first open the app.

---

## Step 2 — Deploy to GitHub Pages (~5 minutes)

1. Go to [github.com](https://github.com) → sign in → **New repository**
2. Name it `material-orders` → set to **Public** → **Create repository**
3. On the repo page click **uploading an existing file**
4. Drag and drop all files from this folder:
   - `index.html`, `manager.html`, `manifest.json`, `sw.js`
   - `css/` folder, `js/` folder, `icons/` folder
5. Click **Commit changes**
6. Go to **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: **main** → **Save**

Your URLs will be (replace `YOUR-USERNAME` and `YOUR-REPO`):
- **iPad (worker):** `https://YOUR-USERNAME.github.io/YOUR-REPO/`
- **Windows (manager):** `https://YOUR-USERNAME.github.io/YOUR-REPO/manager.html`

*(Takes ~2 minutes to go live after saving)*

---

## Step 3 — First-time setup on each device

### iPad
1. Open the worker URL in **Safari**
2. Enter your Firebase `apiKey`, `projectId`, and `appId` → tap **Connect**
3. Tap the **Share** button → **Add to Home Screen** → **Add**
4. The app icon will appear on the iPad home screen

### Windows PC
1. Open the manager URL in **Edge** or **Chrome**
2. Enter the same Firebase config values → click **Connect**
3. Optional: click the install icon in the address bar to install as a desktop app

---

## How it works

```
Worker (iPad)                    Firebase                Manager (Windows)
─────────────                    ────────                ─────────────────
Select materials         →   Store order          →   See order appear live
Adjust quantities             (Firestore)              Edit quantities if needed
Tap "Submit to manager"                                Approve & compose email
                                                       Send email to supplier
                                                       Order marked as "Sent"
```

### Worker (iPad) can:
- Browse materials by category or search
- Adjust quantities
- Submit an order to the manager
- Start a new order after submitting

### Manager (Windows) can:
- See all pending orders in real time
- Edit quantities before approving
- Approve and compose the supplier email (pre-filled)
- Reject/delete orders
- Mark orders as sent
- Configure supplier email, CC, company name, GST rate
- Add/edit/delete materials in the catalogue

---

## URLs to bookmark

| Device | URL | Role |
|--------|-----|------|
| iPad | `https://YOUR-USERNAME.github.io/YOUR-REPO/` | Worker — submit orders |
| Windows PC | `https://YOUR-USERNAME.github.io/YOUR-REPO/manager.html` | Manager — review & email |

---

## Firestore security (optional, recommended)

By default Firebase is in test mode (anyone with the URL can read/write).
To lock it down, go to Firestore → **Rules** and replace with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /orders/{orderId} {
      allow read, write: if true; // Replace with auth rules if needed
    }
    match /_test/{doc} {
      allow read, write: if true;
    }
  }
}
```

For a small internal tool on a private URL this is usually fine as-is.

---

## Troubleshooting

**"Could not connect" on setup**
- Double-check you copied the right values (apiKey, projectId, appId)
- Make sure Firestore is enabled in your Firebase project (not just the project created)

**Orders not appearing on Windows**
- Both devices must use the exact same `projectId`
- Check Firestore is in **test mode** or your rules allow reads

**Email doesn't open**
- The app uses `mailto:` links which open your default mail client (Outlook on Windows, Mail on iPad)
- Make sure a mail client is configured on the Windows PC

**iPad app not working offline**
- Must be added to home screen via Safari for offline/PWA to work
- First load requires internet; subsequent loads work offline for the app shell (orders require internet to sync)
