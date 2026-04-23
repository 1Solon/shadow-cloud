FROM node:22.22.2-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

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

FROM node:22.22.2-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c AS runner

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
