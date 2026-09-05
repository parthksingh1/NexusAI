"use client";

import { Cloud, HardDrive } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderId, ProviderInfo } from "@/lib/manager-api";

/**
 * Picks which model runs the goal. Unavailable providers stay visible but disabled, with the
 * reason attached — knowing Gemini needs GOOGLE_API_KEY is more useful than the option
 * silently not being there.
 */
export function LLMPicker({
  providers,
  value,
  onChange,
  disabled,
}: {
  providers: ProviderInfo[];
  value: ProviderId | undefined;
  onChange: (id: ProviderId) => void;
  disabled?: boolean;
}) {
  const selected = providers.find((p) => p.id === value);

  return (
    <Select value={value} onValueChange={(v) => onChange(v as ProviderId)} disabled={disabled}>
      <SelectTrigger className="h-9 w-[190px] text-[13px]">
        <span className="flex items-center gap-2 truncate">
          {selected?.kind === "local" ? (
            <HardDrive size={13} className="shrink-0 text-fg-muted" />
          ) : (
            <Cloud size={13} className="shrink-0 text-fg-muted" />
          )}
          <SelectValue placeholder="Choose a model" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {providers.map((provider) => (
          <SelectItem
            key={provider.id}
            value={provider.id}
            disabled={!provider.available}
            className={cn(!provider.available && "opacity-60")}
          >
            <span className="flex w-full items-center gap-2">
              {provider.kind === "local" ? <HardDrive size={13} /> : <Cloud size={13} />}
              <span className="flex-1">{provider.label}</span>
              {provider.kind === "local" && provider.available && (
                <span className="text-[10px] text-emerald-400">free</span>
              )}
              {!provider.available && provider.reason && (
                <span className="text-[10px] text-fg-muted">{provider.reason}</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
