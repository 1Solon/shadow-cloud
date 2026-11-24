# In-app turn state repair

Shadow Cloud has no in-app way to repair a broken turn state. If a campaign's turn ever gets into such a state, it is fixed by hand in the database.

A broken turn state is one where every turn mutation refuses to run because the turn-record check fails. That happens in two cases:

- **Unresolvable turn state:** the turn state doesn't name exactly one seat whose occupant is the active player. Error: "The active turn could not be resolved."
- **Turn record mismatch:** there isn't exactly one open turn record, or it doesn't match the turn state's seat, player and round. Error: "The open turn record does not match the active turn state."

## Why this is out of scope

Every writer updates the turn state, the roster and the turn records together in one transaction, so a broken turn state can only come from a bug, legacy data or a manual database edit. One has never happened in production.

A repair tool would be a second way to write turn state, and it would have to bypass the very check that stops mutations from acting on an inconsistent turn. Building and maintaining that path, deciding who may use it, and choosing what it does to open turn records, the round and the turn timer, all cost more than the occasional manual fix it would replace. The better investment is keeping broken states from arising: the turn-rotation module (#129) and the single active-seat rule (#135).

If broken turn states start appearing in production, that is a bug to fix at its source. It is also new evidence, so reopen this decision then.

## Prior requests

- #136: "Let a broken turn state be repaired from the app"
