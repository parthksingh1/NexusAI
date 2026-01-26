"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Github, Mail, ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/orch/auth/${mode}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Authentication failed");
      localStorage.setItem("nexus_token", d.token);
      localStorage.setItem("nexus_user", JSON.stringify(d.user));
      toast.success("Welcome back");
      router.push("/");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  function oauth(provider: "github" | "google") {
    toast.info(`${provider} OAuth — not wired in demo mode`);
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* Left: form */}
      <div className="flex items-center justify-center p-8 relative">
        <div className="absolute top-6 left-8 flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-brand to-emerald-600 flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-semibold tracking-tight">NexusAI</span>
        </div>

        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tightest">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-sm text-fg-muted mt-1.5">
            {mode === "login" ? "Sign in to manage your agents." : "Start building autonomous agents in minutes."}
          </p>

          <div className="mt-7 space-y-2">
            <Button variant="secondary" className="w-full" leftIcon={<Github className="h-3.5 w-3.5" />} onClick={() => oauth("github")}>
              Continue with GitHub
            </Button>
            <Button variant="secondary" className="w-full" leftIcon={<Mail className="h-3.5 w-3.5" />} onClick={() => oauth("google")}>
              Continue with Google
            </Button>
          </div>

          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-2xs uppercase tracking-wider text-fg-subtle font-semibold">or continue with email</span>
            <Separator className="flex-1" />
          </div>

          <div className="space-y-3">
            <div>
              <Label>Email</Label>
              <Input
                type="email" autoFocus
                placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="mb-0">Password</Label>
                {mode === "login" && <Link href="#" className="text-2xs text-brand hover:underline">Forgot?</Link>}
              </div>
              <Input
                type="password" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            {err && (
              <div className="rounded-md bg-danger/10 border border-danger/20 px-3 py-2 text-sm text-danger">{err}</div>
            )}
            <Button
              onClick={submit} loading={busy}
              disabled={!email || !password}
              className="w-full"
              rightIcon={!busy ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}
            >
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </div>

          <div className="mt-6 text-center text-sm text-fg-muted">
            {mode === "login" ? (
              <>New to NexusAI?{" "}
                <button onClick={() => setMode("signup")} className="text-brand hover:underline font-medium">Create an account</button>
              </>
            ) : (
              <>Already have an account?{" "}
                <button onClick={() => setMode("login")} className="text-brand hover:underline font-medium">Sign in</button>
              </>
            )}
          </div>

          <div className="mt-10 text-2xs text-fg-subtle text-center">
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
