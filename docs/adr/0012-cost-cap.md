# 0012 — Daily spend cap and per-run budgets

- Status: accepted
- Date: 2026-09-03

## Context
Deep runs with web search can cost dollars each; a burst of shares should not surprise the
owner on the bill. Per-run cost visibility was requested.

## Decision
Each run carries `maxBudgetUsd` from its mode. A `cost_ledger` table sums spend per day; when
the configured daily cap is reached, new runs enter status `capped` and are shown with a
banner, resuming automatically the next day or when the owner raises the cap. Follow-ups keep
a small reserve. Every chat shows the cost of each run.

## Alternatives considered
- Monthly cap only: a bad day can still burn the month.
- Hard stop with no queueing: loses the share; queueing preserves it.

## Consequences
Adapters that cannot report cost (some CLIs) are estimated from a per-model price table or
counted as zero with a warning in the UI.
