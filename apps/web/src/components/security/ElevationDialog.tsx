"use client";
import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { useElevation } from "@/hooks/useElevation";

type ElevationScope =
  | "TRANSFER"
  | "KYC_EDIT"
  | "BANK_ACCOUNT"
  | "API_KEY_ROTATE"
  | "MEMBER_MANAGE"
  | "FEES_CONFIG";

const SCOPE_LABELS: Record<ElevationScope, string> = {
  TRANSFER: "Transferir valores",
  KYC_EDIT: "Editar dados KYC",
  BANK_ACCOUNT: "Alterar conta bancária",
  API_KEY_ROTATE: "Rotacionar API key",
  MEMBER_MANAGE: "Gerenciar membros",
  FEES_CONFIG: "Configurar taxas",
};

export function ElevationDialog({
  open,
  onOpenChange,
  scopes,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopes: ElevationScope[];
  onSuccess?: () => void;
}) {
  const { elevate } = useElevation();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    try {
      const payload = useRecovery
        ? { password, recoveryCode: code, scopes }
        : { password, code, scopes };
      const result = await elevate(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Identidade confirmada");
      setPassword("");
      setCode("");
      onSuccess?.();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirme sua identidade</DialogTitle>
          <DialogDescription>
            Esta ação exige confirmação. Você poderá executar operações em{" "}
            {scopes.map((s) => SCOPE_LABELS[s]).join(", ")} durante 15 minutos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="elev-password">Senha</Label>
            <Input
              id="elev-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>

          {useRecovery ? (
            <div>
              <Label htmlFor="elev-recovery">Código de recuperação</Label>
              <Input
                id="elev-recovery"
                placeholder="XXXXX-XXXXX"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono"
              />
              <button
                type="button"
                className="text-xs text-muted-foreground mt-1 underline"
                onClick={() => setUseRecovery(false)}
              >
                Usar código do app autenticador
              </button>
            </div>
          ) : (
            <div>
              <Label htmlFor="elev-code">Código 2FA (6 dígitos)</Label>
              <Input
                id="elev-code"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="font-mono text-lg tracking-widest text-center"
              />
              <button
                type="button"
                className="text-xs text-muted-foreground mt-1 underline"
                onClick={() => setUseRecovery(true)}
              >
                Usar código de recuperação
              </button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !password || !code}
          >
            {loading ? "Verificando..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
