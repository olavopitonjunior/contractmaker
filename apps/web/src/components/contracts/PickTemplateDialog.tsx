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
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, Check } from "lucide-react";

export interface TemplateChoice {
  id: string;
  name: string;
  modalidade: string | null;
  modalidadeLabel: string;
  isDefault: boolean;
  criteria: string[];
}

/**
 * Escolha manual do modelo na geração do contrato.
 *
 * Existe porque o pareamento automático só sabe decidir com FATOS do
 * formulário (garantia, PF/PJ, administração). Quando o que distingue dois
 * modelos não está no formulário — "este é o de curta temporada" — o modelo
 * fica inalcançável, e antes disso não havia nenhuma forma de alcançá-lo.
 *
 * Deliberadamente NÃO é o caminho principal: o botão continua gerando pelo
 * automático, e isto fica atrás de "Escolher outro modelo". O automático
 * acerta na esmagadora maioria e cada escolha manual é uma chance de errar.
 */
export function PickTemplateDialog({
  open,
  onOpenChange,
  dealId,
  hasContract,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dealId: string;
  /** Já existe contrato: gerar de novo cria uma versão e órfã o Doc anterior. */
  hasContract: boolean;
  onConfirm: (templateId: string) => void | Promise<void>;
}) {
  const [choices, setChoices] = useState<TemplateChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChoices(null);
    setError(null);
    setSelected(null);
    fetch(`/api/pipeline/deals/${dealId}/template-choices`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Falha ao carregar os modelos");
        setChoices(data.templates ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erro de rede"));
  }, [open, dealId]);

  async function confirm() {
    if (!selected) return;
    setSubmitting(true);
    try {
      await onConfirm(selected);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Escolher outro modelo</DialogTitle>
          <DialogDescription>
            Normalmente o modelo é escolhido sozinho pelas respostas do
            formulário. Use isto quando o contrato certo for um que o
            formulário não tem como indicar.
          </DialogDescription>
        </DialogHeader>

        {hasContract && (
          <div className="flex gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
            <p>
              Este negócio já tem contrato. Gerar de novo cria uma{" "}
              <b>nova versão</b> — a anterior continua no histórico, mas deixa de
              ser a atual.
            </p>
          </div>
        )}

        <div className="max-h-[46vh] space-y-2 overflow-y-auto">
          {error && <p className="text-sm text-destructive">{error}</p>}

          {!choices && !error && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando modelos…
            </div>
          )}

          {choices?.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">
              Nenhum modelo ativo serve para este tipo de negócio. Envie ou ative
              um em Modelos.
            </p>
          )}

          {choices?.map((t) => {
            const isSel = selected === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t.id)}
                aria-pressed={isSel}
                className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
                  isSel
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <div
                  className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                    isSel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                  }`}
                >
                  {isSel && <Check className="h-3 w-3" />}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{t.name}</span>
                    {t.isDefault && (
                      <Badge variant="secondary" className="text-[10px]">
                        padrão da modalidade
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.modalidadeLabel}
                    {t.criteria.length > 0 && ` · ${t.criteria.join(" · ")}`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={!selected || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Gerar com este modelo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
