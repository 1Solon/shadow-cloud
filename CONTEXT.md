# Shadow Cloud

Shadow Cloud coordinates shared Shadow Empire campaigns, their players, and their turns.

## Language

**Campaign**:
A shared Shadow Empire game whose players, seats, and turns are coordinated through Shadow Cloud.

**Desktop companion**:
A local application that exchanges Campaign save files between Shadow Empire and Shadow Cloud; campaign administration remains on the website.
_Avoid_: Desktop client, desktop website

**Device session**:
A revocable, installation-specific Shadow Cloud session authorizing the Desktop companion to observe the player's Campaigns and exchange their turn saves. It does not grant Campaign-administration authority.
_Avoid_: Desktop token, API token

**Companion root**:
The player-selected parent directory in which the Desktop companion creates and rediscovers its Campaign folders. The Desktop companion owns neither the Companion root nor unrelated contents within it.
_Avoid_: Save root, target directory

**Campaign folder**:
The uniquely identified, marker-owned directory for one Campaign inside the Companion root. It contains that Campaign's incoming and outgoing save files and is never merged with an unrelated existing directory.
_Avoid_: Game folder

**Received save**:
Save-file contents downloaded from Shadow Cloud and recorded by the Desktop companion so that renaming or copying the file does not make it local turn work.

**Canonical save**:
The save-file contents currently accepted by Shadow Cloud as the basis for continuing a Campaign. An administrative replacement can change the Canonical save without completing another turn.
_Avoid_: Latest save

**Save publication**:
The durable, ordered record that an accepted Turn submission established a new Canonical save for a Campaign. A later administrative replacement changes the canonical contents associated with that publication rather than publishing another turn.

**Turn candidate**:
New or changed save-file contents in a Campaign folder that the Desktop companion does not recognize as a Received save or a previously sent submission. A Turn candidate is not necessarily a completed turn.
_Avoid_: Send candidate, outgoing save, pending save

**Ignored candidate**:
A Turn candidate whose exact contents the player has reversibly excluded from sending. A changed file has new contents and is therefore a new Turn candidate.

**Turn submission**:
The exact Campaign save contents a seated player authorizes the Desktop companion to publish as their completed turn. It remains bound to the account, Campaign state, and save identity against which it was authorized.

**Stale submission**:
A Turn submission whose accepted turn, Seat, permission, or Roster state has changed while Shadow Cloud's latest save identity remains unchanged. It requires revalidation but is not a Save conflict.

**Save conflict**:
A condition in which Shadow Cloud's latest Campaign save changes after local turn work has begun. Neither version supersedes the other automatically, and sending local work remains blocked until the conflict is resolved.

**Campaign number**:
The changeable, human-facing number identifying a campaign; changing the number does not create a different campaign.

**Seat**:
A position in a campaign's turn order that can be occupied by a player or left open.

**Roster**:
A campaign's seats, their order, and their occupants.

**Accepted Roster**:
The authoritative account of a campaign's roster and active seat currently accepted for Seat Order editing. It can become newer than an existing Seat Order draft without changing that draft's captured baseline.

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

**Registration preview**:
An inert example of a registration response, matching its production presentation while using sample details and controls that cannot execute a registration decision.
