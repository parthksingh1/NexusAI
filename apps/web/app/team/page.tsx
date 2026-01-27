"use client";

import { useState } from "react";
import {
  Users, UserPlus, Mail, Shield, MoreHorizontal, Check, Clock, Crown, X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Stat } from "@/components/ui/stat";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown";
import { Dialog } from "@/components/ui/dialog";

type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
type Status = "active" | "invited";
type Member = {
  id: string; name: string; email: string; role: Role; status: Status;
  initials: string; joinedAt: string; lastActive?: string;
};

const INITIAL: Member[] = [
  { id: "m1", name: "Demo User",      email: "demo@nexusai.local",    role: "OWNER",  status: "active",  initials: "DU", joinedAt: new Date(Date.now() - 90 * 86400_000).toISOString(), lastActive: new Date().toISOString() },
  { id: "m2", name: "Alex Chen",      email: "alex@nexusai.local",    role: "ADMIN",  status: "active",  initials: "AC", joinedAt: new Date(Date.now() - 60 * 86400_000).toISOString(), lastActive: new Date(Date.now() - 3 * 3600_000).toISOString() },
  { id: "m3", name: "Priya Sharma",   email: "priya@nexusai.local",   role: "MEMBER", status: "active",  initials: "PS", joinedAt: new Date(Date.now() - 30 * 86400_000).toISOString(), lastActive: new Date(Date.now() - 24 * 3600_000).toISOString() },
  { id: "m4", name: "Marcus Lee",     email: "marcus@nexusai.local",  role: "MEMBER", status: "active",  initials: "ML", joinedAt: new Date(Date.now() - 14 * 86400_000).toISOString(), lastActive: new Date(Date.now() - 48 * 3600_000).toISOString() },
  { id: "m5", name: "Sophie Dubois",  email: "sophie@nexusai.local",  role: "VIEWER", status: "invited", initials: "SD", joinedAt: new Date(Date.now() - 2 * 86400_000).toISOString() },
];

const ROLE_LABELS: Record<Role, { label: string; desc: string; tone: "brand" | "info" | "neutral" }> = {
  OWNER:  { label: "Owner",  desc: "Full access. Billing + team management.",   tone: "brand" },
  ADMIN:  { label: "Admin",  desc: "Manage agents, approvals, integrations.",   tone: "info" },
  MEMBER: { label: "Member", desc: "Create and run agents. No billing access.", tone: "neutral" },
  VIEWER: { label: "Viewer", desc: "Read-only across the workspace.",           tone: "neutral" },
};

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>(INITIAL);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("MEMBER");

  function sendInvite() {
    if (!inviteEmail.includes("@")) return;
    const nm = inviteEmail.split("@")[0]!;
    setMembers([...members, {
      id: `m${Date.now()}`, name: nm, email: inviteEmail, role: inviteRole,
      status: "invited", initials: nm.slice(0, 2).toUpperCase(), joinedAt: new Date().toISOString(),
    }]);
    toast.success(`Invite sent to ${inviteEmail}`);
    setInviteOpen(false);
    setInviteEmail("");
  }

  function changeRole(id: string, role: Role) {
    setMembers(members.map((m) => (m.id === id ? { ...m, role } : m)));
    toast.success("Role updated");
  }
  function remove(id: string) { setMembers(members.filter((m) => m.id !== id)); toast.success("Member removed"); }
  function resend(id: string) { const m = members.find((x) => x.id === id); if (m) toast.success(`Invite resent to ${m.email}`); }

  const active = members.filter((m) => m.status === "active").length;
  const pending = members.filter((m) => m.status === "invited").length;

  return (
    <div>
      <PageHeader
        title="Team"
        description="Invite teammates and manage their access."
        actions={
          <Button onClick={() => setInviteOpen(true)} leftIcon={<UserPlus className="h-3.5 w-3.5" />}>
            Invite member
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Total members"  icon={Users}  value={members.length} />
        <Stat label="Active"          icon={Check}  value={active} />
        <Stat label="Pending invites" icon={Clock}  value={pending} />
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-semibold tracking-tight">Members</h3>
            <p className="text-xs text-fg-muted mt-0.5">{members.length} total · {active} active, {pending} pending</p>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-bg-hover transition-colors">
              <Avatar className="h-9 w-9"><AvatarFallback>{m.initials}</AvatarFallback></Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{m.name}</span>
                  {m.role === "OWNER" && <Crown className="h-3 w-3 text-warn" />}
                  {m.status === "invited" && <Badge tone="warn" size="sm" dot>Pending</Badge>}
                </div>
                <div className="text-xs text-fg-subtle">{m.email}</div>
              </div>
              <div className="hidden md:block text-2xs text-fg-subtle text-right">
                {m.status === "active" ? (
                  <>
                    <div>Active</div>
                    <div className="font-mono">{m.lastActive ? formatDistanceToNow(new Date(m.lastActive), { addSuffix: true }) : "—"}</div>
                  </>
                ) : (
                  <>
                    <div>Invited</div>
                    <div>{formatDistanceToNow(new Date(m.joinedAt), { addSuffix: true })}</div>
                  </>
                )}
              </div>
              <Badge tone={ROLE_LABELS[m.role].tone} size="sm">{ROLE_LABELS[m.role].label}</Badge>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" disabled={m.role === "OWNER"}>
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {m.status === "invited" && (
                    <DropdownMenuItem onClick={() => resend(m.id)}><Mail className="h-3.5 w-3.5" />Resend invite</DropdownMenuItem>
                  )}
                  {(["ADMIN", "MEMBER", "VIEWER"] as Role[]).filter((r) => r !== m.role).map((r) => (
                    <DropdownMenuItem key={r} onClick={() => changeRole(m.id, r)}>
                      <Shield className="h-3.5 w-3.5" />Change to {ROLE_LABELS[r].label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => remove(m.id)} className="text-danger">
                    <X className="h-3.5 w-3.5" />Remove member
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      </Card>

      {/* Role reference */}
      <Card className="mt-4 p-5 bg-bg-subtle">
        <h3 className="font-semibold tracking-tight mb-3">Role reference</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {(Object.entries(ROLE_LABELS) as [Role, typeof ROLE_LABELS[Role]][]).map(([k, v]) => (
            <div key={k} className="p-3 rounded-md border border-border bg-bg-elevated">
              <Badge tone={v.tone} size="sm" className="mb-2">{v.label}</Badge>
              <p className="text-xs text-fg-muted">{v.desc}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Invite dialog */}
      <Dialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Invite a teammate"
        description="They'll receive an email to join your workspace."
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={sendInvite} disabled={!inviteEmail.includes("@")} leftIcon={<Mail className="h-3.5 w-3.5" />}>Send invite</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Email address</Label>
            <Input type="email" placeholder="name@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["ADMIN", "MEMBER", "VIEWER"] as Role[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r].label} — {ROLE_LABELS[r].desc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
