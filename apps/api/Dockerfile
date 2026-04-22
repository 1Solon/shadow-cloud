FROM node:22-bookworm-slim AS base

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

FROM node:22-bookworm-slim AS runner

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
ENV PORT=3001

RUN corepack enable

WORKDIR /workspace

COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api ./apps/api

WORKDIR /workspace/apps/api

EXPOSE 3001

CMD ["sh", "-c", "pnpm exec prisma migrate deploy --schema prisma/schema.prisma && node dist/main"]
