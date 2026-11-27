# Doubletake — Design System (Master, v2 "Field notebook")

Global source of truth for the PWA (`apps/web`) and the Capacitor wrappers that show it.
Page-specific rules live in [`pages/`](pages/) (`inbox`, `library`, `chat`, `compose`,
`settings`, `welcome`); where a page file exists it overrides this one. v1 (2026-09-04) was
generated with the `ui-ux-pro-max` design-system tool and hand-edited; v2 (2026-09-07,
[ADR 0030](../../docs/adr/0030-field-notebook-ui-and-rich-answer-blocks.md)) is a redesign
after the owner's review of v1 ("still reads as generic AI-tool UI"). Implemented as CSS custom
properties in `apps/web/src/styles.css`; components under `apps/web/src/components`.

**One sentence.** Doubletake is a field notebook that fills itself in: you clip something,
walk away, and come back to a well-set page about it.

- **Lineage**: reading tools (Pocket, Readwise, Matter, a well-typeset magazine), not chat
  apps. The answer is an article, never a bubble.
- **Reference quality bar**: system settings apps for the Settings tab, iA Writer / Readwise
  for the answer page, Things for the lists. Every row on a grid, nothing wraps mid-chip,
  every control is a 44 px target.
- **Component dependency**: `@base-ui/react` only (Menu, Dialog, Tabs, Toast, Switch),
  unstyled and tree-shaken. No Tailwind, no motion library, CSS-only animation.

## 0. Experience principles and core flows

Doubletake is used in three moments; the UI is designed around them rather than around
screens:

1. **Capture (2 seconds, one thumb, mid-scroll).** The share sheet, the Web Share Target and
   the **Add** tab get the item out of the user's head and back to the feed. URL pre-filled,
   cursor in the note field, mode defaults to Auto, one tap to send, a toast instead of a new
   screen. Nothing on this path asks a question the user cannot answer without leaving the
   feed.
2. **Return (minutes to hours later, from a notification).** The user arrives with one
   question: "what did it say?" The chat opens on the **answer** as a page: a one-line source
   meta, the title, the prose, then the **Claims** and **Sources** reports printed underneath;
   entities and run history sit behind one footer row; the follow-up composer is pinned at the
   bottom.
3. **Browse (occasionally, sitting down, often on a laptop).** **Inbox** is triage: search,
   then the list, unread first. Everything that used to be a chip row (collections, entity
   kinds, tags) lives in the **Library** tab as tiles and lists, and in the Inbox's **Filter**
   sheet as pressed chips; the list itself is never crowded by filters.

Cross-cutting rules:

- **One primary action per screen**, where the thumb rests (bottom on phones).
- **Progress over spinners.** A live run shows its stage in the footer row and fills a hairline
  progress rule under the prose; skeletons hold the space of what is loading.
- **Errors keep the input** and stay inline where the action happened (`role="alert"`).
  Transient successes are toasts.
- **First run is guided.** Welcome explains the product in one line and defaults to the right
  tab for the platform (pair on phones, password on the laptop).
- **Nothing important lives behind hover.** Every affordance works with touch and keyboard.
- **Continuity.** Back goes where the user came from; deep links (`/chat/<id>`,
  `/settings/<section>`, `/?tag=`) work cold; list → page uses a View Transition when the
  browser has it.

## 1. Signature element: the evidence report

