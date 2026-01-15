# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/llm-router/package.json packages/llm-router/
COPY packages/db/package.json packages/db/
COPY apps/orchestrator/package.json apps/orchestrator/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/llm-router packages/llm-router
COPY packages/db packages/db
COPY apps/orchestrator apps/orchestrator
RUN pnpm --filter @nexusai/db prisma generate
RUN pnpm --filter @nexusai/shared build
RUN pnpm --filter @nexusai/llm-router build
RUN pnpm --filter @nexusai/db build
RUN pnpm --filter @nexusai/orchestrator build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY --from=build /app .
EXPOSE 4000
CMD ["node", "apps/orchestrator/dist/index.js"]
