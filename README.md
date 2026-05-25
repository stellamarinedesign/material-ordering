# Material Orders v4

Two-page web app:
- **iPad / mobile** (`index.html`) — worker selects materials and submits orders
- **Windows PC / desktop** (`manager.html`) — manager reviews, approves, and emails orders

Both pages scale cleanly on any device or screen size.

---

## What changed in v4
- Materials loaded from `materials.csv` in the GitHub repo (edit CSV → push → both devices update automatically)
- Panels fixed: slide in/out correctly at all screen widths, no ghost panels sticking to the side
- Full-width layout on desktop for both pages
- Manager page: proper two-column sidebar layout on desktop, tab strip on mobile

---

## Setup

### 1. Firebase (free)
1. [console.firebase.google.com](https://console.firebase.google.com) → Add project
2. Firestore Database → Create database → Test mode → **australia-southeast1**
3. Project settings → Web app → copy `apiKey`, `projectId`, `appId`

### 2. GitHub Pages
1. New repo → upload all files → Settings → Pages → main branch → Save
2. URLs: `https://USERNAME.github.io/REPO/` (worker) and `.../manager.html` (manager)

### 3. First open
Enter Firebase config on each device. Done once per browser.

---

## Updating materials

Edit `materials.csv` in the GitHub repo. Required columns (row 1 headers):

```
Part Code, Description, Category, Subcategory, Quantity Type
```

Example:
```csv
Part Code,Description,Category,Subcategory,Quantity Type
SL0300,100 x 50 x 3mm x 6m Box Section 316 S/S,Stainless Steel,Hollow Section,Length
AL0300,100 x 50 x 3mm x 6m Box Section 6061-T6,Aluminium,Hollow Section,Length
```

Both devices fetch the CSV fresh on each load. The previous list is cached locally as a fallback if there's no internet.

To edit on GitHub:
1. Open `materials.csv` in the repo
2. Click the pencil (Edit) icon
3. Make changes → Commit changes
4. Both devices see the update within ~2 minutes (after GitHub Pages republishes)

---

## Email format

```
Order Reference: ORD-2026-0522-482
Date: 22 May 2026

────────────────────────────────────────────────────────
MATERIAL ORDER
────────────────────────────────────────────────────────

SL0300 - 100 x 50 x 3mm x 6m Box Section 316 S/S
  Qty: 4 Length

AL0400 - 20mm Diameter x 6m Round Bar 6061-T6
  Qty: 2 Length

────────────────────────────────────────────────────────
Please confirm availability and expected delivery date.
```
