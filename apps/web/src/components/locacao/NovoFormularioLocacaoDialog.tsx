"use client";

import { useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { PartyLinksPanel } from "@/components/forms/PartyLinksPanel";
import { Plus, Copy, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const REGIME_IR = [
  { value: "nao_retem", label: "Não retém IR" },
  { value: "retem_imobiliaria", label: "Retém (imobiliária)" },
  { value: "retem_inquilino", label: "Retém (inquilino)" },
  { value: "retem_sem_controle", label: "Retém sem controle" },
];
const REGIME_COBRANCA = [
  { value: "mes_a_vencer", label: "Mês a vencer" },
  { value: "mes_vencido", label: "Mês vencido" },
];

interface NovoFormularioLocacaoDialogProps {
  /** Modo controlado (dropdown "Novo negócio") — esconde o trigger próprio. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Diálogo do OPERADOR: cria um formulário público de locação. Coleta a
 * finalidade + a config fiscal/comissão (que NÃO é preenchida pelo cliente) e
 * gera o link /f/[token] pra enviar ao locador/locatário.
 */
export function NovoFormularioLocacaoDialog({
  open: controlledOpen,
  onOpenChange,
}: NovoFormularioLocacaoDialogProps = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (o: boolean) => {
    if (isControlled) onOpenChange?.(o);
    else setUncontrolledOpen(o);
  };
  const [submitting, setSubmitting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [formToken, setFormToken] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Key por INTENÇÃO (mount/reset), não por clique: duplo-clique e retry de
  // rede replayam a mesma resposta no servidor em vez de criar 2 forms+deals.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  const [finalidade, setFinalidade] = useState("residencial");
  const [taxaAdmin, setTaxaAdmin] = useState(10);
  const [taxaLocacao, setTaxaLocacao] = useState(0);
  const [regimeIr, setRegimeIr] = useState("nao_retem");
  const [regimeCobranca, setRegimeCobranca] = useState("mes_a_vencer");
  const [emitirNfse, setEmitirNfse] = useState(false);

  const reset = () => {
    setLink(null);
    setFormToken(null);
    setDealId(null);
    setCopied(false);
    // Nova intenção de criação → nova key de idempotência.
    setIdemKey(crypto.randomUUID());
  };

  const postForm = async (key: string, force: boolean) => {
    return fetch("/api/locacao/forms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-idempotency-key": key,
      },
      body: JSON.stringify({
        finalidade,
        ...(force ? { force: true } : {}),
        fiscal: {
          taxa_admin_percent: taxaAdmin,
          regime_ir: regimeIr,
          regime_cobranca: regimeCobranca,
          emitir_nfse: emitirNfse,
        },
        comissao: { taxa_locacao_percent: taxaLocacao, angariadores: [] },
      }),
    });
  };

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      let res = await postForm(idemKey, false);

      // Soft-block do servidor: título repetido criado há pouco. Confirmar
      // cria mesmo assim — com key NOVA (o 409 fica cacheado na antiga).
      if (res.status === 409) {
        const dup = await res.json().catch(() => ({}));
        if (dup?.error === "duplicate_recent") {
          const proceed = window.confirm(
            `Já existe um negócio "${dup.existing?.title ?? ""}" criado há poucos minutos. Deseja criar outro mesmo assim?`,
          );
          if (!proceed) return;
          const freshKey = crypto.randomUUID();
          setIdemKey(freshKey);
          res = await postForm(freshKey, true);
        }
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Falha ao criar o formulário.");
        return;
      }
      const data = await res.json();
      const fullUrl = `${window.location.origin}${data.url}`;
      setLink(fullUrl);
      setFormToken(data.token ?? null);
      setDealId(data.dealId);
    } catch {
      toast.error("Falha ao criar o formulário.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Link copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="h-4 w-4 mr-1.5" /> Novo formulário de locação
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo formulário de locação</DialogTitle>
          <DialogDescription>
            Defina a finalidade e a configuração fiscal/comissão. O link é preenchido pelo
            locador/locatário e gera o contrato automaticamente.
          </DialogDescription>
        </DialogHeader>

        {!link ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm">Finalidade</Label>
                <NativeSelect
                  value={finalidade}
                  onChange={setFinalidade}
                  options={[
                    { value: "residencial", label: "Residencial" },
                    { value: "comercial", label: "Comercial" },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm">Taxa de administração (%)</Label>
                <Input
                  type="number"
                  value={taxaAdmin}
                  onChange={(e) => setTaxaAdmin(Number(e.target.value))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm">Taxa de locação / comissão (%)</Label>
                <Input
                  type="number"
                  value={taxaLocacao}
                  onChange={(e) => setTaxaLocacao(Number(e.target.value))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm">Regime de IR</Label>
                <NativeSelect value={regimeIr} onChange={setRegimeIr} options={REGIME_IR} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm">Regime de cobrança</Label>
                <NativeSelect
                  value={regimeCobranca}
                  onChange={setRegimeCobranca}
                  options={REGIME_COBRANCA}
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="emitir-nfse"
                  className="h-4 w-4 rounded border-input accent-primary"
                  checked={emitirNfse}
                  onChange={(e) => setEmitirNfse(e.target.checked)}
                />
                <Label htmlFor="emitir-nfse" className="cursor-pointer text-sm">
                  Emitir NFS-e por repasse
                </Label>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Formulário criado! Envie o link abaixo ao cliente:
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={link} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            {formToken && (
              <PartyLinksPanel
                formToken={formToken}
                roles={["locador", "locatario"]}
                compact
              />
            )}
          </div>
        )}

        <DialogFooter>
          {!link ? (
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? "Criando..." : "Criar e gerar link"}
            </Button>
          ) : (
            <div className="flex gap-2">
              {dealId && (
                <Button variant="outline" asChild>
                  <a href={`/locacao/deals/${dealId}`}>
                    <ExternalLink className="h-4 w-4 mr-1.5" /> Abrir negócio
                  </a>
                </Button>
              )}
              <Button onClick={() => setOpen(false)}>Concluir</Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
