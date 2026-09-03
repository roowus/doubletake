# 0013 — AGPL-3.0, public from day one

- Status: accepted
- Date: 2026-09-03

## Context
The owner wants the project open source and self-hostable, and does not want a hosted clone
to close the source. The closest OSS relatives (SuperBrain, Karakeep) are AGPL.

## Decision
License under AGPL-3.0-only. Repository public at github.com/roowus/doubletake from the first
commit, including the docs-before-code phase.

## Alternatives considered
- MIT/Apache: allows closed hosted forks.
- Source-available (BSL, SSPL): not open source; hurts adoption by self-hosters.

## Consequences
Contributions must be AGPL-compatible. Dependencies with incompatible licenses are excluded.
