"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import {
  ManagerSelect,
  managerLabel,
  useManagerContext,
} from "@/components/deals/ManagerSelect";
import { cn } from "@/lib/utils";

interface DealManagerChipProps {
  dealId: string;
  managerUserId: string | null;
  /** Nome (ou e-mail) do gerente vindo do server; null cai no lookup por candidato. */
  managerName: string | null;
  className?: string;
}

const CHIP_CLASS =
  "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium";

/**
 * Chip compacto de gerente responsável no cabeçalho do negócio (vendas e
 * locação). Com `deal.manager.assign` vira um popover de troca/remoção;
 * sem a permissão é somente leitura.
 */
export function DealManagerChip({
  dealId,
  managerUserId,
  managerName,
  className,
}: DealManagerChipProps) {
  const router = useRouter();
  const { can, loading: permsLoading } = usePermissions();
  const { ctx } = useManagerContext();

  const [currentId, setCurrentId] = useState<string | null>(managerUserId);
  const [currentName, setCurrentName] = useState<string | null>(managerName);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(managerUserId);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);

  // Nome do server ganha; senão tenta casar com os candidatos (membros com
  // perfil Gerente). Gerente fora desse recorte cai no rótulo genérico.
  const resolvedName =
    currentName?.trim() ||
    (currentId
      ? (() => {
          const found = ctx?.candidates.find((c) => c.userId === currentId);
          return found ? managerLabel(found) : "Gerente atribuído";
        })()
      : null);

  const label = resolvedName ? `Gerente: ${resolvedName}` : "Sem gerente";
  const editable = !permsLoading && can(PERMISSION.DEAL_MANAGER_ASSIGN);

  async function patchManager(body: Record<string, unknown>, mode: "save" | "clear") {
    setBusy(mode);
    try {
      const res = await fetch(`/api/deals/${dealId}/manager`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);

      if (!res.ok) {
        toast.error(
          (typeof data.message === "string" && data.message) ||
            (typeof data.error === "string" && data.error) ||
            "Falha ao atualizar o gerente."
        );
        return;
      }

      const manager = data.manager as
        | { id: string; name: string | null; email: string }
        | null
        | undefined;
      const nextId = (data.managerUserId as string | null) ?? null;
      setCurrentId(nextId);
      setCurrentName(manager ? manager.name?.trim() || manager.email : null);
      setDraft(nextId);
      setOpen(false);
      toast.success(
        nextId
          ? "Gerente atualizado."
          : "Gerente removido — o negócio some do kanban dos gerentes."
      );
      router.refresh();
    } catch {
      toast.error("Falha ao atualizar o gerente.");
    } finally {
      setBusy(null);
    }
  }

  if (!editable) {
    return (
      <span
        className={cn(
          CHIP_CLASS,
          "bg-muted/40 text-muted-foreground",
          !resolvedName && "border-dashed",
          className
        )}
        title={label}
      >
        <UserCog className="h-3 w-3" />
        <span className="max-w-[16rem] truncate">{label}</span>
      </span>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(currentId);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="xs"
          className={cn(
            "gap-1 font-medium",
            !resolvedName && "border-dashed text-muted-foreground",
            className
          )}
          title="Definir gerente responsável"
        >
          <UserCog className="h-3 w-3" />
          <span className="max-w-[16rem] truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <ManagerSelect value={draft} onChange={setDraft} disabled={busy !== null} />
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={busy !== null || !currentId}
            onClick={() => patchManager({ clear: true }, "clear")}
          >
            {busy === "clear" ? "Removendo..." : "Remover"}
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || !draft || draft === currentId}
            onClick={() => patchManager({ managerUserId: draft }, "save")}
          >
            {busy === "save" ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
