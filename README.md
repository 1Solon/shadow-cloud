# Shadow Cloud

Shadow Cloud is a PBEM coordination service for Shadow Empire. This repository contains a TypeScript monorepo with a Next.js web app, a NestJS API, and a discord.js bot, each moving toward separate service ownership.

## Stack

- Next.js App Router for the web app
- NestJS for the backend API
- discord.js for the Discord bot
- Prisma with SQLite for persistence
- NextAuth with Discord OAuth for web authentication
- shadcn/ui-style component setup for the web interface
- pnpm workspaces and Turborepo for the monorepo toolchain

## Current Implementation Slice

- Monorepo scaffold with `apps/web`, `apps/api`, and `apps/bot`
- API-owned Prisma schema, migrations, seed script, and database client for users, linked identities, games, turn state, file versions, and audit events
- API-owned domain utilities for active-player resolution, next-player calculation, and rolling file retention
- Web-auth identity sync is handled through the API instead of direct database access from NextAuth callbacks
- Internal web-to-API auth calls use short-lived signed tokens instead of a shared-secret header
- API health endpoint at `/v1`
- Public API game list endpoint at `/v1/games`
- Public API game detail endpoint at `/v1/games/:gameId/detail`
- API game status endpoint at `/v1/games/:gameId/status`
- Internal bot game creation endpoint at `/v1/games/init`
- Branded web landing page with shadcn/ui-style primitives and Discord sign-in scaffolding
- Discord bot shell that boots when `DISCORD_BOT_TOKEN` is configured

## Workspace Commands

- `pnpm install` to install dependencies
- `pnpm dev` to run the monorepo dev processes
- `pnpm build` to build all packages and apps
- `pnpm format` to run Prettier formatting across the app workspaces
- `pnpm typecheck` to run TypeScript validation across the workspace

## Discord Notification Standard

- Persistent Discord thread notifications now use Discord containers with one shared structure: action-first title, compact fact block, separator, then one action block.
- Notification copy should stay brief and use the same product terms as the web UI, especially `Active lord`, `Overlord`, `world`, and `campaign ledger`.
- Mentions should target only the person who needs to act.
- Buttons are reserved for in-Discord decisions such as organizer approval, while links stay in the action block for web flows like download and upload.

## Environment

Copy values from `.env.example` into a local `.env` file and fill in real credentials for:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_BOT_TOKEN`
- `SHADOW_CLOUD_API_URL`
- `BOT_API_TOKEN`

Legacy aliases are still accepted by the current implementation:

- `AUTH_SECRET`
- `AUTH_URL`
- `AUTH_DISCORD_ID`
- `AUTH_DISCORD_SECRET`

For local Discord OAuth testing, set the callback URL in your Discord application to `http://localhost:3000/api/auth/callback/discord`.

## What Is Still Stubbed

- Prisma-backed persistence in NextAuth sign-in callbacks
- App-issued token validation in the NestJS API
- Prisma-backed persistence in the API service layer
- Organizer recovery UI and roster management flows
- File upload and download endpoints
- Discord-driven roster expansion beyond the initial organizer `/init` flow

## Project Structure

- `apps/web` - Next.js frontend
- `apps/api` - NestJS backend
- `apps/bot` - Discord bot
- `apps/api/prisma` - Prisma schema, migrations, and seed data