# Companion save safety

The previous desktop sync implementation and its handoff were removed as part
of the greenfield Companion rebuild. Its implementation-specific instructions
and regression-test paths no longer describe the application.

See [the Companion developer guide](../apps/desktop/README.md) for the current
foundation, checks, and limitations. The accepted rebuild is tracked in
[SOL-29](https://linear.app/1solon/issue/SOL-29/spec-rebuild-shadow-cloud-companion-as-a-greenfield-cross-platform-app).
The foundation does not transfer any saves yet.

The replacement engine must preserve the server's correction semantics: password
reset and undo can change the canonical save without advancing the turn or
changing the file-version ID. Revision and content identity, not timestamps or
filenames alone, determine which bytes were received. Never overwrite local
work, silently retry a rejected Turn submission, or treat a newer baseline as
conflict resolution. These behaviors are implemented and tested through the
engine and Companion HTTP seams in the receive, submit, and recovery milestones.

The governing decisions are [save provenance](adr/0002-track-save-provenance-in-flat-campaign-folders.md),
[the Rust engine](adr/0003-run-a-deep-companion-engine-in-rust.md),
[coherent server contracts](adr/0005-add-coherent-companion-server-contracts.md),
and [publication archiving](adr/0007-archive-future-save-publications-locally.md).
Existing server database migration history is retained. In-game correctness is
not established by browser checks or synthetic save tests.
