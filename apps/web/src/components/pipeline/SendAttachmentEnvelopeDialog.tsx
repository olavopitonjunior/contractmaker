"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, Plus, Send, Trash2, UserPlus } from "lucide-react";
import { CLICKSIGN_ROLE_OPTIONS, type ClicksignRole } from "@/lib/clicksign/roles";

interface AttachmentPick {
  id: string;
  filename: string;
  mime: string;
  category?: string | null;
}

interface PartySuggestion {
  sourceKind: "vendedor" | "comprador";
  sourceIndex: number;
  name: string;
  email: string | null;
  documentation?: string | null;
}

interface SendAttachmentEnvelopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  attachments: AttachmentPick[];
  /** Vendedores/compradores extraídos do dataJson — vira chips de auto-fill. */
  partySuggestions: PartySuggestion[];
  /** Pré-seleciona este anexo (PDF) ao abrir — usado quando aberto a partir
   *  do botão "Enviar para assinatura" de um card específico. */
  preselectAttachmentId?: string;
  onSent: () => void;
}

interface SignerDraft {
  id: string;
  name: string;
  email: string;
  documentation: string;
  role: ClicksignRole;
  sourceKind?: "vendedor" | "comprador" | "outro";
  sourceIndex?: number;
}

const COST_PER_SIGNER_CENTS = 150;

function newSignerDraft(role: ClicksignRole = "sign"): SignerDraft {
  return {
    id: Math.random().toString(36).slice(2),
    name: "",
    email: "",
    documentation: "",
    role,
    sourceKind: "outro",
    sourceIndex: 0,
  };
}

