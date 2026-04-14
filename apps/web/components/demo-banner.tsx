"use client";

import { useEffect, useState } from "react";
import { Sparkles, X, Github, ExternalLink } from "lucide-react";

const STORAGE_DISMISSED = "nexus_demo_banner_dismissed";

export function DemoBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = localStorage.getItem(STORAGE_DISMISSED) === "1";
    if (dismissed) return;

    // Show the banner if the user is signed in (real JWT) OR is in offline-demo mode.
    const raw = localStorage.getItem("nexus_user");
    const isDemoOffline = localStorage.getItem("nexus_demo") === "1";
    if (!raw && !isDemoOffline) return;

    try {
      const user = raw ? JSON.parse(raw) : null;
      if (user?.email === "demo@nexusai.local" || isDemoOffline) setShow(true);
    } catch {
      if (isDemoOffline) setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="relative border-b border-brand/30 bg-brand-muted/40">
      <div className="mx-auto max-w-7xl px-6 py-2 flex items-center gap-3 text-xs">
        <div className="h-5 w-5 rounded-md bg-gradient-to-br from-brand to-emerald-600 flex items-center justify-center shrink-0">
          <Sparkles className="h-3 w-3 text-white" strokeWidth={2.5} />
        </div>
        <span className="font-medium">You're exploring NexusAI as a demo user.</span>
        <span className="text-fg-muted hidden sm:inline">
          All data is dummy and safe to play with. Create, run, and break things freely.
        </span>
        <div className="ml-auto flex items-center gap-3">
          <a
            href="https://github.com/"
            target="_blank"
            rel="noreferrer"
            className="hidden md:inline-flex items-center gap-1.5 text-fg-muted hover:text-fg transition-colors"
          >
            <Github className="h-3 w-3" /> Source <ExternalLink className="h-2.5 w-2.5" />
          </a>
          <button
            onClick={() => {
              localStorage.setItem(STORAGE_DISMISSED, "1");
              setShow(false);
            }}
            className="p-1 rounded-md text-fg-subtle hover:text-fg hover:bg-bg-hover transition-colors"
            aria-label="Dismiss banner"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
