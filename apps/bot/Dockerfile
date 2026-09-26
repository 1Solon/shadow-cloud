FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

RUN corepack enable

FROM base AS deps

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/bot/package.json apps/bot/package.json

RUN pnpm install --filter @shadow-cloud/bot... --frozen-lockfile

FROM deps AS build

WORKDIR /workspace

COPY apps/bot apps/bot

RUN pnpm --dir apps/bot exec tsc -p tsconfig.json

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runner

ARG SHADOW_CLOUD_VERSION
ENV SHADOW_CLOUD_VERSION=$SHADOW_CLOUD_VERSION
LABEL org.opencontainers.image.version=$SHADOW_CLOUD_VERSION

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

RUN corepack enable

WORKDIR /workspace

COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/bot ./apps/bot

WORKDIR /workspace/apps/bot

EXPOSE 3011

CMD ["node", "dist/index.js"]
