"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, UserPlus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseProposalApiError } from "@/lib/proposals/api-errors";

export interface PlanVendedor {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** Pendência de preflight detectada no servidor (linha não-enviável). */
  issue: string | null;
}

/**
 * Diálogo do braço "enviar" da parada de decisão.
 *
 * COM vendedores cadastrados: lista as linhas com o preflight por linha e o
 * custo previsto, e o CTA dispara `POST /send-vendedor`.
 * SEM vendedores: form inline (nome/e-mail/CPF/WhatsApp) que primeiro cria a
 * linha (`POST /signers`, role=vendedor) e só então oferece "Enviar agora" —
 * DUAS chamadas de propósito: a criação valida o preflight e materializa a
 * linha; o envio gasta ClickSign. Falha no meio deixa a linha criada e o botão
 * de reenvio na tela.
 */
export function EnviarProprietarioDialog({
  open,
  onOpenChange,
  proposalId,
  vendedorLabel,
  vendedores,
  custoLabel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  proposalId: string;
  /** "proprietário" (venda) | "locador" (locação). */
  vendedorLabel: string;
  vendedores: PlanVendedor[];
  custoLabel: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", cpf: "", phone: "" });
  const [createdId, setCreatedId] = useState<string | null>(null);

  const hasVendedores = vendedores.length > 0 || createdId != null;
  const blockedRows = vendedores.filter((v) => v.issue);

  async function enviar() {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/send-vendedor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseProposalApiError(d, res.status));
      toast.success(`2ª via enviada ao ${vendedorLabel}.`);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setBusy(false);
    }
  }

  async function criarVendedor() {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/signers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "vendedor",
          name: form.name,
          email: form.email || undefined,
          cpf: form.cpf || undefined,
          phone: form.phone || undefined,
          signingGroup: 2,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseProposalApiError(d, res.status));
      setCreatedId(d.signer?.id ?? "created");
      if (Array.isArray(d.warnings) && d.warnings.length > 0) {
        toast.warning(d.warnings.join(" · "), { duration: 10000, closeButton: true });
      }
      toast.success(`${vendedorLabel[0].toUpperCase()}${vendedorLabel.slice(1)} cadastrado. Agora é só enviar.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cadastrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar ao {vendedorLabel}</DialogTitle>
          <DialogDescription>
            Cria a 2ª via para o {vendedorLabel} assinar
            {custoLabel ? ` — custo previsto ${custoLabel}` : ""}. O documento dele
            respeita a configuração de comissão oculta desta proposta.
          </DialogDescription>
        </DialogHeader>

        {hasVendedores ? (
          <div className="space-y-2">
            {vendedores.map((v) => (
              <div key={v.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{v.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {[v.email, v.phone].filter(Boolean).join(" · ") || "sem contato"}
                  </span>
                </div>
                {v.issue && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {v.issue}
                  </p>
                )}
              </div>
            ))}
            {createdId && vendedores.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {vendedorLabel[0].toUpperCase()}
                {vendedorLabel.slice(1)} cadastrado nesta sessão.
              </p>
            )}
            {blockedRows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Corrija as pendências acima (Editar contato na lista de
                assinaturas) antes de enviar — o envio valida os mesmos dados.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Nenhum {vendedorLabel} cadastrado nesta proposta. Preencha para
              cadastrar e enviar:
            </p>
            <div className="space-y-1">
              <Label htmlFor="vend-nome">Nome completo</Label>
              <Input
                id="vend-nome"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="vend-email">E-mail</Label>
                <Input
                  id="vend-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vend-phone">WhatsApp</Label>
                <Input
                  id="vend-phone"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="vend-cpf">CPF/CNPJ (opcional)</Label>
              <Input
                id="vend-cpf"
                inputMode="numeric"
                value={form.cpf}
                onChange={(e) => setForm({ ...form, cpf: e.target.value })}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Voltar
          </Button>
          {hasVendedores ? (
            <Button onClick={enviar} disabled={busy}>
              <Send className="mr-1.5 h-4 w-4" /> Enviar agora
            </Button>
          ) : (
            <Button
              onClick={criarVendedor}
              disabled={
                busy ||
                form.name.trim().length < 3 ||
                (!form.email.trim() && !form.phone.trim())
              }
            >
              <UserPlus className="mr-1.5 h-4 w-4" /> Cadastrar {vendedorLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
