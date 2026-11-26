# Consumables photos

Drop a photo here for any consumable, then add its file name to `photos.txt` (one
per line), and it appears on the worker Consumables Checkout grid. Only photos listed
in `photos.txt` are asked for. No photo? The tile shows a short band with the
category-coloured icon instead, so the grid always works and stays compact.

## Naming

Each file is named after the item's **stock key**, lower-case, ending `.jpg`:

- **Items with a real part code** → the part code, lower-cased.
  e.g. `SDC0257` → `sdc0257.jpg`
- **Items whose code is a placeholder** (the `SC####` codes are treated as
  placeholders and hidden in the app) → the description, lower-cased with every run
  of non-letters/digits turned into `_`, cut to 40 characters.
  e.g. `4.5" Grinding Disc 4mm Thickness` → `4_5_grinding_disc_4mm_thickness.jpg`

Square images look best (tiles are square, cropped to fill). Keep them reasonably
small (a few hundred KB each) so the page stays fast on the iPads.

If you're unsure of an item's exact filename, ask and it can be listed for you — or
we can add the expected filename as a hint on the manager's stock cards.
