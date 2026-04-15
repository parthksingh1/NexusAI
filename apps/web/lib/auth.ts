/**
 * Tiny client-side auth helpers backed by localStorage.
 *
 * Why localStorage and not cookies? The orchestrator API uses Bearer tokens
 * (set in the Authorization header by the SDK), and we want easy zero-backend
 * "demo mode" so visitors can explore the UI without a real session.
 */

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  tier?: string;
};

const TOKEN_KEY = "nexus_token";
const USER_KEY = "nexus_user";
const DEMO_KEY = "nexus_demo";

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return !!(localStorage.getItem(TOKEN_KEY) || localStorage.getItem(DEMO_KEY));
}

export function getCurrentUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function signOut(redirectTo = "/login"): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(DEMO_KEY);
  // Force a hard redirect — clears any in-memory React state from the previous session.
  window.location.href = redirectTo;
}

export function getInitials(user: AuthUser | null): string {
  if (!user) return "?";
  const source = user.name || user.email || "??";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
