"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sparkles, Github, Mail, ArrowRight, CheckCircle2, Zap, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

const DEMO_EMAIL = "demo@nexusai.local";
const DEMO_PASSWORD = "demo1234";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  async function realSubmit(payload: { email: string; password: string }) {
    const r = await fetch(`/api/orch/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.message ?? "Authentication failed");
    }
    return r.json();
  }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const d = await realSubmit({ email, password });
      localStorage.setItem("nexus_token", d.token);
      localStorage.setItem("nexus_user", JSON.stringify(d.user));
      toast.success("Welcome back");
      router.push("/");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * One-click demo:
   *   1. Try real /auth/login with the seeded credentials.
   *   2. If the backend is offline, fall back to a client-side demo session
   *      so the UI still lights up for visitors on a cold deployment.
   */
  async function demoLogin() {
    setDemoBusy(true); setErr(null);
    try {
      const d = await realSubmit({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
      localStorage.setItem("nexus_token", d.token);
      localStorage.setItem("nexus_user", JSON.stringify(d.user));
      toast.success("Signed in as Demo User");
    } catch {
      // Offline fallback — set a visibly-demo session so pages still render.
      // Mock data covers the rest; API calls that hit the orchestrator will gracefully fall back too.
      localStorage.setItem("nexus_demo", "1");
      localStorage.setItem("nexus_user", JSON.stringify({
        id: "00000000-0000-0000-0000-000000000001",
        email: DEMO_EMAIL,
        name: "Demo User",
        tier: "PRO",
      }));
      toast.info("Demo mode (backend offline — UI uses mock data)");
    } finally {
      setDemoBusy(false);
      router.push("/");
    }
  }

  function oauth(provider: "github" | "google") {
    toast.info(`${provider} OAuth — use the demo for now`);
  }

  function copyCred(val: string) {
    navigator.clipboard.writeText(val);
    toast.success("Copied");
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* Left: auth */}
      <div className="flex items-center justify-center p-8 relative">
        <div className="absolute top-6 left-8 flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-brand to-emerald-600 flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-semibold tracking-tight">NexusAI</span>
        </div>

        <div className="w-full max-w-sm">
          {/* Demo CTA — the most important element on this page */}
          <div className="rounded-xl border border-brand/40 bg-brand-muted/40 p-5 mb-6 relative overflow-hidden">
            <div className="absolute -top-12 -right-12 h-40 w-40 bg-brand/15 rounded-full blur-3xl pointer-events-none" />
            <div className="relative">
              <Badge tone="brand" size="sm" className="mb-2"><Zap className="h-3 w-3" />Instant demo</Badge>
              <h2 className="text-lg font-semibold tracking-tight">Try NexusAI in one click</h2>
              <p className="text-xs text-fg-muted mt-1 leading-relaxed">
                No signup, no credit card. You'll sign in as a demo user with four pre-seeded agents.
              </p>
              <Button
                onClick={demoLogin}
                loading={demoBusy}
                className="w-full mt-3"
                rightIcon={!demoBusy ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}
              >
                Continue as Demo User
              </Button>

              {/* Visible credentials for transparency */}
              <div className="mt-3 pt-3 border-t border-brand/20 space-y-1">
                <CredRow label="Email"    value={DEMO_EMAIL}    onCopy={copyCred} />
                <CredRow label="Password" value={DEMO_PASSWORD} onCopy={copyCred} />
              </div>
            </div>
          </div>

          <div className="my-5 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-2xs uppercase tracking-wider text-fg-subtle font-semibold">or use your own account</span>
            <Separator className="flex-1" />
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <Button variant="secondary" leftIcon={<Github className="h-3.5 w-3.5" />} onClick={() => oauth("github")}>
              GitHub
            </Button>
            <Button variant="secondary" leftIcon={<Mail className="h-3.5 w-3.5" />} onClick={() => oauth("google")}>
              Google
            </Button>
          </div>

          <div className="space-y-3">
            <div>
              <Label>Email</Label>
              <Input type="email" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="mb-0">Password</Label>
                {mode === "login" && <Link href="#" className="text-2xs text-brand hover:underline">Forgot?</Link>}
              </div>
              <Input type="password" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
            </div>
            {err && <div className="rounded-md bg-danger/10 border border-danger/20 px-3 py-2 text-sm text-danger">{err}</div>}
            <Button onClick={submit} loading={busy} disabled={!email || !password} variant="secondary" className="w-full">
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </div>

          <div className="mt-5 text-center text-sm text-fg-muted">
            {mode === "login" ? (
              <>New to NexusAI? <button onClick={() => setMode("signup")} className="text-brand hover:underline font-medium">Create an account</button></>
            ) : (
              <>Already have one? <button onClick={() => setMode("login")} className="text-brand hover:underline font-medium">Sign in</button></>
            )}
          </div>

          <div className="mt-8 text-2xs text-fg-subtle text-center">
            By continuing, you agree to our{" "}
            <Link href="#" className="underline hover:text-fg-muted">Terms</Link> and{" "}
            <Link href="#" className="underline hover:text-fg-muted">Privacy Policy</Link>.
          </div>
        </div>
      </div>

      {/* Right: marketing panel */}
      <div className="hidden lg:flex bg-bg-subtle border-l border-border p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-40 pointer-events-none" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />

        <div className="relative max-w-md self-center">
          <h2 className="text-3xl font-semibold tracking-tightest leading-tight">
            Build agents that <span className="text-gradient-brand">reason, act, and improve</span>.
          </h2>
          <p className="mt-4 text-sm text-fg-muted leading-relaxed">
            NexusAI is the production-ready operating system for autonomous AI agents. Deploy in minutes.
            Observe every call. Stay in control.
          </p>

          <ul className="mt-8 space-y-3">
            <Feature text="Multi-model routing — Claude, GPT, Gemini" />
            <Feature text="Sandboxed code execution with gVisor" />
            <Feature text="Hybrid RAG with citation-grounded answers" />
            <Feature text="Human-in-the-loop approvals by default" />
            <Feature text="Full observability — Prometheus + OTel" />
          </ul>

          <div className="mt-10 p-4 rounded-lg border border-border bg-bg-elevated">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex -space-x-2">
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-brand to-emerald-600 border-2 border-bg-elevated flex items-center justify-center text-white text-2xs font-bold">A</div>
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-info to-blue-600 border-2 border-bg-elevated flex items-center justify-center text-white text-2xs font-bold">M</div>
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-warn to-orange-600 border-2 border-bg-elevated flex items-center justify-center text-white text-2xs font-bold">P</div>
              </div>
              <span className="text-xs text-fg-muted">Loved by engineers at</span>
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold text-fg-muted opacity-80">
              <span>Vercel</span><span>·</span><span>Linear</span><span>·</span><span>Stripe</span><span>·</span><span>Ramp</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckCircle2 className="h-4 w-4 text-brand shrink-0 mt-0.5" />
      <span className="text-sm text-fg-muted">{text}</span>
    </li>
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
