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
  buildValidUntil,
  emptyParty,
  formatAmountInput,
  garantiaHumanLabel,
  validParties,
  type PartyInput,
  type ProposalFormValues,
} from "@/lib/proposals/form-data";

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
export function ProposalForm({
  mode,
  proposalId,
  initial,
  schemaOptions,
}: {
  mode: "create" | "edit";
  proposalId?: string;
  initial: ProposalFormValues;
  schemaOptions: SchemaOption[];
}) {
  const router = useRouter();
  const [v, setV] = useState<ProposalFormValues>(initial);
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

      <form onSubmit={handleSubmit} className="space-y-4">
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
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Buscar no catálogo iList (RE/MAX)"
                    onClick={() => setPickerOpen(true)}
                  >
                    <Building2 className="h-4 w-4" />
                  </Button>
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
                          patch({ garantia: { ...v.garantia, tipo: t as GarantiaTipo } })
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
                    {["seguro_fianca", "garantia_digital", "titulo_capitalizacao"].includes(
                      v.garantia.tipo
                    ) && (
                      <div className="space-y-1">
                        <Label>Seguradora / provedora</Label>
                        <Input
                          value={v.garantia.provider}
                          onChange={(e) =>
                            patch({ garantia: { ...v.garantia, provider: e.target.value } })
                          }
                        />
                      </div>
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
                        O fiador entra no documento; ele não é adicionado como
                        signatário da proposta.
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
