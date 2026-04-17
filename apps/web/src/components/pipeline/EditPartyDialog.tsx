"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { CertidaoJobRow } from "@/hooks/useCertidoesBatch";

interface Props {
  job: CertidaoJobRow;
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the party data is saved so the parent can retry the job. */
  onSaved: () => void | Promise<void>;
}

interface PartySnapshot {
  tipo_pessoa?: "fisica" | "juridica";
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  data_nascimento?: string;
  uf?: string;
  cidade?: string;
  estado_civil?: string;
}

/**
 * Phase A — inline party editor invoked from a CertidaoJob whose portal
 * response categorized as missing_input / inconsistent_input.
 *
 * Flow:
 *   1. Fetch current deal.dataJson (so we know the party snapshot)
 *   2. Pre-fill fields; user edits the relevant ones (name, birthdate, doc)
 *   3. POST edited fields to /certidoes/:jobId/complete (merges + re-plans
 *      + creates a new job; old one becomes status="replaced")
 *   4. Parent retries implicitly via the new job row appearing on the next
 *      useCertidoesBatch poll
 */
export function EditPartyDialog({
  job,
  dealId,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const [snapshot, setSnapshot] = useState<PartySnapshot | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load current party snapshot from the deal so the form pre-fills.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/deals/${dealId}`);
        if (!res.ok) {
          toast.error("Não foi possível carregar dados do negócio");
          onOpenChange(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const deal = data.deal ?? data; // tolerate both wrapper shapes
        const dealData = (deal?.dataJson ?? deal?.data ?? {}) as Record<
          string,
          unknown
        >;
        const arrKey =
          job.targetKind === "vendedor" ? "vendedores" : "compradores";
        const arr = (dealData[arrKey] as PartySnapshot[] | undefined) ?? [];
        const party = arr[job.targetIndex] ?? {};
        setSnapshot(party);
        setValues({
          nome: party.nome ?? party.razao_social ?? "",
          cpf: party.cpf ?? "",
          cnpj: party.cnpj ?? "",
          data_nascimento: party.data_nascimento ?? "",
          uf: party.uf ?? "",
          cidade: party.cidade ?? "",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dealId, job.targetKind, job.targetIndex, onOpenChange]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const basePath =
        job.targetKind === "vendedor"
          ? `vendedores.${job.targetIndex}`
          : `compradores.${job.targetIndex}`;
      const isPJ = snapshot?.tipo_pessoa === "juridica";
      const fields: Record<string, string> = {};
      const pushIfChanged = (key: string, current: string | undefined) => {
        const next = values[key] ?? "";
        // Only send changed fields to avoid blind overwrites from the dialog.
        if (next !== (current ?? "")) {
          fields[`${basePath}.${key === "nome" && isPJ ? "razao_social" : key}`] = next;
        }
      };
      pushIfChanged("nome", snapshot?.nome ?? snapshot?.razao_social);
      pushIfChanged("cpf", snapshot?.cpf);
      pushIfChanged("cnpj", snapshot?.cnpj);
      pushIfChanged("data_nascimento", snapshot?.data_nascimento);
      pushIfChanged("uf", snapshot?.uf);
      pushIfChanged("cidade", snapshot?.cidade);

      if (Object.keys(fields).length === 0) {
        toast.info("Nenhuma alteração para salvar");
        onOpenChange(false);
        return;
      }

      const res = await fetch(
        `/api/deals/${dealId}/certidoes/${job.id}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Falha ao atualizar parte");
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const isPJ = snapshot?.tipo_pessoa === "juridica";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Editar dados da parte
          </DialogTitle>
          <DialogDescription>
            O portal rejeitou a consulta por divergência de dados. Ajuste os
            campos abaixo e a certidão será reenviada automaticamente.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Carregando…
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">
                {isPJ ? "Razão social" : "Nome completo"}
              </Label>
              <Input
                value={values.nome ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, nome: e.target.value }))
                }
              />
            </div>
            {isPJ ? (
              <div className="space-y-1">
                <Label className="text-xs">CNPJ</Label>
                <Input
                  value={values.cnpj ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, cnpj: e.target.value }))
                  }
                  placeholder="00.000.000/0000-00"
                />
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">CPF</Label>
                  <Input
                    value={values.cpf ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, cpf: e.target.value }))
                    }
                    placeholder="000.000.000-00"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data de nascimento</Label>
                  <Input
                    type="date"
                    value={values.data_nascimento ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        data_nascimento: e.target.value,
                      }))
                    }
                  />
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">UF</Label>
                <Input
                  maxLength={2}
                  value={values.uf ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      uf: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="SP"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cidade</Label>
                <Input
                  value={values.cidade ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, cidade: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Salvando…
              </>
            ) : (
              "Salvar e reenviar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
