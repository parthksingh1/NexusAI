"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, Check, X, Clock, AlertTriangle, History } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Approval = {
  id: string; runId: string; tool: string;
  input: Record<string, unknown>;
  riskLevel: string; createdAt: string;
  agentName?: string;
};

type HistoryEntry = Approval & { status: "approved" | "rejected" | "expired"; decidedAt: string; decidedBy: string };

const MOCK_PENDING: Approval[] = [
  {
    id: "ap1", runId: "r_01", tool: "github_create_pr",
    input: { owner: "nexusai", repo: "demo", base: "main", headBranch: "agent/fix-readme", title: "Fix typo in README", files: [{ path: "README.md", content: "…" }] },
    riskLevel: "dangerous", createdAt: new Date(Date.now() - 2 * 60_000).toISOString(), agentName: "DevOps Sentinel",
  },
  {
    id: "ap2", runId: "r_02", tool: "code_exec",
    input: { language: "bash", code: "rm -rf /tmp/scratch && git clone ..." },
    riskLevel: "moderate", createdAt: new Date(Date.now() - 35 * 60_000).toISOString(), agentName: "Code Helper",
  },
];

const MOCK_HISTORY: HistoryEntry[] = [
  { id: "h1", runId: "r_a1", tool: "github_create_pr", input: { title: "Add observability hooks" }, riskLevel: "dangerous", createdAt: new Date(Date.now() - 3600_000).toISOString(), agentName: "DevOps Sentinel", status: "approved", decidedBy: "demo@nexusai.local", decidedAt: new Date(Date.now() - 3500_000).toISOString() },
  { id: "h2", runId: "r_b2", tool: "code_exec",        input: { language: "python", code: "import os; os.system(...)" }, riskLevel: "moderate", createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(), agentName: "Code Helper",  status: "rejected", decidedBy: "demo@nexusai.local", decidedAt: new Date(Date.now() - 2 * 3600_000 + 60_000).toISOString() },
  { id: "h3", runId: "r_c3", tool: "github_create_pr", input: { title: "Bump dependency" },         riskLevel: "dangerous", createdAt: new Date(Date.now() - 24 * 3600_000).toISOString(), agentName: "DevOps Sentinel", status: "expired",  decidedBy: "system",              decidedAt: new Date(Date.now() - 24 * 3600_000 + 120_000).toISOString() },
];

