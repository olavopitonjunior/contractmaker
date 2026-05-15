"use client";

/**
 * Dialog de expansão de vínculos PJ↔PF Serasa.
 *
 * Fluxo (opt-in manual, S4 do plano):
 *   1. Usuário aciona "Descobrir empresas vinculadas" pra um CPF do deal.
 *   2. POST /api/deals/[id]/serasa/expand-vinculos cria 1 CertidaoJob.
 *   3. Caller (CertidaoDetailDialog ou CertidoesTab) re-renderiza com o
 *      resultData.raw.vinculos[] quando o job conclui.
 *   4. Este dialog mostra checkbox por CNPJ; submit chama
 *      POST /api/deals/[id]/diligenciados (bulk) pra criar DiligentedPerson
 *      rows. Em seguida o usuário pode disparar nova rodada Serasa pra esses
 *      CNPJs via picker normal.
 *
 * NÃO dispara consultas Serasa automaticamente — o usuário tem que ir no
 * picker e selecionar score+restritivos pros novos diligenciados. Esse
 * "double-click" é proposital pra evitar bill-shock.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Building2 } from "lucide-react";

export interface SerasaVinculo {
  cnpj?: string;
  razaoSocial?: string;
  papel?: string;
  percentual?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  vinculos: SerasaVinculo[];
  /** Optional callback fired após criação bem-sucedida dos diligenciados. */
  onCreated?: () => void;
}

export function VinculosExpandDialog({
  open,
  onOpenChange,
  dealId,
  vinculos,
  onCreated,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = (cnpj: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cnpj)) next.delete(cnpj);
      else next.add(cnpj);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    const picked = vinculos.filter((v) => v.cnpj && selected.has(v.cnpj));
    let createdCount = 0;
    let errorCount = 0;
    for (const v of picked) {
      try {
        const res = await fetch(`/api/deals/${dealId}/diligenciados`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipoPessoa: "juridica",
            nome: v.razaoSocial ?? `CNPJ ${v.cnpj}`,
            cnpj: v.cnpj,
            relacao: "socio",
            notes: `Descoberto via Serasa (${v.papel ?? "vinculo"}${
              v.percentual ? `, ${v.percentual}%` : ""
            }).`,
          }),
        });
        if (res.ok) createdCount += 1;
        else errorCount += 1;
      } catch {
        errorCount += 1;
      }
    }
    setSubmitting(false);
    if (createdCount > 0) {
      toast.success(
        `${createdCount} diligenciado${createdCount > 1 ? "s" : ""} criado${
          createdCount > 1 ? "s" : ""
        }. Use o picker pra disparar Serasa neles.`
      );
      onCreated?.();
      setSelected(new Set());
      onOpenChange(false);
    }
    if (errorCount > 0) {
      toast.error(`${errorCount} falharam ao criar. Tente novamente.`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Empresas vinculadas a este CPF</DialogTitle>
          <DialogDescription>
            Selecione as empresas que devem entrar no deal como diligenciadas.
            Depois, no picker, dispare Serasa (score + restritivos) pra elas
            individualmente.
          </DialogDescription>
        </DialogHeader>

        {vinculos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhum vínculo retornado pelo Serasa.
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto space-y-1">
            {vinculos.map((v, i) => {
              const cnpj = v.cnpj ?? "";
              const isChecked = selected.has(cnpj);
              return (
                <div
                  key={cnpj || i}
                  className={`flex items-start gap-2 rounded border p-2 text-sm ${
                    cnpj ? "hover:bg-muted/30 cursor-pointer" : "opacity-50"
                  }`}
                  onClick={() => cnpj && toggle(cnpj)}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={!cnpj}
                    onChange={() => {}}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{v.razaoSocial ?? "Sem razão social"}</div>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      <span className="font-mono text-xs text-muted-foreground">{v.cnpj}</span>
                      {v.papel && (
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {v.papel}
                        </Badge>
                      )}
                      {typeof v.percentual === "number" && (
                        <Badge variant="secondary" className="text-[10px]">
                          {v.percentual}%
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || selected.size === 0}>
            {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Adicionar {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
