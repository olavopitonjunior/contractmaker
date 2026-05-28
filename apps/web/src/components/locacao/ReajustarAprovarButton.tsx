"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface Props {
  leaseId: string;
  readjustmentId: string;
  action: "approve" | "reject";
}

export function ReajusteAprovarButton({ leaseId, readjustmentId, action }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      const res = await fetch(`/api/locacao/leases/${leaseId}/readjustments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readjustmentId, action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success(action === "approve" ? "Reajuste aplicado no contrato" : "Reajuste recusado");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={action === "approve" ? "default" : "outline"}
      onClick={handleClick}
      disabled={busy}
    >
      {busy ? "..." : action === "approve" ? "Aprovar e aplicar" : "Recusar"}
    </Button>
  );
}
