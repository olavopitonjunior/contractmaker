"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronLeft,
  Trash2,
  UserPlus,
  Building2,
  UsersRound,
  X,
} from "lucide-react";
import {
  IListPickerDialog,
  type IListImportPayload,
} from "@/components/ilist/IListPickerDialog";
import {
  WitnessPicker,
  pickNewWitnesses,
  type RegistryWitness,
} from "@/components/pipeline/WitnessPicker";
import {
  GARANTIA_TIPOS,
  GARANTIA_LABELS,
  type GarantiaTipo,
} from "@/lib/contracts/template-category";
import {
  OBSERVACOES_MAX,
  buildHiddenPaths,
  buildProposalDataJson,
  buildProposalSigners,
  buildProposalTitle,
  derivedProposalTitle,
  buildValidUntil,
  emptyParty,
  formatAmountInput,
  garantiaHumanLabel,
  validParties,
  type PartyInput,
  type ProposalFormValues,
} from "@/lib/proposals/form-data";
import { parseMoneyBR } from "@/lib/format/money";
import {
  providersForTipo,
  tipoTemGarantidor,
  type GarantiaOptionLike,
} from "@/lib/forms/garantia-catalog";

export interface SchemaOption {
  label: string;
  value: string;
}

/**
 * Criação e EDIÇÃO da proposta numa PÁGINA (não mais num diálogo).
 *
 * O diálogo antigo perdia tudo num clique fora — sem `preventDefault` no
 * outside-click, o estado (partes, testemunhas, imóvel, snapshot do iList)
 * morria com o overlay. Página resolve por construção: é uma URL (abre em nova
 * guia, volta no histórico) e a saída acidental passa pelo `beforeunload`.
 *
 * O MESMO componente serve os dois modos — criar faz POST /api/proposals e
 * editar faz PATCH /api/proposals/[id]. Manter uma tela só é o que garante que
 * a edição não "perca" campo que a criação coleta.
 *
 * Seções em Accordion (2026-08): Partes e Negócio abertas; Condições,
 * Observações e Comissão & testemunhas colapsadas com resumo no header —
 * nenhum campo delas é obrigatório, então o caminho rápido continua curto.
 */
/** Sentinel do Select pro responsável externo herdado (não é um userId). */
const EXTERNAL_RESPONSIBLE = "__external__";

