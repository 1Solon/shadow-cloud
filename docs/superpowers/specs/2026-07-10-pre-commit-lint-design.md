# Pre-Commit Validation Hook Design

## Goal

Run the repository's full Turbo lint and test pipelines before every commit and reject the commit when either pipeline fails. The hook configuration must be tracked so all contributors receive it after installing dependencies.

## Design

Use Husky to manage the Git hook. Add Husky as a root development dependency and add a root `prepare` script that installs the tracked hooks during `pnpm install`.

Create `.husky/pre-commit` with `pnpm lint && pnpm test`. The existing root scripts delegate to `turbo run lint` and `turbo run test`, keeping the hook aligned with normal local and CI commands without duplicating pipeline configuration. Lint runs first, and tests run only when lint succeeds.

## Behavior

- Successful lint and test runs permit the commit.
- A lint failure blocks the commit without running tests.
- A test failure blocks the commit.
- Git's standard `--no-verify` option remains available for deliberate bypasses.
- Contributors must run `pnpm install` after pulling the configuration so Husky can install the hook in their local clone.

## Verification

- Install dependencies and confirm Husky configures the repository hook.
- Run the hook directly and confirm the current lint and test pipelines succeed.
- Temporarily substitute a failing command when testing hook propagation, if needed; do not retain that change.
- Run the repository's normal lint and test commands after implementation.

## Scope

This change adds only the pre-commit lint and test hook. It does not add staged-file filtering, formatting, type checking, or pre-push behavior.
