# 0014 — Structured extraction, categories, and auto-collections

- Status: accepted (extends 0011)
- Date: 2026-09-03

## Context
The competitor survey (31 products, 2026-09-03) showed that the one capture product with real
traction on Instagram, SaveToList, does not research anything: it turns a post into
structured entries (a place with address and cuisine, a recipe with ingredients, a product
with price) and files them into categorised lists automatically. Users pay for that even
without a question. Summary-only tools (SuperBrain, the reel-summariser apps) get churned;
archive tools (Karakeep, Raindrop) are kept because their lists stay useful later. Doubletake's
differentiator is the researched answer, but an answer that leaves the *thing* unstructured
loses the part users demonstrably value.

## Decision
Every run, in every mode including `save_for_later`, produces a structured `Answer` alongside
the Markdown text: a `category`, a list of `entities` (typed things found in the media: place,
recipe, product, tool or skill, tip, book or media, person, event, other) each with a small
attribute map and an optional URL, plus `claims[]`, `recommendations[]`, and `tags[]`.
Entities are stored in their own table and rendered in the chat as cards. Collections are
created automatically per category and per entity kind ("Places", "Recipes", "Tools & skills",
"Tips") and are saved queries, so nothing has to be filed by hand. Exports carry category and
entities in frontmatter so Obsidian Dataview and similar can query them. Extraction happens in
the same brain call as the research; there is no separate extraction model.

## Alternatives considered
- Tags only (ADR 0011 as written): tags cannot hold "address" or "ingredients"; lists of
  tagged items are not lists of things.
- Separate cheap extraction pass before research: doubles cost and latency for a field the
  research call already has in context.
- Vertical lists like SaveToList (fixed schemas per category): too narrow for "anything you
  scroll past"; the attribute map stays free-form with a few well-known keys per kind.

## Consequences
`Verdict` in earlier drafts is renamed `Answer` and gains `category` and `entities[]`. New
table `entities`, new `items.category` column, auto collections seeded at first boot. Output
templates gain an entities section. `save_for_later` becomes "extract and file", which is the
cheapest useful run. Later: map view over place entities, shopping-list view over products,
shareable collections (SaveToList's shared lists), and cross-library chat (Recall's one real
advantage) over FTS.
