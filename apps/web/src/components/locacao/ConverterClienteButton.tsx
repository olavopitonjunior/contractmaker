"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserCheck } from "lucide-react";

/**
 * Converte o prospect num Tenant (locatário) reaproveitável. Idempotente no
 * backend por (orgId, cpfCnpj). Depois de convertido, o cliente pode ser puxado
 * no wizard "Novo contrato".
 */
export function ConverterClienteButton({
  clientId,
  alreadyConverted,
}: {
  clientId: string;
  alreadyConverted: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function convert() {
    setBusy(true);
    try {
      const res = await fetch(`/api/locacao/clients/${clientId}/convert`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success(
        d.reused ? "Locatário já existia — vinculado" : "Convertido em locatário"
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao converter");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant={alreadyConverted ? "outline" : "default"} onClick={convert} disabled={busy}>
      <UserCheck className="mr-1.5 h-4 w-4" />
      {busy ? "Convertendo…" : alreadyConverted ? "Reconverter em locatário" : "Converter em locatário"}
    </Button>
  );
}
