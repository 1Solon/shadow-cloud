# Releasing

Production runs the latest published GitHub release. Merging to `main` deploys nothing.

## What a release does

Publishing a release with a semantic tag (`0.22.0`, no `v`) starts two workflows:

- `deploy.yml` builds the api, web and bot images, pushes them to `ghcr.io/1solon/shadow-cloud/<service>:<version>`, and points each Railway production service at its new image.
- `publish-desktop.yml` builds the desktop app and attaches it to the release.

The release body is the patch notes shown in the web app's "What's new" dialog.

The tag can point at any commit already in `main`, not only its head. Tag an older commit to ship part of `main` and hold back later changes.

The api applies pending Prisma migrations with `prisma migrate deploy` when its container starts, so a release with a migration changes the production database as soon as the new api boots. Write migrations that the previous release can still run against, in case of a rollback.

To redeploy an existing release, run `deploy.yml` manually with its tag.

## What is live

```sh
gh release list --limit 1                         # the live version
gh run list --workflow deploy.yml --limit 1       # whether its deploy succeeded
git log --oneline <live-tag>..origin/main         # merged but not deployed
```

## Before releasing

- The `Image (...)` CI jobs build each Dockerfile on every PR. A green `main` means the release images will build, but they have not run.
- Check the undeployed commits for behaviour that starts as soon as the new version boots, such as scheduled jobs and Discord notifications.
