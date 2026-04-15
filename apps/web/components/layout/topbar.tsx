"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Search, Bell, ChevronRight, Plus, Sun, Moon, LogOut, User, Settings, CreditCard } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Kbd } from "@/components/ui/kbd";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut,
} from "@/components/ui/dropdown";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { getCurrentUser, getInitials, signOut, type AuthUser } from "@/lib/auth";

const TITLES: Record<string, string> = {
  "": "Overview", agents: "Agents", playground: "Playground", streams: "Live streams",
  knowledge: "Knowledge", marketplace: "Marketplace", approvals: "Approvals", metrics: "Metrics",
  billing: "Billing", settings: "Settings", login: "Sign in", activity: "Activity",
  team: "Team", integrations: "Integrations",
};

export function Topbar() {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    setUser(getCurrentUser());
  }, []);

  function handleSignOut() {
    toast.success("Signed out");
    signOut("/login");
  }

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  const parts = pathname.split("/").filter(Boolean);
  const crumbs = [
    { href: "/", label: TITLES[""] },
    ...parts.map((p, i) => ({
      href: "/" + parts.slice(0, i + 1).join("/"),
      label: TITLES[p] ?? prettify(p),
    })),
  ];

  const openCmd = () => {
    const evt = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
    document.dispatchEvent(evt);
  };

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border glass flex items-center px-6 gap-4">
      {/* Breadcrumbs */}
      <nav className="flex items-center text-sm min-w-0">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={c.href} className="flex items-center min-w-0">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-fg-subtle mx-1.5 shrink-0" />}
              {last ? (
                <span className="font-medium truncate max-w-[240px]">{c.label}</span>
              ) : (
                <Link href={c.href} className="text-fg-muted hover:text-fg transition-colors truncate">
                  {c.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Search / command palette */}
      <button
        onClick={openCmd}
        className="hidden md:flex items-center gap-2 h-8 pl-3 pr-2 rounded-md border border-border bg-bg-elevated text-fg-muted text-sm hover:border-border-strong hover:text-fg transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs min-w-[140px] text-left">Search or jump to…</span>
        <div className="flex items-center gap-0.5">
          <Kbd>⌘</Kbd><Kbd>K</Kbd>
        </div>
      </button>

      {/* Quick new agent */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} asChild>
            <Link href="/agents?new=1">New agent</Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Create a new autonomous agent</TooltipContent>
      </Tooltip>

      {/* Theme */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleTheme}
            className="h-8 w-8 rounded-md border border-border bg-bg-elevated flex items-center justify-center text-fg-muted hover:text-fg hover:border-border-strong transition-colors"
            aria-label="Toggle theme"
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>Toggle theme</TooltipContent>
      </Tooltip>

      {/* Notifications */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="relative h-8 w-8 rounded-md border border-border bg-bg-elevated flex items-center justify-center text-fg-muted hover:text-fg hover:border-border-strong transition-colors">
            <Bell className="h-3.5 w-3.5" />
            <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-brand" />
          </button>
        </TooltipTrigger>
        <TooltipContent>3 unread notifications</TooltipContent>
      </Tooltip>

      {/* User */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg rounded-full">
            <Avatar className="h-8 w-8 cursor-pointer">
              <AvatarFallback>{getInitials(user)}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <div className="px-2 py-2">
            <div className="text-sm font-medium">{user?.name ?? "Demo User"}</div>
            <div className="text-2xs text-fg-subtle">{user?.email ?? "demo@nexusai.local"}</div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings"><User className="h-3.5 w-3.5" />Profile<DropdownMenuShortcut>⌘P</DropdownMenuShortcut></Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings"><Settings className="h-3.5 w-3.5" />Settings<DropdownMenuShortcut>⌘,</DropdownMenuShortcut></Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/billing"><CreditCard className="h-3.5 w-3.5" />Billing</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleSignOut} className="text-danger focus:text-danger">
            <LogOut className="h-3.5 w-3.5" />Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

function prettify(s: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/.test(s) || s.startsWith("demo-")) return s.slice(0, 8) + "…";
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
}
