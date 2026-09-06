# Issue Tracker: Linear

Linear is the source of truth for this repo's issues and specs.

## Destination

- Workspace: Solon (`1solon`)
- Team: Solon
- Project: `shadow-cloud`
- Project URL:
  https://linear.app/1solon/project/shadow-cloud-0e60a72e8c17/overview

## Access

Prefer the official Linear MCP server configured globally as `linear` in
`~/.config/opencode/opencode.jsonc`, using `https://mcp.linear.app/mcp` with
automatic OAuth. This repo does not duplicate that server in project config.

For initial authorization, run `opencode mcp auth linear`
and approve access to the Solon workspace in the browser. Check the connection
with `opencode mcp list`. OAuth credentials stay in OpenCode's user-level auth
storage, not in this repo. Quit and restart the OpenCode backend after changing
MCP configuration so subsequent sessions load the tools.

Use authenticated browser access only when MCP is unavailable and the browser
controls demonstrably work; reading a page is not proof a write succeeded.

If access is unavailable, ask the user to reconnect. Do not silently publish
to GitHub or create a second active tracker under `.scratch/`.

Keep credentials out of repository files and issue descriptions.

## Fetching Work

Resolve the supplied Linear identifier or URL, then read the complete
description, relevant comments, parent spec, and blocking relationships.

For a legacy local source path, resolve its canonical Linear issue through
`.scratch/linear-migration.md`, then fetch live content and status. The initial
local source copies were removed after verified migration at the user's request.

## Publishing Work

- Publish approved specs as parent issues in the configured team and project.
- Publish implementation tickets as sub-issues of their spec.
- Use native Linear blocking relationships, not only prose dependencies.
- Apply triage labels according to `triage-labels.md`.
- Leave new issues in the team's default unstarted workflow state unless
  the user requests another state.
- Preserve acceptance criteria, decisions, and verification requirements.
- Return created issue identifiers and URLs.

Before retrying publication, check for an existing matching issue and consult
`.scratch/linear-migration.md`. Resume incomplete work instead of creating
duplicates.

## Working Tickets

Implementation normally targets a child ticket, not its entire parent spec.
An actionable ticket has `ready-for-agent`, is unstarted, and has completed
blockers. Check live tracker state before beginning.

Record progress, decisions, and verification in Linear. Keep triage labels
separate from workflow status. Do not automatically close a parent spec
when a child ticket completes.

## Wayfinding

Keep the decision map in a parent issue and decision tickets as sub-issues.
Use native blocking relationships. Retain ticket type and decision phase
(open, claimed, resolved) in the descriptions, and record answers and links
back to the map as decisions resolve.

## Migration Record

`.scratch/linear-migration.md` retains the original source-to-Linear mapping,
including parent and blocking relationships. Its source paths are provenance,
not local files to reopen. The three migrated specs and ten local ticket copies
were removed with explicit user approval after publication was verified.

Update active work in Linear, not in duplicate local specs or tickets. For any
future migration, record canonical identifiers and URLs as publication proceeds;
remove source copies only after verification and explicit permission.
