import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { config } from "../config.js";

/**
 * Zero-dependency HS256 JWT. We avoid pulling jsonwebtoken for a smaller surface.
 * Used for user sessions (issued by /auth/login) and for signing CLI/SDK tokens.
 */

type JwtPayload = {
  sub: string;
  email?: string;
  tier?: string;
  iat: number;
  exp: number;
  scope?: string[];
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlJson(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}

function sign(data: string): string {
  return b64url(createHmac("sha256", config.JWT_SECRET).update(data).digest());
}

export function issueJwt(sub: string, extra: { email?: string; tier?: string; scope?: string[]; ttlSeconds?: number } = {}): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (extra.ttlSeconds ?? 60 * 60 * 24 * 7);
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson({ sub, email: extra.email, tier: extra.tier, scope: extra.scope, iat, exp });
  const signing = `${header}.${payload}`;
  return `${signing}.${sign(signing)}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = sign(`${header}.${payload}`);
  const sigBuf = Buffer.from(sig!);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()) as JwtPayload;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function generateApiKey(): { plain: string; prefix: string; hash: string } {
  const bytes = randomBytes(32).toString("hex");
  const plain = `nxs_${bytes}`;
  const prefix = plain.slice(0, 12);
  const hash = createHmac("sha256", config.JWT_SECRET).update(plain).digest("hex");
  return { plain, prefix, hash };
}

export function hashApiKey(plain: string): string {
  return createHmac("sha256", config.JWT_SECRET).update(plain).digest("hex");
}
