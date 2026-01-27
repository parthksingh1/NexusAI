"use client";

import { useEffect, useState } from "react";
import { Copy, Plus, Trash2, Key, User, Bell, Shield, Palette, Globe, Database, Check } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, SectionHeader } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

type ApiKey = {
  id: string; name: string; prefix: string; lastUsedAt: string | null; createdAt: string;
};

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Manage your profile, API keys, preferences, and security." />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile"><User className="h-3.5 w-3.5 mr-1.5" />Profile</TabsTrigger>
          <TabsTrigger value="api-keys"><Key className="h-3.5 w-3.5 mr-1.5" />API keys</TabsTrigger>
          <TabsTrigger value="preferences"><Palette className="h-3.5 w-3.5 mr-1.5" />Preferences</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="h-3.5 w-3.5 mr-1.5" />Notifications</TabsTrigger>
          <TabsTrigger value="security"><Shield className="h-3.5 w-3.5 mr-1.5" />Security</TabsTrigger>
          <TabsTrigger value="advanced"><Database className="h-3.5 w-3.5 mr-1.5" />Advanced</TabsTrigger>
        </TabsList>

        <TabsContent value="profile"><ProfileTab /></TabsContent>
        <TabsContent value="api-keys"><ApiKeysTab /></TabsContent>
        <TabsContent value="preferences"><PreferencesTab /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab /></TabsContent>
        <TabsContent value="security"><SecurityTab /></TabsContent>
        <TabsContent value="advanced"><AdvancedTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Profile ────────────────────────────────────────────────────
function ProfileTab() {
  const [name, setName] = useState("Demo User");
  const [email, setEmail] = useState("demo@nexusai.local");
  const [bio, setBio] = useState("Building the future of autonomous agents.");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="p-6 flex flex-col items-center">
        <Avatar className="h-20 w-20 mb-3">
          <AvatarFallback className="text-xl">DU</AvatarFallback>
        </Avatar>
        <div className="font-medium">{name}</div>
        <div className="text-xs text-fg-subtle mt-0.5">{email}</div>
        <Badge tone="brand" size="sm" className="mt-3">Pro plan</Badge>
        <Separator className="my-4" />
        <Button variant="secondary" size="sm" className="w-full">Change avatar</Button>
        <Button variant="ghost" size="sm" className="w-full mt-1 text-danger">Remove avatar</Button>
      </Card>

      <Card className="p-6 lg:col-span-2">
        <h3 className="font-semibold tracking-tight mb-1">Personal information</h3>
        <p className="text-xs text-fg-muted mb-5">Update how you appear across NexusAI.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Bio</Label>
            <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell us about yourself" />
          </div>
          <div>
            <Label>Timezone</Label>
            <Select defaultValue="utc">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="utc">UTC</SelectItem>
                <SelectItem value="pst">America/Los_Angeles</SelectItem>
                <SelectItem value="est">America/New_York</SelectItem>
                <SelectItem value="ist">Asia/Kolkata</SelectItem>
                <SelectItem value="tokyo">Asia/Tokyo</SelectItem>
                <SelectItem value="cet">Europe/Berlin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Language</Label>
            <Select defaultValue="en">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="de">Deutsch</SelectItem>
                <SelectItem value="ja">日本語</SelectItem>
                <SelectItem value="hi">हिन्दी</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost">Discard</Button>
          <Button onClick={() => toast.success("Profile updated")} leftIcon={<Check className="h-3.5 w-3.5" />}>Save changes</Button>
        </div>
      </Card>
    </div>
  );
}

