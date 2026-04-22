FROM node:22-bookworm-slim AS base

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

FROM node:22-bookworm-slim AS runner

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

RUN corepack enable

WORKDIR /workspace

COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/web ./apps/web

WORKDIR /workspace/apps/web

EXPOSE 3000

CMD ["pnpm", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
