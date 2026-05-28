"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, User, MoreHorizontal } from "lucide-react";

interface StageOption {
  id: string;
  name: string;
}

interface Props {
  deal: {
    id: string;
    title: string;
    value: number | null;
    stageId: string;
  };
  imovelEndereco?: string | null;
  tenantName?: string | null;
  stages: StageOption[];
}

function fmtBRL(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function KanbanDealCard({ deal, imovelEndereco, tenantName, stages }: Props) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const otherStages = stages.filter((s) => s.id !== deal.stageId);

  async function moveToStage(stageId: string, stageName: string) {
    setMoving(true);
    try {
      const res = await fetch(`/api/pipeline/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Movido para "${stageName}"`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setMoving(false);
    }
  }

  return (
    <Card className="border-current/20 bg-card">
      <CardHeader className="flex flex-row items-start justify-between gap-2 p-3 pb-1.5">
        <Link href={`/pipeline/deals/${deal.id}`} className="text-sm font-medium hover:underline">
          {deal.title || "Sem título"}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={moving}
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Mover para</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {otherStages.map((s) => (
              <DropdownMenuItem key={s.id} onSelect={() => moveToStage(s.id, s.name)}>
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="space-y-1 p-3 pt-0 text-xs text-muted-foreground">
        {imovelEndereco && (
          <div className="flex items-center gap-1">
            <Building2 className="h-3 w-3 shrink-0" />
            {imovelEndereco}
          </div>
        )}
        {tenantName && (
          <div className="flex items-center gap-1">
            <User className="h-3 w-3 shrink-0" />
            {tenantName}
          </div>
        )}
        {deal.value != null && (
          <div className="pt-1 text-sm font-semibold text-foreground">{fmtBRL(deal.value)}</div>
        )}
      </CardContent>
    </Card>
  );
}
