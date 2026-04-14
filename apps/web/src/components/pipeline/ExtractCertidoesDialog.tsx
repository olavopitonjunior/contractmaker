"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Loader2, Wallet } from "lucide-react";

interface PlannedJob {
  endpoint: string;
  label: string;
  targetKind: string;
  targetIndex: number;
  costCents: number;
}

interface SkippedJob {
  endpoint: string;
  label: string;
  reason: string;
  missingField: string;
}

interface ExtractionPlan {
  jobs: PlannedJob[];
  skipped: SkippedJob[];
  totalCostCents: number;
}

interface Spend {
  spentCents: number;
  budgetCents: number;
  exceeded: boolean;
}

interface ExtractCertidoesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  onConfirm: () => Promise<void> | void;
}

export function ExtractCertidoesDialog({
  open,
  onOpenChange,
  dealId,
  onConfirm,
}: ExtractCertidoesDialogProps) {
  const [plan, setPlan] = useState<ExtractionPlan | null>(null);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/deals/${dealId}/certidoes/plan`)
      .then((r) => r.json())
      .then((data) => {
        setPlan(data.plan);
        setSpend(data.spend);
      })
      .finally(() => setLoading(false));
  }, [open, dealId]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const custoReais = plan ? (plan.totalCostCents / 100).toFixed(2) : "0,00";
  const budgetReais = spend ? (spend.budgetCents / 100).toFixed(2) : "0,00";
  const gastoReais = spend ? (spend.spentCents / 100).toFixed(2) : "0,00";
  const excederia =
    spend && plan
      ? spend.spentCents + plan.totalCostCents > spend.budgetCents
      : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Extrair certidões via Infosimples</DialogTitle>
          <DialogDescription>
            Revise as certidões que serão extraídas antes de confirmar. As chamadas
            levam entre 5 e 30 segundos cada e geram créditos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando plano de extração…
            </div>
          )}

          {!loading && plan && (
            <>
              <div className="rounded-md border bg-muted/20 p-3 text-sm flex items-center gap-3">
                <Wallet className="h-4 w-4" />
                <div className="flex-1">
                  <strong>Custo estimado:</strong> R$ {custoReais.replace(".", ",")} —{" "}
                  {plan.jobs.length} certidões prontas
                </div>
                {excederia && (
                  <Badge variant="destructive" className="shrink-0">
                    Budget excedido
                  </Badge>
                )}
              </div>

              {spend && (
                <p className="text-xs text-muted-foreground">
                  Gasto do mês: R$ {gastoReais.replace(".", ",")} / R${" "}
                  {budgetReais.replace(".", ",")}
                </p>
              )}

              {plan.jobs.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-1 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Certidões a extrair ({plan.jobs.length})
                  </h4>
                  <ul className="text-xs space-y-1 max-h-48 overflow-y-auto border rounded p-2">
                    {plan.jobs.map((j, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate">{j.label}</span>
                        <span className="shrink-0 text-muted-foreground">
                          R$ {(j.costCents / 100).toFixed(2).replace(".", ",")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.skipped.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-1 flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    Pulando por falta de dados ({plan.skipped.length})
                  </h4>
                  <ul className="text-xs space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                    {plan.skipped.map((s, i) => (
                      <li key={i}>
                        <span className="font-medium">{s.label}</span>:{" "}
                        <span className="text-muted-foreground">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              submitting ||
              loading ||
              !plan ||
              plan.jobs.length === 0 ||
              excederia
            }
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Iniciando…
              </>
            ) : (
              `Extrair ${plan?.jobs.length ?? 0} certidões`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
