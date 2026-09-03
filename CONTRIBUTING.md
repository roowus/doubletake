# Contributing

Thanks for looking. Doubletake is a single-owner-per-instance tool, but the code is for
everyone who wants to self-host it.

## Ground rules
- Read `CLAUDE.md` (it applies to humans too): docs change in the same commit as behaviour;
  decisions get an ADR; `pnpm check` and `python3 scripts/check-links.py` must be green.
- Small PRs. One behavioural change per PR with its doc diff.
- New brain adapters: implement `BrainAdapter`, pass the contract tests, add a row to
  `docs/BRAIN-ADAPTERS.md`.
- New channels or notifiers: implement the interface in `apps/server/src/channels` /
  `notify`, add a guide under `docs/channels/`.

## Setup
```sh
scripts/doctor.sh
pnpm install && (cd workers/media && uv sync)
pnpm check
```

## Style
TypeScript strict + biome defaults (single quotes, semicolons, 100 cols). Python ruff.
Commit messages: `type(scope): summary` (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`).

## License
By contributing you agree your contribution is licensed under AGPL-3.0-only.
