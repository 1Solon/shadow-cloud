# Victory deletes the campaign

Once a campaign has a victor, nothing about it is needed again except who won, and its saves are the largest thing Shadow Cloud stores. So when a victory's grace period ends we delete the whole campaign (saves, roster, turn records, and audit log) rather than archiving it, and keep only a victory record that stores its own copy of the campaign's number and name. The grace period is the only chance to download saves or undo the victory; after it, the result is all that remains.
