# Doubletake — Design System (Master)

Global source of truth for the PWA (`apps/web`) and the Capacitor wrappers that show it.
Page-specific overrides live in `pages/<page>.md`; if none exists, this file applies.
Generated with the `ui-ux-pro-max` design-system tool on 2026-09-04 and then hand-edited to
the Doubletake brand. Implemented as CSS custom properties in `apps/web/src/styles.css`.

- **Direction**: Minimalism & Swiss Style. Grid, alignment, whitespace, one accent colour.
- **Reference quality bar**: professional mobile apps (iOS/Android system apps, Linear,
  Things): every row aligns to a grid, nothing wraps mid-chip, every control is a target.
- **Dials**: variance 3 (centred, calm) · motion 2 (subtle) · density 6 (standard).

## 0. Experience principles and core flows

Doubletake is used in three moments, and the UI is designed around them rather than around
screens:

1. **Capture (2 seconds, one thumb, mid-scroll).** The share sheet, the Web Share Target and
   Compose exist to get the item out of the user's head and back to the feed. Rules: URL
   pre-filled, cursor in the note field, mode defaults to Auto, one tap to send, a toast
   instead of a new screen. Nothing on this path asks a question the user cannot answer
   without leaving the feed. Compose on the phone therefore leads with the note, keeps mode
   chips on one scrollable line and puts **Send** full-width at the bottom.
2. **Return (minutes to hours later, from a notification).** The user arrives with one
   question: "what did it say?" The chat opens on the **answer**, not on the metadata. Title,
   status and cost are one calm header line; sources, tags and collections are collapsed
   below the answer; the follow-up composer is pinned at the bottom with the keyboard.
   Unread state is visible from the list (accent dot + badge) and clears on open.
3. **Browse (occasionally, sitting down, often on a laptop).** The home list is a triage
   surface: search first, then filters, then items. Filters (collections, entity kinds, tags)
   are secondary and collapsed to one row each; the item list is the hero. Desktop shows the
   same layout with a wider column and header-level actions instead of a FAB.

Cross-cutting rules that fall out of these flows:

- **One primary action per screen**, always where the thumb rests (bottom on phones).
- **Progress over spinners.** A run shows its stage (extracting → researching → done) and
  the live timeline is available but collapsed; the user should never wonder whether
  something is happening.
- **Errors keep the input.** A failed send or pairing keeps what was typed and explains the
  next step in one sentence.
- **First run is guided.** Welcome explains the product in one line, defaults to the right
  tab for the platform (pair on phones, password on the laptop), and the Settings page tells
  you what to do next (pair a phone, enable notifications) before it lists options.
- **Nothing important lives behind hover.** Every affordance works with touch and keyboard.
- **Continuity.** Back always goes where the user came from; deep links (`/chat/<id>`) work
  cold from a notification; scroll position and drafts survive navigation.

## 1. Colour tokens

Both schemes ship; the UI follows `prefers-color-scheme` (`color-scheme: light dark`).
Ratios are WCAG contrast against the surface named in the row. Body text must reach 4.5:1,
large text and UI glyphs 3:1, in **both** themes.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--bg` | `#0f1115` | `#f6f7fb` | app background |
| `--surface` | `#171a21` | `#ffffff` | cards, sheets, header |
| `--surface-2` | `#1e222b` | `#eef0f6` | inputs, nested rows, chips |
| `--border` | `#343a48` | `#d5d9e3` | dividers, control outlines |
| `--text` | `#e6e8ee` (14.2:1) | `#14171f` (17.9:1) | primary text |
| `--text-muted` | `#9aa3b2` (6.8:1) | `#5b6472` (6.0:1) | secondary text, meta |
| `--accent` | `#7c9cff` | `#4360f0` | primary buttons, active chips, links |
| `--on-accent` | `#0b0d12` (7.5:1) | `#ffffff` (5.0:1) | text on `--accent` |
| `--accent-text` | `#7c9cff` (6.7:1) | `#3a55cc` (6.3:1) | links and accent text on surfaces |
| `--accent-2` | `#c4b5fd` | `#6d4fd6` | brand secondary (badges, QR foreground) |
| `--ok` | `#4ade80` | `#15803d` | done, verified |
| `--warn` | `#fbbf24` | `#a16207` | running, unclear, capped |
| `--err` | `#f87171` | `#dc2626` | failed, false, destructive |
| `--focus` | `#7c9cff` | `#4360f0` | focus ring |
| `--scrim` | `rgba(0,0,0,.6)` | `rgba(16,18,26,.45)` | behind popovers/sheets |

Status tints for pills use the status colour at 18% alpha as background with the full
colour as text, so they read in both themes.

## 2. Typography

System-first, no web-font fetch (offline PWA, no layout shift):

