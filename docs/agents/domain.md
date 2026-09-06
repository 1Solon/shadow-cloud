# Domain Docs

This repo uses a single shared domain context across all apps.

## Before Exploring

- Read `CONTEXT.md` at the repo root.
- Read ADRs in root `docs/adr/` that touch the area being explored.

If these files do not exist, proceed silently without flagging their absence or suggesting their creation upfront. `/domain-modeling`, also reached through `/grill-with-docs` and `/improve-codebase-architecture`, creates them lazily when terms or decisions are resolved.

## Layout

- `CONTEXT.md`: shared domain model and glossary.
- `docs/adr/NNNN-<decision-slug>.md`: architectural decision records.

All paths are relative to the repo root.

## Use the Glossary's Vocabulary

When naming a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term defined in `CONTEXT.md` rather than synonyms it explicitly avoids.

If a concept is missing, reconsider whether it belongs to the domain or note the gap for `/domain-modeling`.

## Flag ADR Conflicts

If a proposal contradicts an existing ADR, explicitly identify the ADR and explain why the decision is worth reopening rather than silently overriding it.
