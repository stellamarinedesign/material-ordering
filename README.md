# Material Orders v3

Two-page web app:
- **iPad** (`index.html`) — worker selects materials and submits orders
- **Windows PC** (`manager.html`) — production manager reviews, approves, and emails orders to purchasing

---

## What changed in v3
- No pricing or GST anywhere
- Categories and subcategories (Stainless Steel → Hollow Section, Round Bar, etc.)
- Each material has a Part Code + Description
- Part code shown below description in the list; combined `SL0300 - 100x50x3mm...` in email
- Excel import on manager page — pushes material list to Firebase, iPad updates automatically
- "Order Confirmation" instead of cart
- Email reformatted for internal use (no Dear/Kind regards/company line)
- Manager page properly laid out for desktop with sidebar
- Double-tap zoom disabled on iPad

---

## Setup (first time)

### 1. Firebase — free cloud database

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → name it → Create
3. Left sidebar → **Firestore Database** → **Create database** → Start in test mode → pick **australia-southeast1 (Sydney)** → Enable
4. Left sidebar → **Project settings** (gear) → scroll to **Your apps** → click `</>` (Web)
5. Register app → copy these three values:
   ```
   apiKey: "AIzaSy..."
   projectId: "your-project-id"
   appId: "1:123456:web:abc..."
   ```

### 2. GitHub Pages

1. [github.com](https://github.com) → New repository → name it `material-orders` → Public → Create
2. Upload all files from this folder (including `css/`, `js/`, `icons/` subfolders)
3. Settings → Pages → Branch: main → Save
4. Live at: `https://YOUR-USERNAME.github.io/material-orders/`

### 3. First open on each device

**iPad:** Open worker URL in Safari → enter Firebase config → Connect → Share → Add to Home Screen

**Windows PC:** Open manager URL in Edge/Chrome → enter same Firebase config → Connect

---

## URLs

| Device | URL | Role |
|--------|-----|------|
| iPad | `https://username.github.io/material-orders/` | Worker |
| Windows | `https://username.github.io/material-orders/manager.html` | Manager |

---

## Updating the materials list (Excel import)

The manager page has an **Import from Excel** button in the sidebar.

Your spreadsheet needs these column headers in row 1:

| Part Code | Description | Category | Subcategory | Quantity Type |
|-----------|-------------|----------|-------------|---------------|
| SL0300 | 100 x 50 x 3mm x 6m Box Section 316 S/S | Stainless Steel | Hollow Section | Length |

A template CSV is included: `materials-template.csv` — open in Excel, fill it out, save as `.xlsx`, import.

When you import:
1. A preview shows before anything is saved
2. On confirm, the list is pushed to Firebase
3. The iPad picks up the new list automatically next time it connects — no manual update needed

---

## Workflow

```
Worker (iPad)             Firebase (Sydney)         Manager (Windows)
─────────────             ─────────────────         ─────────────────
Browse by category   →                         ←   Push updated materials
Select materials          Store order           →   Order appears live
Confirm quantities    →   (Firestore)               Edit quantities if needed
Submit to manager                                   Approve → email to purchasing
                          Mark as sent          ←   Outlook opens pre-filled
```

## Email format

Emails are formatted for internal purchasing use:

```
Order Reference: ORD-2026-0522-482
Date: 22 May 2026

────────────────────────────────────────────────────
MATERIAL ORDER
────────────────────────────────────────────────────

SL0300 - 100 x 50 x 3mm x 6m Box Section 316 S/S
  Qty: 4 Length

AL0400 - 20mm Diameter x 6m Round Bar 6061-T6
  Qty: 2 Length

────────────────────────────────────────────────────
Please confirm availability and expected delivery date.
```

No "Dear Supplier", no "Kind regards" — your email signature handles that.
