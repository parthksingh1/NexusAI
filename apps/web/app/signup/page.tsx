"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  AuthLogo, OAuthButtons, AuthFooter,
} from "@/components/auth/auth-form";
import { AuthMarketingPanel } from "@/components/auth/marketing-panel";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function persist(token: string | null, user: { id: string; email: string; name?: string; tier?: string }) {
    if (token) localStorage.setItem("nexus_token", token);
    localStorage.setItem("nexus_user", JSON.stringify(user));
  }

  async function submit() {
    if (!agreed) { setErr("You must agree to the terms to continue."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/orch/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      if (r.ok) {
        const d = await r.json();
        persist(d.token, d.user);
        toast.success("Account created");
        window.location.href = "/";
        return;
      }
      // Backend unavailable — let them in with a local-only session so the demo still works.
      persist(null, {
        id: crypto.randomUUID(),
        email, name: name || email.split("@")[0],
        tier: "FREE",
      });
      toast.info("Account created locally (backend offline — UI uses mock data)");
      window.location.href = "/";
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* LEFT — Marketing panel (mirrored vs login) */}
      <div className="border-r border-border">
        <AuthMarketingPanel />
      </div>

      {/* RIGHT — Signup form */}
      <div className="flex flex-col items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between">
            <AuthLogo />
            <Badge tone="brand" size="sm">Free forever plan</Badge>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tightest">Create your account</h1>
            <p className="text-sm text-fg-muted mt-1.5">
              Start building autonomous agents in minutes. No credit card required.
            </p>
          </div>

          <OAuthButtons disabled={busy} />

          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-2xs uppercase tracking-wider text-fg-subtle font-semibold">or use email</span>
            <Separator className="flex-1" />
          </div>

          <div className="space-y-3">
            <div>
              <Label>Full name</Label>
              <Input autoFocus placeholder="Jane Doe"
                value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Work email</Label>
              <Input type="email" placeholder="you@company.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" placeholder="At least 8 characters"
                value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
              <div className="text-2xs text-fg-subtle mt-1">
                Use 8+ characters. Mix in numbers and symbols for a stronger password.
              </div>
            </div>

            <label className="flex items-start gap-2 text-xs text-fg-muted cursor-pointer mt-3">
              <input
                type="checkbox" className="accent-brand mt-0.5"
                checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                I agree to the{" "}
                <Link href="#" className="text-brand hover:underline">Terms</Link>{" "}and{" "}
                <Link href="#" className="text-brand hover:underline">Privacy Policy</Link>.
              </span>
            </label>

            {err && (
              <div className="rounded-md bg-danger/10 border border-danger/20 px-3 py-2 text-sm text-danger">{err}</div>
            )}

            <Button onClick={submit} loading={busy}
              disabled={!email || password.length < 8 || !name}
              className="w-full"
              rightIcon={!busy ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}>
              Create account
            </Button>
          </div>

          <div className="mt-5 text-center text-sm text-fg-muted">
            Already have an account?{" "}
            <Link href="/login" className="text-brand hover:underline font-medium">Sign in</Link>
          </div>

          <ul className="mt-7 space-y-2 border-t border-border pt-5">
            <PerkRow text="Up to 50 agent runs / month, free forever" />
            <PerkRow text="No credit card required" />
            <PerkRow text="Upgrade or cancel anytime" />
          </ul>

          <AuthFooter />
        </div>
      </div>
    </div>
  );
}

function PerkRow({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-xs text-fg-muted">
      <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
      <span>{text}</span>
    </li>
  );
}
