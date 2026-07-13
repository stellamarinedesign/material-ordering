# Consumables photos

Drop a photo here for any consumable and it appears on the worker Consumables
Checkout grid. No photo? The tile falls back to the category-coloured icon, so the
grid always works — it just gets clearer as photos are added.

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
