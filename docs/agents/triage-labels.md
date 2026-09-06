# Triage Labels

The five canonical triage roles map directly to Linear issue labels.

| Canonical role | Linear label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer evaluation needed |
| `needs-info` | `needs-info` | More information needed |
| `ready-for-agent` | `ready-for-agent` | Specified for autonomous implementation |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

Reuse matching labels; create missing labels in the configured team.
Keep at most one canonical triage-role label on an issue, preserving
unrelated labels.

These labels are distinct from Linear workflow status. `ready-for-agent`
does not mean an issue is unblocked, unstarted, or incomplete; check its
workflow state and blocking relationships too.

Changing the triage role does not implicitly change workflow status.