export function ProposalForm({
  mode,
  proposalId,
  initial,
  schemaOptions,
  members = [],
  canAssign = false,
  hasIList = false,
  parentProposalId,
  initialResponsibleUserId = "",
  initialResponsibleName,
  garantiaOptions = [],
}: {
  mode: "create" | "edit";
  proposalId?: string;
  initial: ProposalFormValues;
  schemaOptions: SchemaOption[];
  /** Catálogo de prestadoras da org (só ativas) — mesmo dado do form público. */
  garantiaOptions?: GarantiaOptionLike[];
  /** Membros da org pro select de responsável (só usado em create + canAssign). */
  members?: { id: string; name: string }[];
  /** PROPOSAL_ASSIGN — sem ela o select não aparece e o POST não manda o campo. */
  canAssign?: boolean;
  /**
   * A org tem conexão iList (RE/MAX) provisionada pelo super-admin. Sem ela o
   * botão do catálogo some — é o mesmo gate de `NovoNegocioDropdown` no
   * pipeline (`getIListConnection(orgId) !== null`). Default `false`: um tenant
   * sem iList não pode ver a porta abrir num diálogo de "não habilitado".
   */
  hasIList?: boolean;
  /**
   * Recriação (`nova?fromId=`): id da proposta de origem. Vai no POST pra rota
   * gravar a thread (round, supersededById, eventos) e liga o banner de revisão.
   */
  parentProposalId?: string;
  /** Responsável herdado da proposta de origem (só chega com PROPOSAL_ASSIGN). */
  initialResponsibleUserId?: string;
  /** Responsável EXTERNO herdado (nome livre, sem userId) — vira opção própria
   *  no Select; se o usuário trocar, a herança é descartada. */
  initialResponsibleName?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<ProposalFormValues>(initial);
  // Responsável comercial na criação (admin cria e atribui num passo só).
  // Fora do ProposalFormValues de propósito: o PATCH de edição não aceita o
  // campo — lá a troca é pelo ProposalAssigneeControl do detalhe.
  const [responsibleUserId, setResponsibleUserId] = useState(
    initialResponsibleUserId || (initialResponsibleName ? EXTERNAL_RESPONSIBLE : "")
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [witnessPickerOpen, setWitnessPickerOpen] = useState(false);

  const isVenda = v.kind === "venda";
  const proponenteLabel = isVenda ? "Comprador" : "Locatário";
  const vendedorLabel = isVenda ? "Proprietário / Vendedor" : "Locador";
  const backHref =
    mode === "edit" && proposalId
      ? `/pipeline/propostas/${proposalId}`
      : `/pipeline/propostas?tipo=${v.kind}`;

  // Aviso de saída: o ganho anti-perda da página. Só arma quando há alteração
  // não salva (o navegador ignora o handler sem interação prévia, então o
  // usuário nunca vê o diálogo à toa).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function patch(next: Partial<ProposalFormValues>) {
    setDirty(true);
    setV((prev) => ({ ...prev, ...next }));
  }

  function updateParty(
    key: "proponentes" | "vendedores",
    idx: number,
    p: Partial<PartyInput>
  ) {
    patch({ [key]: v[key].map((x, i) => (i === idx ? { ...x, ...p } : x)) } as Partial<
      ProposalFormValues
    >);
  }

  // Pré-filtro do picker (UX): não oferece quem já é parte ou já foi escolhido.
  // O dedup AUTORITATIVO acontece em buildProposalSigners, com o mesmo
  // computeDedupeKey do servidor.
  const witnessExistingKeys = useMemo(
    () =>
      [
        ...v.proponentes.map((p) => p.email.trim().toLowerCase()),
        ...v.vendedores.map((p) => p.email.trim().toLowerCase()),
        ...v.witnesses.map((w) => w.email.trim().toLowerCase()),
        ...v.witnesses.map((w) => w.documentation),
      ].filter(Boolean),
    [v.proponentes, v.vendedores, v.witnesses]
  );

  function addWitnesses(selected: RegistryWitness[]) {
    patch({ witnesses: [...v.witnesses, ...pickNewWitnesses(selected, witnessExistingKeys)] });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validParties(v.proponentes).length === 0) {
      toast.error(`Informe ao menos um ${proponenteLabel.toLowerCase()}`);
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: buildProposalTitle(v),
        schemaType: v.schemaType,
        dataJson: buildProposalDataJson(v),
        validUntil: buildValidUntil(v),
        signers: buildProposalSigners(v),
        comissaoIncluida: v.comissao,
        hiddenPaths: buildHiddenPaths(v),
        ...(mode === "create" && canAssign && responsibleUserId
          ? responsibleUserId === EXTERNAL_RESPONSIBLE
            ? { responsibleName: initialResponsibleName }
            : { responsibleUserId }
          : {}),
        ...(mode === "create" && parentProposalId ? { parentProposalId } : {}),
      };
      const res = await fetch(
        mode === "create" ? "/api/proposals" : `/api/proposals/${proposalId}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      // `dirty` cai ANTES do push pra não disparar o beforeunload na navegação
      // de sucesso.
      setDirty(false);
      toast.success(mode === "create" ? "Proposta criada" : "Proposta atualizada");
      const id = mode === "create" ? d.proposal?.id : proposalId;
      router.push(`/pipeline/propostas/${id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const renderParties = (
    key: "proponentes" | "vendedores",
    roleLabel: string,
    removableToZero: boolean
  ) =>
    v[key].map((p, idx) => (
      <div key={idx} className="space-y-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <Select
            value={p.tipoPessoa}
            onValueChange={(t) =>
              updateParty(key, idx, { tipoPessoa: t as PartyInput["tipoPessoa"] })
            }
          >
            <SelectTrigger className="w-[150px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fisica">Pessoa física</SelectItem>
              <SelectItem value="juridica">Pessoa jurídica</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={p.nome}
            onChange={(e) => updateParty(key, idx, { nome: e.target.value })}
            placeholder={
              p.tipoPessoa === "juridica"
                ? "Razão social"
                : `Nome do ${roleLabel.toLowerCase()}`
            }
          />
          {(removableToZero || v[key].length > 1) && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              onClick={() => patch({ [key]: v[key].filter((_, i) => i !== idx) } as Partial<ProposalFormValues>)}
              aria-label="Remover"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_130px]">
          <Input
            value={p.documento}
            onChange={(e) => updateParty(key, idx, { documento: e.target.value })}
            placeholder={p.tipoPessoa === "juridica" ? "CNPJ" : "CPF"}
            inputMode="numeric"
          />
          <Input
            type="email"
            value={p.email}
            onChange={(e) => updateParty(key, idx, { email: e.target.value })}
            placeholder="e-mail"
          />
          <Input
            inputMode="tel"
            value={p.phone}
            onChange={(e) => updateParty(key, idx, { phone: e.target.value })}
            placeholder="(DDD) WhatsApp"
          />
          <Select value={p.canal} onValueChange={(c) => updateParty(key, idx, { canal: c })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">E-mail</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    ));

  // Resumos dos headers colapsados — o operador vê o que está dentro sem abrir.
  const partesSummary = [
    `${validParties(v.proponentes).length || "nenhum"} ${proponenteLabel.toLowerCase()}(es)`,
    validParties(v.vendedores).length
      ? `${validParties(v.vendedores).length} ${vendedorLabel.split(" ")[0].toLowerCase()}(es)`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const condicoesSummary = isVenda
    ? [
        v.modalidade === "financiamento"
          ? "Financiamento"
          : v.modalidade === "a_vista"
            ? "À vista"
            : null,
        v.sinal ? `sinal R$ ${v.sinal}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Não informadas"
    : [
        garantiaHumanLabel(v.garantia) || GARANTIA_LABELS[v.garantia.tipo],
        v.prazoMeses ? `${v.prazoMeses} meses` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  const observacoesSummary = v.observacoes.trim()
    ? `${v.observacoes.trim().length} caractere(s)`
    : "Sem observações";
  const comissaoSummary = [
    v.comissao ? "Comissão incluída" : "Sem comissão",
    v.witnesses.length ? `${v.witnesses.length} testemunha(s)` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const sectionCls = "rounded-lg border bg-card px-4 shadow-xs";
  const headerCls = ({ title, summary }: { title: string; summary: string }) => (
    <div className="flex w-full flex-col gap-0.5 text-left">
      <span className="font-medium">{title}</span>
      <span className="text-xs font-normal text-muted-foreground">{summary}</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div>
        <Link
          href={backHref}
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ChevronLeft className="h-4 w-4" /> {mode === "edit" ? "Proposta" : "Propostas"}
        </Link>
        <h1 className="font-display mt-1 text-2xl font-semibold tracking-tight">
          {mode === "edit" ? "Editar proposta" : "Nova proposta"} —{" "}
          {isVenda ? "Venda" : "Locação"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === "edit"
            ? "Alterações valem enquanto a proposta não for enviada. Depois do envio o documento é congelado."
            : "Preencha e crie o rascunho. Nada é enviado ao cliente até você clicar em “Enviar para assinatura”."}
        </p>
      </div>

      {/* Banner de recriação: o form nasceu pré-preenchido de outra proposta.
          O aviso dos anexos é deliberado — sem ele o corretor assume que os
          documentos vieram junto (v1 não copia). */}
      {mode === "create" && parentProposalId && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Recriação de proposta
          </p>
          <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
            Os dados abaixo vieram da proposta anterior — revise antes de criar
            (contatos errados costumam ser a causa do reenvio). Documentos
            anexados na proposta original <strong>não são copiados</strong>.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Título fica FORA do accordion: é o rótulo da proposta inteira, não
            um detalhe de uma seção. Em branco cai no derivado (o placeholder
            mostra qual seria), então o caminho rápido não ganhou um campo
            obrigatório. */}
        <div className={`${sectionCls} space-y-1 py-4`}>
          <Label htmlFor="proposal-title">Título da proposta</Label>
          <Input
            id="proposal-title"
            value={v.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder={derivedProposalTitle(v)}
            maxLength={200}
          />
          <p className="text-xs text-muted-foreground">
            Deixe em branco para usar o padrão: proponente — imóvel.
          </p>
        </div>

        <Accordion
          type="multiple"
          defaultValue={["partes", "negocio"]}
          className="space-y-3"
        >
          {/* ---------- Partes ---------- */}
          <AccordionItem value="partes" className={sectionCls}>
            <AccordionTrigger>
              {headerCls({ title: "Partes", summary: partesSummary })}
            </AccordionTrigger>
            <AccordionContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-base">
                    {proponenteLabel}(es) — quem faz a proposta
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => patch({ proponentes: [...v.proponentes, emptyParty()] })}
                  >
                    <UserPlus className="mr-1 h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>
                {renderParties("proponentes", proponenteLabel, false)}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-base">{vendedorLabel}(es) — opcional</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => patch({ vendedores: [...v.vendedores, emptyParty()] })}
                  >
                    <UserPlus className="mr-1 h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>
                {v.vendedores.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Adicione se o {vendedorLabel.toLowerCase()} também vai assinar.
                  </p>
                ) : (
                  renderParties("vendedores", vendedorLabel, true)
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ---------- Imóvel e valores ---------- */}
          <AccordionItem value="negocio" className={sectionCls}>
            <AccordionTrigger>
              {headerCls({
                title: "Imóvel e valores",
                summary:
                  [
                    v.imovelEndereco || "Imóvel não informado",
                    v.valor ? `R$ ${v.valor}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
              })}
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="space-y-1">
                <Label>Imóvel</Label>
                <div className="flex gap-2">
                  <Input
                    value={v.imovelEndereco}
                    onChange={(e) => patch({ imovelEndereco: e.target.value })}
                    placeholder="Endereço do imóvel"
                  />
                  {hasIList && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Buscar no catálogo iList (RE/MAX)"
                      onClick={() => setPickerOpen(true)}
                    >
                      <Building2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {schemaOptions.length > 1 && (
                <div className="space-y-1">
                  <Label>Modelo</Label>
                  <Select value={v.schemaType} onValueChange={(s) => patch({ schemaType: s })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {schemaOptions.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {mode === "edit" && (
                    <p className="text-xs text-muted-foreground">
                      O modelo define o schema da proposta; mudá-lo aqui não recria a
                      proposta — para trocar de tipo, crie uma nova.
                    </p>
                  )}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Tipo do imóvel (opcional)</Label>
                  <Input
                    value={v.imovelTipo}
                    onChange={(e) => patch({ imovelTipo: e.target.value })}
                    placeholder="Ex: apartamento, casa, sala comercial"
                  />
                </div>
                {isVenda ? (
                  <div className="space-y-1">
                    <Label>Matrícula (opcional)</Label>
                    <Input
                      value={v.imovelMatricula}
                      onChange={(e) => patch({ imovelMatricula: e.target.value })}
                      placeholder="Nº da matrícula"
                    />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label>Finalidade (opcional)</Label>
                    <Input
                      value={v.locacaoFinalidade}
                      onChange={(e) => patch({ locacaoFinalidade: e.target.value })}
                      placeholder="Ex: residencial, escritório"
                    />
                  </div>
                )}
              </div>
              {isVenda && (
                <div className="space-y-1">
                  <Label>Cartório de registro (opcional)</Label>
                  <Input
                    value={v.imovelCartorio}
                    onChange={(e) => patch({ imovelCartorio: e.target.value })}
                    placeholder="Ex: 2º Oficial de Registro de Imóveis de São Paulo/SP"
                  />
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{isVenda ? "Valor (R$)" : "Aluguel (R$/mês)"}</Label>
                  <Input
                    inputMode="numeric"
                    value={v.valor}
                    onChange={(e) => patch({ valor: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Validade (dias)</Label>
                  <Input
                    inputMode="numeric"
                    value={v.validadeDias}
                    onChange={(e) => patch({ validadeDias: e.target.value })}
                  />
                </div>
              </div>

              {mode === "create" && canAssign && members.length > 0 && (
                <div className="space-y-1">
                  <Label>Responsável</Label>
                  <Select
                    value={responsibleUserId || "none"}
                    onValueChange={(val) => {
                      setResponsibleUserId(val === "none" ? "" : val);
                      // Conveniência: pré-preenche o corretor da intermediação
                      // (seção Comissão) com o responsável — segue editável.
                      if (val !== "none" && !v.corretorNome.trim()) {
                        const m = members.find((x) => x.id === val);
                        if (m) patch({ corretorNome: m.name });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Eu mesmo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Eu mesmo</SelectItem>
                      {initialResponsibleName && (
                        <SelectItem value={EXTERNAL_RESPONSIBLE}>
                          {initialResponsibleName} (externo)
                        </SelectItem>
                      )}
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Gerente ou corretor que responde pela proposta. Dá pra trocar
                    depois no detalhe da proposta.
                  </p>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* ---------- Condições (venda: modalidade/sinal; locação: garantia/prazo) ---------- */}
          <AccordionItem value="condicoes" className={sectionCls}>
            <AccordionTrigger>
              {headerCls({
                title: isVenda ? "Condições da venda" : "Condições da locação",
                summary: condicoesSummary,
              })}
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              {isVenda ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Forma de pagamento</Label>
                      <Select
                        value={v.modalidade || "nao_informada"}
                        onValueChange={(m) =>
                          patch({
                            modalidade:
                              m === "nao_informada"
                                ? ""
                                : (m as ProposalFormValues["modalidade"]),
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nao_informada">Não informar</SelectItem>
                          <SelectItem value="a_vista">À vista (recursos próprios)</SelectItem>
                          <SelectItem value="financiamento">
                            Financiamento bancário
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Sinal (R$)</Label>
                      <Input
                        inputMode="numeric"
                        value={v.sinal}
                        onChange={(e) => patch({ sinal: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  {v.modalidade === "financiamento" && (
                    <div className="space-y-1">
                      <Label>Banco do financiamento (opcional)</Label>
                      <Input
                        value={v.bancoFinanciamento}
                        onChange={(e) => patch({ bancoFinanciamento: e.target.value })}
                        placeholder="Ex.: Caixa Econômica Federal"
                      />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Essas condições saem no documento da proposta e, na conversão em
                    negócio, já chegam preenchidas no formulário.
                  </p>
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Tipo de garantia</Label>
                      <Select
                        value={v.garantia.tipo}
                        onValueChange={(t) =>
                          // Trocar o tipo zera a prestadora — ela pertence ao
                          // tipo anterior.
                          patch({
                            garantia: {
                              ...v.garantia,
                              tipo: t as GarantiaTipo,
                              provider: "",
                            },
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GARANTIA_TIPOS.map((t) => (
                            <SelectItem key={t} value={t}>
                              {GARANTIA_LABELS[t]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {v.garantia.tipo === "caucao" && (
                      <div className="space-y-1">
                        <Label>Caução (nº de aluguéis)</Label>
                        <Input
                          inputMode="numeric"
                          value={v.garantia.caucaoMeses}
                          onChange={(e) =>
                            patch({ garantia: { ...v.garantia, caucaoMeses: e.target.value } })
                          }
                          placeholder="até 3"
                        />
                      </div>
                    )}
                    {tipoTemGarantidor(v.garantia.tipo) && (
                      <GarantiaProviderPicker
                        tipo={v.garantia.tipo}
                        provider={v.garantia.provider}
                        garantiaOptions={garantiaOptions}
                        onChange={(provider) =>
                          patch({ garantia: { ...v.garantia, provider } })
                        }
                      />
                    )}
                  </div>

                  {v.garantia.tipo === "fiador" && (
                    <div className="space-y-2 rounded-md border p-3">
                      <Label>Fiador</Label>
                      <div className="flex items-center gap-2">
                        <Select
                          value={v.garantia.fiador.tipoPessoa}
                          onValueChange={(t) =>
                            patch({
                              garantia: {
                                ...v.garantia,
                                fiador: {
                                  ...v.garantia.fiador,
                                  tipoPessoa: t as PartyInput["tipoPessoa"],
                                },
                              },
                            })
                          }
                        >
                          <SelectTrigger className="w-[150px] shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fisica">Pessoa física</SelectItem>
                            <SelectItem value="juridica">Pessoa jurídica</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={v.garantia.fiador.nome}
                          onChange={(e) =>
                            patch({
                              garantia: {
                                ...v.garantia,
                                fiador: { ...v.garantia.fiador, nome: e.target.value },
                              },
                            })
                          }
                          placeholder={
                            v.garantia.fiador.tipoPessoa === "juridica"
                              ? "Razão social do fiador"
                              : "Nome do fiador"
                          }
                        />
                        <Input
                          className="w-[180px] shrink-0"
                          inputMode="numeric"
                          value={v.garantia.fiador.documento}
                          onChange={(e) =>
                            patch({
                              garantia: {
                                ...v.garantia,
                                fiador: { ...v.garantia.fiador, documento: e.target.value },
                              },
                            })
                          }
                          placeholder={
                            v.garantia.fiador.tipoPessoa === "juridica" ? "CNPJ" : "CPF"
                          }
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        O fiador entra no documento; ele não assina a proposta.
                        No contrato de locação ele (e o cônjuge) assinam como
                        Fiador e Cônjuge do fiador.
                      </p>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Prazo pretendido (meses)</Label>
                      <Input
                        inputMode="numeric"
                        value={v.prazoMeses}
                        onChange={(e) => patch({ prazoMeses: e.target.value })}
                        placeholder="Ex.: 30"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Data pretendida de entrada</Label>
                      <Input
                        type="date"
                        value={v.dataEntrada}
                        onChange={(e) => patch({ dataEntrada: e.target.value })}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Garantia, prazo e entrada saem no documento da proposta e ajudam a
                    escolher a variante certa do modelo; na conversão em negócio já
                    chegam preenchidos no formulário.
                  </p>
                </>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* ---------- Observações ---------- */}
          <AccordionItem value="observacoes" className={sectionCls}>
            <AccordionTrigger>
              {headerCls({
                title: "Observações e condições da proposta",
                summary: observacoesSummary,
              })}
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              <Textarea
                value={v.observacoes}
                onChange={(e) => patch({ observacoes: e.target.value })}
                rows={4}
                maxLength={OBSERVACOES_MAX}
                placeholder="Condições combinadas, prazos, itens inclusos — texto livre que sai no documento da proposta."
              />
              <p className="text-xs text-muted-foreground">
                Aparece nas duas vias do documento (inclusive na via do{" "}
                {vendedorLabel.toLowerCase()}) e acompanha o negócio na conversão. Não
                vira texto do contrato automaticamente.
              </p>
            </AccordionContent>
          </AccordionItem>

          {/* ---------- Comissão e testemunhas ---------- */}
          <AccordionItem value="comissao" className={sectionCls}>
            <AccordionTrigger>
              {headerCls({ title: "Comissão e testemunhas", summary: comissaoSummary })}
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={v.comissao}
                  onCheckedChange={(c) => patch({ comissao: Boolean(c) })}
                />
                Incluir comissão da imobiliária no documento
              </label>
              {v.comissao && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label>Percentual (%)</Label>
                    <Input
                      inputMode="decimal"
                      value={v.comissaoPercentual}
                      onChange={(e) => {
                        const pctStr = e.target.value;
                        const pct = Number(pctStr.replace(",", "."));
                        const base = v.valor ? parseMoneyBR(v.valor) : null;
                        // Conveniência: sugere o valor em R$ a partir do
                        // percentual × valor da proposta (segue editável).
                        const sugerido =
                          Number.isFinite(pct) && pct > 0 && base != null && base > 0
                            ? formatAmountInput((base * pct) / 100)
                            : v.comissaoValor;
                        patch({ comissaoPercentual: pctStr, comissaoValor: sugerido });
                      }}
                      placeholder="Ex: 6"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Valor (R$)</Label>
                    <Input
                      inputMode="numeric"
                      value={v.comissaoValor}
                      onChange={(e) => patch({ comissaoValor: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Quem paga</Label>
                    <Select
                      value={v.comissaoResponsavel || "none"}
                      onValueChange={(val) =>
                        patch({ comissaoResponsavel: val === "none" ? "" : val })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Não informado" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Não informado</SelectItem>
                        <SelectItem
                          value={isVenda ? "o proponente comprador" : "o proponente locatário"}
                        >
                          {isVenda ? "Proponente comprador" : "Proponente locatário"}
                        </SelectItem>
                        <SelectItem value={isVenda ? "a parte vendedora" : "a parte locadora"}>
                          {vendedorLabel}
                        </SelectItem>
                        <SelectItem value="ambas as partes">Ambas as partes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Corretor da intermediação (opcional)</Label>
                  <Input
                    value={v.corretorNome}
                    onChange={(e) => patch({ corretorNome: e.target.value })}
                    placeholder="Nome do corretor no documento"
                  />
                </div>
                <div className="space-y-1">
                  <Label>CRECI (opcional)</Label>
                  <Input
                    value={v.corretorCreci}
                    onChange={(e) => patch({ corretorCreci: e.target.value })}
                    placeholder="Ex: 123456-F/SP"
                  />
                </div>
              </div>
              {v.comissao && validParties(v.vendedores).length > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={v.esconderComissao}
                    onCheckedChange={(c) => patch({ esconderComissao: Boolean(c) })}
                  />
                  Esconder a comissão do {vendedorLabel.toLowerCase()} (ele assina uma
                  via reduzida)
                </label>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Testemunhas (opcional)</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setWitnessPickerOpen(true)}
                  >
                    <UsersRound className="mr-1 h-3.5 w-3.5" /> Selecionar testemunhas
                  </Button>
                </div>
                {v.witnesses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {v.witnesses.map((w) => (
                      <span
                        key={w.email}
                        className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                      >
                        {w.name}
                        <button
                          type="button"
                          onClick={() =>
                            patch({ witnesses: v.witnesses.filter((x) => x.email !== w.email) })
                          }
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Remover ${w.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" asChild>
            <Link href={backHref}>Cancelar</Link>
          </Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? "Salvando…"
              : mode === "create"
                ? "Criar rascunho"
                : "Salvar alterações"}
          </Button>
        </div>
      </form>

      {hasIList && (
      <IListPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        transactionType={v.kind}
        onSelect={(payload: IListImportPayload) => {
          const snap = payload.proposalSnapshot;
          setDirty(true);
          setV((prev) => ({
            ...prev,
            ilistSnapshot: snap,
            imovelEndereco: snap.endereco,
            // Preço do listing só preenche o valor quando ainda vazio.
            valor: prev.valor || (snap.preco != null ? formatAmountInput(snap.preco) : ""),
          }));
        }}
      />
      )}

      <WitnessPicker
        open={witnessPickerOpen}
        onOpenChange={setWitnessPickerOpen}
        scope="proposta"
        existingKeys={witnessExistingKeys}
        onConfirm={addWitnesses}
      />
    </div>
  );
}

/**
 * Prestadora da garantia: select do catálogo da org + "Outra…" (texto livre).
 * Mesmo split do GarantiaStep do formulário público — o `provider` gravado é
 * o que casa a cláusula da seguradora no acervo; fora do catálogo, a geração
 * usa a cláusula genérica do tipo. Sem prestadora cadastrada pro tipo, o
 * campo é só o texto livre.
 */
const OUTRA_PRESTADORA = "__outra__";

function GarantiaProviderPicker({
  tipo,
  provider,
  garantiaOptions,
  onChange,
}: {
  tipo: GarantiaTipo;
  provider: string;
  garantiaOptions: GarantiaOptionLike[];
  onChange: (provider: string) => void;
}) {
  const providers = useMemo(
    () => providersForTipo(garantiaOptions, tipo),
    [garantiaOptions, tipo]
  );
  const [outraEscolhida, setOutraEscolhida] = useState(false);
  const isCatalogProvider = providers.includes(provider);
  const showInput =
    providers.length === 0 ||
    outraEscolhida ||
    (provider !== "" && !isCatalogProvider);
  const selectValue = isCatalogProvider
    ? provider
    : showInput
      ? OUTRA_PRESTADORA
      : "";

  return (
    <>
      {providers.length > 0 && (
        <div className="space-y-1">
          <Label>Seguradora / prestadora</Label>
          <Select
            value={selectValue}
            onValueChange={(value) => {
              if (value === OUTRA_PRESTADORA) {
                setOutraEscolhida(true);
                onChange("");
                return;
              }
              setOutraEscolhida(false);
              onChange(value);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
              <SelectItem value={OUTRA_PRESTADORA}>Outra…</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {showInput && (
        <div className="space-y-1">
          <Label>
            {providers.length > 0
              ? "Qual seguradora / prestadora?"
              : "Seguradora / prestadora"}
          </Label>
          <Input
            value={provider}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Nome da seguradora ou garantidora"
          />
        </div>
      )}
    </>
  );
}
