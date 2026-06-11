"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

interface Item {
  path: string;
  label: string;
  schedule: string;
  realMoney: boolean;
  enabled: boolean;
}

interface Props {
  items: Item[];
}

export function StagingCronsClient({ items: initial }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initial);
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(path: string, enabled: boolean) {
    setPending(path);
    const original = items;
    setItems((prev) => prev.map((i) => (i.path === path ? { ...i, enabled } : i)));
    try {
      const res = await fetch(`/api/admin/staging-crons/${encodeURIComponent(path)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success(`${path} ${enabled ? "ligado" : "desligado"}`);
      router.refresh();
    } catch (err) {
      setItems(original);
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div
          key={item.path}
          className="flex items-center gap-3 rounded-md border p-3"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{item.label}</span>
              {item.realMoney && (
                <Badge variant="destructive" className="text-[10px]">
                  custo real
                </Badge>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              <code>{item.path}</code> · {item.schedule}
            </div>
          </div>
          <Switch
            checked={item.enabled}
            disabled={pending === item.path}
            onCheckedChange={(v: boolean) => toggle(item.path, v)}
          />
        </div>
      ))}
    </div>
  );
}
