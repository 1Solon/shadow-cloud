# Coding Standards

Review applies these rules. Each is a judgement call. `pnpm lint` and `pnpm typecheck` enforce formatting, lint rules and types.

## Comments

Write a comment only to explain a non-obvious why: a constraint, an ordering requirement, a gotcha. Let names carry the what.

## Domain vocabulary

New identifiers, parameters, user-facing messages, test names and docs use the terms defined in `CONTEXT.md`, not the synonyms listed under a term's _Avoid_. Existing schema names such as `organizerId` and `GameRole.ORGANIZER` stay until a migration renames them; new APIs take Overlord names (`overlordId`).

## Overlord authority

- Discord commands that need the Overlord check the caller with `resolveOverlordCommandCaller` and `authorizeOverlordCommand` in `apps/api/src/games/support/overlord-command-authority.ts`, which also admit a Shadow Lord.
- Web Overlord actions also admit a Shadow Lord under Shadow Override, through `isUserShadowOverride`.

Flag any new hand-written comparison against `organizerId` that leaves out the Shadow Lord path.