export default function ApprovalsPage() {
  const [pending, setPending] = useState<Approval[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>(MOCK_HISTORY);

  async function refresh() {
    try {
      const r = await fetch("/api/orch/approvals");
      if (r.ok) {
        const d = await r.json();
        setPending(d.approvals?.length ? d.approvals : MOCK_PENDING);
        return;
      }
    } catch { /* fall through */ }
    setPending(MOCK_PENDING);
  }
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  async function decide(id: string, decision: "approved" | "rejected") {
    const item = pending.find((p) => p.id === id);
    try {
      await fetch(`/api/orch/approvals/${id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, decidedBy: "web-user" }),
      });
    } catch { /* demo path */ }
    if (item) {
      setHistory([{ ...item, status: decision, decidedBy: "demo@nexusai.local", decidedAt: new Date().toISOString() }, ...history]);
      setPending(pending.filter((p) => p.id !== id));
      toast.success(`Request ${decision}`);
    }
  }

  const stats = useMemo(() => ({
    pending: pending.length,
    dangerous: pending.filter((p) => p.riskLevel === "dangerous").length,
    approvedToday: history.filter((h) => h.status === "approved" && Date.now() - +new Date(h.decidedAt) < 86400_000).length,
    rejectedToday: history.filter((h) => h.status === "rejected" && Date.now() - +new Date(h.decidedAt) < 86400_000).length,
  }), [pending, history]);

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Dangerous tool calls pause pending your decision. Default timeout: 2 minutes."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Pending"          icon={Clock}         value={stats.pending} />
        <Stat label="Dangerous"        icon={AlertTriangle} value={stats.dangerous} />
        <Stat label="Approved today"   icon={Check}         value={stats.approvedToday} />
        <Stat label="Rejected today"   icon={X}             value={stats.rejectedToday} />
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending"><Clock className="h-3.5 w-3.5 mr-1.5" />Pending {pending.length > 0 && <Badge tone="warn" size="sm" className="ml-2">{pending.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1.5" />History</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {pending.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="No pending approvals"
              description="You'll see dangerous tool calls here that need human review before they can execute."
            />
          ) : (
            <div className="space-y-3">
              {pending.map((a) => <ApprovalCard key={a.id} a={a} onDecide={decide} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            {history.length === 0 ? (
              <div className="py-16 text-center text-sm text-fg-subtle">No decisions yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {history.map((h) => (
                  <li key={h.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-bg-hover transition-colors">
                    <HistoryIcon status={h.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">{h.tool}</span>
                        {h.agentName && <Badge tone="brand" size="sm">{h.agentName}</Badge>}
                        <Badge tone={h.riskLevel === "dangerous" ? "danger" : "warn"} size="sm">{h.riskLevel}</Badge>
                      </div>
                      <div className="text-2xs text-fg-subtle mt-0.5">
                        {h.status === "approved" && `Approved by ${h.decidedBy}`}
                        {h.status === "rejected" && `Rejected by ${h.decidedBy}`}
                        {h.status === "expired" && "Expired without a decision"}
                        {" · "}
                        {formatDistanceToNow(new Date(h.decidedAt), { addSuffix: true })}
                      </div>
                    </div>
                    <HistoryBadge status={h.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ApprovalCard({ a, onDecide }: { a: Approval; onDecide: (id: string, d: "approved" | "rejected") => void }) {
  return (
    <Card className={`p-5 ${a.riskLevel === "dangerous" ? "border-danger/30" : "border-warn/30"}`}>
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`h-9 w-9 rounded-md flex items-center justify-center border shrink-0 ${a.riskLevel === "dangerous" ? "bg-danger/10 border-danger/20" : "bg-warn/10 border-warn/20"}`}>
            <ShieldAlert className={`h-4 w-4 ${a.riskLevel === "dangerous" ? "text-danger" : "text-warn"}`} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-medium">{a.tool}</span>
              <Badge tone={a.riskLevel === "dangerous" ? "danger" : "warn"} size="sm">{a.riskLevel}</Badge>
              {a.agentName && <Badge tone="brand" size="sm">{a.agentName}</Badge>}
            </div>
            <div className="text-2xs text-fg-subtle mt-0.5 font-mono">
              run {a.runId.slice(0, 8)} · {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="secondary" onClick={() => onDecide(a.id, "rejected")} leftIcon={<X className="h-3 w-3" />}>Reject</Button>
          <Button size="sm" onClick={() => onDecide(a.id, "approved")} leftIcon={<Check className="h-3 w-3" />}>Approve</Button>
        </div>
      </div>
      <pre className="text-2xs bg-bg-muted border border-border p-3 rounded-md overflow-x-auto font-mono leading-relaxed">
{JSON.stringify(a.input, null, 2)}
      </pre>
    </Card>
  );
}

function HistoryIcon({ status }: { status: "approved" | "rejected" | "expired" }) {
  const m = {
    approved: { Icon: Check, color: "text-success bg-success/10 border-success/20" },
    rejected: { Icon: X,     color: "text-danger bg-danger/10 border-danger/20" },
    expired:  { Icon: Clock, color: "text-fg-muted bg-bg-muted border-border" },
  }[status];
  return (
    <div className={`h-8 w-8 rounded-md border flex items-center justify-center shrink-0 ${m.color}`}>
      <m.Icon className="h-3.5 w-3.5" />
    </div>
  );
}

function HistoryBadge({ status }: { status: "approved" | "rejected" | "expired" }) {
  const map = { approved: "success", rejected: "danger", expired: "neutral" } as const;
  return <Badge tone={map[status]} size="sm" dot>{status}</Badge>;
}
