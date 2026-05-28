"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, MoreHorizontal } from "lucide-react";

interface ActionDef<TKey extends string> {
  key: TKey;
  label: string;
  destructive?: boolean;
  confirm?: string;
}

interface Props<TKey extends string> {
  endpoint: string;
  ids: string[];
  actions: ActionDef<TKey>[];
  buttonLabel?: string;
}

export function BulkActions<TKey extends string>({
  endpoint,
  ids,
  actions,
  buttonLabel = "Ações em massa",
}: Props<TKey>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: TKey, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { affected: number };
      toast.success(`${data.affected} registro(s) afetado(s)`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  if (actions.length === 1) {
    const a = actions[0];
    return (
      <Button
        size="sm"
        variant={a.destructive ? "destructive" : "default"}
        disabled={busy}
        onClick={() => run(a.key, a.confirm)}
      >
        {busy ? "..." : a.label}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy}>
          <MoreHorizontal className="mr-1 h-4 w-4" />
          {busy ? "..." : buttonLabel}
          <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.key}
            onSelect={() => run(a.key, a.confirm)}
            className={a.destructive ? "text-destructive" : undefined}
          >
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
