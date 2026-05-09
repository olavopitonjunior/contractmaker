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
import { Wallet, KeyRound } from "lucide-react";

import type { ComissionadoLike } from "@/lib/asaas/commissionados-matcher";

interface CreatedRecipient {
  id: string;
  label: string;
  recipientType: "asaas_wallet" | "pix_external";
  walletId: string | null;
  pixAddressKey: string | null;
  pixKeyType: string | null;
  ownerName: string | null;
  ownerCpfCnpj: string | null;
  cpfCnpj: string | null;
  email: string | null;
  active: boolean;
}

interface Props {
  open: boolean;
  prefill: ComissionadoLike;
  onClose: () => void;
  onCreated: (recipient: CreatedRecipient) => void;
}

/**
 * Dialog compacto para criar um SplitRecipient sem sair do wizard de cobrança.
 *
 * Pré-popula nome + CPF/CNPJ a partir do comissionado extraído. Pede só:
 *   - Tipo (asaas_wallet | pix_external)
 *   - walletId (se Asaas) ou chave PIX + tipo (se PIX externo)
 *   - email (opt-in pra notificação interna pós-pagamento)
 */
export function SplitRecipientInlineDialog({
  open,
  prefill,
  onClose,
  onCreated,
}: Props) {
  const [tipo, setTipo] = useState<"asaas_wallet" | "pix_external">("pix_external");
  const [label, setLabel] = useState(prefill.nome ?? "");
  const [walletId, setWalletId] = useState("");
  const [pixKey, setPixKey] = useState(
    prefill.cpf || prefill.cnpj || prefill.email || prefill.mobile_phone || ""
  );
  const [ownerName, setOwnerName] = useState(prefill.nome ?? "");
  const [ownerCpfCnpj, setOwnerCpfCnpj] = useState(
    prefill.cpf || prefill.cnpj || ""
  );
  const [email, setEmail] = useState(prefill.email ?? "");
  const [draftMode, setDraftMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      // Em rascunho, marca campos críticos como pendentes.
      const pendingFields: string[] = [];
      if (draftMode) {
        if (tipo === "asaas_wallet" && walletId.trim() === "") {
          pendingFields.push("walletId");
        }
        if (tipo === "pix_external" && pixKey.trim() === "") {
          pendingFields.push("pixAddressKey");
        }
      }

      const body =
        tipo === "asaas_wallet"
          ? {
              recipientType: "asaas_wallet" as const,
              label,
              walletId: walletId.trim(),
              cpfCnpj: ownerCpfCnpj.trim() || undefined,
              email: email.trim() || undefined,
              pendingFields: pendingFields.length > 0 ? pendingFields : undefined,
            }
          : {
              recipientType: "pix_external" as const,
              label,
              pixAddressKey: pixKey.trim(),
              ownerName: ownerName.trim(),
              ownerCpfCnpj: ownerCpfCnpj.trim(),
              email: email.trim() || undefined,
              pendingFields: pendingFields.length > 0 ? pendingFields : undefined,
            };
      const res = await fetch("/api/financeiro/split-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? `Erro ${res.status}`);
        return;
      }
      toast.success("Destinatário cadastrado");
      onCreated(data.recipient as CreatedRecipient);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    label.trim().length > 0 &&
    (draftMode
      ? // rascunho: só exige label + dados de identificação
        tipo === "asaas_wallet"
        ? true
        : ownerName.trim().length > 0 &&
          ownerCpfCnpj.replace(/\D/g, "").length >= 11
      : tipo === "asaas_wallet"
        ? walletId.trim().length > 0
        : pixKey.trim().length > 0 &&
          ownerName.trim().length > 0 &&
          ownerCpfCnpj.replace(/\D/g, "").length >= 11);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cadastrar destinatário de split</DialogTitle>
          <DialogDescription>
            {prefill.nome
              ? `${prefill.nome} ainda não está cadastrado nesta org. Adicione abaixo para que possa receber repasses.`
              : "Adicione um novo destinatário para receber repasses de cobranças."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="mb-2 block">Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`border rounded-md p-3 text-sm font-medium transition flex flex-col items-center ${
                  tipo === "pix_external"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-muted"
                }`}
                onClick={() => setTipo("pix_external")}
              >
                <KeyRound className="h-4 w-4 mb-1" />
                PIX externo
                <span className="text-xs font-normal text-muted-foreground mt-1 text-center">
                  Beneficiário em outro banco
                </span>
              </button>
              <button
                type="button"
                className={`border rounded-md p-3 text-sm font-medium transition flex flex-col items-center ${
                  tipo === "asaas_wallet"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-muted"
                }`}
                onClick={() => setTipo("asaas_wallet")}
              >
                <Wallet className="h-4 w-4 mb-1" />
                Conta Asaas
                <span className="text-xs font-normal text-muted-foreground mt-1 text-center">
                  Split nativo (gratuito)
                </span>
              </button>
            </div>
          </div>

          <div>
            <Label htmlFor="sr-label">Apelido / Identificação</Label>
            <Input
              id="sr-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex: Imobiliária X"
            />
          </div>

          {tipo === "asaas_wallet" ? (
            <div>
              <Label htmlFor="sr-wallet">Wallet ID Asaas</Label>
              <Input
                id="sr-wallet"
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
                placeholder="UUID do wallet (compartilhado pelo beneficiário)"
              />
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="sr-pix">Chave PIX</Label>
                <Input
                  id="sr-pix"
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  placeholder="CPF, CNPJ, email, telefone ou EVP"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  O tipo da chave é detectado automaticamente.
                </p>
              </div>
              <div>
                <Label htmlFor="sr-owner">Nome do titular</Label>
                <Input
                  id="sr-owner"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="sr-owner-cpf">CPF/CNPJ do titular</Label>
                <Input
                  id="sr-owner-cpf"
                  value={ownerCpfCnpj}
                  onChange={(e) => setOwnerCpfCnpj(e.target.value)}
                />
              </div>
            </>
          )}

          <div>
            <Label htmlFor="sr-email">
              Email para notificação{" "}
              <span className="text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Input
              id="sr-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contato@email.com"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Se preenchido, o destinatário recebe email quando uma cobrança que
              o inclui no split é paga.
            </p>
          </div>

          <div className="border-t pt-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                checked={draftMode}
                onChange={(e) => setDraftMode(e.target.checked)}
              />
              <div className="flex-1">
                <span className="text-sm font-medium">
                  Salvar com dados mínimos (rascunho)
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Permite cadastrar sem chave PIX/wallet agora. O destinatário
                  fica inativo até completar o cadastro — splits desta cobrança
                  ficarão em estado FALHOU até resolver.
                </p>
              </div>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? "Cadastrando..." : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
