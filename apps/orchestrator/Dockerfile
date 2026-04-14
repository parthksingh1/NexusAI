# syntax=docker/dockerfile:1.7
#
# Deterministic orchestrator build — no pnpm/symlinks/tsbuildinfo at runtime.
#
# ORDER MATTERS: npm install prunes anything in node_modules/ that isn't declared
# in package.json. That includes our @nexusai/* workspace packages. Therefore:
#   1. build all TypeScript
#   2. assemble orchestrator's merged package.json (third-party deps only)
#   3. `npm install` — creates a clean flat node_modules
#   4. ONLY THEN copy the @nexusai/* built packages into node_modules
#   5. regenerate Prisma
#   6. sanity-check everything

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

# ─── Stage 2: build all TypeScript packages ───────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared       packages/shared
COPY packages/llm-router   packages/llm-router
COPY packages/db           packages/db
COPY apps/orchestrator     apps/orchestrator

RUN find . -name "*.tsbuildinfo" -delete 2>/dev/null || true

RUN pnpm --filter @nexusai/db exec prisma generate

RUN cd packages/shared     && pnpm exec tsc -p tsconfig.json
RUN cd packages/llm-router && pnpm exec tsc -p tsconfig.json
RUN cd packages/db         && pnpm exec tsc -p tsconfig.json
RUN cd apps/orchestrator   && pnpm exec tsc -p tsconfig.json

RUN set -e; \
    echo "── Verifying tsc emits ──"; \
    for p in packages/shared packages/llm-router packages/db apps/orchestrator; do \
      if [ ! -f "$p/dist/index.js" ]; then \
        echo "❌ $p/dist/index.js missing"; \
        ls -la "$p/dist" 2>/dev/null || echo "   (no dist dir)"; \
        exit 1; \
      fi; \
      echo "   ✔ $p/dist/index.js"; \
    done

# ─── Stage 3: assemble minimal deploy shell ───────────────────
# At this point /app/out contains just orchestrator's compiled code + package.json
# (with merged prod deps, no @nexusai/* entries).
RUN mkdir -p /app/out/dist /app/out/prisma \
 && cp -r apps/orchestrator/dist/. /app/out/dist/ \
 && cp apps/orchestrator/package.json /app/out/package.json \
 && cp -r packages/db/prisma/. /app/out/prisma/

RUN cd /app/out && node -e "                                    \
    const fs = require('fs');                                   \
    const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8')); \
    const orch = read('package.json');                          \
    const workspaceDeps = [                                     \
      '/app/packages/shared/package.json',                      \
      '/app/packages/llm-router/package.json',                  \
      '/app/packages/db/package.json',                          \
    ].map(read);                                                \
    orch.dependencies = orch.dependencies || {};                \
    for (const pkg of workspaceDeps) {                          \
      for (const [k, v] of Object.entries(pkg.dependencies || {})) { \
        if (k.startsWith('@nexusai/')) continue;                \
        if (!orch.dependencies[k]) orch.dependencies[k] = v;    \
      }                                                         \
    }                                                           \
    for (const k of Object.keys(orch.dependencies)) {           \
      if (k.startsWith('@nexusai/')) delete orch.dependencies[k]; \
    }                                                           \
    delete orch.devDependencies;                                \
    orch.scripts = { start: 'node dist/index.js' };             \
    fs.writeFileSync('package.json', JSON.stringify(orch, null, 2)); \
    console.log('Merged deps:', Object.keys(orch.dependencies).sort().join(', '));"

# ─── Stage 4: npm install FIRST — creates clean flat node_modules ──
WORKDIR /app/out
RUN npm install --omit=dev --no-package-lock --no-audit --no-fund --loglevel=warn

# ─── Stage 5: NOW place the workspace packages into node_modules ─
# Anything placed here survives because npm install already finished.
RUN mkdir -p /app/out/node_modules/@nexusai/shared \
             /app/out/node_modules/@nexusai/llm-router \
             /app/out/node_modules/@nexusai/db

RUN cp    /app/packages/shared/package.json     /app/out/node_modules/@nexusai/shared/package.json \
 && cp -r /app/packages/shared/dist             /app/out/node_modules/@nexusai/shared/dist

RUN cp    /app/packages/llm-router/package.json /app/out/node_modules/@nexusai/llm-router/package.json \
 && cp -r /app/packages/llm-router/dist         /app/out/node_modules/@nexusai/llm-router/dist

RUN cp    /app/packages/db/package.json         /app/out/node_modules/@nexusai/db/package.json \
 && cp -r /app/packages/db/dist                 /app/out/node_modules/@nexusai/db/dist \
 && cp -r /app/packages/db/src                  /app/out/node_modules/@nexusai/db/src \
 && cp -r /app/packages/db/prisma               /app/out/node_modules/@nexusai/db/prisma

# Strip workspace:* refs from each copied package.json.
RUN for pkg in shared llm-router db; do \
      cd /app/out/node_modules/@nexusai/$pkg && node -e "       \
        const fs = require('fs');                               \
        const p  = JSON.parse(fs.readFileSync('package.json','utf8')); \
        for (const field of ['dependencies','devDependencies','peerDependencies']) { \
          if (!p[field]) continue;                              \
          for (const k of Object.keys(p[field])) {              \
            if (String(p[field][k]).startsWith('workspace')) delete p[field][k]; \
          }                                                     \
        }                                                       \
        delete p.devDependencies;                               \
        delete p.scripts;                                       \
        fs.writeFileSync('package.json', JSON.stringify(p, null, 2));"; \
    done

# ─── Stage 6: regenerate Prisma client in /app/out ───────────
RUN cd /app/out && npx --yes prisma@5.22.0 generate --schema=prisma/schema.prisma

# ─── Stage 7: hard sanity checks ─────────────────────────────
RUN set -e; \
    cd /app/out; \
    echo "── Verifying deploy bundle ──"; \
    for p in fastify @fastify/cors @fastify/websocket ioredis kafkajs pino zod uuid neo4j-driver stripe node-cron; do \
      test -f "node_modules/$p/package.json" || (echo "❌ missing third-party dep: $p" && ls node_modules | head -30 && exit 1); \
    done; \
    test -f node_modules/@nexusai/shared/dist/index.js     || (echo "❌ missing @nexusai/shared/dist/index.js"     && ls -R node_modules/@nexusai/shared     2>/dev/null && exit 1); \
    test -f node_modules/@nexusai/llm-router/dist/index.js || (echo "❌ missing @nexusai/llm-router/dist/index.js" && ls -R node_modules/@nexusai/llm-router 2>/dev/null && exit 1); \
    test -f node_modules/@nexusai/db/src/index.ts          || (echo "❌ missing @nexusai/db/src/index.ts"          && ls -R node_modules/@nexusai/db          2>/dev/null && exit 1); \
    test -d node_modules/.prisma/client || test -d node_modules/@prisma/client/runtime \
      || (echo "❌ Prisma client not generated" && exit 1); \
    test -f dist/index.js                                  || (echo "❌ missing orchestrator entry" && exit 1); \
    echo "✔ deploy bundle complete"

# ─── Stage 8: lean runtime image ─────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/out .

EXPOSE 4000
CMD ["node", "dist/index.js"]
