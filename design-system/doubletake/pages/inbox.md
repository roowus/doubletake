# Inbox (`/`, `pages/Inbox.tsx`)

Overrides [MASTER](../MASTER.md) for the triage list.

**Job.** Answer "what came back?" in one glance and get the owner into the right chat. It is a
list, not a dashboard: no chip rows, no counters, no cards inside cards.

**Layout.**
1. **Page title**: "Inbox", Figtree 700 at 27 px, tracked -0.025em. Not the display scale; it
   is a label on a page of rows.
2. **Search field** (FTS over titles, notes and answers) labelled "Search your library", 44 px,
   `--surface-2` with a hairline border that strengthens on focus. Typing offers an **Ask**
   button inside the field, clay on the accent wash, small type and no glow: it turns the text
   into a `library` question and opens the chat.
3. **Funnel button** at the field's right edge, inner corners at `--radius-xs`, 40 x 44. It
   opens the filter sheet, and carries a clay count badge while filters are active
   (`aria-label="Filters, 2 active"`).
4. One **summary chip** under the field while filters are active ("Places to visit · #ski ·
   YouTube"), which clears them. Filters live in the URL (`?tag= ?collection= ?platform=
   ?status=`).
5. **Unread · n** section, then **Earlier**, newest first, each under a mono uppercase label at
   11 px / 700 / 0.14em in clay, 26 px above and 10 px below. Rows: 30 px glyph tile on
   `--surface-2` (clay wash when unread), title at `--text-md` / 500 (650 when unread, two
   lines max), a mono 10.5 px meta line (status while a run is working or failed, category, up
   to three tags in ochre), trailing age in mono and an unread count in the accent.
6. Empty state: a dashed quiet card, one centred glyph, a bold line and a quiet line. Wording
   depends on why the list is empty (no filters, filters too tight, a search with no matches).

**Filter sheet** (`components/Sheet.tsx`): status, platform, collections and tags as pressed
pills in labelled groups, no shadow, muted until pressed. Apply is the primary action at the
bottom; Reset is a ghost. Tag and collection filters go to the server, platform and status are
client-side.

**States.** Loading = `ListSkeleton`; a running chat shows "Researching…" in the meta line
and its row updates live (`useLive`); a failed run shows the reason in `--err`.

**Do not.** Put collections or entity kinds back on this page (they live in Library); show
more than one line of meta; use a FAB (Add is a tab); give the search field a shadow or put a
solid clay slab inside it.
