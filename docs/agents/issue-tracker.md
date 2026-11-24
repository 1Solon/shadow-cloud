# Issue Tracker: GitHub Issues

GitHub Issues on `1Solon/shadow-cloud` is the source of truth for this repo's
issues and specs.

## Destination

- Repository: `1Solon/shadow-cloud`
- Issues URL: https://github.com/1Solon/shadow-cloud/issues

## Access

Use the `gh` CLI, authenticated as the user. Check the connection with
`gh auth status`. Use `gh issue` for issues, labels and comments, and
`gh api` for sub-issues and blocking relationships.

If `gh` is unauthenticated, ask the user to run `gh auth login`. Do not create
a second tracker under `.scratch/` or elsewhere.

Keep credentials out of repository files and issue bodies.

## Fetching Work

Resolve the supplied issue number or URL with
`gh issue view <n> --comments`, then read the parent spec, sub-issues and
blocking relationships:

- Parent: `gh api repos/1Solon/shadow-cloud/issues/<n>/parent`
- Sub-issues: `gh api repos/1Solon/shadow-cloud/issues/<n>/sub_issues`
- Blockers: `gh api repos/1Solon/shadow-cloud/issues/<n>/dependencies/blocked_by`

Older references such as `SOL-24` point to the retired Linear workspace at
https://linear.app/1solon. Treat them as history, not active work.

## Publishing Work

- Publish approved specs as parent issues.
- Publish implementation tickets as sub-issues of their spec. Attach a child
  with `gh api -X POST repos/1Solon/shadow-cloud/issues/<parent>/sub_issues
  -F sub_issue_id=<child database id>`; get the id from
  `gh api repos/1Solon/shadow-cloud/issues/<child> --jq .id`.
- Record dependencies as native blocking relationships with
  `gh api -X POST repos/1Solon/shadow-cloud/issues/<n>/dependencies/blocked_by
  -F issue_id=<blocker database id>`, not only as prose.
- Apply triage labels according to `triage-labels.md`.
- Leave new issues open and unassigned unless the user asks otherwise.
- Preserve acceptance criteria, decisions, and verification requirements.
- Return created issue numbers and URLs.

Before retrying publication, search for an existing matching issue with
`gh issue list --search` and resume incomplete work instead of creating
duplicates.

## Working Tickets

Implementation normally targets a child ticket, not its entire parent spec.
An actionable ticket has `ready-for-agent`, is open, is unassigned or assigned
to the user, and has no open blockers. Check live state before beginning.

Record progress, decisions, and verification as issue comments. Keep triage
labels separate from open/closed state. Do not close a parent spec when a
child ticket completes.

## Wayfinding

Keep the decision map in a parent issue and decision tickets as sub-issues.
Use native blocking relationships. Retain ticket type and decision phase
(open, claimed, resolved) in the bodies, and record answers and links back
to the map as decisions resolve.
