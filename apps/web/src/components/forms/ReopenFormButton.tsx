"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Undo2, FileWarning } from "lucide-react";
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

interface ReopenFormButtonProps {
  /** Token do SalesForm — a rota `/api/forms/[token]/lock` é kind-agnóstica. */
  token: string;
  /**
   * Só formulário JÁ ENVIADO pode ser reaberto. "Enviado" =
   * `completedAt != null || status === "vinculado"` — o mesmo critério do gate
   * (lib/forms/form-gate.ts::isFormClosed). Fora disso o botão nem aparece (a
   * rota devolveria 409).
   */
  submitted: boolean;
  /** `reopenedAt` atual do form (ISO) — quando setado, o form está reaberto. */
  reopenedAt: string | null;
  disabled?: boolean;
  /**
   * Reabrir limpa `lockedAt` no servidor. O header que renderiza este botão
   * guarda o estado de travamento localmente, então avisamos pra ele sincronizar
   * (some o badge "Travado", volta pra "Travar").
   */
  onReopened?: () => void;
}

/**
 * Botão manual (usuário interno) que reabre um formulário público já enviado pra
 * o cliente voltar a corrigir/completar pelo link. Reflete o estado reaberto e
 * re-trava sozinho no próximo envio (o finalize zera `reopenedAt`). O backend
 * (`POST /api/forms/[token]/lock { locked:false, reopen:true }`) já faz o escopo
 * por-negócio + cross-org guard + auditoria `FORM_REOPENED`.
 *
 * Compartilhado entre o header de vendas (DealDetail) e o de locação
 * (LocacaoDealHeaderActions) — as duas esteiras são linhas de `SalesForm`.
 */
export function ReopenFormButton({
  token,
  submitted,
  reopenedAt: initialReopenedAt,
  disabled,
  onReopened,
}: ReopenFormButtonProps) {
  const router = useRouter();
  const [reopenedAt, setReopenedAt] = useState<string | null>(initialReopenedAt);
  const [busy, setBusy] = useState(false);

  // Já reaberto: nada a reabrir, só sinaliza o estado. O próximo envio re-trava.
  if (reopenedAt) {
    return (
      <Badge variant="secondary" className="gap-1 self-center">
        <Undo2 className="h-3 w-3" />
        Reaberto para edição
      </Badge>
    );
  }

  // Form ainda não enviado → não há o que reabrir.
  if (!submitted) return null;

  async function handleReopen() {
    setBusy(true);
    try {
      const res = await fetch(`/api/forms/${token}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: false, reopen: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Falha ao reabrir o formulário");
        return;
      }
      setReopenedAt(data.reopenedAt ?? new Date().toISOString());
      onReopened?.();
      toast.success(
        "Formulário reaberto — o cliente pode editar pelo link novamente",
      );
      // Ressincroniza o status (completo → rascunho) e derivados vindos do server.
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          title="Reabrir: devolve ao cliente o acesso de edição pelo link público até o próximo envio"
        >
          {busy ? (
            <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Undo2 className="h-4 w-4 mr-1" />
          )}
          Reabrir formulário
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <FileWarning className="h-4 w-4 text-amber-500" />
            Reabrir o formulário enviado?
          </AlertDialogTitle>
          <AlertDialogDescription>
            O link público volta a aceitar edições do cliente e a exibir os dados
            já preenchidos (incluindo dados pessoais). Ao enviar de novo, o
            formulário se trava automaticamente e o contrato é ressincronizado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleReopen();
            }}
            disabled={busy}
          >
            Reabrir formulário
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
