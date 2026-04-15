"use client";

import Link from "next/link";
import { Sparkles, Github, Mail, ArrowRight, Zap, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

export const DEMO_EMAIL = "demo@nexusai.local";
export const DEMO_PASSWORD = "demo1234";

export function AuthLogo() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-8 rounded-md bg-gradient-to-br from-brand to-emerald-600 flex items-center justify-center shadow-sm">
        <Sparkles className="h-4 w-4 text-white" strokeWidth={2.5} />
      </div>
      <span className="font-semibold tracking-tight">NexusAI</span>
    </div>
  );
}

export function DemoCallout({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  function copyCred(val: string) {
    navigator.clipboard.writeText(val);
    toast.success("Copied");
  }

  return (
    <div className="rounded-xl border border-brand/40 bg-brand-muted/30 p-5 relative overflow-hidden">
      <div className="absolute -top-12 -right-12 h-40 w-40 bg-brand/15 rounded-full blur-3xl pointer-events-none" />
      <div className="relative">
        <Badge tone="brand" size="sm" className="mb-2">
          <Zap className="h-3 w-3" />Instant demo
        </Badge>
        <h2 className="text-base font-semibold tracking-tight">Try NexusAI in one click</h2>
        <p className="text-xs text-fg-muted mt-1 leading-relaxed">
          No signup, no credit card. Sign in as a demo user with four pre-seeded agents.
        </p>
        <Button
          onClick={onClick}
          loading={busy}
          className="w-full mt-3"
          rightIcon={!busy ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}
        >
          Continue as Demo User
        </Button>
        <div className="mt-3 pt-3 border-t border-brand/20 space-y-1">
          <CredRow label="Email" value={DEMO_EMAIL} onCopy={copyCred} />
          <CredRow label="Password" value={DEMO_PASSWORD} onCopy={copyCred} />
        </div>
      </div>
    </div>
  );
}

export function OAuthButtons({ disabled }: { disabled?: boolean }) {
  function oauth(provider: string) {
    toast.info(`${provider} OAuth — demo mode, use the demo button above`);
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="secondary" disabled={disabled} leftIcon={<Github className="h-3.5 w-3.5" />} onClick={() => oauth("GitHub")}>
        GitHub
      </Button>
      <Button variant="secondary" disabled={disabled} leftIcon={<Mail className="h-3.5 w-3.5" />} onClick={() => oauth("Google")}>
        Google
      </Button>
    </div>
  );
}

export function AuthFooter() {
  return (
    <div className="mt-8 text-2xs text-fg-subtle text-center">
      By continuing, you agree to our{" "}
      <Link href="#" className="underline hover:text-fg-muted">Terms</Link> and{" "}
      <Link href="#" className="underline hover:text-fg-muted">Privacy Policy</Link>.
    </div>
  );
}

function CredRow({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-fg-subtle w-16">{label}</span>
      <code className="flex-1 font-mono bg-bg-elevated border border-border rounded px-2 py-1 truncate">{value}</code>
      <button
        onClick={() => onCopy(value)}
        className="p-1 rounded-md text-fg-subtle hover:text-fg hover:bg-bg-hover transition-colors"
        aria-label={`Copy ${label}`}
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}
