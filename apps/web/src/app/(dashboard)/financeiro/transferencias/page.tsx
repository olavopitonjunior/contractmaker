"use client";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ElevationDialog } from "@/components/security/ElevationDialog";
import { ChallengeDialog } from "@/components/security/ChallengeDialog";
import { useElevation } from "@/hooks/useElevation";
import { useAccountIdParam } from "@/hooks/useAccountIdParam";
import {
  Wallet,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Send,
} from "lucide-react";
import { maskCpfCnpj } from "@/lib/security/pii";

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

interface TransferRow {
  id: string;
  asaasTransferId: string;
  value: number;
  netValue: number | null;
  type: string;
  status: string;
  pixAddressKey: string | null;
  ownerName: string | null;
  createdAt: string;
  scheduledDate: string | null;
  user: { name: string | null };
}

const STATUS_UI: Record<
  string,
  { text: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  PENDING: { text: "Processando", icon: Clock, color: "bg-amber-100 text-amber-900" },
  BANK_PROCESSING: {
    text: "No banco",
    icon: Clock,
    color: "bg-blue-100 text-blue-900",
  },
  DONE: { text: "Concluída", icon: CheckCircle2, color: "bg-green-100 text-green-900" },
  FAILED: { text: "Falhou", icon: XCircle, color: "bg-red-100 text-red-900" },
  CANCELLED: { text: "Cancelada", icon: XCircle, color: "bg-gray-100 text-gray-700" },
};

