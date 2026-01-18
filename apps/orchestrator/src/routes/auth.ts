import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@nexusai/db";
import { UnauthorizedError, ValidationError } from "@nexusai/shared";
import { z } from "zod";
import { issueJwt, verifyJwt, generateApiKey, hashApiKey } from "../auth/jwt.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";

export const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/signup", async (req) => {
    const body = SignupSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw new ValidationError("Email already registered");
    const user = await prisma.user.create({
      data: { email: body.email, name: body.name, passwordHash: hashPassword(body.password) },
    });
    const token = issueJwt(user.id, { email: user.email, tier: user.tier });
    return { token, user: { id: user.id, email: user.email, name: user.name, tier: user.tier } };
  });

  app.post("/auth/login", async (req) => {
    const body = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.passwordHash || !verifyPassword(body.password, user.passwordHash)) {
      throw new UnauthorizedError("Invalid email or password");
    }
    const token = issueJwt(user.id, { email: user.email, tier: user.tier });
    return { token, user: { id: user.id, email: user.email, name: user.name, tier: user.tier } };
  });

  app.get("/auth/me", async (req) => {
    const user = await authenticateRequest(req);
    return { user };
  });

  app.post("/auth/api-keys", async (req) => {
    const user = await authenticateRequest(req);
    const { name } = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    const { plain, prefix, hash } = generateApiKey();
    const key = await prisma.apiKey.create({
      data: { userId: user.id, name, prefix, hash },
    });
    return { id: key.id, name, prefix, plaintext: plain };
  });

  app.get("/auth/api-keys", async (req) => {
    const user = await authenticateRequest(req);
    const keys = await prisma.apiKey.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
    });
    return { keys };
  });

  app.delete<{ Params: { id: string } }>("/auth/api-keys/:id", async (req, reply) => {
    const user = await authenticateRequest(req);
    await prisma.apiKey.updateMany({
      where: { id: req.params.id, userId: user.id },
      data: { revokedAt: new Date() },
    });
    return reply.code(204).send();
  });
}

/**
 * Extract user from Authorization header (Bearer JWT) or X-API-Key.
 * Throws UnauthorizedError if neither is valid.
 */
export async function authenticateRequest(req: FastifyRequest) {
  const header = (req.headers.authorization as string | undefined)?.trim();
  if (header?.startsWith("Bearer ")) {
    const payload = verifyJwt(header.slice(7));
    if (!payload) throw new UnauthorizedError("Invalid or expired token");
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedError("User not found");
    return user;
  }

  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (apiKey?.startsWith("nxs_")) {
    const prefix = apiKey.slice(0, 12);
    const hash = hashApiKey(apiKey);
    const record = await prisma.apiKey.findFirst({ where: { prefix, hash, revokedAt: null } });
    if (!record) throw new UnauthorizedError("Invalid API key");
    await prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) throw new UnauthorizedError("Owner not found");
    return user;
  }

  // Phase 1 fallback for local dev — remove once clients are migrated
  const demoHeader = req.headers["x-user-id"] as string | undefined;
  if (demoHeader) {
    const user = await prisma.user.findUnique({ where: { id: demoHeader } });
    if (user) return user;
  }

  throw new UnauthorizedError("Missing Authorization header or X-API-Key");
}
