# 0034 — "Soft Paper": one typeface, no margin rail, the answer as a page with an evidence report

- Status: accepted (supersedes parts of 0030; retires the lab harness from 0033)
- Date: 2026-11-27

## Context

ADR 0030 chose the "field notebook" direction and ADR 0033 hardened its tokens. Both held up
structurally, but the owner's review of a live instance found three things wrong with how the
answer page read:

- **Too much chrome around the answer.** A dated turn label, a clip card, a tag row, a 3 px
  margin rail, four tabs (Claims / Things / Sources / Run) and a composer all sat between the
  reader and the sentence that answered their question. The answer is one or two paragraphs;
  the apparatus was four times its size.
- **Two typefaces where one will do.** Newsreader prose beside Instrument Sans interface read
  as a magazine editorial, not as a reading tool. The owner asked for one softer family.
- **Evidence was quarantined.** Claims lived in a tab the reader had to go and open, so the
  answer and its verification were two separate pages. A reader who trusted the prose never
  saw that a claim in it had come back `false`.

A design pass in `design-lab/` compared placements and type, and the owner settled on Soft
Paper with Figtree, a shorter answer page, and inline evidence marks pointing at a claims
report at the foot of the page.

## Decision

- **Soft Paper replaces the field-notebook palette in place.** `--bg #f8f4ea`, `--surface
  #fffdf7`, `--surface-2 #f2ecdd`, `--surface-3 #eae1ce`, `--border #e7e1d2`, `--border-strong
  #cfc5ae`, `--text #1e1b16`, `--text-muted #6d675c`, `--accent #b0472c`, `--accent-text
  #9c3d25`, `--accent-2 #7d5a10`, `--radius-md 18px`, warm-tinted shadows. Ink moves to
  `--bg #17130e`, `--surface #201b15`, `--surface-2 #282218`, `--accent #e8865f`, with the
  same shape. Both dark token blocks stay byte-identical, as ADR 0033 requires.
- **One typeface: Figtree**, bundled from `@fontsource-variable` (latin subset) and used for
  both interface and prose. Newsreader and Instrument Sans are removed as dependencies.
  JetBrains Mono stays for meta and code only.
- **The margin rail is removed.** Answers carry no coloured left rule. `--rail` survives as an
  alias of the accent for the landing's benefit but no app rule uses it.
- **The answer page is a page, not a chat log.** Source line (platform · host · date, with the
  item's thumbnail when it has one), the title, the prose, then two printed reports: **Claims**
  with each claim's verdict and where it came from, and **Sources** listing the distinct URLs
  that were cited. Entities and run history collapse into one footer row that opens a sheet.
  No turn labels, no bubbles, no tabs.
- **Evidence marks are structured, not guessed.** The brain writes `[[n]]` where `n` is the
  1-based index of its own claim; the web app renders each as a small superscript that scrolls
  to and flashes that claim's row. Answers without marks still render.
- **The brain is blunt, not hedged by the client.** The prompt requires it to state a caveat
  in its own words when its own check refutes or contests a sentence, to keep that claim in the
  report with its true verdict and whatever source it actually found, and to say plainly when
  it found none. The web app never rewrites the model's prose.
- **Expanded scope authority.** This ADR also authorises the restyle of every screen (shell,
  Inbox, Library, Compose, Settings, entry screens) under the same tokens, and the Library
  restructure already agreed in the design pass: a hub with the To-do row at the top and two
  sub-pages, Things and Collections.
- **The lab harness is retired.** `design-lab/` is deleted with this ADR. The real app plus the
  Playwright screenshot suite replace it; a change is now looked at against the app, not
  against a mock that can drift.

## Alternatives considered

- **Keep the field-notebook look and only re-lay the answer page.** Rejected: the owner's
  objections were to the palette and the typeface as well as to the chrome, and doing them in
  two passes would have meant re-recording the visual baselines twice.
- **Pair Figtree for the UI with a serif for prose.** Rejected by the owner explicitly: no
  mixed typefaces. A second family buys editorial flavour the reading tool does not need, and
  costs another ~150 KB of precached woff2.
- **Keep claims in a tab and add a summary chip above the prose.** Rejected: the tab is what
  made the verification invisible. A chip saying "1 false" is a warning bell without the
  evidence behind it; the printed report is the evidence.
- **Let the client soften prose that has a `false` claim.** Rejected: deterministic text
  rewriting would mangle sentences it cannot parse, and it hides the model's mistake instead
  of showing it. Better to make the model state the caveat and keep the claim visible.
- **Keep `design-lab/` as a component preview.** Rejected for now: it duplicates markup and CSS
  (including its own Google Fonts imports past the precache), and the Playwright suite already
  renders real screens at three viewports against fixture data. A preview harness can return
  later as a React route rendering the same components, with no second stylesheet.

## Consequences

- Easier: one font to load and reason about; the answer reads as writing with its evidence
  underneath; a refuted claim is visible without a tap; the token guard keeps the new palette
  honest; a change is judged against the real app.
- Harder: the visual baselines must be re-recorded once (27 shots, Linux CI run); the answer
  page markup is replaced rather than restyled, so its unit tests move with it; the brain
  prompt's `[[n]]` convention needs an answer fixture that exercises it.
- Superseded: ADR 0030's typography, margin-rail and answer-tab decisions, and ADR 0033's
  `design-lab/` harness decision. ADR 0030's rich answer blocks (chart / mermaid / svg), its
  `@base-ui/react`-only rule, its four-tab shell and its paper-first default all stand.
- Revisit: if the answer grows a second evidence type (quotes, timestamps, extracted entities
  cited inline), extend the mark convention rather than adding a second one.
