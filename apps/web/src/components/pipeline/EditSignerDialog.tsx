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
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { AlertTriangle, Save } from "lucide-react";
import type { EnvelopeSignerRow } from "@/hooks/useEnvelopePolling";
import { suggestEmailDomain } from "@/lib/forms/email-typo";
import {
  CLICKSIGN_ROLE_OPTIONS,
  type ClicksignRole,
} from "@/lib/clicksign/roles";

interface EditSignerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Base do envelope (`/api/.../envelopes/{eid}`); o signer é
   *  `${basePath}/signers/${signer.id}`. Serve contrato e documento. */
  basePath: string;
  signer: EnvelopeSignerRow;
  /** Status do envelope — usado pra avisar que troca de auth/papel em envelope
   *  já enviado (running) vai à ClickSign e pode exigir cancelar+reenviar. */
  envelopeStatus?: string;
  onSaved: () => void;
}

const AUTH_METHOD_LABELS: Record<string, string> = {
  email: "E-mail (token)",
  whatsapp: "WhatsApp",
  selfie: "Selfie + documento",
  icp_brasil: "ICP-Brasil (certificado)",
};

interface SignatureConfig {
  configured: boolean;
  defaultAuthMethod: string;
  allowedAuthMethods: string[];
}

function maskCpfCnpj(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

export function EditSignerDialog({
  open,
  onOpenChange,
  basePath,
  signer,
  envelopeStatus,
  onSaved,
}: EditSignerDialogProps) {
  // Fallbacks estáveis pra inicialização E pra detecção de mudança (signers
  // legados podem ter role/authMethod nulos).
  const initialRole: ClicksignRole = (signer.role as ClicksignRole) || "sign";
  const initialAuth = signer.authMethod || "email";

  const [name, setName] = useState(signer.name);
  // `signer.email` é nullable (signatário de proposta pode ser só WhatsApp) —
  // o input é controlado, então null viraria campo não-controlado no React.
  const [email, setEmail] = useState(signer.email ?? "");
  const [documentation, setDocumentation] = useState(signer.documentation || "");
  const [phone, setPhone] = useState(signer.phone || "");
  const [role, setRole] = useState<ClicksignRole>(initialRole);
  const [authMethod, setAuthMethod] = useState(initialAuth);
  const [config, setConfig] = useState<SignatureConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(signer.name);
    setEmail(signer.email ?? "");
    setDocumentation(signer.documentation || "");
    setPhone(signer.phone || "");
    setRole((signer.role as ClicksignRole) || "sign");
    setAuthMethod(signer.authMethod || "email");
    setSubmitting(false);

    fetch("/api/signatures/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: SignatureConfig | null) => cfg && setConfig(cfg))
      .catch(() => {});
  }, [open, signer]);

  // Métodos de assinatura disponíveis: allow-list da org + o método atual
  // (caso o signer já use um método hoje fora da lista, não some do select).
  const authOptions = (() => {
    const allowed = config?.allowedAuthMethods?.length
      ? config.allowedAuthMethods
      : ["email", "whatsapp", "selfie", "icp_brasil"];
    const set = new Set(allowed);
    if (signer.authMethod) set.add(signer.authMethod);
    return Array.from(set).map((v) => ({
      value: v,
      label: AUTH_METHOD_LABELS[v] ?? v,
    }));
  })();

  const handleSubmit = async () => {
    if (!name.trim() || name.trim().length < 2) {
      toast.error("Nome inválido");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("E-mail inválido");
      return;
    }
    const docDigits = documentation.replace(/\D/g, "");
    if (docDigits && docDigits.length !== 11 && docDigits.length !== 14) {
      toast.error("CPF deve ter 11 dígitos ou CNPJ 14");
      return;
    }
    const phoneDigits = phone.replace(/\D/g, "");

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { action: "update" };
      if (name.trim() !== signer.name) body.name = name.trim();
      if (email.trim() !== (signer.email ?? "")) body.email = email.trim();
      if (docDigits !== (signer.documentation || "")) {
        body.documentation = docDigits;
      }
      if (phoneDigits !== (signer.phone || "")) body.phone = phoneDigits;
      // Compara contra o MESMO fallback usado pra inicializar o estado — senão um
      // signer legado com role/authMethod nulos dispararia recriação de
      // requirement em toda edição de perfil (bug do review).
      if (role !== initialRole) body.role = role;
      if (authMethod !== initialAuth) body.authMethod = authMethod;

      if (Object.keys(body).length === 1) {
        toast.info("Nenhuma alteração");
        onOpenChange(false);
        return;
      }

      const res = await fetch(`${basePath}/signers/${signer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const respBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(respBody.error || `HTTP ${res.status}`);
      }
      toast.success("Signatário atualizado");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSubmitting(false);
    }
  };

  const roleOrAuthChanged = role !== initialRole || authMethod !== initialAuth;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar signatário</DialogTitle>
          <DialogDescription>
            Atualiza os dados na ClickSign e no sistema. Disponível enquanto o
            signatário não assinou e o envelope não foi concluído.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="signer-name">Nome</Label>
            <Input
              id="signer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signer-email">E-mail</Label>
            <Input
              id="signer-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            {(() => {
              const suggestion = suggestEmailDomain(email);
              if (!suggestion) return null;
              return (
                <p className="text-[11px] text-amber-600 flex items-center gap-1 flex-wrap">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span>Você quis dizer</span>
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2 hover:text-amber-700"
                    onClick={() => setEmail(suggestion)}
                  >
                    {suggestion}
                  </button>
                  <span>?</span>
                </p>
              );
            })()}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="signer-phone">Celular</Label>
              <Input
                id="signer-phone"
                value={maskPhone(phone)}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                placeholder="(11) 90000-0000"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signer-doc">CPF/CNPJ</Label>
              <Input
                id="signer-doc"
                value={maskCpfCnpj(documentation)}
                onChange={(e) =>
                  setDocumentation(e.target.value.replace(/\D/g, ""))
                }
                placeholder="000.000.000-00"
                disabled={submitting}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Assina como</Label>
              <NativeSelect
                value={role}
                onChange={(v) => setRole(v as ClicksignRole)}
                options={CLICKSIGN_ROLE_OPTIONS}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de assinatura</Label>
              <NativeSelect
                value={authMethod}
                onChange={(v) => setAuthMethod(v)}
                options={authOptions}
                disabled={submitting}
              />
            </div>
          </div>

          {envelopeStatus === "running" && roleOrAuthChanged && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-[12px] text-amber-900 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                O envelope já foi enviado. Alterar o tipo de assinatura ou o
                papel recria os requisitos na ClickSign; se ela recusar, será
                preciso cancelar o envelope e reenviar.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            <Save className="h-4 w-4 mr-2" />
            {submitting ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
