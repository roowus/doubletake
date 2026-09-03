# CLAUDE.md — rules for working in this repo

Doubletake: self-hosted "share it now, get a researched answer later" assistant. Read
`docs/ARCHITECTURE.md` before touching anything; it is the source of truth and it is kept
current by the rule below.

## Non-negotiable rules

1. **Docs in the same commit.** Any behavioural change updates `docs/ARCHITECTURE.md` and the
   relevant guide (`docs/*.md`, `docs/channels/*.md`) in the *same* commit. A PR that changes
   behaviour without a docs diff is incomplete.
2. **Decisions get an ADR.** Changing any row of the decisions table in `docs/ARCHITECTURE.md`
   requires a new file in `docs/adr/` (next number, template in `docs/adr/README.md`), a line in
   the ADR index, and the table row updated to point at it. Superseded ADRs are marked, never
   deleted.
3. **Always be committing.** Commit each green unit of work as you go, unprompted. Pushing and
   opening PRs is fine without asking on this project.
4. **Green before commit.** `pnpm check` (biome, tsc, vitest, ruff, pytest) and
   `python3 scripts/check-links.py` must pass. Do not commit with a failing check "to fix later".
5. **No secrets, no data.** Nothing from `~/.doubletake`, no `.env`, no tokens, no Firebase
   service accounts, no cookies files. `.gitignore` is a backstop, not the rule.
6. **Untrusted content stays untrusted.** Anything scraped (captions, transcripts, OCR, comments,
   fetched pages) is wrapped by `packages/shared` helpers before reaching a brain, and tool
   policy is enforced in code (`canUseTool` / the tool loop), never by prompt text alone.
7. **No shell tool for the brain. Ever.** Reads follow the deny list; writes go to
   `DOUBLETAKE_NOTES_DIR` only.

## Naming and layout

- Domain nouns: `item` (one share), `chat` (its conversation), `run` (one brain execution),
  `extraction` (derived text), `brain` / `adapter`, `channel` (how it arrived), `mode`
  (quick | standard | deep), `focus` (whole | comments | thread:<id>). Do not introduce
  synonyms (`save`, `bookmark`, `job`, `session` for a run).
- Packages: `apps/server` (Fastify), `apps/web` (Vite PWA), `apps/mobile` (Capacitor),
  `packages/shared` (zod + types), `packages/brain-sdk` (adapter interface + contract tests),
  `workers/media` (Python, uv).
- Paths: code `~/projects/doubletake`, data `~/.doubletake`, notes sandbox `~/Doubletake`;
  all overridable via env (`.env.example` lists every variable with its default).
- TypeScript: strict, ESM, `verbatimModuleSyntax`; biome for lint+format; vitest.
  Python: 3.12, ruff, pytest, `uv run`.

## Workflow

- Milestones and acceptance criteria live in `docs/ROADMAP.md`; work top to bottom.
- Before implementing a milestone, re-read its section in `docs/ARCHITECTURE.md` and the
  guide it references; if reality disagrees with the doc, fix the doc first (rule 1).
- Third-party API facts (Meta, Capacitor, Agent SDK) that were verified only from docs, not
  against the live service, are marked **unverified** in the guides. When you verify one,
  remove the marker in the same commit as the code that depends on it.
- Never commit `apps/mobile/android/local.properties` or Gradle caches.
