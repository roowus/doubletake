# Research modes

Mode is picked per run. Budgets are configuration (`modes.*` in settings) with these defaults.

| | Quick | Standard | Deep |
|---|---|---|---|
| Wall-clock target | < 90 s | < 6 min | < 25 min |
| Transcription model | small / turbo | large-v3-turbo | large-v3-turbo |
| Frames sampled | ≤ 4 | ≤ 12 | ≤ 40 |
| Frames described by vision | 0 (OCR only) | ≤ 6 | all sampled |
| Comments fetched | top 20 | top 100 (thread focus: whole thread) | all, cap 500 |
| Linked pages followed | 0 | 0 | 1 hop from caption/comments |
| Agent `maxTurns` | 6 | 20 | 60 |
| Agent `maxBudgetUsd` | 0.15 | 0.75 | 3.00 |
| `web_search` / `web_fetch` | 3 / 3 | 10 / 10 | unlimited within budget |
| `read_file` | no | yes | yes |
| `write_sandbox_file` | no | no | yes (report + assets) |
| Model tier hint | fast (Haiku-class) | default (Sonnet-class) | best (Opus / reasoning) |
| Output | 3–6 sentences + entities | answer + claims verdict + sources + entities | full report, tables, recommendations, entities |

## Picking a mode

1. Explicit chip in the share sheet or compose box wins.
2. Keyword rules on the note (case-insensitive, first match):
   - Quick: `quick`, `tl;dr`, `tldr`, `just save`, `save this`, `later`
   - Deep: `deep`, `deep dive`, `research`, `compare`, `thorough`, `everything about`
   - Standard: `is this true`, `is this real`, `legit`, `explain`, `how`, `what is`
3. Otherwise one cheap classifier call via the brain's `classify()` (or the default adapter
   with the fast model), prompt returns JSON `{ mode, question_type, needs_comments }`.
   Timeout 8 s; on failure default Standard.
4. `question_type` values: `is_it_true` · `what_is_this` · `how_to` · `compare` ·
   `save_for_later` · `explain_comments` · `other`. `save_for_later` forces Quick.

## Output templates by question type

Every template ends with the structured `Answer` block (category, entities, tags; claims and
recommendations where relevant). Entities are the SaveToList lesson: the place, recipe, product,
tool, or tip in the media is extracted with its attributes so it lands in the right auto
collection even when the owner asked nothing.

- **is_it_true**: verdict line, claims table (claim · verdict · confidence · sources), what
  the comments say, caveats.
- **what_is_this**: identification, what it is for, who makes it, alternatives, is it worth it
  for *you* (uses local file context if relevant).
- **how_to**: steps distilled from the media, corrections from sources, prerequisites.
- **compare**: table of options with criteria the owner cares about, recommendation.
- **explain_comments**: summary of the discussion, main camps, notable replies, consensus.
- **save_for_later**: one-paragraph summary, category, entities with attributes, tags; no
  research. A share with an empty note and no question-like caption defaults here in Quick.
- **other**: what_is_this shape without the alternatives section.

## Follow-ups and escalation

Follow-ups run with `maxTurns` 3 and `maxBudgetUsd` 0.10, no extraction, tools limited to
`web_search` ×2. The model is told it may answer `{ "escalate": true, "mode": "standard" |
"deep" }` if the question needs research; the UI also has **Research this** which schedules a
Standard run (long-press: Deep). Escalated runs resume the chat's brain session.
