# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/sandbox apps/sandbox
RUN pnpm install --frozen-lockfile=false \
  && pnpm --filter @nexusai/shared build \
  && pnpm --filter @nexusai/sandbox build
EXPOSE 4100
WORKDIR /app/apps/sandbox
CMD ["node", "dist/index.js"]
