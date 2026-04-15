"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check, Zap, CreditCard, Download, FileText, Building2, Plus,
  ArrowRight, TrendingUp, Sparkles, Shield, Clock,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip as ReTooltip, CartesianGrid } from "recharts";
import { format } from "date-fns";
import { PageHeader, SectionHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

type Tier = { tier: "FREE" | "PRO" | "TEAM" | "ENTERPRISE"; runs: number; cap: number; perExtra: number; price: number; features: string[]; };

const TIERS: Tier[] = [
  { tier: "FREE",       runs: 50,     cap: 5,     perExtra: 0,     price: 0,    features: ["50 runs / mo", "Community support", "Basic observability", "All 3 LLM providers"] },
  { tier: "PRO",        runs: 2000,   cap: 50,    perExtra: 0.01,  price: 29,   features: ["2,000 runs / mo", "Priority support", "Full audit log", "Memory graph"] },
  { tier: "TEAM",       runs: 20000,  cap: 500,   perExtra: 0.008, price: 199,  features: ["20,000 runs / mo", "SSO & team roles", "Dedicated support", "Advanced RAG + HyDE"] },
  { tier: "ENTERPRISE", runs: 200000, cap: 5000,  perExtra: 0.005, price: 0,    features: ["Unlimited runs", "SOC2 / HIPAA", "Dedicated sandbox nodes", "Custom SLAs"] },
];

const INVOICES = [
  { id: "inv_2601", date: "2026-04-01", amount: 29, status: "paid" as const, period: "Apr 2026" },
  { id: "inv_2531", date: "2026-03-01", amount: 29, status: "paid" as const, period: "Mar 2026" },
  { id: "inv_2460", date: "2026-02-01", amount: 29, status: "paid" as const, period: "Feb 2026" },
  { id: "inv_2389", date: "2026-01-01", amount: 29, status: "paid" as const, period: "Jan 2026" },
  { id: "inv_2318", date: "2025-12-01", amount: 29, status: "paid" as const, period: "Dec 2025" },
];

const WEEKLY_USAGE = [
  { day: "Mon", cost: 0.42, runs: 18 },
  { day: "Tue", cost: 0.68, runs: 29 },
  { day: "Wed", cost: 0.51, runs: 22 },
  { day: "Thu", cost: 1.21, runs: 47 },
  { day: "Fri", cost: 0.84, runs: 36 },
  { day: "Sat", cost: 0.19, runs: 7 },
  { day: "Sun", cost: 0.31, runs: 12 },
];

export default function BillingPage() {
  async function checkout(tier: string) {
    toast.info(`Checkout for ${tier} is not wired in demo mode`);
  }

  const used = 12.47, cap = 50, runs = 487, runsMax = 2000;
  const pct = (used / cap) * 100;

  return (
    <div>
      <PageHeader
        title="Billing & usage"
        description="Track usage, manage your plan, and review invoices."
        actions={<Button variant="secondary" leftIcon={<FileText className="h-3.5 w-3.5" />}>Tax documents</Button>}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payment">Payment methods</TabsTrigger>
        </TabsList>

        {/* ─── Overview ──────────────────────────────────────── */}
        <TabsContent value="overview">
          <div className="space-y-5">
            {/* Current plan */}
            <Card className="p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-brand/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />
              <div className="relative flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <Badge tone="brand" size="sm" className="mb-2"><Sparkles className="h-3 w-3" />Current plan</Badge>
                  <h2 className="text-2xl font-semibold tracking-tightest">Pro</h2>
                  <p className="text-sm text-fg-muted mt-1">$29/month · renews May 1, 2026</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary">Cancel plan</Button>
                  <Button asChild><Link href="#plans">Upgrade plan</Link></Button>
                </div>
              </div>
              <Separator className="my-6" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <UsageMeter label="Monthly spend" used={`$${used.toFixed(2)}`} cap={`$${cap}`} pct={pct} hint="Resets in 18 days" />
                <UsageMeter label="Runs" used={`${runs}`} cap={`${runsMax}`} pct={(runs / runsMax) * 100} hint={`${runsMax - runs} remaining`} />
                <UsageMeter label="Tokens (month)" used="4.2M" cap="∞" pct={0} hint="No hard limit on Pro" noProgress />
              </div>
            </Card>

            {/* Weekly chart */}
            <Card>
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <h3 className="font-semibold tracking-tight">Usage this week</h3>
                  <p className="text-xs text-fg-muted mt-0.5">Daily spend — Mon through Sun</p>
                </div>
                <div className="inline-flex items-center gap-1 text-xs text-success">
                  <TrendingUp className="h-3 w-3" />12% vs last week
                </div>
              </div>
              <div className="p-5 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={WEEKLY_USAGE} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--fg-subtle))" />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--fg-subtle))" tickFormatter={(v) => `$${v.toFixed(2)}`} />
                    <ReTooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: number, n, p) => [`$${v.toFixed(2)}`, p.payload.runs + " runs"]}
                    />
                    <Bar dataKey="cost" fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Add-ons + company */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-5">
                <h3 className="font-semibold tracking-tight">Add-ons</h3>
                <p className="text-xs text-fg-muted mt-0.5 mb-4">Boost your plan with optional capabilities.</p>
                <div className="space-y-2">
                  <AddonRow icon={Zap}    title="Dedicated LLM capacity" desc="Reserved throughput for critical runs" price="$49/mo" />
                  <AddonRow icon={Shield} title="SOC 2 compliance pack"  desc="Audit logs, data residency, SLA"      price="$199/mo" />
                  <AddonRow icon={Clock}  title="Extended data retention" desc="365 days for runs and activity"      price="$19/mo" />
                </div>
              </Card>

              <Card className="p-5">
                <h3 className="font-semibold tracking-tight">Billing details</h3>
                <p className="text-xs text-fg-muted mt-0.5 mb-4">Used on invoices and tax forms.</p>
                <div className="flex items-center gap-3 p-3 rounded-md border border-border bg-bg-subtle mb-3">
                  <div className="h-9 w-9 rounded-md bg-bg-muted border border-border flex items-center justify-center">
                    <Building2 className="h-4 w-4 text-fg-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">Nexus Demo Corp.</div>
                    <div className="text-2xs text-fg-subtle">500 Market Street, San Francisco CA</div>
                  </div>
                  <Button variant="ghost" size="sm">Edit</Button>
                </div>
                <div className="text-xs text-fg-subtle">
                  Tax ID: <span className="font-mono">US-45-1234567</span>
                </div>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── Plans ─────────────────────────────────────────── */}
        <TabsContent value="plans">
          <div id="plans" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {TIERS.map((t) => {
              const hero = t.tier === "PRO";
              const current = t.tier === "PRO";
              return (
                <Card key={t.tier} className={`p-5 flex flex-col relative ${hero ? "border-brand shadow-glow-brand" : ""}`}>
                  {hero && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge tone="brand" size="sm" className="shadow-sm"><Zap className="h-3 w-3" />Most popular</Badge>
                    </div>
                  )}
                  <h3 className="font-semibold tracking-tight">{t.tier}</h3>
                  <div className="mt-2 flex items-baseline gap-1">
                    {t.tier === "ENTERPRISE" ? (
                      <span className="text-2xl font-semibold tracking-tighter">Custom</span>
                    ) : (
                      <>
                        <span className="text-3xl font-semibold tracking-tighter">${t.price}</span>
                        {t.price > 0 && <span className="text-sm text-fg-subtle">/mo</span>}
                      </>
                    )}
                  </div>
                  <p className="text-xs text-fg-muted mt-1">
                    {t.runs.toLocaleString()} runs · ${t.cap} cap · {t.perExtra > 0 ? `$${t.perExtra}/extra` : "no overage"}
                  </p>
                  <ul className="mt-5 space-y-2 text-sm flex-1">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                        <span className="text-fg-muted">{f}</span>
                      </li>
                    ))}
                  </ul>
                  {current ? (
                    <Button className="mt-5 w-full" variant="outline" disabled>Current plan</Button>
                  ) : t.tier === "ENTERPRISE" ? (
                    <Button className="mt-5 w-full" variant="secondary">Contact sales</Button>
                  ) : (
                    <Button className="mt-5 w-full" variant={hero ? "primary" : "secondary"} onClick={() => checkout(t.tier)}>
                      {t.tier === "FREE" ? "Downgrade" : `Upgrade to ${t.tier}`}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>

          <Card className="mt-6 p-6 bg-bg-subtle">
            <h3 className="font-semibold tracking-tight">Frequently asked</h3>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Faq q="Can I switch plans anytime?" a="Yes. Upgrades take effect immediately with prorated billing. Downgrades apply at the next renewal." />
              <Faq q="What counts as a run?" a="Each agent run — regardless of the number of ReAct steps or tool calls within it — is one unit." />
              <Faq q="Do I need to bring my own LLM keys?" a="On Free, yes. On Pro and above, NexusAI covers LLM spend within your cap. You can still BYOK for full cost control." />
              <Faq q="What happens at the cap?" a="New runs are paused until the next cycle unless you approve overage (Pro+). You're never billed more than your cap." />
            </div>
          </Card>
        </TabsContent>

        {/* ─── Invoices ──────────────────────────────────────── */}
        <TabsContent value="invoices">
          <Card>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold tracking-tight">Invoice history</h3>
                <p className="text-xs text-fg-muted mt-0.5">All invoices, sorted by most recent.</p>
              </div>
              <Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>Export CSV</Button>
            </div>
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wider text-fg-subtle border-b border-border bg-bg-subtle/50">
                <tr>
                  <th className="text-left font-medium px-5 py-3">Invoice</th>
                  <th className="text-left font-medium">Period</th>
                  <th className="text-left font-medium">Date</th>
                  <th className="text-right font-medium">Amount</th>
                  <th className="text-center font-medium">Status</th>
                  <th className="px-5" />
                </tr>
              </thead>
              <tbody>
                {INVOICES.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs">{inv.id}</td>
                    <td>{inv.period}</td>
                    <td className="text-fg-muted">{format(new Date(inv.date), "MMM d, yyyy")}</td>
                    <td className="text-right font-medium">${inv.amount.toFixed(2)}</td>
                    <td className="text-center"><Badge tone="success" size="sm" dot>Paid</Badge></td>
                    <td className="px-5 py-3">
                      <Button variant="ghost" size="sm" leftIcon={<Download className="h-3 w-3" />}>PDF</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        {/* ─── Payment methods ───────────────────────────────── */}
        <TabsContent value="payment">
          <div className="space-y-4">
            <Card>
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <h3 className="font-semibold tracking-tight">Payment methods</h3>
                  <p className="text-xs text-fg-muted mt-0.5">We use Stripe. Your card is never stored on our servers.</p>
                </div>
                <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />}>Add method</Button>
              </div>
              <div className="p-5 space-y-2">
                <PaymentRow brand="Visa"       last4="4242" exp="12/28" primary />
                <PaymentRow brand="Mastercard" last4="5555" exp="04/27" />
              </div>
            </Card>

            <Card className="p-5 bg-bg-subtle">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-md bg-brand-muted border border-brand-border flex items-center justify-center shrink-0">
                  <CreditCard className="h-4 w-4 text-brand" />
                </div>
                <div>
                  <h3 className="font-semibold tracking-tight text-sm">Secure billing via Stripe</h3>
                  <p className="text-sm text-fg-muted mt-1 leading-relaxed">
                    All payments are processed by Stripe under PCI DSS Level 1 compliance.
                    NexusAI never touches card numbers directly — only tokenized references.
                  </p>
                  <Link href="https://stripe.com" className="text-xs text-brand hover:underline inline-flex items-center gap-1 mt-2">
                    Learn more <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "hsl(var(--bg-elevated))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--fg))",
};

function UsageMeter({ label, used, cap, pct, hint, noProgress }: { label: string; used: string; cap: string; pct: number; hint?: string; noProgress?: boolean }) {
  const tone = pct > 90 ? "danger" : pct > 70 ? "warn" : "brand";
  return (
    <div>
      <div className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tighter">{used}</span>
        <span className="text-sm text-fg-subtle">/ {cap}</span>
      </div>
      {!noProgress && <Progress value={pct} tone={tone as any} className="mt-2" />}
      {hint && <div className="text-2xs text-fg-subtle mt-1">{hint}</div>}
    </div>
  );
}

function AddonRow({ icon: Icon, title, desc, price }: { icon: LucideIcon; title: string; desc: string; price: string }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-md border border-border hover:bg-bg-hover transition-colors">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-md bg-bg-muted border border-border flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-fg-muted" />
        </div>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-2xs text-fg-subtle">{desc}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-fg-muted">{price}</span>
        <Button variant="ghost" size="sm">Add</Button>
      </div>
    </div>
  );
}

function PaymentRow({ brand, last4, exp, primary }: { brand: string; last4: string; exp: string; primary?: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-md border border-border">
      <div className="flex items-center gap-3">
        <div className="h-9 w-14 rounded-md bg-gradient-to-br from-bg-muted to-bg-hover border border-border flex items-center justify-center text-2xs font-bold">
          {brand}
        </div>
        <div>
          <div className="text-sm font-medium flex items-center gap-2">
            •••• {last4}
            {primary && <Badge tone="success" size="sm">Primary</Badge>}
          </div>
          <div className="text-2xs text-fg-subtle">Expires {exp}</div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!primary && <Button variant="ghost" size="sm">Make primary</Button>}
        <Button variant="ghost" size="sm">Remove</Button>
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <div className="text-sm font-medium">{q}</div>
      <div className="text-sm text-fg-muted mt-1 leading-relaxed">{a}</div>
    </div>
  );
}
