# Issue Tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- The spec is `.scratch/<feature-slug>/spec.md`.
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file.
- Triage state is a `Status:` line near the top of each issue file. Use the role strings in `triage-labels.md`.
- Record blocking dependencies as a `Blocked by:` line listing ticket numbers or paths.
- Append comments and conversation history under a `## Comments` heading.

## Publishing and Fetching

When a skill says "publish to the issue tracker", create the appropriate file under `.scratch/<feature-slug>/`, creating directories as needed.

When a skill says "fetch the relevant ticket", read the referenced file. If an issue number matches multiple features, ask which feature the user means.

## Wayfinding Operations

Used by `/wayfinder`. The map is a file with one child file per ticket.

- Map: `.scratch/<effort>/map.md`, containing Notes, Decisions-so-far, and Fog.
- Child ticket: `.scratch/<effort>/issues/<NN>-<slug>.md`, numbered from `01`, with the question in the body.
- A `Type:` line records `research`, `prototype`, `grilling`, or `task`.
- Wayfinding tickets use `Status: open`, `Status: claimed`, or `Status: resolved` instead of triage roles.
- Blocking: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every ticket it lists is resolved.
- Frontier: scan the effort's issues for open, unblocked tickets; lowest number wins.
- Claim: set `Status: claimed` and save before working.
- Resolve: append the answer under `## Answer`, set `Status: resolved`, and append a gist and link to Decisions-so-far in the map.
