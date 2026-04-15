"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  AuthLogo, DemoCallout, OAuthButtons, AuthFooter,
  DEMO_EMAIL, DEMO_PASSWORD,
} from "@/components/auth/auth-form";
import { AuthMarketingPanel } from "@/components/auth/marketing-panel";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  async function realSubmit(payload: { email: string; password: string }) {
    const r = await fetch(`/api/orch/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.message ?? "Sign-in failed");
    }
    return r.json();
  }

  function persist(token: string | null, user: { id: string; email: string; name?: string; tier?: string }, demo = false) {
    if (token) localStorage.setItem("nexus_token", token);
    if (demo) localStorage.setItem("nexus_demo", "1");
    localStorage.setItem("nexus_user", JSON.stringify(user));
  }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const d = await realSubmit({ email, password });
      persist(d.token, d.user);
      toast.success("Welcome back");
      window.location.href = "/";
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function demoLogin() {
    setDemoBusy(true); setErr(null);
    try {
      const d = await realSubmit({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
      persist(d.token, d.user);
      toast.success("Signed in as Demo User");
    } catch {
      persist(null, {
        id: "00000000-0000-0000-0000-000000000001",
        email: DEMO_EMAIL,
        name: "Demo User",
        tier: "PRO",
      }, true);
      toast.info("Demo mode (backend offline — UI uses mock data)");
    }
    window.location.href = "/";
  }

  return (
    <div className="h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* LEFT — Sign-in form */}
      <div className="flex flex-col items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <AuthLogo />
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tightest">Welcome back</h1>
            <p className="text-sm text-fg-muted mt-1.5">Sign in to manage your agents.</p>
          </div>

          <DemoCallout onClick={demoLogin} busy={demoBusy} />

          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-2xs uppercase tracking-wider text-fg-subtle font-semibold">or</span>
            <Separator className="flex-1" />
          </div>

          <OAuthButtons disabled={busy || demoBusy} />

          <div className="mt-5 space-y-3">
            <div>
              <Label>Email</Label>
              <Input type="email" autoFocus placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="mb-0">Password</Label>
                <Link href="#" className="text-2xs text-brand hover:underline">Forgot?</Link>
              </div>
              <Input type="password" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
            </div>
            {err && (
              <div className="rounded-md bg-danger/10 border border-danger/20 px-3 py-2 text-sm text-danger">{err}</div>
            )}
            <Button onClick={submit} loading={busy} disabled={!email || !password}
              className="w-full" rightIcon={!busy ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}>
              Sign in
            </Button>
          </div>

          <div className="mt-6 text-center text-sm text-fg-muted">
            New to NexusAI?{" "}
            <Link href="/signup" className="text-brand hover:underline font-medium">Create an account</Link>
          </div>

          <AuthFooter />
        </div>
      </div>

      {/* RIGHT — Marketing panel */}
      <div className="border-l border-border">
        <AuthMarketingPanel />
      </div>
    </div>
  );
}
