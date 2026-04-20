"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { useChallenge, computePayloadHash } from "@/hooks/useChallenge";

type ChallengeKind =
  | "TRANSFER"
  | "BANK_ACCOUNT_CHANGE"
  | "SUBACCOUNT_DELETE"
  | "DUAL_APPROVE"
  | "FEES_CHANGE";

/**
 * Dialog que gerencia todo o fluxo OTP por operação:
 * 1. Ao abrir: automaticamente faz POST /challenges com o payload.
 * 2. Mostra input do código 6 dígitos.
 * 3. Ao confirmar, chama onToken(challengeToken) — caller usa no X-Challenge-Token
 *    header da requisição sensível.
 */
export function ChallengeDialog({
  open,
  onOpenChange,
  kind,
  payload,
  title = "Confirme a operação",
  description,
  onToken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ChallengeKind;
  payload: unknown;
  title?: string;
  description?: string;
  onToken: (token: string) => void | Promise<void>;
}) {
  const { sentTo, request, confirm, cancel, reset, loading, error } = useChallenge();
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open) {
      reset();
      setCode("");
      return;
    }
    (async () => {
      const hash = await computePayloadHash(payload);
      const r = await request(kind, hash);
      if (!r.ok) {
        toast.error("Falha ao enviar código");
        onOpenChange(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleConfirm() {
    const r = await confirm(code);
    if (r.ok && r.token) {
      await onToken(r.token);
      onOpenChange(false);
    }
  }

  async function handleCancel() {
    await cancel();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ??
              `Enviamos um código de 6 dígitos para ${sentTo ?? "seu email"}. Digite abaixo:`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="font-mono text-2xl text-center tracking-widest"
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={loading || code.length !== 6}>
            {loading ? "Verificando..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
