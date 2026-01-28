"use client";

import { useState } from "react";
import {
  Webhook, Plus, Copy, Play, CheckCircle2, XCircle, Clock, Shield, RefreshCw,
  MoreHorizontal, Trash2, Edit,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Stat } from "@/components/ui/stat";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown";

type Webhook = {
  id: string; url: string; events: string[]; secret: string;
  active: boolean; lastDelivery?: { ts: string; status: number; durationMs: number };
  deliveries: number; failures: number;
};

const EVENTS = [
  "agent.run.started", "agent.run.finished", "agent.run.failed",
  "tool.invoked", "approval.required", "approval.decided",
  "alert.fired", "agent.created", "billing.threshold",
];

const MOCK: Webhook[] = [
  { id: "wh1", url: "https://api.acme.com/nexus/events", events: ["agent.run.finished", "alert.fired"], secret: "whsec_4fd8a…", active: true,  lastDelivery: { ts: new Date(Date.now() - 2 * 60_000).toISOString(), status: 200, durationMs: 84 },  deliveries: 2840, failures: 3 },
  { id: "wh2", url: "https://hooks.slack.com/services/T0001/…",           events: ["approval.required"],                       secret: "whsec_a12bc…", active: true,  lastDelivery: { ts: new Date(Date.now() - 18 * 60_000).toISOString(), status: 200, durationMs: 140 }, deliveries: 412, failures: 0 },
  { id: "wh3", url: "https://staging.example.com/nexus",                  events: ["agent.run.started", "agent.run.finished"], secret: "whsec_99a0e…", active: false, lastDelivery: { ts: new Date(Date.now() - 4 * 3600_000).toISOString(), status: 500, durationMs: 812 }, deliveries: 128, failures: 22 },
];

const RECENT_DELIVERIES = [
  { id: "d1", event: "agent.run.finished",  url: "acme.com/nexus", status: 200, dur: 84,  ts: new Date(Date.now() - 2 * 60_000).toISOString() },
  { id: "d2", event: "alert.fired",         url: "acme.com/nexus", status: 200, dur: 91,  ts: new Date(Date.now() - 12 * 60_000).toISOString() },
  { id: "d3", event: "approval.required",   url: "hooks.slack.com", status: 200, dur: 140, ts: new Date(Date.now() - 18 * 60_000).toISOString() },
  { id: "d4", event: "agent.run.finished",  url: "acme.com/nexus", status: 429, dur: 1240, ts: new Date(Date.now() - 45 * 60_000).toISOString() },
  { id: "d5", event: "agent.run.finished",  url: "acme.com/nexus", status: 200, dur: 78,  ts: new Date(Date.now() - 58 * 60_000).toISOString() },
  { id: "d6", event: "agent.run.failed",    url: "staging.example.com", status: 500, dur: 812, ts: new Date(Date.now() - 4 * 3600_000).toISOString() },
];