```
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

| Step | Size / line | Weight | Use |
|---|---|---|---|
| `--text-xs` | 12 / 16 | 500 | pills, badges, timestamps (never body copy) |
| `--text-sm` | 14 / 20 | 400–500 | meta, helper text, list secondary line |
| `--text-md` | 16 / 24 | 400 | body, inputs, buttons |
| `--text-lg` | 18 / 26 | 600 | card titles, list primary line |
| `--text-xl` | 22 / 28 | 700 | page titles |
| `--text-2xl` | 28 / 34 | 700 | welcome headline |

Titles clamp to 2 lines (`.clamp-2`), meta to 1 (`.truncate`). Tablet/desktop measure is
capped at 72ch for reading columns.

## 3. Spacing, radii, elevation

```
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
--space-6: 24px; --space-8: 32px; --space-12: 48px; --space-16: 64px;
--radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-pill: 999px;
--shadow-sm: 0 1px 2px rgba(0,0,0,.25);
--shadow-md: 0 4px 12px rgba(0,0,0,.30);
--shadow-lg: 0 12px 32px rgba(0,0,0,.35);
```

Everything sits on the 4/8 rhythm. Page gutter 16px on phones, 24px from 768px. Content
column max 960px (lists) / 720px (forms, chat).

## 4. Components

- **Buttons** — height 44px (`--tap`), padding 0 16px, radius `--radius-sm`, weight 600,
  `--text-md`. Variants: `primary` (accent fill), `ghost` (transparent, border on hover),
  `danger` (err text). Icon-only buttons are 44×44 with an `aria-label`. Pressed state
  scales to .98 over 100ms; disabled at 50% opacity with `cursor: not-allowed`.
- **Chips** — height 36px, padding 0 12px, pill radius, `white-space: nowrap`, one line
  always; selected = accent tint background + accent text + 1px accent border. Chip rows
  scroll horizontally on phones (`.chips.scroll`) or wrap with a "Show all" toggle.
- **Inputs** — height 44px (textarea min 96px), padding 10px 12px, `--text-md`, background
  `--surface-2`, 1px `--border`, focus = 2px `--focus` ring outside. Every input has a
  visible `<label>`; helper text and errors sit under the field and are linked with
  `aria-describedby`.
- **Cards** — `--surface`, 1px `--border`, radius `--radius-md`, padding 16px (24px ≥768px).
- **List rows** — 64px min height, 12px vertical padding, leading 24px icon, primary line
  clamped to 2, meta line truncated, trailing column right-aligned (time + unread badge).
- **Header** — 56px + top safe-area, `--surface`, bottom border, brand left, icon buttons
  right (`+ New`, Settings) with labels on ≥768px and `aria-label` always.
- **FAB** — 56px, accent, bottom-right at `16px + safe-area`, hidden on ≥768px where the
  header button suffices; list gets bottom padding so the last row is never covered.
- **Composer** — sticky at bottom with safe-area padding; textarea grows to 6 lines; Send is
  an icon button; "Research" opens a popover (`role="menu"`) above the bar.
- **Popover/menu** — `--surface`, `--shadow-lg`, radius `--radius-md`, items 44px; closes on
  Escape and outside click.
- **Status pill** — `--text-xs`, uppercase off, tinted per status (see §1).
- **Icons** — one inline SVG set (`components/Icon.tsx`), 24px outline, 1.75px stroke,
  `currentColor`; `aria-hidden` next to text, `aria-label` when alone. **No emoji as icons.**

## 5. Motion

`--dur-fast: 120ms; --dur: 200ms; --dur-slow: 300ms; --ease: cubic-bezier(.2,.8,.2,1)`.
Only colour, opacity, transform and shadow animate. Under `prefers-reduced-motion: reduce`
all durations drop to 1ms.

## 6. Accessibility rules

- Contrast per §1; never grey-on-grey below 4.5:1.
- Keyboard: every control reachable; `:focus-visible` shows a 2px ring; no outline removal.
- Touch: 44px minimum targets, 8px minimum gap between adjacent targets.
- Labels: visible labels for inputs, `aria-label` for icon buttons, `aria-live="polite"`
  on status text that changes (send state, pairing result).
- Layout: no horizontal scroll at 375px; space reserved for async content; safe areas
  honoured on all four edges.

## 7. Anti-patterns (do not ship)

Emoji as icons · placeholder-only labels · text under 12px · chips that wrap mid-label ·
inline `style={{}}` for layout · raw hex in components (use tokens) · hover-only affordances ·
instant (0ms) state changes · removing focus rings · fixed pixel container widths ·
FAB covering list content · three controls squeezed into one row on a phone.

## 8. Pre-delivery checklist

- [ ] 375 / 768 / 1024 / 1440 screenshots, light and dark, no wrap or overflow defects
- [ ] every icon is SVG with a label or `aria-hidden`
- [ ] every input has a visible label; errors are inline
- [ ] tab through every page; focus ring visible everywhere
- [ ] `prefers-reduced-motion` and `prefers-color-scheme` both honoured
- [ ] contrast spot-check on new colour pairs
- [ ] safe areas on the Android/iOS wrappers