export default function TransferenciasPage() {
  const elevation = useElevation();
  const accountId = useAccountIdParam();
  const accountQs = accountId ? `?accountId=${accountId}` : "";
  const [balance, setBalance] = useState<number | null>(null);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [type, setType] = useState<"PIX" | "TED">("PIX");
  const [pixKey, setPixKey] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");

  // Dialogs
  const [elevOpen, setElevOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [dualApprovalPending, setDualApprovalPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [balRes, trRes] = await Promise.all([
        fetch(`/api/financeiro/balance${accountQs}`, { credentials: "include" }),
        fetch(`/api/financeiro/transfers${accountQs}`, { credentials: "include" }),
      ]);
      if (balRes.ok) {
        const b = await balRes.json();
        setBalance(b.balance);
      }
      if (trRes.ok) {
        const t = await trRes.json();
        setTransfers(t.transfers ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [accountQs]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleInitiate() {
    if (!elevation.hasScope("TRANSFER")) {
      setElevOpen(true);
      return;
    }
    await doPreview();
  }

  async function doPreview() {
    setBusy(true);
    try {
      const body: any = {
        type,
        value: parseFloat(value),
      };
      if (accountId) body.accountId = accountId;
      if (type === "PIX") body.pixAddressKey = pixKey;

      const res = await fetch("/api/financeiro/transfers/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "INSUFFICIENT_BALANCE") {
          toast.error(
            `Saldo insuficiente. Disponível: ${fmtBRL(data.available)}`
          );
        } else if (data.error === "HARD_CAP_EXCEEDED") {
          toast.error(`Valor acima do limite máximo: ${fmtBRL(data.hardCapBrl)}`);
        } else if (data.error === "ELEVATION_REQUIRED") {
          setElevOpen(true);
        } else {
          toast.error(data.error ?? "Falha");
        }
        return;
      }
      setPreview(data);
      setPreviewOpen(true);
    } finally {
      setBusy(false);
    }
  }

  function handleConfirmPreview() {
    setPreviewOpen(false);
    setChallengeOpen(true);
  }

  async function handleChallengeConfirmed(token: string) {
    setBusy(true);
    try {
      const body: any = { type, value: parseFloat(value), description };
      if (accountId) body.accountId = accountId;
      if (type === "PIX") body.pixAddressKey = pixKey;

      const res = await fetch("/api/financeiro/transfers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Challenge-Token": token,
        },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao transferir");
        return;
      }
      if (data.status === "PENDING_APPROVAL") {
        toast.success(
          `Transferência acima do limite. Aguardando aprovação de ${data.adminsNotified} admin(s).`
        );
        setDualApprovalPending(data.approvalId);
      } else {
        toast.success("Transferência iniciada");
        setValue("");
        setPixKey("");
        setDescription("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Transferências</h1>
        <p className="text-sm text-muted-foreground">
          Retire valores da sua conta Asaas para sua conta bancária.
        </p>
      </div>

      {/* Saldo destaque */}
      <Card>
        <CardContent className="pt-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Saldo disponível</div>
            <div className="text-3xl font-bold">
              {balance != null ? fmtBRL(balance) : "—"}
            </div>
          </div>
          <Button variant="outline" onClick={load}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Form nova transferência */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nova transferência</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="mb-2 block">Tipo</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["PIX", "TED"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={t === "TED"} // TED UI ainda não implementado (fase 3.x)
                    onClick={() => setType(t)}
                    className={`border rounded-md p-3 text-sm font-medium ${
                      type === t
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-muted"
                    } ${t === "TED" ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {t === "PIX" ? "PIX" : "TED"}
                    <div className="text-xs font-normal text-muted-foreground mt-1">
                      {t === "PIX" ? "Instantâneo, grátis" : "D+1, ~R$ 1,50"}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {type === "PIX" && (
              <div>
                <Label htmlFor="pix-key">Chave PIX do destinatário</Label>
                <Input
                  id="pix-key"
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  placeholder="CPF, CNPJ, email ou chave aleatória"
                />
              </div>
            )}

            <div>
              <Label htmlFor="val">Valor (R$)</Label>
              <Input
                id="val"
                type="number"
                step="0.01"
                min="1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0,00"
              />
              {balance != null && parseFloat(value) > balance && (
                <p className="text-xs text-red-600 mt-1">Maior que saldo disponível</p>
              )}
            </div>

            <div>
              <Label htmlFor="desc">Descrição (opcional)</Label>
              <Input
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Saque mensal"
                maxLength={140}
              />
            </div>

            <Button
              onClick={handleInitiate}
              disabled={busy || !value || (type === "PIX" && !pixKey)}
              className="w-full"
            >
              <Send className="h-4 w-4 mr-2" />
              Continuar
            </Button>
            {!elevation.hasScope("TRANSFER") && (
              <p className="text-xs text-muted-foreground text-center">
                Exige confirmação de identidade (senha + 2FA)
              </p>
            )}
          </CardContent>
        </Card>

        {/* Histórico */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {transfers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center p-6">
                Nenhuma transferência ainda
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t) => {
                    const ui = STATUS_UI[t.status] ?? STATUS_UI.PENDING;
                    const Icon = ui.icon;
                    return (
                      <tr key={t.id} className="border-t">
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-xs">
                            {t.type}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {fmtBRL(t.value)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={ui.color}>
                            <Icon className="h-3 w-3 mr-1" />
                            {ui.text}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Elevation dialog */}
      <ElevationDialog
        open={elevOpen}
        onOpenChange={setElevOpen}
        scopes={["TRANSFER"]}
        onSuccess={() => doPreview()}
      />

      {/* Preview confirm dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirme a transferência
            </DialogTitle>
            <DialogDescription>
              Esta operação não pode ser desfeita após confirmação.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="text-center py-4 bg-muted rounded">
                <div className="text-sm text-muted-foreground">Você vai enviar</div>
                <div className="text-3xl font-bold my-1">
                  {fmtBRL(preview.requestedValue)}
                </div>
                {preview.estimatedFee > 0 && (
                  <div className="text-xs text-muted-foreground">
                    + {fmtBRL(preview.estimatedFee)} taxa
                  </div>
                )}
              </div>
              {preview.pixValidation?.ownerName && (
                <div className="p-3 border rounded bg-green-50">
                  <div className="text-xs text-green-800 mb-1">Destino validado:</div>
                  <div className="font-semibold">{preview.pixValidation.ownerName}</div>
                  {preview.pixValidation.ownerCpfCnpj && (
                    <div className="text-xs text-muted-foreground">
                      {maskCpfCnpj(preview.pixValidation.ownerCpfCnpj)}
                    </div>
                  )}
                  {preview.pixValidation.bank && (
                    <div className="text-xs text-muted-foreground">
                      {preview.pixValidation.bank}
                    </div>
                  )}
                </div>
              )}
              {preview.requiresDualApproval && (
                <div className="p-3 border border-amber-300 rounded bg-amber-50 text-sm text-amber-900">
                  ⚠ Valor acima de {fmtBRL(preview.dualApprovalCapBrl)}. Exige aprovação
                  de um segundo admin antes de executar.
                </div>
              )}
              <div className="text-xs text-muted-foreground space-y-1">
                <div>
                  Saldo após: {fmtBRL(preview.netAfterTransfer)}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmPreview} disabled={busy}>
              Enviar código por email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Challenge OTP */}
      <ChallengeDialog
        open={challengeOpen}
        onOpenChange={setChallengeOpen}
        kind="TRANSFER"
        payload={{
          type,
          value: parseFloat(value || "0"),
          description: description || undefined,
          ...(type === "PIX" ? { pixAddressKey: pixKey } : {}),
        }}
        title="Confirme a transferência"
        onToken={handleChallengeConfirmed}
      />

      {/* Dual approval pending notice */}
      {dualApprovalPending && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-6 space-y-2">
            <div className="font-medium text-amber-900">
              ⏳ Transferência aguardando aprovação dupla
            </div>
            <p className="text-sm text-amber-800">
              Um email foi enviado aos admins da organização. Tão logo um deles
              aprovar, a transferência será executada automaticamente.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = `/financeiro/dual-approvals/${dualApprovalPending}`;
              }}
            >
              Ver status
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