// ─── API Keys ───────────────────────────────────────────────────
function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([
    { id: "k_01", name: "Production", prefix: "nxs_a7f29c3d", lastUsedAt: new Date(Date.now() - 3600_000).toISOString(), createdAt: new Date(Date.now() - 30 * 86400_000).toISOString() },
    { id: "k_02", name: "CI pipeline", prefix: "nxs_41b09f55", lastUsedAt: new Date(Date.now() - 86400_000).toISOString(), createdAt: new Date(Date.now() - 10 * 86400_000).toISOString() },
    { id: "k_03", name: "Personal dev", prefix: "nxs_92e1d47a", lastUsedAt: null, createdAt: new Date(Date.now() - 2 * 86400_000).toISOString() },
  ]);
  const [newKeyName, setNewKeyName] = useState("");
  const [justCreated, setJustCreated] = useState<{ name: string; plaintext: string } | null>(null);

  function createKey() {
    if (!newKeyName.trim()) return;
    const plain = `nxs_${Math.random().toString(36).slice(2, 14)}${Math.random().toString(36).slice(2, 14)}`;
    const k: ApiKey = { id: `k_${Date.now()}`, name: newKeyName, prefix: plain.slice(0, 12), lastUsedAt: null, createdAt: new Date().toISOString() };
    setKeys([k, ...keys]);
    setJustCreated({ name: newKeyName, plaintext: plain });
    setNewKeyName("");
    toast.success("API key created");
  }

  function revoke(id: string) {
    setKeys(keys.filter((k) => k.id !== id));
    toast.success("API key revoked");
  }

  return (
    <div className="space-y-4">
      {justCreated && (
        <Card className="p-5 border-brand/40 bg-brand-muted/40">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-brand/15 border border-brand-border flex items-center justify-center shrink-0">
              <Key className="h-4 w-4 text-brand" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold tracking-tight text-sm">Save your API key</h3>
              <p className="text-xs text-fg-muted mt-0.5">
                This is the only time <strong>{justCreated.name}</strong> will be shown. Store it in a secret manager.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-bg-elevated border border-border rounded-md px-3 py-2 truncate">
                  {justCreated.plaintext}
                </code>
                <Button size="sm" variant="secondary"
                  onClick={() => { navigator.clipboard.writeText(justCreated.plaintext); toast.success("Copied"); }}
                  leftIcon={<Copy className="h-3 w-3" />}>
                  Copy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setJustCreated(null)}>Dismiss</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold tracking-tight">Create new key</h3>
          <p className="text-xs text-fg-muted mt-0.5">Used to authenticate the SDK and CLI.</p>
        </div>
        <div className="p-5 flex items-end gap-2">
          <div className="flex-1">
            <Label>Key name</Label>
            <Input placeholder="e.g. Production API" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createKey()} />
          </div>
          <Button onClick={createKey} disabled={!newKeyName.trim()} leftIcon={<Plus className="h-3.5 w-3.5" />}>Create</Button>
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-semibold tracking-tight">Your keys</h3>
            <p className="text-xs text-fg-muted mt-0.5">{keys.length} active key{keys.length !== 1 && "s"}</p>
          </div>
        </div>
        {keys.length === 0 ? (
          <EmptyState icon={Key} title="No API keys yet" className="m-5 border-0 bg-transparent py-10" />
        ) : (
          <ul className="divide-y divide-border">
            {keys.map((k) => (
              <li key={k.id} className="px-5 py-3 flex items-center justify-between gap-3 group hover:bg-bg-hover transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{k.name}</span>
                    {k.lastUsedAt ? <Badge tone="success" size="sm" dot>Active</Badge> : <Badge tone="neutral" size="sm">Unused</Badge>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-2xs text-fg-subtle font-mono">
                    <span>{k.prefix}••••••••</span>
                    <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                    {k.lastUsedAt && <span>Used {new Date(k.lastUsedAt).toLocaleString()}</span>}
                  </div>
                </div>
                <Button size="icon-sm" variant="ghost" onClick={() => revoke(k.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Preferences ────────────────────────────────────────────────
function PreferencesTab() {
  const [theme, setTheme] = useState("system");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [compact, setCompact] = useState(false);
  const [telemetry, setTelemetry] = useState(true);
  const [model, setModel] = useState("auto");

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="font-semibold tracking-tight mb-1">Appearance</h3>
        <p className="text-xs text-fg-muted mb-5">Control how NexusAI looks on your device.</p>
        <div className="space-y-4">
          <SettingRow label="Theme" desc="Choose light, dark, or match your system.">
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <Separator />
          <SettingRow label="Compact mode" desc="Denser layout with smaller spacing.">
            <Switch checked={compact} onCheckedChange={setCompact} />
          </SettingRow>
          <Separator />
          <SettingRow label="Reduce motion" desc="Minimize animations and transitions.">
            <Switch checked={reduceMotion} onCheckedChange={setReduceMotion} />
          </SettingRow>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold tracking-tight mb-1">Defaults</h3>
        <p className="text-xs text-fg-muted mb-5">Defaults applied when creating new agents.</p>
        <div className="space-y-4">
          <SettingRow label="Default model" desc="Pick a preferred provider, or let the router decide.">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (smart routing)</SelectItem>
                <SelectItem value="anthropic">Anthropic Claude</SelectItem>
                <SelectItem value="openai">OpenAI GPT</SelectItem>
                <SelectItem value="gemini">Google Gemini</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <Separator />
          <SettingRow label="Max steps per run" desc="Cap on ReAct iterations. Higher = more tokens.">
            <Select defaultValue="12">
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="12">12</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold tracking-tight mb-1">Privacy</h3>
        <p className="text-xs text-fg-muted mb-5">How we use your usage data.</p>
        <SettingRow label="Anonymous usage analytics" desc="Help us improve NexusAI. Never includes prompts or data.">
          <Switch checked={telemetry} onCheckedChange={setTelemetry} />
        </SettingRow>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => toast.success("Preferences saved")} leftIcon={<Check className="h-3.5 w-3.5" />}>Save preferences</Button>
      </div>
    </div>
  );
}

// ─── Notifications ──────────────────────────────────────────────
function NotificationsTab() {
  const [prefs, setPrefs] = useState({
    runFinished: true, runFailed: true, approvalRequired: true,
    budgetAlerts: true, weeklyDigest: false, productUpdates: true,
    emailDelivery: true, slackDelivery: false, webhookDelivery: false,
  });
  const flip = (k: keyof typeof prefs) => setPrefs((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="font-semibold tracking-tight mb-1">Events</h3>
        <p className="text-xs text-fg-muted mb-5">Pick which agent events you want to hear about.</p>
        <div className="space-y-4">
          <SettingRow label="Run finished" desc="When an agent completes a run."><Switch checked={prefs.runFinished} onCheckedChange={() => flip("runFinished")} /></SettingRow>
          <Separator />
          <SettingRow label="Run failed" desc="When a run errors out or is cancelled."><Switch checked={prefs.runFailed} onCheckedChange={() => flip("runFailed")} /></SettingRow>
          <Separator />
          <SettingRow label="Approval required" desc="When a dangerous tool call needs human review."><Switch checked={prefs.approvalRequired} onCheckedChange={() => flip("approvalRequired")} /></SettingRow>
          <Separator />
          <SettingRow label="Budget alerts" desc="At 50%, 80%, and 100% of your monthly cap."><Switch checked={prefs.budgetAlerts} onCheckedChange={() => flip("budgetAlerts")} /></SettingRow>
          <Separator />
          <SettingRow label="Weekly digest" desc="A Monday-morning summary of the past week."><Switch checked={prefs.weeklyDigest} onCheckedChange={() => flip("weeklyDigest")} /></SettingRow>
          <Separator />
          <SettingRow label="Product updates" desc="New features, releases, changelogs."><Switch checked={prefs.productUpdates} onCheckedChange={() => flip("productUpdates")} /></SettingRow>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold tracking-tight mb-1">Delivery channels</h3>
        <p className="text-xs text-fg-muted mb-5">Where notifications should land.</p>
        <div className="space-y-4">
          <SettingRow label="Email" desc="demo@nexusai.local"><Switch checked={prefs.emailDelivery} onCheckedChange={() => flip("emailDelivery")} /></SettingRow>
          <Separator />
          <SettingRow label="Slack" desc="Connect your workspace from Integrations"><Switch checked={prefs.slackDelivery} onCheckedChange={() => flip("slackDelivery")} /></SettingRow>
          <Separator />
          <SettingRow label="Webhook" desc="POST JSON payloads to your endpoint"><Switch checked={prefs.webhookDelivery} onCheckedChange={() => flip("webhookDelivery")} /></SettingRow>
        </div>
      </Card>
    </div>
  );
}

// ─── Security ───────────────────────────────────────────────────
function SecurityTab() {
  const [twoFA, setTwoFA] = useState(false);
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="font-semibold tracking-tight mb-1">Password</h3>
        <p className="text-xs text-fg-muted mb-5">Change the password you use to sign in.</p>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Current password</Label><Input type="password" /></div>
          <div /><div><Label>New password</Label><Input type="password" /></div>
          <div><Label>Confirm new password</Label><Input type="password" /></div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => toast.success("Password updated")}>Update password</Button>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold tracking-tight mb-1">Two-factor authentication</h3>
        <p className="text-xs text-fg-muted mb-5">Add an extra layer of security to your account.</p>
        <SettingRow label="Authenticator app" desc={twoFA ? "Enabled via authenticator app" : "Use Google Authenticator, 1Password, or similar"}>
          <Switch checked={twoFA} onCheckedChange={(v) => { setTwoFA(v); toast.success(v ? "2FA enabled" : "2FA disabled"); }} />
        </SettingRow>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold tracking-tight mb-1">Active sessions</h3>
        <p className="text-xs text-fg-muted mb-5">Devices currently signed into your account.</p>
        <ul className="space-y-2">
          <SessionRow device="MacBook Pro · Chrome" location="San Francisco, US" current />
          <SessionRow device="iPhone · Safari"     location="San Francisco, US" />
          <SessionRow device="Windows · Edge"       location="Mumbai, IN" />
        </ul>
      </Card>

      <Card className="p-6 border-danger/30">
        <h3 className="font-semibold tracking-tight mb-1 text-danger">Danger zone</h3>
        <p className="text-xs text-fg-muted mb-5">Irreversible account actions.</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-md border border-border">
            <div>
              <div className="text-sm font-medium">Export data</div>
              <div className="text-xs text-fg-muted">Download all your agents, runs, and memories as JSON.</div>
            </div>
            <Button variant="secondary" size="sm">Export</Button>
          </div>
          <div className="flex items-center justify-between p-3 rounded-md border border-danger/30 bg-danger/5">
            <div>
              <div className="text-sm font-medium text-danger">Delete account</div>
              <div className="text-xs text-fg-muted">Permanently delete your account and all data.</div>
            </div>
            <Button variant="danger" size="sm">Delete</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Advanced ───────────────────────────────────────────────────
function AdvancedTab() {
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="font-semibold tracking-tight mb-1">LLM providers</h3>
        <p className="text-xs text-fg-muted mb-5">Manage your upstream model provider credentials (BYOK).</p>
        <div className="space-y-3">
          <ProviderRow provider="Anthropic Claude" configured keyHint="sk-ant-...d8cQ" />
          <ProviderRow provider="OpenAI GPT"        configured keyHint="sk-proj-...fG4n" />
          <ProviderRow provider="Google Gemini"     configured={false} />
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold tracking-tight mb-1">Data residency</h3>
        <p className="text-xs text-fg-muted mb-5">Where we store your agent data.</p>
        <SettingRow label="Region" desc="Your data is stored in this region at rest.">
          <Select defaultValue="us">
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="us">US (Iowa)</SelectItem>
              <SelectItem value="eu">EU (Frankfurt)</SelectItem>
              <SelectItem value="ap">Asia (Tokyo)</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </Card>
    </div>
  );
}

// ─── Small shared bits ──────────────────────────────────────────
function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-xs text-fg-muted mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SessionRow({ device, location, current }: { device: string; location: string; current?: boolean }) {
  return (
    <li className="flex items-center justify-between p-3 rounded-md border border-border">
      <div>
        <div className="text-sm font-medium flex items-center gap-2">
          {device}
          {current && <Badge tone="success" size="sm" dot pulse>This device</Badge>}
        </div>
        <div className="text-2xs text-fg-subtle mt-0.5 flex items-center gap-1"><Globe className="h-3 w-3" />{location}</div>
      </div>
      {!current && <Button variant="ghost" size="sm">Revoke</Button>}
    </li>
  );
}

function ProviderRow({ provider, configured, keyHint }: { provider: string; configured?: boolean; keyHint?: string }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-md border border-border">
      <div>
        <div className="text-sm font-medium">{provider}</div>
        <div className="text-2xs text-fg-subtle mt-0.5 font-mono">{configured ? keyHint ?? "Configured" : "Not configured"}</div>
      </div>
      <div className="flex items-center gap-2">
        {configured && <Badge tone="success" size="sm" dot>Active</Badge>}
        <Button variant="secondary" size="sm">{configured ? "Update" : "Connect"}</Button>
      </div>
    </div>
  );
}
