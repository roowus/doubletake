# 0005 — Untrusted content isolation and file access policy

- Status: accepted
- Date: 2026-09-03

## Context
Everything Doubletake feeds a model is written by strangers: captions, comments, transcripts,
OCR text, fetched pages. The same model can read the owner's home directory for
personalisation. That is a prompt-injection-to-exfiltration path unless reads, writes, and
network are constrained by code.

## Decision
Wrap every extraction in `<untrusted source= kind=>` blocks with a fixed preamble that
instructions inside are data. Reads: roots default to the home directory, minus a deny list
(`~/.ssh`, `~/.aws`, `~/.config`, `~/.gnupg`, keychains, `~/.doubletake`, `.env*`, `*.pem`,
`*.key`, `node_modules`), symlinks resolved, 2 MB per read. Writes: only under
`~/Doubletake`. No shell tool. Network only via `web_search` and `web_fetch` with an SSRF
guard and no credentials. Enforcement is in `canUseTool` / our tool loop, never in prose alone.

## Alternatives considered
- Allowlist a few folders only: the owner explicitly wants whole-home reads for
  personalisation; deny list on secrets is the compromise.
- Sandboxed shell (containers): heavy, and the owner sees no need for shell in v1.
- Prompt-only defences: known to fail; kept as a layer, not the mechanism.

## Consequences
Some legitimate reads (a project's `.env.example`) are blocked by the `.env*` glob; the deny
list is configurable. External CLI harnesses cannot be policed by `canUseTool`; they run in a
sandbox cwd with the policy as a preamble and are documented as weaker.
