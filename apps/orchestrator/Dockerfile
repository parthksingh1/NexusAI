# syntax=docker/dockerfile:1.7

# ─── Stage 1: install workspace deps ──────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# openssl required by Prisma (build + runtime)
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY packages/shared/package.json       packages/shared/
COPY packages/llm-router/package.json   packages/llm-router/
COPY packages/db/package.json           packages/db/
COPY apps/orchestrator/package.json     apps/orchestrator/

RUN pnpm install --frozen-lockfile=false

# ─── Stage 2: build all workspace packages ────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared       packages/shared
COPY packages/llm-router   packages/llm-router
COPY packages/db           packages/db
COPY apps/orchestrator     apps/orchestrator

RUN pnpm --filter @nexusai/db exec prisma generate

RUN pnpm --filter @nexusai/shared     build
RUN pnpm --filter @nexusai/llm-router build
RUN pnpm --filter @nexusai/db         build
RUN pnpm --filter @nexusai/orchestrator build

# `pnpm deploy` produces a self-contained bundle at /app/out:
#   - flattens workspace symlinks (copies the ACTUAL built source of shared/llm-router/db)
#   - installs only production dependencies into a real node_modules/
#   - the result runs with plain `node dist/index.js` — no pnpm needed at runtime
RUN pnpm --filter @nexusai/orchestrator deploy --prod /app/out

# Ship the Prisma schema alongside so the Query Engine can find it at runtime.
RUN mkdir -p /app/out/prisma && cp -r packages/db/prisma/. /app/out/prisma/

# `pnpm deploy --prod` reinstalls @prisma/client fresh, so the schema-specific
# generated client is gone. Regenerate it inside the bundle so runtime has the
# right query types + binary engine.
RUN cd /app/out && npx --yes prisma@5.22.0 generate --schema=prisma/schema.prisma

# ─── Stage 3: lean runtime image ──────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/out .

EXPOSE 4000
CMD ["node", "dist/index.js"]
