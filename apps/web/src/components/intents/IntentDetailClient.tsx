"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Check, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Intent {
  id: string;
  action: string;
  status: string;
  preview: { summary?: string; details?: Record<string, unknown> };
  payload: Record<string, unknown>;
  requester: { name: string | null; email: string | null };
  tokenName: string | null;
  approverName: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  rejectionReason: string | null;
  expiresAt: string;
  errorMessage: string | null;
  resultJson: unknown;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  CHARGE_CREATE: "Criar cobrança Asaas",
  ENVELOPE_SEND: "Enviar envelope ClickSign",
  CONTRACT_APPROVE: "Aprovar contrato",
  DEAL_DELETE_HARD: "Excluir deal (permanente)",
};

const STATUS_VARIANT: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pendente", variant: "default" },
  approved: { label: "Aprovada", variant: "secondary" },
  executed: { label: "Executada", variant: "secondary" },
  rejected: { label: "Rejeitada", variant: "destructive" },
  expired: { label: "Expirada", variant: "outline" },
  failed: { label: "Falhou", variant: "destructive" },
};

export function IntentDetailClient({ intent }: { intent: Intent }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const status = STATUS_VARIANT[intent.status] ?? {
    label: intent.status,
    variant: "outline" as const,
  };
  const isPending = intent.status === "pending";
  const expired = new Date(intent.expiresAt) < new Date();

  async function handleApprove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/intents/${intent.id}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.reason ?? err?.error ?? "Falha ao aprovar");
        return;
      }
      toast.success("Intent aprovada e executada");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    try {
      const res = await fetch(`/api/intents/${intent.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.reason ?? err?.error ?? "Falha ao rejeitar");
        return;
      }
      toast.success("Intent rejeitada");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/intents">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Link>
        </Button>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      {expired && isPending && (
        <div className="border border-amber-300 bg-amber-50 rounded-md p-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            Esta intent expirou em{" "}
            {new Date(intent.expiresAt).toLocaleString("pt-BR")}. Não pode mais
            ser aprovada — peça ao cliente externo para reenviar a chamada.
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground">Ação</p>
          <p className="font-medium">
            {ACTION_LABELS[intent.action] ?? intent.action}{" "}
            <code className="text-[11px] text-muted-foreground font-mono ml-1">
              {intent.action}
            </code>
          </p>
        </div>

        {intent.preview.summary && (
          <div>
            <p className="text-xs text-muted-foreground">Resumo</p>
            <p className="text-sm">{intent.preview.summary}</p>
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground">Solicitante</p>
          <p className="text-sm">
            {intent.requester.name ?? intent.requester.email ?? "—"}
            {intent.tokenName && (
              <span className="text-muted-foreground"> · token “{intent.tokenName}”</span>
            )}
          </p>
        </div>

        {intent.preview.details && Object.keys(intent.preview.details).length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Detalhes do preview</p>
            <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto font-mono">
              {JSON.stringify(intent.preview.details, null, 2)}
            </pre>
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground">Payload congelado</p>
          <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto font-mono">
            {JSON.stringify(intent.payload, null, 2)}
          </pre>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Criada</p>
            <p>{new Date(intent.createdAt).toLocaleString("pt-BR")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expira</p>
            <p>{new Date(intent.expiresAt).toLocaleString("pt-BR")}</p>
          </div>
          {intent.approvedAt && (
            <div>
              <p className="text-xs text-muted-foreground">Aprovada por</p>
              <p>
                {intent.approverName} ·{" "}
                {new Date(intent.approvedAt).toLocaleString("pt-BR")}
              </p>
            </div>
          )}
          {intent.executedAt && (
            <div>
              <p className="text-xs text-muted-foreground">Executada</p>
              <p>{new Date(intent.executedAt).toLocaleString("pt-BR")}</p>
            </div>
          )}
        </div>

        {intent.rejectionReason && (
          <div>
            <p className="text-xs text-muted-foreground">Motivo da rejeição</p>
            <p className="text-sm">{intent.rejectionReason}</p>
          </div>
        )}

        {intent.errorMessage && (
          <div>
            <p className="text-xs text-muted-foreground">Erro de execução</p>
            <p className="text-sm text-destructive">{intent.errorMessage}</p>
          </div>
        )}

        {intent.resultJson != null && (
          <div>
            <p className="text-xs text-muted-foreground">Resultado</p>
            <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto font-mono">
              {JSON.stringify(intent.resultJson, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {isPending && !expired && (
        <div className="flex gap-2 pt-2 border-t">
          <Button onClick={handleApprove} disabled={busy}>
            <Check className="h-4 w-4 mr-1" />
            Aprovar e executar
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busy}>
                <X className="h-4 w-4 mr-1" />
                Rejeitar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rejeitar intent?</AlertDialogTitle>
                <AlertDialogDescription>
                  O cliente externo verá esta intent como rejeitada. Adicione um
                  motivo (opcional) para registro.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Motivo (opcional)"
                maxLength={500}
                className="min-h-20"
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleReject}>
                  Rejeitar intent
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
