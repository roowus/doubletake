# Chat / answer page (`/chat/:id`, `pages/Chat.tsx` and `components/{ChatHeader,ClipCard,Answer,AnswerTabs,FollowUp,RunTimeline}.tsx`)

Overrides [MASTER](../MASTER.md). This is the screen that matters most.

**Job.** Read the answer. Everything else is secondary and placed accordingly.

**Layout.**
1. **Header**: back, title in the prose face (24 px), platform glyph, overflow menu (Tags…,
   Collections…, Add a task… (see [todo](todo.md)), Research again deeper; Export and Delete are planned and will sit behind a
   separator, Delete with Confirm). Cancel appears here while a run is live. Below it the run meta line
   in mono small caps on phones; on wide screens the meta sits in the margin beside the rail.
2. **Clip card**: the shared thing (thumbnail or uploaded photo/frame, title, domain) and the
   owner's note in prose italics under a "you wrote" label. It is context, so it is quiet:
   `--surface`, hairline, no accent.
3. **Answer**: full-width `.prose` beside the **margin rail** (MASTER §1), measure 68 ch.
   Markdown with GFM tables (sticky first column on phones, horizontal scroll inside the
   table wrapper only), task lists, blockquote margin notes, ```chart, ```mermaid and ```svg
   figures with captions. Never a bubble, never a card.
4. **Tabs** under the answer (Base UI Tabs): **Claims** (verdict chip ✓ / ~ / ✗ in
   `--ok/--warn/--err`, confidence bar, sources), **Things** (entity cards grouped by kind, each
   with a bookmark that saves it to the [to-do list](todo.md); recommendations get the same),
   **Sources** (transcript, OCR, frames, comments, page text, each collapsible), **Run**
   (timeline of events with durations and cost; live while running). Counts in the tab label.
5. **Follow-up composer**, sticky at the bottom above the safe area: one-line field growing
   to six lines, a **Research** menu for mode and brain, Send. Later turns render as a dated
   "You asked" line in the sans, muted, then another full-width prose answer with its own
   rail segment.

**Live run.** Skeleton lines where the answer will be, the rail filling as events arrive, the
Run tab appending steps, status text `aria-live="polite"`. On error the rail turns `--err` and
the reason appears inline with a Retry button.

**Do not.** Bubble anything; show meta above the answer on desktop (it belongs in the margin);
truncate the answer; hide sources behind a second navigation; colour anything else with the
rail.
