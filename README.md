<div align="center">

# Shadow Cloud

_Shadow Cloud is a Discord Bot, API and Website hybrid that aims to support players of Shadow Empires share games._

![GitHub Repo stars](https://img.shields.io/github/stars/1Solon/shadow-cloud?style=for-the-badge)
![GitHub forks](https://img.shields.io/github/forks/1Solon/shadow-cloud?style=for-the-badge)

</div>

---

## How do I access this?

I run a hosted version via [The War of the Worlds discord](https://discord.gg/WjYatWDdg3) and [shadow-cloud.solonsstuff.com](https://shadow-cloud.solonsstuff.com)

Please notify me if any of the above links ever die!

## What does this do?

Currently, Shadow Cloud does the following:

* Track running Shadow Empire games
* Notify players of when their turn is
* Facilitate the managing, running and administration of Shadow Empire games

This is accomplished with a Discord bot, Frontend and API. All functions (with some exceptions where it does not make sense) can be utilized through any of the three interfaces.

## How do I host this?

It's generally recommended you join the above discord and use the above bot, instances do not communicate with each other- and it's better if this service is not fragmented, however if you want to run it yourself- for either development or otherwise, here's a guide!

### Shared Configuration

Shadow Cloud expects a root `.env` file.

```env
DATABASE_URL="file:./dev.db"
AUTH_URL="http://localhost:3000"
AUTH_SECRET="replace-with-a-long-random-secret"
AUTH_DISCORD_ID="your-discord-oauth-client-id"
AUTH_DISCORD_SECRET="your-discord-oauth-client-secret"
DISCORD_BOT_TOKEN="your-discord-bot-token"
SHADOW_CLOUD_API_URL="http://localhost:3001"
BOT_API_TOKEN="replace-with-a-shared-api-token"
SHADOW_CLOUD_BOT_NOTIFY_SECRET="replace-with-a-shared-notify-secret"
SHADOW_OVERRIDE_DISCORD_ROLE_ID="your-shadow-role-id"
```

Notes:

* `AUTH_SECRET` is used by the web app and API for authentication.
* `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET` are the Discord OAuth app credentials used for sign-in.
* `DISCORD_BOT_TOKEN` is the token for the Discord bot itself.
* `BOT_API_TOKEN` and `SHADOW_CLOUD_BOT_NOTIFY_SECRET` must match across the bot and API because they are used for bot-authenticated requests and notification webhooks.
* `SHADOW_OVERRIDE_DISCORD_ROLE_ID` enables the web/API Shadow override for users who hold that Discord role in any Discord guild currently linked to Shadow Cloud.

### Running With PNPM

This is the easiest way to run the project locally for development.

Prerequisites:

* Node.js 22+
* `pnpm` 10+

1. Install dependencies:

	```bash
	pnpm install
	```

2. Start the full workspace in dev mode:

	```bash
	pnpm dev
	```

This starts the API, web app, and bot through the monorepo's Turbo pipeline.

By default, the services are available at:

* Web: `http://localhost:3000`
* API: `http://localhost:3001/v1`

The SQLite database will be created from `DATABASE_URL`, and the API will run Prisma generate during its build/dev lifecycle. If you point `DATABASE_URL` at a new file and need to apply schema changes manually, run:

```bash
pnpm --filter @shadow-cloud/api prisma:migrate
```

### Running With Docker

The repository includes a single `docker-compose.yml` that works for both local and hosted deployments.

Prerequisites:

* Docker Desktop or another Docker Engine install with Compose support
* Optional: shell environment variables or a custom Compose env file if you want to override the built-in defaults
* Access to the published GHCR images if you are deploying from a private repository

The compose file does not require a root `.env` file. It provides inline example defaults in the actual service definitions, and you can override them with normal Docker Compose environment handling.

For a local containerized run:

```bash
docker compose up
```

This publishes:

* Web on `http://localhost:3000`
* API on `http://localhost:3001/v1`

The API stores its SQLite database and uploaded save data in the named Docker volume `shadow-cloud-data`.

For a hosted deployment, provide real values for the auth and Discord variables and then run:

```bash
docker compose pull
docker compose up -d
```

Example override patterns:

* `docker compose --env-file compose.env pull && docker compose --env-file compose.env up -d`
* `AUTH_URL=https://shadow-cloud.example.com docker compose up -d`

Optional runtime overrides:

* `AUTH_URL` to set the public web URL
* `AUTH_SECRET` to set the shared auth secret used by the web app and API
* `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET` to enable Discord sign-in
* `DISCORD_BOT_TOKEN` to enable the Discord bot
* `BOT_API_TOKEN` and `SHADOW_CLOUD_BOT_NOTIFY_SECRET` to secure bot-to-API traffic
* `SHADOW_OVERRIDE_DISCORD_ROLE_ID` to enable the Shadow override role check
* `SHADOW_CLOUD_WEB_PORT` to change the published web port
* `SHADOW_CLOUD_API_PORT` to change the published API port

To stop the stack:

```bash
docker compose down
```

