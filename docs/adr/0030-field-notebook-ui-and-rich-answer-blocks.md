# 0030 — "Field notebook" web UI, Base UI as the only component dependency, chart-spec + Mermaid answer blocks

## Status
accepted

## Date
2026-09-07

## Context
The first UI revamp (2026-09-04, design system v1) gave the PWA tokens, a design doc and
consistent components, but the owner's review found the result still read as generic AI-tool
UI: a dark cool-grey theme, every message in a chat bubble, system fonts, one long list with
three chip rows stacked on top of it, a Settings page that was seven identical cards. Answers
were limited to plain Markdown, so a comparison of prices or a decision process arrived as
prose even when a table, a chart or a flowchart would have been the honest form. The owner
asked for a complete revamp with more effort and more tooling, no bubbles, richer answer
formatting (charts, embedded tables, bullets), the chip clutter moved elsewhere, a Settings
tab that feels like settings, upgraded UI/UX docs, and the work to be checked with real
screenshots rather than by eye.

## Decision
- **Direction: field notebook.** Reading-tool lineage (Pocket, Readwise, Matter), not chat
  apps. Warm paper light theme is the **default**; deep ink dark follows
  `prefers-color-scheme` or a manual choice; one deep pine accent, clay reserved for tag
  chips; Newsreader for answer prose, Instrument Sans for the interface, JetBrains Mono for
  meta and code, all bundled from `@fontsource-variable` (latin subsets, precached). The
  signature element is the **margin rail**: a 3 px accent rule beside every answer that
  carries the run meta in the margin on wide screens and fills as a live run progresses.
  Specification in [`design-system/doubletake/MASTER.md`](../../design-system/doubletake/MASTER.md)
  v2 with one file per screen under `pages/`.
- **Information architecture.** A four-tab shell: **Inbox** (list + search + a Filter sheet,
  no chip rows), **Library** (entity kinds, collections, map and tags as tiles and lists,
  where the chip rows went), **Add** (full-page compose, also the share target) and
  **Settings** (grouped rows, one section page each under `/settings/<section>`, an
  Appearance section for theme / prose size / motion). The answer page is title, clip card
  with the owner's note, full-width prose beside the rail, then Claims / Things / Sources /
  Run tabs and a sticky follow-up composer. No bubbles anywhere.
- **Component dependency: `@base-ui/react` only** (Menu, Dialog, Tabs, Toast, Switch),
  unstyled and tree-shaken, styled by our CSS tokens. Motion stays CSS-only plus the View
  Transitions API where present. No Tailwind, no motion library, no drawer library.
- **Rich answer blocks.** Two fenced blocks join ```` ```svg ```` as the answer-block contract,
  documented to every brain in the system prompt: ```` ```chart ```` with a small zod-validated
  JSON spec (`packages/shared/src/chart.ts`: bar / line / pie / stat, ≤ 8 series, ≤ 60
  points) rendered by our own themed SVG renderer with a hidden data table, and
  ```` ```mermaid ```` rendered by Mermaid loaded lazily as its own chunk at
  `securityLevel: 'strict'` with HTML labels off, its output passed through DOMPurify before
  insertion. Invalid or unsafe blocks fall back to a code block with a one-line note. The
  rule "no essential fact only in the picture" stays in the prompt.
- **Verification is part of the design system.** A Playwright suite (`apps/web/e2e`) renders
  the shell against a dependency-free fixture API (including the rich-answer fixture) and
  compares screenshots recorded on Linux in CI (`web-visual` job); intentional changes
  re-record through a manual workflow run. The pre-delivery checklist in MASTER §12 requires
  it green.

## Alternatives considered
- **Keep v1 and polish.** Rejected: the owner's objections were structural (bubbles, chip
  rows, card-stack settings, the AI-default palette), not cosmetic.
- **Tailwind + shadcn/ui.** Rejected: brings a second styling system next to our tokens, a
  large default look we would have to fight, and no gain for a single-owner PWA.
- **Radix / Headless UI / React Aria.** Base UI chosen because it is one package, unstyled,
  tree-shakes to the five primitives we use and is maintained by the MUI team; the others
  are comparable and this is not a deep commitment (five components behind our own wrappers).
- **Charts via Chart.js / Recharts / Vega-Lite.** Rejected: 60–200 KB for what is four
  small SVG shapes; a hand-written renderer keeps colours on tokens, output sanitizable and
  the spec tiny enough for a brain to emit reliably.
- **Mermaid at `loose` security to allow HTML labels.** Rejected: diagram text is brain
  output derived from scraped pages, therefore untrusted (rule 6); strict + SVG text +
  DOMPurify is the only acceptable path, and the cost is unstyled-but-readable labels.
- **A dark default theme.** Rejected: a reading tool is read; paper by default, ink on
  request or when the OS asks for it.
- **A motion library (`motion`) and a drawer library (`vaul`).** Rejected: CSS transitions,
  `@starting-style` and the View Transitions API cover every animation in the app.

## Consequences
- Easier: answers can carry tables, charts and diagrams that render consistently in both
  themes; the list is uncluttered; Settings is discoverable; every screen has a spec page.
- Harder: three bundled fonts (≈ 300 KB woff2, precached once) and a lazy 170 KB Mermaid
  chunk; the design doc must be kept in step with the CSS (the pre-delivery checklist and
  the visual suite enforce it); snapshot updates need a CI round trip because they are
  recorded on Linux.
- Superseded: the v1 design-system text (dark default, chip rows, FAB, header bar) is
  replaced in place; the `1ecf2f3` decisions on tokens and components stand only where v2
  repeats them.
- Revisit: when a second component primitive family is needed (date picker, combobox),
  extend Base UI first; if the brain adapters start emitting chart specs the renderer cannot
  draw, grow the spec rather than adding a chart library; when iOS ships, verify the sticky
  follow-up composer against the keyboard on a real device.

## Addendum (2026-10-14, the landing palette supersedes the pine accent)

- **The accent is the landing's clay, not pine.** The decision above reserved clay for tag
  chips and made a deep pine the single accent. That held while the app and the marketing
  landing were separate surfaces. They are one product now, and the landing's
  [`DESIGN-LANGUAGE.md`](../../../doubletake-cloud-existing/docs/DESIGN-LANGUAGE.md) makes
  clay (`--rail: #C45A3C`) its accent — so the app adopted it, and the two surfaces no longer
  read as different products.
- **The landing's exact value did not pass contrast, so the app darkens it.** `#C45A3C` is
  3.89:1 on `--paper` and 4.31:1 behind white; the app ships `#a8432a` (5.4:1 / 6.0:1), the
  same hue family (11.9° vs 13.2°). Ink ships `#e5805f`.
- **Tag chips moved to ochre (`--accent-2`).** The old secondary `#a8541e` was itself a clay,
  so once clay became primary a tag chip and a primary button would have read as the same
  ink. `--accent-2` is now `#7d5a10`, 1.2:1 from the accent.
- **The margin rail is unchanged in meaning.** `--rail` was already `var(--accent)`, so the
  signature 3 px rule is clay now, exactly as the landing names its own accent token.
- **Unchanged:** the field-notebook direction, the four-tab shell, the bundled fonts (the
  landing's OS stack is still not adopted), the answer-block contract, and the rule that only
  answers carry a coloured left rule.
