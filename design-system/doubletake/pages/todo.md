# To do (`/todo`, `pages/Todo.tsx`; row on Library; save buttons on the chat page)

Overrides [MASTER](../MASTER.md) for the owner's saved list ([ADR 0031](../../../docs/adr/0031-todo-list.md)).

**Job.** Keep the parts of answers the owner wants to act on (a place to visit, a tool to
install, a task) somewhere they can tick off, without leaving the answer to put them there.

**Getting things onto the list.** On the chat page, every row in the **Things** tab and every
recommendation has a small bookmark button (`.thing-save`, 32 px hit area inside a 44 px row,
muted until hover, `aria-label="Save <name> to your list"`). Tapping saves at once and shows a
toast ("Saved to your list. Find it under Library, To do."); nothing navigates. The header
menu's **Add a task…** opens a Sheet with a title field and an optional note
(`components/TaskForm.tsx`).

**Library row.** Above the Things tiles: a full-width row with a 3 px accent rule on the left
(the only accent rule outside the answer's margin rail, so it reads as "your own writing"),
the check-square glyph, "To do", a one-line hint (loading, the empty-state sentence, or the
first three open titles joined with " · "), the open count as a `count-badge`, a chevron.

**List page, top to bottom.**
1. Header: back to Library, "To do" with the open count, a **Task** ghost button that unfolds
   the task form in a card.
2. Open entries, newest first, in one `.todos` card: tick button (`aria-pressed`, `square` /
   `check-square`, optimistic), body with the kind glyph and the title (an external link when
   the thing has a URL), the note in the prose face italic plus the attributes that matter
   for the kind (address, city, price, brand, install), a footer in mono with the source chat
   link, a Maps link for places and the age. A trash icon button removes behind Confirm.
3. **Done** folds under a `button.ghost.fold` with the count; done rows strike the title and
   go muted, the tick untoggles.

Empty state: "Nothing saved yet. Use the bookmark on any answer, or add a task." When
everything is ticked: "All done. Nice."

**Do not.** Add due dates, priorities or drag ordering; open a dialog to save a thing; move
the list into its own tab; show a done entry above an open one.
