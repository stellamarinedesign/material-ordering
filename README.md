# Material Orders

Ordering, stock and deliveries for the workshop. Four pages, one Firebase database.

| Page | Where it runs | What it is for |
|---|---|---|
| `index.html` | Floor iPads | Workers pick materials and submit an order; stocktake counting |
| `consumables.html` | iPad at the consumables store | Tradesmen sign consumables out, with a barcode scanner |
| `warehouse.html` | Warehouse iPad | Check deliveries in against what was ordered |
| `manager.html` | Windows desktop | Review orders, email suppliers, stock, deliveries, catalogue, accounts |

## Setup

1. GitHub Pages serves the repository: Settings → Pages → main branch.
2. The Firebase settings are built into `js/shared.js` (`FIREBASE_PROJECTS`), so a new device needs nothing typed in beyond its sign-in.
3. Each device signs in with an account a master has listed on the manager page (Settings → Accounts). The floor iPads share one floor account; on those iPads, sign out, change password and the device name sit behind Settings → Admin, which unlocks with that account's password.
4. To add a page to an iPad's home screen, open it in Safari → Share → Add to Home Screen. Each page has its own icon name.
5. Once a page has been opened online, it also opens with no connection (`sw.js` keeps its files on the device), showing the data saved there. Online, the newest files are always fetched first.
6. Orders, consumables sign-outs and stocktake counts made with no connection wait on the device (the "waiting to submit" pill) and send themselves when it returns. Release the database rules (`firestore.rules`) before the code that needs them.

## Materials and consumables lists

- **Materials** live in the database once moved there (manager page → Settings → Open catalogue). Materials are added, edited, retired and imported from the production board's part list there. `materials.csv` stays as the fallback for a device that has never reached the database.
- **Consumables** are read from `consumables.csv`. An item made on the consumables iPad shows on the manager's Barcodes panel until its row is added to the file.

## Test database

A master can switch a device to the test database (Settings → Database → Test mode). It is a separate Firebase project with its own orders, stock and accounts; only per-device settings (theme, device name and the like) are shared with live.

## Releasing

Run `python tools/bump-version.py <version>` before committing a change. It stamps the version on every page and on the script and style links, so devices load the new files and the idle iPads reload themselves.
