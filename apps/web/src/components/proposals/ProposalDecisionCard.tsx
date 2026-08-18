"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Send, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  EnviarProprietarioDialog,
  type PlanVendedor,
} from "./EnviarProprietarioDialog";
import { parseProposalApiError } from "@/lib/proposals/api-errors";

/**
 * CARD DE DECISÃO da parada (`assinada_proponente`) — o proponente assinou e a
 * jornada não anda sozinha: o corretor escolhe entre enviar a 2ª via ao
 * proprietário/locador ou concluir sem enviar. Borda warning porque é "sua
 * vez" — o mesmo sinal do sino e da timeline.
 *
 * `?action=enviar-proprietario` (link "Decidir…" da listagem) abre o diálogo
 * de envio direto.
 */
export function ProposalDecisionCard({
  proposalId,
  kind,
  vendedores,
  custoLabel,
}: {
  proposalId: string;
  kind: string;
  vendedores: PlanVendedor[];
  custoLabel: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const vendedorLabel = kind === "locacao" ? "locador" : "proprietário";
  const [sendOpen, setSendOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (searchParams.get("action") === "enviar-proprietario") setSendOpen(true);
    // Só na montagem — reabrir a cada navegação de searchParams irritaria.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function concluir() {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseProposalApiError(d, res.status));
      toast.success("Proposta concluída. Já pode converter em negócio.");
      setCompleteOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao concluir");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-warning/60 bg-warning/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">O proponente assinou — decida o próximo passo</p>
          <p className="text-sm text-muted-foreground">
            Envie a via do {vendedorLabel} para assinatura, ou conclua a proposta
            sem enviar (ex.: o {vendedorLabel} já aceitou por fora).
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button onClick={() => setSendOpen(true)} disabled={busy}>
            <Send className="mr-1.5 h-4 w-4" /> Enviar ao {vendedorLabel}
          </Button>
          <Button variant="outline" onClick={() => setCompleteOpen(true)} disabled={busy}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" /> Concluir sem enviar
          </Button>
        </div>
      </div>

      <EnviarProprietarioDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        proposalId={proposalId}
        vendedorLabel={vendedorLabel}
        vendedores={vendedores}
        custoLabel={custoLabel}
      />

      <AlertDialog open={completeOpen} onOpenChange={(o) => !busy && setCompleteOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Concluir sem enviar ao {vendedorLabel}</AlertDialogTitle>
            <AlertDialogDescription>
              A proposta fecha como concluída com a assinatura do proponente. A via
              do {vendedorLabel} não será enviada. Motivo é opcional — fica no
              histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Motivo (opcional) — ex.: o ${vendedorLabel} aceitou por WhatsApp`}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void concluir();
              }}
            >
              Concluir proposta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
