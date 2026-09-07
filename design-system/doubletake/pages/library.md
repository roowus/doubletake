# Library (`/library`, `pages/Library.tsx`; entity view `pages/Entities.tsx`; map `pages/MapView.tsx`)

Overrides [MASTER](../MASTER.md) for browsing what the answers have produced.

**Job.** Hold everything that used to be a chip row: entity kinds, collections and tags, as
things you can open, not filters you have to remember.

**Layout, top to bottom.**
0. **To do** row — the owner's saved list, see [todo](todo.md). A full-width row with the
   accent rule, open count and a hint of the first titles, opening `/todo`.
1. **Things** — tiles for the entity kinds with counts (Places, Recipes, Products, Tools,
   Tips, Media, People, Events) and a **Map** tile. Counts come from the seeded
   `entity:<kind>` auto collections so the page costs two requests. Zero-count kinds are shown
   muted, not hidden, so the owner learns what can appear.
2. **Collections** — the owner's manual lists and saved searches first, then non-empty
   category collections; each tile has an overflow menu (rename, share page, hide, delete with
   Confirm). A **New collection** form sits at the end of the grid.
3. **Tags** — every tag in use, alphabetical, with counts, as a plain list (not chips) so a
   long tail stays scannable.

Tiles: `--surface`, hairline border, `--radius-md`, icon top-left, label in the sans at 17 px,
count in mono bottom-right. Two columns on phones, three from 768 px, four on desktop.
Tapping opens the filtered Inbox (`/?collection=`, `/?tag=`) or the entity view.

**Entity view** (`/entities/<kind>`): grouped cards with the attributes that matter for the
kind (address and "Search in maps" for places, price and link for products), the source chat
under each. **Map**: Leaflet with OSM tiles, pins in the accent, a **Locate N more** button
that runs the geocoder, and the unlocated list in a `<details>`.

**Do not.** Render tags as a chip cloud; mix collection and entity tiles in one grid; show a
tile the user cannot open.