The answer page is short on purpose. It opens with a one-line source meta (platform glyph ·
host · date, plus the item's thumbnail when it has one), then the title, then the prose. What
backs the prose is printed directly underneath as two reports:

- **Claims** — one row per checkable claim: its number, the claim, a verdict chip
  (`--ok` / `--warn` / `--err` / muted), and a mono line naming where that claim came from, or
  `no source found`. Any verdict other than `true` carries one line saying why.
- **Sources** — the distinct URLs the claims cite, each with its host and the claim numbers
  that point at it.

Small superscript **marks** in the prose (`[[n]]` from the brain, rendered as a clay numeral)
scroll to and briefly highlight the matching claim row. That link between sentence and evidence
is the element the page is built around; nothing else in the app uses a coloured left rule or a
numbered mark, so a reader always knows what is evidence and what is the app talking.

The old 3 px margin rail is gone (ADR 0034). It marked where an answer started, which the page
shape now does on its own, and it competed with the marks for attention. If a surface needs
emphasis it is a card (`--radius-md`, `--shadow-sm`, `--lift` on hover).

## 2. Colour tokens

Light (**paper**) is the default, and it is the default *unconditionally* — the app does not
open in ink just because the OS is dark. The landing is light-only and is most people's first
sight of the product, so `theme` defaults to `paper` and ink is a choice in Settings →
Appearance (`data-theme="paper|ink"` on `<html>`; absent = follow the OS, which is still
selectable as **Match device**). Ratios are WCAG
contrast against the surface named in the row; body text reaches 4.5:1 and UI glyphs 3:1 in
both themes. The palette is shared with the landing page — the token block at the top of
`apps/web/src/styles.css` records the landing's `:root` and the reconciliation, and these
values are the app's side of it.

The accent is the landing's **clay**, deepened. The landing ships `#C45A3C`, which is only
3.89:1 on paper and 4.31:1 behind white text, so Soft Paper (ADR 0034) carries `#b0472c`: the
same hue family, deep enough to be legible as text, as a button fill, and as an evidence mark.

**Ink is warm, not blue.** The landing has no dark theme, so ink is the app's own — but it is
built from the landing's paper family rather than from a neutral grey. The landing's papers sit
at hue ~43° (warm amber); the first ink was `#101214`, hue 210° (cool blue-grey), which is the
opposite temperature and read as a different product the moment the two were compared. Ink now
runs hue 30–38°, mirroring the landing's lightness ladder onto a dark ground: `--bg` `#17130e`,
`--surface` `#201b15`, `--surface-2` `#282218`. Shadows are warm-tinted too (`rgba(8,6,3,…)`) —
a neutral black shadow over a warm surface reads grey.

| Token | Paper (light) | Ink (dark) | Role |
|---|---|---|---|
| `--bg` | `#f8f4ea` | `#17130e` | app background |
| `--surface` | `#fffdf7` | `#201b15` | cards, sheets, header |
| `--surface-2` | `#f2ecdd` | `#282218` | inputs, code, nested rows |
| `--surface-3` | `#eae1ce` | `#100d09` | inset wells (segmented track, media placeholder) |
| `--border` | `#e7e1d2` | `#372f24` | hairlines, dividers |
| `--border-strong` | `#cfc5ae` | `#4f4636` | control outlines |
| `--text` | `#1e1b16` (15.4:1) | `#eee8db` (15.0:1) | primary text |
| `--text-muted` | `#6d675c` (5.4:1) | `#a89d8b` (6.6:1) | meta, secondary |
| `--accent` | `#b0472c` clay (5.1:1) | `#e8865f` (6.7:1) | buttons, evidence marks, active tab, focus |
| `--on-accent` | `#ffffff` (6.0:1) | `#2a1008` (6.5:1) | text on accent |
| `--accent-text` | `#9c3d25` (6.2:1) | `#f2a984` (9.0:1) | links, accent text on surfaces |
| `--accent-soft` | accent @ 11% | accent @ 16% | pressed chips, selected rows |
| `--accent-2` | `#7d5a10` ochre | `#e2b53c` | **tag chips only**, never buttons |
| `--ok` / `--warn` / `--err` | `#2f7a3d` / `#9a6a00` / `#b3261e` | `#6ccf7b` / `#e2b53c` / `#ff7b6e` | claim verdicts, run status, destructive |
| `--focus` | `= --accent` | `= --accent` | focus ring — the ring only, never a radius |
| `--scrim` | `rgba(28,27,24,.45)` | `rgba(0,0,0,.6)` | behind sheets and menus |
| `--chart-1…8` | clay, ochre, slate, ochre-deep, plum, teal, brick, olive | lighter variants | chart series and legend swatches |
| `--rail` | `= --accent` | `= --accent` | legacy alias; no app rule uses it (ADR 0034) |

`--accent-2` moved when clay became the primary: the old `#a8541e` was itself a clay, so a tag
chip and a primary button read as the same ink. The ochre keeps the warm family and sits 1.2:1
from the accent, i.e. clearly a different chip when the two are side by side.

`--focus` must stay a **ring**. It must not carry `border-radius`: doing so resnapped every pill
control to `--radius-sm` the moment it was focused, which read as the control changing shape
under the cursor.

Status tints use the status colour at 12–16 % alpha as background with the full colour as
text. Charts never rely on colour alone: every series is also named in the legend and in a
visually hidden data table.

## 3. Typography

Two faces, bundled from `@fontsource-variable` (latin subsets, `font-display: swap`,
precached by the service worker), with system fallbacks so an uncached first paint is fine.
**One family carries the interface and the prose** (ADR 0034): mixing a serif reading face with
a sans UI read as a magazine, not as a reading tool.

```
--font-sans:  "Figtree Variable", -apple-system, "Segoe UI", Roboto, sans-serif;  /* UI and prose */
--font-prose: var(--font-sans);                                                   /* the same voice */
--font-mono:  "JetBrains Mono Variable", ui-monospace, Menlo, Consolas, monospace; /* meta, code */
```

| Step | Size | Use |
|---|---|---|
| `--text-xs` | 12 | run meta (mono, small caps), timestamps |
| `--text-sm` | 13 | helper text, list meta, chips |
| `--text-md` | 15 | UI body, inputs, buttons |
| `--text-lg` | 17 | list titles (prose face), tile labels |
| `--text-xl` | 20 | section headings |
| `--text-2xl` | 24 | page and answer titles (prose face, 600) |
| `--text-3xl` | 32 | welcome headline |

Prose: `--prose-size` 17 px / `--prose-leading` 1.62 on phones, 18 px / 1.65 from 768 px;
Settings → Appearance offers S/M/L (`data-prose="s|l"`). Measure capped at `--measure: 68ch`.
Headings inside answers are Figtree at 600 with tight leading; tables and code are the sans/mono
at `--text-sm`. UI labels are 500 with `letter-spacing: -0.005em`. Titles clamp to two lines,
meta to one, and always in Figtree — the answer title is 600 at `--text-2xl`, never a serif.

## 4. Spacing, radii, surfaces

```
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px;
--space-6: 24px; --space-8: 32px; --space-12: 48px;
--radius-sm: 10px (controls); --radius-md: 18px (cards); --radius-lg: 24px (sheets, groups); --radius-pill: 999px (tag chips only)
--shadow-sm/md: 0 10px 30px -14px rgba(60,45,30,.20), 0 2px 6px -3px rgba(60,45,30,.08)
--shadow-lg:   0 20px 44px -18px rgba(60,45,30,.26)
--lift: -2px; --ease-out: cubic-bezier(.22,.9,.3,1)
--tap: 44px; --header-h: 56px; --tabbar-h: 56px; --rail-w: 220px; --content-w: 760px
```

Radii and shadows are Soft Paper's: 18 px cards and warm-tinted (`60,45,30`) shadows, so a card
sits on the paper rather than floating over it. The landing keeps 16 px; the app runs a little
rounder. Cards carry `--shadow-sm` and
lift `--lift` on hover; the landing's `.key-card` does exactly this, and hover changes the
*elevation* rather than swapping the background (a background swap reads as a state change, not
as a surface responding to the pointer). Only the settings groups and tiles lift; dense table
rows do not. Everything sits on the 4/8 rhythm; page gutter 16 px on phones, 24 px from 768 px;
content column max 760 px; the answer measure is narrower still (68 ch).

**Section labels are the landing's `.eyebrow`.** Library section titles, settings group titles
and answer-block group titles all render as mono, uppercase, `letter-spacing: .18em`, in
`--accent-text` (clay). They were a grey sans-serif small-caps at `.06em`–`.08em`, which read as
a quieter, different system than the rest of the page. Menus (`.menu-heading`) keep the mono
treatment but stay `--text-muted`: a dropdown is a dense transient surface, and clay there
competes with the selected item's own accent.

## 5. Shell and navigation

Four tabs (`components/Shell.tsx`): **Inbox** `/`, **Library** `/library`, **Add** `/compose`,
**Settings** `/settings`. Phones: bottom tab bar, 56 px plus the safe area, hidden on a chat
page so the follow-up composer owns the bottom edge. From 900 px: a left rail with the brand
mark and the four items, content column capped at 760 px. Active item uses `aria-current`
and the accent. Back is always a real history step. `navigateWithTransition()` wraps list →
page navigations in the View Transitions API when present and motion is not reduced.

## 6. Components

- **Buttons** — 44 px, padding 0 16 px, `--radius-sm`, weight 500, `--text-md`, verbs as
  labels ("Research", "Save note", "Pair phone"). Variants `primary` (accent fill), `ghost`,
  `danger`; `small` is 36 px for secondary actions inside cards. Icon-only buttons are 44×44
  with an `aria-label`. Pressed scales to .98 over `--dur-fast`.
- **Chips** — 36 px, `white-space: nowrap`; filter chips are `--radius-sm` with
  `aria-pressed`; **tag chips** are the only pills and use `--accent-2` (ochre), never the
  primary accent — a tag and a primary button must never read as the same ink.
- **Inputs** — 44 px (textarea min 96 px), `--surface-2`, 1 px `--border-strong` on focus a
  2 px `--focus` ring; visible `<label>`, helper and error text under the field via
  `aria-describedby`.
- **Cards and tiles** — `--surface`, 1 px `--border`, `--radius-md`, padding 16 px (24 px
  ≥ 768). Tiles (Library) are square-ish with an icon, label and count.
- **List rows** — 64 px min, leading platform glyph, title in the prose face, one meta line,
  trailing age and unread count; Unread rows sit in their own section.
- **Sheet** (`components/Sheet.tsx`, Base UI Dialog) — bottom sheet on phones (slides up,
  `--radius-lg` top corners, drag handle), centred dialog from 768 px.
- **Menu** (`components/Menu.tsx`, Base UI Menu) — `--surface`, `--shadow-md`, items 44 px,
  destructive item in `--err`; Escape and outside click close.
- **Confirm** (`components/Confirm.tsx`) — Base UI Dialog for every destructive action
  (revoke, disconnect, delete) naming the object in the title.
- **Tabs** (`AnswerTabs.tsx`, Base UI Tabs) — segmented control under the answer; the active
  tab is underlined in the accent, counts in mono.
- **Toast** (`components/Toast.tsx`) — transient successes only, one viewport in the shell,
  dismissable, auto-hides.
- **Skeleton** (`components/Skeleton.tsx`) — shimmering rows in an `aria-busy` region with a
  visually hidden label; replaces spinners in every list and the answer while a run is live.
- **Icons** — one inline SVG set (`components/Icon.tsx`), 24 px outline, 1.75 px stroke,
  `currentColor`; the brand mark is the two-page "double take" glyph. `aria-hidden` next to
  text, `aria-label` when alone. **No emoji, no arrow glyphs.**

## 7. Rich answer blocks

Answers are Markdown rendered by `components/Markdown.tsx` into `.prose`: GFM tables with
hairlines and a sticky first column on phones, task lists, blockquotes as margin notes, code
in mono on `--surface-2`, and three fenced blocks the brains are told about in the system
prompt (`apps/server/src/brains/prompts.ts`):

- ```` ```chart ```` — a small JSON spec (`packages/shared/src/chart.ts`: `bar | line | pie |
  stat`, up to 8 series and 60 points) drawn as themed SVG by `components/Chart.tsx`. Series
  colours come from `--chart-N` through the `.sN` class; values are also emitted as a
  visually hidden table for screen readers. An invalid spec falls back to the raw block as
  code with a one-line note.
- ```` ```mermaid ```` — `components/Mermaid.tsx` loads Mermaid lazily (own chunk),
  initialises it at `securityLevel: 'strict'` with HTML labels off so labels are SVG
  `<text>`, themes it from the tokens, and passes the SVG through the DOMPurify-based
  `cleanMermaidSvg()` before insert. Parse or sanitize failures stay a code block.
- ```` ```svg ```` — inline vector figures, sanitized the same way.

Rule for the prompt and the renderer alike: a picture never carries a fact that is not also
in the prose or a table.

## 8. Motion

`--dur-fast: 120ms; --dur: 200ms; --dur-slow: 280ms; --ease: cubic-bezier(.2,.8,.2,1)`.
Only colour, opacity, transform and shadow animate. Sheets slide from the bottom on phones and
fade-scale on desktop; the streaming answer shows a soft caret; a hairline rule under the prose fills as a run
progresses. Under `prefers-reduced-motion: reduce` or `data-motion="reduce"` every duration
drops to 1 ms and view transitions are skipped.

## 9. Copy

Sentence case everywhere. Verbs on buttons. Empty states are one line that says what to do
next ("No places yet. Share a post about somewhere and the answer pins it here."). No "AI",
"magic" or "sparkles" wording; the product talks about *the answer*, *the run* and *the
brain*. Owner-written text ("you wrote", follow-up questions) is labelled and set in prose
italics so it is never mistaken for the answer.

## 10. Accessibility rules

- Contrast per §2; never grey-on-grey below 4.5:1.
- Keyboard: every control reachable; `:focus-visible` shows a 2 px ring; no outline removal.
- Touch: 44 px minimum targets, 8 px minimum gap.
- Labels: visible labels for inputs, `aria-label` for icon-only controls, `aria-live="polite"`
  on status text that changes, `aria-busy` on loading regions, `aria-current`/`aria-pressed`
  on navigation and filter state.
- Layout: no horizontal scroll at 375 px (prose tables scroll inside their own wrapper);
  space reserved for async content; safe areas honoured on all four edges.
- Diagrams and charts carry their data as text (legend, hidden table, prose).

## 11. Anti-patterns (do not ship)

Chat bubbles for the answer · cream + terracotta + serif everywhere (the AI default) · drop
heavy or neutral-grey shadows · two competing accents (a tag chip in the button colour, or any second
"primary") · emoji as icons · placeholder-only labels · text under
12 px · chips that wrap mid-label · inline `style={{}}` · raw hex in components · hover-only
affordances · 0 ms state changes · removing focus rings · a focus rule that changes an
element's shape · fixed pixel container widths · chip
rows stacked above a list · a coloured left rule on anything that is not an answer · a
second component library.

## 12. Pre-delivery checklist

- [ ] `pnpm --filter @doubletake/web e2e` green; snapshots re-recorded from CI when a change
      is intentional (`update_snapshots=true`), reviewed side by side before commit
- [ ] 390 / 768 / 1280 screenshots, paper and ink, no wrap or overflow defects
- [ ] every icon is SVG with a label or `aria-hidden`; every input has a visible label
- [ ] tab through every page; focus ring visible everywhere
- [ ] `prefers-reduced-motion`, `prefers-color-scheme` and the Appearance overrides honoured
- [ ] contrast spot-check on any new colour pair, both themes
- [ ] safe areas on the Android/iOS wrappers; the chat composer clears the keyboard
- [ ] main JS gzipped under 260 KB; Mermaid stays a lazy chunk; fonts precached
