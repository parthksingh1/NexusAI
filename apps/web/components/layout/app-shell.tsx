"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { DemoBanner } from "@/components/demo-banner";
import { isAuthenticated } from "@/lib/auth";

/**
 * Routes that don't have the full app chrome (sidebar + topbar + banner).
 * These render their children full-bleed and bypass the auth check.
 */
const PUBLIC_ROUTES = ["/login", "/signup", "/forgot-password"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  useEffect(() => {
    // Wait until we're on the client to read localStorage.
    if (isPublic) {
      // If you're on /login but already signed in, send you to the app.
      if (pathname === "/login" && isAuthenticated()) {
        router.replace("/");
        return;
      }
      setReady(true);
      return;
    }

    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [pathname, isPublic, router]);

  // Public pages render full-bleed (no sidebar/topbar).
  if (isPublic) {
    return ready ? <>{children}</> : <FullScreenSpinner />;
  }

  // Private pages get the full app chrome.
  if (!ready) return <FullScreenSpinner />;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <DemoBanner />
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-8 py-8 animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}

function FullScreenSpinner() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-bg">
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse-dot" />
        <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse-dot" style={{ animationDelay: "0.2s" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse-dot" style={{ animationDelay: "0.4s" }} />
      </div>
    </div>
  );
}
