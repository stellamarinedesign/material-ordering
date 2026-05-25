# Material Orders v5

- **iPad / mobile** (`index.html`) — worker selects materials, submits orders
- **Windows / desktop** (`manager.html`) — manager reviews, approves, emails

## What changed in v5
- Added Plate subcategory to both Stainless Steel and Aluminium
- Renamed "Hollow Section" → "Box Section"
- True fluid layout — fills any screen width with no upper cap
- Panels use `position:absolute` inside the app container, no bleed at any width
- Bottom sheets capped at 80dvh and scroll internally — safe in landscape orientation
- Category and subcategory tabs built dynamically from the CSV — adding or removing a category/subcategory in the CSV automatically reflects in both apps

## Updating materials

Edit `materials.csv` in the GitHub repo. Columns:
```
Part Code, Description, Category, Subcategory, Quantity Type
```

- Add a new Category/Subcategory value → new tab appears automatically
- Remove all items in a Category/Subcategory → tab disappears automatically
- Both devices reload the CSV on next open (~2 min after GitHub push)

## Setup

1. Firebase: console.firebase.google.com → new project → Firestore (australia-southeast1) → copy apiKey, projectId, appId
2. GitHub Pages: upload all files → Settings → Pages → main branch
3. URLs: `https://USERNAME.github.io/REPO/` (worker) and `.../manager.html` (manager)
4. Enter Firebase config on first open of each device
