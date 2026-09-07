# Inbox (`/`, `pages/Inbox.tsx`)

Overrides [MASTER](../MASTER.md) for the triage list.

**Job.** Answer "what came back?" in one glance and get the owner into the right chat. It is a
list, not a dashboard: no chip rows, no counters, no cards inside cards.

**Layout.**
1. Search field (FTS over titles, notes, answers) with an **Ask** button that turns the text
   into a `library` question; a **Filter** funnel button beside it (`aria-label="Filters"`,
   with the active count when non-zero).
2. One **summary chip** while filters are active ("Places to visit · #ski · YouTube"), with a
   clear button. Filters live in the URL (`?tag= ?collection= ?platform= ?status=`).
3. **Unread** section, then the rest, newest first. Row: platform or channel glyph, title in
   the prose face (17 px, two lines max), one meta line (status while a run is working or
   failed, category, up to three tag chips in clay), trailing age in mono and an unread count
   in the accent.
4. Empty state: one line, plus a link to Add.

**Filter sheet** (`components/Sheet.tsx`): status, platform, collections and tags as pressed
chips in labelled groups; Apply is the primary action at the bottom; Reset is a ghost. Tag and
collection filters go to the server, platform and status are client-side.

**States.** Loading = `ListSkeleton`; a running chat shows "Researching…" in the meta line
and its row updates live (`useLive`); a failed run shows the reason in `--err`.

**Do not.** Put collections or entity kinds back on this page (they live in Library); show
more than one line of meta; use a FAB (Add is a tab).