export default function WebhooksPage() {
  const [hooks, setHooks] = useState<Webhook[]>(MOCK);
  const [newOpen, setNewOpen] = useState(false);

  const active = hooks.filter((h) => h.active).length;
  const totalDeliveries = hooks.reduce((a, b) => a + b.deliveries, 0);
  const totalFailures = hooks.reduce((a, b) => a + b.failures, 0);
  const successRate = ((totalDeliveries - totalFailures) / Math.max(1, totalDeliveries)) * 100;

  return (
    <div>
      <PageHeader
        title="Webhooks"
        description="Receive real-time event notifications over HTTP. Signed with HMAC-SHA256."
        actions={<Button leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setNewOpen(true)}>Add endpoint</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Endpoints"     icon={Webhook}       value={hooks.length} />
        <Stat label="Active"        icon={Play}          value={active} />
        <Stat label="Deliveries"    icon={CheckCircle2}  value={totalDeliveries.toLocaleString()} />
        <Stat label="Success rate"  icon={Shield}        value={`${successRate.toFixed(2)}%`} delta={{ value: "+0.1%", positive: true }} />
      </div>

      <Tabs defaultValue="endpoints">
        <TabsList>
          <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="events">Event types</TabsTrigger>
        </TabsList>

        <TabsContent value="endpoints">
          <Card>
            <ul className="divide-y divide-border">
              {hooks.map((h) => (
                <li key={h.id} className="p-5 hover:bg-bg-hover transition-colors">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-sm font-mono font-medium break-all">{h.url}</code>
                        {h.active ? <Badge tone="success" size="sm" dot pulse>Active</Badge> : <Badge size="sm">Paused</Badge>}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        {h.events.map((e) => <Badge key={e} size="sm" tone="brand">{e}</Badge>)}
                      </div>
                      <div className="mt-2 flex items-center gap-4 text-2xs text-fg-subtle">
                        <span className="inline-flex items-center gap-1"><Shield className="h-3 w-3" />{h.secret}</span>
                        <span>{h.deliveries.toLocaleString()} deliveries</span>
                        {h.failures > 0 && <span className="text-danger">{h.failures} failures</span>}
                        {h.lastDelivery && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(h.lastDelivery.ts), { addSuffix: true })}
                            {h.lastDelivery.status >= 400 && <Badge tone="danger" size="sm">{h.lastDelivery.status}</Badge>}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch checked={h.active} onCheckedChange={() => setHooks(hooks.map((x) => x.id === h.id ? { ...x, active: !x.active } : x))} />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => toast.success("Test payload sent")}><Play className="h-3.5 w-3.5" />Send test event</DropdownMenuItem>
                          <DropdownMenuItem><Edit className="h-3.5 w-3.5" />Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toast.success("Secret rotated")}><RefreshCw className="h-3.5 w-3.5" />Rotate secret</DropdownMenuItem>
                          <DropdownMenuItem className="text-danger" onClick={() => setHooks(hooks.filter((x) => x.id !== h.id))}>
                            <Trash2 className="h-3.5 w-3.5" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>

        <TabsContent value="deliveries">
          <Card>
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wider text-fg-subtle border-b border-border bg-bg-subtle/50">
                <tr>
                  <th className="text-left font-medium px-5 py-3">Event</th>
                  <th className="text-left font-medium">URL</th>
                  <th className="text-right font-medium">Status</th>
                  <th className="text-right font-medium">Duration</th>
                  <th className="text-right font-medium px-5">When</th>
                </tr>
              </thead>
              <tbody>
                {RECENT_DELIVERIES.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                    <td className="px-5 py-3 font-mono text-xs">{d.event}</td>
                    <td className="text-xs text-fg-muted truncate max-w-[240px]">{d.url}</td>
                    <td className="text-right">
                      <Badge tone={d.status < 300 ? "success" : d.status < 400 ? "warn" : "danger"} size="sm">{d.status}</Badge>
                    </td>
                    <td className="text-right font-mono text-xs">{d.dur}ms</td>
                    <td className="text-right text-xs text-fg-subtle px-5">{formatDistanceToNow(new Date(d.ts), { addSuffix: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {EVENTS.map((e) => (
              <Card key={e} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <code className="text-xs font-mono font-medium">{e}</code>
                </div>
                <p className="text-xs text-fg-muted">Fires when {e.replace(/\./g, " ")}.</p>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Card className="mt-5 p-5 bg-bg-subtle">
        <h3 className="font-semibold tracking-tight mb-2 text-sm">Verifying signatures</h3>
        <p className="text-xs text-fg-muted mb-3 max-w-3xl leading-relaxed">
          Every payload is signed with HMAC-SHA256 using your endpoint's secret. Verify the <code className="font-mono text-2xs bg-bg-muted px-1 py-0.5 rounded">x-nexus-signature</code> header before trusting the request.
        </p>
        <pre className="text-2xs bg-bg-elevated border border-border p-3 rounded-md overflow-x-auto font-mono">{`const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
if (req.headers["x-nexus-signature"] !== expected) throw new Error("bad signature");`}
        </pre>
      </Card>

      <Dialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title="Add webhook endpoint"
        description="We'll POST event payloads to this URL."
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={() => { setNewOpen(false); toast.success("Webhook created"); }}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div><Label>URL</Label><Input placeholder="https://api.acme.com/nexus" /></div>
          <div>
            <Label>Subscribed events</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-2 p-2 rounded-md border border-border bg-bg-elevated text-2xs font-mono cursor-pointer hover:bg-bg-hover">
                  <input type="checkbox" className="accent-brand" defaultChecked={e.includes("finished") || e.includes("failed")} />
                  {e}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
