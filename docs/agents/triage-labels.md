# Triage Labels

Map the five canonical triage roles to these `Status:` values in local issue files.

| Canonical role | Tracker status | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate the issue |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an autonomous agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill says to apply a triage label, update the issue's `Status:` line using this mapping.

Edit the Tracker status column to change the vocabulary.
