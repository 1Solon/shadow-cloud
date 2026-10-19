# Shadow Cloud

Shadow Cloud coordinates shared Shadow Empire campaigns, their players, and their turns.

## Language

**Campaign**:
A shared Shadow Empire game whose players, seats, and turns are coordinated through Shadow Cloud.

**Campaign number**:
The changeable, human-facing number identifying a campaign; changing the number does not create a different campaign.

**Tagline**:
An optional one-line summary of a campaign, up to 40 characters, set by its Overlord and shown after the campaign name.

**Seat**:
A position in a campaign's turn order that can be occupied by a player or left open.

**Roster**:
A campaign's seats, their order, and their occupants.

**Turn**:
One player's play, from receiving the save to uploading the next one.

**Round**:
The turns in which every occupied seat plays once.

**Save**:
A Shadow Empire game file uploaded to a campaign at the end of a turn.

**Save retention limit**:
The number of most recent saves a campaign keeps; older saves are permanently deleted. One limit applies to every campaign.
_Avoid_: Save cap, history limit, max saves

**Pruned save**:
A save permanently deleted for falling outside the save retention limit. Its number and fingerprint are remembered so it can still be recognised, but it can no longer be downloaded.

**Save rejection**:
Discarding the latest save and returning the turn to the seat that uploaded it, with that seat's turn time resuming where it stopped. Only possible during the turn that save started, by the receiving seat, the uploader, the Overlord, or a Shadow Lord under Shadow Override.

**Accepted Roster**:
The authoritative account of a campaign's roster and active seat currently accepted for Seat Order editing. It can become newer than an existing Seat Order draft without changing that draft's captured baseline.

**Victory**:
The Overlord's or a Shadow Lord's designation of a seated player as a campaign's victor, which concludes the campaign.

**Victor**:
The player designated by a victory as having won a campaign.
_Avoid_: Winner

**Concluded campaign**:
A campaign whose victory has been designated and that is awaiting deletion at the end of a grace period, during which saves may only be downloaded and the victory may be undone.

**Victory record**:
The lasting record of a campaign's victor, which outlives the deleted campaign.

**Activity**:
Anything that moves a campaign forward: a save upload, a save rejection, a turn ending for any other reason, a roster change, or undoing a victory. Downloads and edits to notes, tagline, or settings are not activity.
_Avoid_: Last updated

**Inactivity warning**:
Notice to every seated player that a campaign has had no activity for 30 days and will be deleted 30 days after the notice unless activity happens.

**Final inactivity warning**:
The second notice to a dormant campaign's seated players, given 2 days before its inactivity deletion.

**Dormant campaign**:
A campaign with an outstanding inactivity warning. Any activity ends dormancy and restarts the 30 days. Concluded campaigns never become dormant.
_Avoid_: Inactive, abandoned, closed, archived

**Inactivity deletion**:
The permanent deletion of a dormant campaign, including its saves, roster, and history, once its warning period ends without activity. Unlike a victory, nothing of the campaign remains.

**Regime**:
A nation inside a Shadow Empire game, controlled by a human or the game AI. A regime is distinct from a Shadow Cloud seat and the player occupying that seat.

**In-game password**:
The password protecting access to a human-controlled regime inside Shadow Empire, distinct from authentication to Shadow Cloud.

**In-game password reset**:
An Overlord-authorized replacement of a human-controlled regime's in-game password without requiring the old password or the affected player's approval.

**Seat Order draft**:
A proposed change to a campaign's roster or active seat, based on the campaign state presented when the draft was loaded.

**Stale seat edit**:
A Seat Order draft whose baseline predates a change to the roster, Overlord ownership or seat roles, or active turn, even if those changes were subsequently reversed. Changes only to display names, campaign notes, or reminder settings do not make a seat edit stale.

**Overlord**:
The player responsible for organizing and administering a campaign.
_Avoid_: Host, organizer

**Overlord transfer**:
Reassignment of campaign control to another eligible player in that campaign.

**Shadow Lord**:
A person who administers Shadow Cloud itself and may arm Shadow Override.
_Avoid_: Administrator, admin, privileged user

**Shadow Override**:
A per-session mode in which a Shadow Lord holds an Overlord's authority in any campaign, plus the power to delete campaigns. Designating or undoing a victory from Discord needs no armed session; holding the Shadow Lord role is enough.
_Avoid_: Override mode, admin mode

**Registration preview**:
An inert example of a registration response, matching its production presentation while using sample details and controls that cannot execute a registration decision.
