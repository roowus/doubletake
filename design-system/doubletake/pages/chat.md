# Chat / answer page (`/chat/:id`, `pages/Chat.tsx` and `components/{ChatHeader,Answer,AnswerTabs,FollowUp,RunTimeline}.tsx`)

Overrides [MASTER](../MASTER.md). This is the screen that matters most.

**Job.** Read the answer, and be able to check it. Everything else is secondary and placed
accordingly.

**Layout.**
1. **Source line** at the very top: platform glyph, host, date, and the item's thumbnail when
   it has one (a 44 px tile, not a card). Links to the original. The owner's note, when there
   is one, is a single quiet line of prose under it. This replaces the old clip card.
2. **Title**, Figtree 600, 24 px, balanced to two lines.
3. **Answer prose**: full width, measure 68 ch, Figtree at `--prose-size`. GFM tables (sticky
   first column on phones, horizontal scroll inside the table wrapper only), task lists,
   blockquote margin notes, and ```chart / ```mermaid / ```svg figures with captions. Never a
   bubble, never a card. Evidence marks (`[[n]]`) render as a small clay superscript that
   scrolls to and highlights claim number `n`.
4. **Claims report** (MASTER §1): a mono `CLAIMS` header with the tally
   (`1 supported · 1 contested · 1 refuted`), then one row per claim: number, claim text,
   verdict chip, and a mono line naming where it came from or `no source found`. A verdict
   other than `true` adds one line of reason. Rows carry `id="claim-<n>"` for the marks.
5. **Sources report**: the distinct URLs the claims cite, each with host and the claim numbers
   that point at it. Empty state: "no sources cited".
6. **Footer row**, one 56 px line: `8 things · 3 claims · run 12 s · $0.04` with a chevron.
   Opens a sheet with three tabs: **Things** (entity cards grouped by kind, each with a
   bookmark that saves it to the [to-do list](todo.md)), **Sources** (every extraction the
   brain read, one chip per kind, flattened to text) and **Run** (event timeline, live while
   running). A message that is nothing but the shared URL is not rendered as a turn; the
   source line already names it. The owner's note that came with the share is the first
   "You asked" line under the title.
7. **Follow-up composer**, sticky at the bottom above the safe area: one-line field growing to
   six lines, a **Research** menu for mode and brain, Send. Later turns render as a dated
   "You asked" line, muted, then another answer with its own claims report.

**Live run.** Skeleton lines where the answer will be, the run's status and mode in a small
label above them with a Cancel button, status text `aria-live="polite"`. On error the reason
appears inline with a Retry button.

**Do not.** Bubble anything; put the answer's evidence behind a tab the reader has to find;
truncate the answer; hide sources behind a second navigation; soften the brain's prose because
one of its claims came back false (the claim's report states it plainly, the prose stays the
model's).
