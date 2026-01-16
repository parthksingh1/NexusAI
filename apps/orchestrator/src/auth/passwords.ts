import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

/** scrypt-backed password hashing. Output format: "scrypt$<salt_hex>$<hash_hex>" */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, KEYLEN, { N, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
