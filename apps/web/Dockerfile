FROM node:24.15.0-bookworm-slim@sha256:03eae3ef7e88a9de535496fb488d67e02b9d96a063a8967bae657744ecd513f2 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

FROM base AS deps

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --filter @shadow-cloud/web... --frozen-lockfile

FROM deps AS build

WORKDIR /workspace

COPY apps/web apps/web

ENV NEXTAUTH_SECRET=docker-build-secret
ENV NEXTAUTH_URL=http://localhost:3000
ENV AUTH_URL=http://localhost:3000
ENV DISCORD_CLIENT_ID=docker-build-client-id
ENV DISCORD_CLIENT_SECRET=docker-build-client-secret
ENV SHADOW_CLOUD_API_URL=http://api:3001

RUN pnpm --dir apps/web exec next build

FROM node:24.15.0-bookworm-slim@sha256:03eae3ef7e88a9de535496fb488d67e02b9d96a063a8967bae657744ecd513f2 AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=build /workspace/apps/web/.next/standalone ./
COPY --from=build /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /workspace/apps/web/public ./apps/web/public

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["sh", "-c", "export NEXT_DEPLOYMENT_ID=\"${NEXT_DEPLOYMENT_ID:-$(cat .next/BUILD_ID)}\"; exec node server.js"]
