#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Pushing Prisma schema…"
pnpm --filter @nexusai/db prisma db push

echo "▶ Seeding demo data…"
pnpm --filter @nexusai/db tsx prisma/seed.ts

echo "▶ Loading Neo4j constraints…"
docker exec -i nexus-neo4j cypher-shell -u neo4j -p nexuspass < infra/neo4j/init.cypher || true

echo "✅ Seed complete."
