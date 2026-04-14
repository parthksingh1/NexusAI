# syntax=docker/dockerfile:1.7
#
# Robust single-path deployment build:
#   1. Build all workspace packages with pnpm (uses the lockfile cleanly).
#   2. `pnpm pack` each workspace dep into a tarball — this respects the "files"
#      field AND rewrites workspace:* deps into concrete versions automatically.
#   3. Assemble a clean /app/out directory with orchestrator's compiled output +
#      a rewritten package.json pointing at those tarballs.
#   4. Plain `npm install` produces a flat node_modules (no pnpm, no symlinks).
#   5. Regenerate the Prisma client so the Query Engine has schema-specific code.
#   6. Sanity-check every critical path before the image is published.

# ─── Stage 1: install workspace deps ──────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app

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

RUN pnpm --filter @nexusai/db exec prisma generate
RUN pnpm --filter @nexusai/shared     build
RUN pnpm --filter @nexusai/llm-router build
RUN pnpm --filter @nexusai/db         build
RUN pnpm --filter @nexusai/orchestrator build

# ─── Stage 3: pack workspace deps as standard npm tarballs ────
# pnpm pack resolves workspace:* refs to concrete versions.
# Output files follow the pattern: <scope>-<name>-<version>.tgz
RUN mkdir -p /tmp/pkgs \
 && (cd packages/shared     && pnpm pack --pack-destination /tmp/pkgs) \
 && (cd packages/llm-router && pnpm pack --pack-destination /tmp/pkgs) \
 && (cd packages/db         && pnpm pack --pack-destination /tmp/pkgs) \
 && ls -la /tmp/pkgs

# ─── Stage 4: assemble a clean deploy directory ───────────────
RUN mkdir -p /app/out/dist /app/out/prisma \
 && cp -r apps/orchestrator/dist/. /app/out/dist/ \
 && cp apps/orchestrator/package.json /app/out/package.json \
 && cp -r packages/db/prisma/. /app/out/prisma/

# Rewrite orchestrator's package.json to reference the packed tarballs by
# absolute path. Also drop workspace-scoped devDependencies (not needed at runtime).
RUN cd /app/out && node -e "                                    \
    const fs = require('fs');                                   \
    const path = require('path');                               \
    const p = JSON.parse(fs.readFileSync('package.json','utf8'));\
    const pkgDir = '/tmp/pkgs';                                 \
    const files = fs.readdirSync(pkgDir);                       \
    function find(pkg) {                                        \
      const key = pkg.replace('@','').replace('/','-') + '-';   \
      const hit = files.find(f => f.startsWith(key) && f.endsWith('.tgz'));\
      if (!hit) throw new Error('tarball not found for ' + pkg);\
      return 'file:' + path.join(pkgDir, hit);                  \
    }                                                           \
    for (const k of Object.keys(p.dependencies || {})) {        \
      if (k.startsWith('@nexusai/')) p.dependencies[k] = find(k);\
    }                                                           \
    delete p.devDependencies;                                   \
    delete p.scripts;                                           \
    p.scripts = { start: 'node dist/index.js' };                \
    fs.writeFileSync('package.json', JSON.stringify(p, null, 2));"

# ─── Stage 5: npm install — flat node_modules, no pnpm, no symlinks ──
WORKDIR /app/out
RUN npm install --omit=dev --no-package-lock --no-audit --no-fund --loglevel=warn

# Regenerate the Prisma client inside the flat bundle.
RUN npx --yes prisma@5.22.0 generate --schema=prisma/schema.prisma

# ─── Stage 6: hard sanity checks — fail loudly if anything's missing ──
RUN set -e; \
    echo "── Verifying deploy bundle ──"; \
    for p in fastify @fastify/cors @fastify/websocket ioredis kafkajs pino zod uuid neo4j-driver stripe; do \
      test -f "node_modules/$p/package.json" || (echo "❌ missing third-party dep: $p" && exit 1); \
    done; \
    test -f node_modules/@nexusai/shared/dist/index.js     || (echo "❌ missing @nexusai/shared/dist/index.js" && exit 1); \
    test -f node_modules/@nexusai/llm-router/dist/index.js || (echo "❌ missing @nexusai/llm-router/dist/index.js" && exit 1); \
    test -d node_modules/@nexusai/db                       || (echo "❌ missing @nexusai/db" && exit 1); \
    test -d node_modules/.prisma/client || test -d node_modules/@prisma/client/runtime \
      || (echo "❌ Prisma client not generated" && exit 1); \
    test -f dist/index.js                                  || (echo "❌ missing orchestrator entry" && exit 1); \
    echo "✔ deploy bundle complete"

# ─── Stage 7: runtime image ───────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/out .

EXPOSE 4000
CMD ["node", "dist/index.js"]
