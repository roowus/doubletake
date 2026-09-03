# 0004 — Quick / Standard / Deep research modes

- Status: accepted
- Date: 2026-09-03

## Context
"Save this for later" and "is this claim true, compare with alternatives" cost wildly
different amounts of time and money. The owner will not choose a mode every time while
scrolling, but wants to be able to.

## Decision
Three modes with fixed budgets for extraction depth, agent turns, USD, tool calls, and model
tier (RESEARCH-MODES.md). Mode is auto-picked: keyword rules on the note, else a cheap
classifier call that also returns a `question_type`; default Standard. The share sheet offers
chips to override; any chat can be re-run in another mode.

## Alternatives considered
- One mode: either too slow/expensive for "just file it" or too shallow for real questions.
- Free-form budget sliders: too much UI at capture time.
- Always ask: interrupts scrolling, which is the thing the product must not do.

## Consequences
Budgets are data, not code, so they can be tuned in config. The classifier costs a small call
per item; keyword rules short-circuit it for the common cases.