export function SendAttachmentEnvelopeDialog({
  open,
  onOpenChange,
  dealId,
  attachments,
  partySuggestions,
  preselectAttachmentId,
  onSent,
}: SendAttachmentEnvelopeDialogProps) {
  const pdfAttachments = useMemo(
    () => attachments.filter((a) => a.mime === "application/pdf"),
    [attachments]
  );

  const [attachmentId, setAttachmentId] = useState<string>("");
  const [envelopeName, setEnvelopeName] = useState<string>("");
  const [authMethod, setAuthMethod] = useState<
    "email" | "whatsapp" | "selfie" | "icp_brasil"
  >("email");
  const [deadline, setDeadline] = useState<string>("");
  const [signers, setSigners] = useState<SignerDraft[]>(() => [newSignerDraft()]);
  const [orderEnabled, setOrderEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (
      preselectAttachmentId &&
      pdfAttachments.some((a) => a.id === preselectAttachmentId)
    ) {
      setAttachmentId(preselectAttachmentId);
    } else if (pdfAttachments.length > 0 && !attachmentId) {
      setAttachmentId(pdfAttachments[0].id);
    }
    if (signers.length === 0) {
      setSigners([newSignerDraft()]);
    }
  }, [open, pdfAttachments, attachmentId, signers.length, preselectAttachmentId]);

  function updateSigner(id: string, patch: Partial<SignerDraft>) {
    setSigners((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addSigner() {
    setSigners((prev) => [...prev, newSignerDraft()]);
  }

  function removeSigner(id: string) {
    setSigners((prev) => prev.filter((s) => s.id !== id));
  }

  function moveSigner(id: string, dir: -1 | 1) {
    setSigners((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  function roleForKind(kind: PartySuggestion["sourceKind"]): ClicksignRole {
    return kind === "vendedor" ? "seller" : "buyer";
  }

  function addFromSuggestion(p: PartySuggestion) {
    setSigners((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        name: p.name,
        email: p.email ?? "",
        documentation: p.documentation ?? "",
        role: roleForKind(p.sourceKind),
        sourceKind: p.sourceKind,
        sourceIndex: p.sourceIndex,
      },
    ]);
  }

  async function handleSubmit() {
    if (!attachmentId) {
      toast.error("Selecione um documento");
      return;
    }
    const filled = signers.filter((s) => s.name.trim() && s.email.trim());
    if (filled.length === 0) {
      toast.error("Adicione ao menos um signatário com nome e e-mail");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/envelopes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachmentId,
          authMethod,
          envelopeName: envelopeName.trim() || undefined,
          deadlineAt: deadline ? new Date(deadline).toISOString() : undefined,
          signers: filled.map((s, idx) => ({
            name: s.name.trim(),
            email: s.email.trim(),
            documentation: s.documentation.trim() || undefined,
            role: s.role,
            // Ordem ON: grupo = posição na lista (1-based). OFF: paralelo.
            group: orderEnabled ? idx + 1 : undefined,
            sourceKind: s.sourceKind,
            sourceIndex: s.sourceIndex,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 422 && data.missing) {
          toast.error(`${data.missing.length} signatário(s) sem e-mail válido`);
        } else if (res.status === 402) {
          toast.error(
            `Orçamento Clicksign do mês excedido (gasto ${(data.spentCents / 100).toFixed(2)})`
          );
        } else {
          toast.error(data.error || "Falha ao enviar");
        }
        return;
      }
      toast.success("Envelope enviado!");
      onSent();
      onOpenChange(false);
      setSigners([newSignerDraft()]);
      setEnvelopeName("");
      setAttachmentId("");
      setDeadline("");
      setOrderEnabled(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setSubmitting(false);
    }
  }

  const validSignerCount = signers.filter(
    (s) => s.name.trim() && s.email.trim()
  ).length;
  const estimatedCost = (validSignerCount * COST_PER_SIGNER_CENTS) / 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar documento para assinatura</DialogTitle>
          <DialogDescription>
            Selecione um PDF da pasta Documentos e adicione os signatários.
            Não exige aprovação prévia — usado para aditivos, distratos,
            procurações, recibos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 1. Documento */}
          <div className="space-y-2">
            <Label htmlFor="attachment">Documento (PDF)</Label>
            {pdfAttachments.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
                Nenhum PDF disponível na pasta Documentos. Suba um arquivo
                primeiro pela aba Documentos.
              </p>
            ) : (
              <NativeSelect
                value={attachmentId}
                onChange={setAttachmentId}
                options={pdfAttachments.map((a) => ({
                  value: a.id,
                  label: a.category
                    ? `${a.filename} · ${a.category}`
                    : a.filename,
                }))}
              />
            )}
          </div>

          {/* 2. Signatários */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Signatários</Label>
              <Button type="button" size="sm" variant="outline" onClick={addSigner}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Adicionar
              </Button>
            </div>

            {/* Chips de auto-fill a partir das partes do deal */}
            {partySuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 rounded-md bg-muted/40 p-2">
                <span className="text-[11px] text-muted-foreground self-center">
                  Sugestões:
                </span>
                {partySuggestions.map((p, i) => (
                  <Button
                    key={`${p.sourceKind}-${p.sourceIndex}-${i}`}
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => addFromSuggestion(p)}
                  >
                    <UserPlus className="h-3 w-3 mr-1" />
                    {p.name}
                    <Badge variant="outline" className="ml-1 text-[9px]">
                      {p.sourceKind}
                    </Badge>
                  </Button>
                ))}
              </div>
            )}

            {/* Toggle ordem de assinatura */}
            <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border bg-muted/30 px-3 py-2">
              <input
                type="checkbox"
                checked={orderEnabled}
                onChange={(e) => setOrderEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span className="font-medium">Assinar em ordem</span>
              <span className="text-xs text-muted-foreground">
                Cada signatário só é notificado depois que o anterior assina.
              </span>
            </label>

            <div className="space-y-2">
              {signers.map((s, idx) => (
                <div key={s.id} className="rounded-md border p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {orderEnabled ? `${idx + 1}º a assinar` : `Signatário ${idx + 1}`}
                    </span>
                    <div className="flex items-center gap-1">
                      {orderEnabled && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            disabled={idx === 0}
                            onClick={() => moveSigner(s.id, -1)}
                            title="Subir"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            disabled={idx === signers.length - 1}
                            onClick={() => moveSigner(s.id, 1)}
                            title="Descer"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {signers.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeSigner(s.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Input
                      placeholder="Nome completo"
                      value={s.name}
                      onChange={(e) => updateSigner(s.id, { name: e.target.value })}
                    />
                    <Input
                      type="email"
                      placeholder="email@exemplo.com"
                      value={s.email}
                      onChange={(e) => updateSigner(s.id, { email: e.target.value })}
                    />
                    <Input
                      placeholder="CPF ou CNPJ (opcional)"
                      value={s.documentation}
                      onChange={(e) =>
                        updateSigner(s.id, { documentation: e.target.value })
                      }
                    />
                    <div className="space-y-1">
                      <NativeSelect
                        value={s.role}
                        onChange={(v) =>
                          updateSigner(s.id, { role: v as ClicksignRole })
                        }
                        options={CLICKSIGN_ROLE_OPTIONS.map((o) => ({
                          value: o.value,
                          label: `Assina como: ${o.label}`,
                        }))}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Configurações */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="envelopeName">Nome do envelope (opcional)</Label>
              <Input
                id="envelopeName"
                placeholder="Ex: Aditivo de prazo"
                value={envelopeName}
                onChange={(e) => setEnvelopeName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="authMethod">Autenticação</Label>
              <NativeSelect
                value={authMethod}
                onChange={(v) => setAuthMethod(v as typeof authMethod)}
                options={[
                  { value: "email", label: "E-mail" },
                  { value: "whatsapp", label: "WhatsApp" },
                  { value: "selfie", label: "Selfie + RG/CNH" },
                  { value: "icp_brasil", label: "ICP-Brasil (certificado)" },
                ]}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="deadline">Prazo (opcional)</Label>
              <Input
                id="deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>

          {validSignerCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Custo estimado: R$ {estimatedCost.toFixed(2)} ({validSignerCount}{" "}
              signatário(s) × R$ 1,50)
            </p>
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
          <Button onClick={handleSubmit} disabled={submitting || pdfAttachments.length === 0}>
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {submitting ? "Enviando..." : "Enviar envelope"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
