# 0033 — Design-token enforcement, preview harness, and mobile audit in CI

- Status: accepted
- Date: 2026-11-26

## Context

ADR 0030 pinned the "field notebook" direction: paper default, ink dark, bundled
serif + sans + mono, the margin rail, and a single stylesheet (`apps/web/src/styles.css`,
about 4,000 lines, 93 custom properties in `:root`) as the only place a colour is written.

In practice the rule held for tokens and leaked for everything adjacent to them. A survey
of the stylesheet before this ADR found:

- Eight raw colour literals outside the token blocks: two texture gradients, a mask stop,
  the text on a filled danger button, a map sea fallback, the switch knob's shadow, the QR
  plate, and hosted-mode fallbacks written against names the app never declares
  (`--ink-3`, `--line`).
- The ink theme declared twice (once inside `@media (prefers-color-scheme: dark)` and once
  for `[data-theme="ink"]`), 36 properties each, and the two were kept in sync by hand.
- The same ink values were also restated as TypeScript fallbacks in
  `components/Mermaid.tsx`, as a `CHROME_BG` pair in `appearance.ts`, as two
  `theme-color` metas in `index.html`, and as a QR plate pair in `settings/Devices.tsx`.
  Four places had to agree with `--bg` and nothing checked that they did.
- `scripts/audit-mobile.mjs` existed, caught nothing at the time, and ran in no CI job.

Three other things were true. The 27 Playwright visual baselines are recorded on Linux only,
so a macOS contributor can only compare them by dispatching CI. There was no way to show the
owner a design change outside a terminal diff. And a redesign had already been decided as the
next unit of work, which meant the guards needed to exist before the redesign rather than
after.

## Decision

1. **`scripts/check-tokens.mjs` is the token guard, and it is part of `pnpm check` and CI.**
   It fails on: a raw colour literal outside the three token blocks; the ink block and the
   prefers-dark block disagreeing on any property or set of properties; a `var(--x)` naming
   a property nothing declares (external Capacitor, Base UI and JS-set properties are
   allow-listed by prefix); `index.html`'s two `theme-color` metas or `appearance.ts`'s
   `CHROME_BG` drifting from `--bg`; and a stale `design-system/doubletake/tokens.json`.
   The escape hatch is a `tokens-lint-ignore` comment with a reason, or a
   `tokens-lint-ignore-start` / `-end` region for a block of intentional fallbacks.

2. **`design-system/doubletake/tokens.json` is generated, never edited.** `--write` rewrites
   it from the stylesheet so tooling (and a future design tool) reads one machine-usable
   file. The guard fails when the file and the stylesheet disagree.

3. **Raw literals found by the guard are fixed, not ignored.** Colour moved into tokens where
   a rule needed one (`--texture-bloom`, `--texture-rule`, `--mask-solid`, `--on-danger`,
   `--knob-bg`, `--knob-shadow`, `--qr-plate`, `--qr-ink`, plus paper defaults for the ink-only
   `--map-filter` and `--map-sea`). The three rules that painted ink's texture separately now
   use the same rule as paper, because the two dark blocks re-point the texture tokens.
   The hosted-mode fallbacks now name the tokens the app actually has (`--text-muted`,
   `--border`). The refactor is deliberately visual-neutral: the mobile audit and the
   snapshot suite are expected to pass without re-recording.

4. **`scripts/audit-mobile.mjs` runs in the `web-visual` CI job**, at 320 and 390 wide in both
   themes over eight routes, before the snapshot suite. It is the width-and-target check that
   does not need Linux rendering, so it catches a 320 px horizontal scroll on any machine.

5. **`design-lab/index.html` is the preview harness.** A single self-contained page that
   renders the real screens at phone width with realistic fixture content, and lets the owner
   switch direction (tokens plus a few structural rules), typeface, theme, screen, and a
   side-by-side compare mode. It is excluded from biome (`files.includes`) because it is a
   scratch artifact, not shipped code, and it is not built or deployed. It exists so a design
   question is answered by looking at a page instead of by reading a description.

## Alternatives considered

- **A CSS-in-JS or a second component library to enforce tokens structurally.** Rejected for
  the same reason as in ADR 0030: one stylesheet and one component library is the constraint;
  the failure mode here was literals and duplicated blocks, not selector chaos.
- **Stylelint with `declaration-property-value-allowed-list`.** A real option and a more
  mature tool than a bespoke script. Rejected because the checks that actually matter are
  cross-file (the two dark blocks, the meta tags, the TS constants, the generated mirror) and
  stylelint would need custom plugins for all four, which is the script again with more
  configuration.
- **PostCSS `@define-mixin` or a build-time token pipeline.** Adds a build step to a
  stylesheet that currently has none, for a property (no literals) the script already enforces
  at commit time.
- **Fixing the drift without a guard.** This is what produced the drift.
- **A combination of `check-tokens` and a third-party "AI slop" scanner.** Deferred: the slop
  scanner catches taste, and taste is the redesign's job to establish, not a lint rule's.
- **Recording visual baselines on macOS as well.** Rejected again for font-hinting reasons
  (ADR 0030); the lab plus the mobile audit covers the local loop.

## Consequences

Easier: a new colour is either a token or a failure; the two dark blocks cannot silently
diverge; the browser chrome colours cannot lag the stylesheet by a design pass, which is
exactly the bug `index.html`'s own comment records; `tokens.json` gives a design tool one
input; the owner can review a direction as a page.

Harder: a genuinely theme-independent literal now needs a one-line comment, and the guard
must be extended when a new class of drift appears. `tokens.json` adds a generated file to
review after any token change. The lab is a second stylesheet that nobody can forget is
scratch.

Revisit when the redesign lands: the lab should be retired (or promoted to a component
preview) and ADR 0030's token table should be updated to whatever the redesign chooses. If a
token ever needs to exist only in ink, the parity check needs an explicit forward-declaration
in `:root` rather than a special case in the script.
