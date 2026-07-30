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
import { ManagerSelect } from "@/components/deals/ManagerSelect";
import { Separator } from "@/components/ui/separator";
import {
  ComissaoLocacaoSection,
  type ComissaoLocacaoValue,
} from "@/components/locacao/ComissaoLocacaoSection";
import { Plus, Copy, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface NovoFormularioLocacaoDialogProps {
  /** Modo controlado (dropdown "Novo negócio") — esconde o trigger próprio. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Diálogo do OPERADOR: cria um formulário público de locação. Coleta a
 * finalidade + a comissão (que NÃO é preenchida pelo cliente) e gera o link
 * /f/[token] pra enviar ao locador/locatário.
 *
 * Taxa de administração, regime de IR, regime de cobrança e NFS-e saíram daqui:
 * são condições da ADMINISTRAÇÃO (imobiliária ↔ proprietário) e passaram a ser
 * coletadas no diálogo que precede a geração daquele contrato (aba
 * Administração do negócio). O POST segue aceitando `fiscal` por
 * retrocompatibilidade de API — só esta UI parou de enviar; sem ele,
 * `createLeaseContractFromDataJson` cai nos defaults da casa (10%, nao_retem,
 * mes_a_vencer, sem NFS-e) até o operador acertar na administração.
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

  const [title, setTitle] = useState("");
  const [finalidade, setFinalidade] = useState("residencial");
  // Gerente responsável pelo negócio (obrigatório quando a org liga o toggle).
  const [managerUserId, setManagerUserId] = useState<string | null>(null);
  const [managerRequired, setManagerRequired] = useState(false);
  // Comissão completa (corretagem + angariadores) — antes só existia o input
  // de `taxa_locacao_percent`, e o array ia hard-coded vazio pro servidor.
  // Os campos fiscais (taxa de administração, IR, regime de cobrança, NFS-e)
  // saíram daqui pro diálogo que precede a geração da ADM.
  const [comissao, setComissao] = useState<ComissaoLocacaoValue>({
    taxa_locacao_percent: 0,
    angariadores: [],
  });

  const reset = () => {
    setLink(null);
    setFormToken(null);
    setDealId(null);
    setCopied(false);
    setTitle("");
    setManagerUserId(null);
    setComissao({ taxa_locacao_percent: 0, angariadores: [] });
    // Nova intenção de criação → nova key de idempotência.
    setIdemKey(crypto.randomUUID());
  };

  const postForm = async (key: string, force: boolean) => {
    const res = await fetch("/api/locacao/forms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-idempotency-key": key,
      },
      body: JSON.stringify({
        finalidade,
        title: title.trim() || undefined,
        ...(managerUserId ? { managerUserId } : {}),
        ...(force ? { force: true } : {}),
        comissao: {
          taxa_locacao_percent: comissao.taxa_locacao_percent ?? 0,
          angariadores: comissao.angariadores ?? [],
        },
      }),
    });
    // Body lido UMA vez — reler depois lança "body already consumed" e
    // mascara a mensagem real do erro.
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    return { res, data };
  };

  const handleCreate = async () => {
    if (managerRequired && !managerUserId) {
      toast.error("Selecione o gerente responsável");
      return;
    }
    setSubmitting(true);
    try {
      let { res, data } = await postForm(idemKey, false);

      // Soft-block do servidor: título repetido criado há pouco. A key atual
      // acabou de cachear o 409 — rotaciona JÁ (um "Cancelar" não pode deixar
      // a próxima tentativa replayando o 409 stale).
      if (res.status === 409 && data?.error === "duplicate_recent") {
        const freshKey = crypto.randomUUID();
        setIdemKey(freshKey);
        const proceed = window.confirm(
          `Já existe um negócio "${(data.existing as { title?: string })?.title ?? title}" criado há poucos minutos. Deseja criar outro mesmo assim?`,
        );
        if (!proceed) return;
        ({ res, data } = await postForm(freshKey, true));
      }

      if (!res.ok) {
        // Erros ficam cacheados sob a key (ex.: 412 pipeline não seedada) —
        // rotaciona pra próxima tentativa no MESMO dialog não replayar o stale.
        setIdemKey(crypto.randomUUID());
        // Fallback do gate server-side (org exige gerente e o client não sabia).
        if (res.status === 422 && data?.error === "gerente_obrigatorio") {
          setManagerRequired(true);
          toast.error(
            (typeof data.message === "string" && data.message) ||
              "Selecione o gerente responsável",
          );
          return;
        }
        toast.error(
          (typeof data?.error === "string" && data.error) ||
            "Falha ao criar o formulário.",
        );
        return;
      }
      const fullUrl = `${window.location.origin}${data.url}`;
      setLink(fullUrl);
      setFormToken((data.token as string) ?? null);
      setDealId(data.dealId as string);
    } catch {
      setIdemKey(crypto.randomUUID());
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
      {/* A seção de comissão (angariadores) estica o diálogo — rola dentro. */}
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo formulário de locação</DialogTitle>
          <DialogDescription>
            Defina a finalidade e a comissão. O link é preenchido pelo
            locador/locatário e gera o contrato automaticamente.
          </DialogDescription>
        </DialogHeader>

        {!link ? (
          <div className="space-y-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm" htmlFor="locacao-form-title">
                Título (opcional)
              </Label>
              <Input
                id="locacao-form-title"
                placeholder="Ex: Locação Apto 302 - Ed. Floresta"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Identifica o negócio no pipeline e evita cards duplicados.
              </p>
            </div>
            <ManagerSelect
              value={managerUserId}
              onChange={setManagerUserId}
              disabled={submitting}
              onContextLoaded={(ctx) => setManagerRequired(ctx.managerRequired)}
            />
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
            </div>

            <Separator />

            {/* Comissão do operador — o cliente do link nunca vê nem edita. O
                aluguel ainda não existe nesta tela, então os previews em R$ só
                aparecem depois, na aba Dados do negócio. */}
            <ComissaoLocacaoSection value={comissao} onChange={setComissao} />
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
                categoriesModule="locacao"
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
