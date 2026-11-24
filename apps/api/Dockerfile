FROM node:26.13.1-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# renovate: datasource=npm depName=corepack
ARG COREPACK_VERSION=0.36.0
RUN npm install --global corepack@$COREPACK_VERSION \
  && corepack enable

FROM base AS deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --filter @shadow-cloud/api... --frozen-lockfile

FROM deps AS build

WORKDIR /workspace

COPY apps/api apps/api

ENV DATABASE_URL=file:/data/shadow-cloud.db

RUN pnpm --dir apps/api exec prisma generate --schema prisma/schema.prisma
RUN pnpm --dir apps/api exec nest build

FROM node:26.13.1-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9 AS runner

ARG SHADOW_CLOUD_VERSION
ENV SHADOW_CLOUD_VERSION=$SHADOW_CLOUD_VERSION
LABEL org.opencontainers.image.version=$SHADOW_CLOUD_VERSION

ENV NODE_ENV=production
ENV PORT=3001
ENV PATH=/workspace/apps/api/node_modules/.bin:/workspace/node_modules/.bin:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api ./apps/api
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules

WORKDIR /workspace/apps/api

EXPOSE 3001

CMD ["sh", "-c", "prisma migrate deploy --schema prisma/schema.prisma && node dist/main"]
