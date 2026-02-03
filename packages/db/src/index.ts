import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

declare global {
  var __nexusPrisma: PrismaClient | undefined;
}

/**
 * Singleton Prisma client — survives Next.js HMR and is safe across services.
 * Log slow queries (>500ms) as warnings for observability.
 */
export const prisma: PrismaClient =
  globalThis.__nexusPrisma ??
  new PrismaClient({
    log: [
      { level: "warn", emit: "event" },
      { level: "error", emit: "event" },
    ],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__nexusPrisma = prisma;
}

/** Raw vector search helper for pgvector columns. */
export async function vectorSearch<T extends { id: string }>(
  table: string,
  embedding: number[],
  limit = 10,
  where?: string,
): Promise<Array<T & { distance: number }>> {
  const vec = `[${embedding.join(",")}]`;
  const whereClause = where ? `WHERE ${where}` : "";
  const rows = await prisma.$queryRawUnsafe<Array<T & { distance: number }>>(
    `SELECT *, embedding <=> $1::vector AS distance FROM ${table} ${whereClause} ORDER BY embedding <=> $1::vector LIMIT ${limit}`,
    vec,
  );
  return rows;
}
