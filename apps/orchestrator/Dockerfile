# syntax=docker/dockerfile:1.7

# ─── Stage 1: install ─────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# openssl is required by Prisma at both build and runtime
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

# ─── Stage 2: build ───────────────────────────────────────────
FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/shared       packages/shared
COPY packages/llm-router   packages/llm-router
COPY packages/db           packages/db
COPY apps/orchestrator     apps/orchestrator

# Generate Prisma client (use `exec` — there's no "prisma" npm script in @nexusai/db).
RUN pnpm --filter @nexusai/db exec prisma generate

# Build in dependency order: shared → llm-router → db → orchestrator.
RUN pnpm --filter @nexusai/shared     build
RUN pnpm --filter @nexusai/llm-router build
RUN pnpm --filter @nexusai/db         build
RUN pnpm --filter @nexusai/orchestrator build

# ─── Stage 3: runtime ─────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# openssl required by Prisma Query Engine at runtime
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY --from=build /app .

EXPOSE 4000
CMD ["node", "apps/orchestrator/dist/index.js"]
