"use client";

import { useEffect, useId, useState } from "react";
import { useFieldArray, UseFormReturn, Controller } from "react-hook-form";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, UserPlus, Building2, Search } from "lucide-react";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { OBSERVACOES_MAX } from "@/lib/forms/validation";

interface ComissaoConfigStepProps {
  form: UseFormReturn<any>;
  /** Token do form público — usado pra chamar /api/forms/[token]/commissioners */
  token?: string;
}

interface CommissionerLookup {
  id: string;
  label: string;
  tipoPessoa: string | null;
  doc: string | null;
  creci: string | null;
  papel: string | null;
  email: string | null;
  phone: string | null;
}

function FormField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label className="text-sm font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CheckboxField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
    </div>
  );
}

/**
 * Botão "Salvar como cadastro reutilizável" — persiste o comissionado como
 * SplitRecipient via /api/forms/[token]/commissioners e armazena o id no
 * form. Próximos negócios encontram esse cadastro pelo autocomplete.
 *
 * Sem dados de PIX/banco, o cadastro fica como rascunho (active=false) —
 * admin completa em /settings/pagamentos/split-recipients depois.
 */
function SaveAsCadastroButton({
  form,
  index,
  token,
}: {
  form: UseFormReturn<any>;
  index: number;
  token: string;
}) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const base = `comissao.comissionados.${index}`;
    const tipoPessoa = (form.getValues(`${base}.tipo_pessoa`) || "juridica") as
      | "fisica"
      | "juridica";
    const nome = String(form.getValues(`${base}.nome`) || "").trim();
    const doc = String(
      form.getValues(
        tipoPessoa === "fisica" ? `${base}.cpf` : `${base}.cnpj`
      ) || ""
    ).trim();
    if (!nome || !doc) {
      toast.error("Preencha pelo menos Nome e CPF/CNPJ antes de salvar.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/forms/${token}/commissioners`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: nome,
          tipoPessoa,
          cpfCnpj: doc,
          creci: String(form.getValues(`${base}.creci`) || "") || undefined,
          papel: form.getValues(`${base}.papel`) || "imobiliaria_principal",
          email: String(form.getValues(`${base}.email`) || "") || undefined,
          phone:
            String(form.getValues(`${base}.mobile_phone`) || "") || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Falha ao salvar cadastro.");
        return;
      }
      const data = await res.json();
      const recipientId = data?.recipient?.id;
      if (recipientId) {
        form.setValue(`${base}.splitRecipientId`, recipientId, {
          shouldDirty: true,
        });
      }
      toast.success(
        data?.existed
          ? "Cadastro já existia e foi vinculado."
          : "Cadastro salvo. Próximos negócios podem reusá-lo."
      );
    } catch (err) {
      console.error("[SaveAsCadastroButton]", err);
      toast.error("Erro ao salvar cadastro.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleSave}
      disabled={saving}
      className="text-xs"
    >
      {saving ? "Salvando..." : "Salvar como cadastro reutilizável"}
    </Button>
  );
}

export function ComissaoConfigStep({ form, token }: ComissaoConfigStepProps) {
  const quemPaga = form.watch("comissao.quem_paga");
  const quandoPaga = form.watch("comissao.quando_paga");

  // Lookup público de comissionados cadastrados na org.
  // Carregado sob demanda quando usuário abre o picker "Selecionar cadastrado".
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResults, setLookupResults] = useState<CommissionerLookup[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const datalistId = useId();

  useEffect(() => {
    if (!lookupOpen || !token) return;
    let cancelled = false;
    setLookupLoading(true);
    const q = lookupQuery.trim();
    const url = `/api/forms/${token}/commissioners${q ? `?q=${encodeURIComponent(q)}` : ""}`;
    // credentials default (same-origin): em prod imobpro.ia.br o endpoint
    // é público sem auth — cookie da sessão NextAuth é inofensivo (route
    // não chama requireAuth). Em preview Vercel com SSO, `credentials: "omit"`
    // quebrava a request com 401 porque não enviava o cookie de SSO.
    fetch(url)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        if (!cancelled) {
          setLookupResults(Array.isArray(data?.items) ? data.items : []);
        }
      })
      .catch(() => {
        if (!cancelled) setLookupResults([]);
      })
      .finally(() => {
        if (!cancelled) setLookupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lookupOpen, lookupQuery, token]);

  const {
    fields: testemunhaFields,
    append: appendTestemunha,
    remove: removeTestemunha,
  } = useFieldArray({
    control: form.control,
    name: "testemunhas",
  });

  // Garante que sempre existem ao menos 2 testemunhas (padrão CCV).
  // Append em loop separado pra evitar setState durante render.
  useEffect(() => {
    if (testemunhaFields.length < 2) {
      const missing = 2 - testemunhaFields.length;
      for (let i = 0; i < missing; i++) {
        appendTestemunha({ nome: "", cpf: "", email: "" });
      }
    }
  }, [testemunhaFields.length, appendTestemunha]);

  // Comissionados — array dinâmico (corretora + intermediária + sub-corretor).
  // Hidrata 1º item a partir dos campos legados `imobiliaria_*` quando vazio,
  // pra suavizar formulários antigos. Garante pelo menos 1 entrada.
  const {
    fields: comissionadoFields,
    append: appendComissionado,
    remove: removeComissionado,
  } = useFieldArray({
    control: form.control,
    name: "comissao.comissionados",
  });

  useEffect(() => {
    if (comissionadoFields.length === 0) {
      const legacyNome = form.getValues("comissao.imobiliaria_nome") || "";
      const legacyDoc = form.getValues("comissao.imobiliaria_cnpj") || "";
      const legacyEmail = form.getValues("comissao.imobiliaria_email") || "";
      const legacyTipo =
        form.getValues("comissao.corretora_tipo_pessoa") || "juridica";
      const legacyCreci = form.getValues("comissao.creci") || "";
      const legacyFlag = !!form.getValues("comissao.incluir_como_signatario");
      appendComissionado({
        nome: legacyNome,
        tipo_pessoa: legacyTipo,
        cpf: legacyTipo === "fisica" ? legacyDoc : "",
        cnpj: legacyTipo !== "fisica" ? legacyDoc : "",
        creci: legacyCreci,
        email: legacyEmail,
        incluir_como_signatario: legacyFlag,
      });
    }
  }, [comissionadoFields.length, appendComissionado, form]);

  // Sync `comissionados[0]` → campos legados pra templates Handlebars que
  // ainda renderizam `comissao.imobiliaria_*` no corpo do contrato.
  // Watcher: dispara quando o usuário edita o 1º item.
  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (!name?.startsWith("comissao.comissionados.0.")) return;
      const first = value?.comissao?.comissionados?.[0];
      if (!first) return;
      const tipo = first.tipo_pessoa || "juridica";
      const doc = tipo === "fisica" ? first.cpf || "" : first.cnpj || "";
      form.setValue("comissao.corretora_tipo_pessoa", tipo, {
        shouldDirty: false,
      });
      form.setValue("comissao.imobiliaria_nome", first.nome || "", {
        shouldDirty: false,
      });
      form.setValue("comissao.imobiliaria_cnpj", doc, { shouldDirty: false });
      form.setValue("comissao.imobiliaria_email", first.email || "", {
        shouldDirty: false,
      });
      form.setValue("comissao.creci", first.creci || "", {
        shouldDirty: false,
      });
      form.setValue(
        "comissao.incluir_como_signatario",
        !!first.incluir_como_signatario,
        { shouldDirty: false }
      );
    });
    return () => subscription.unsubscribe();
  }, [form]);

  return (
    <div className="space-y-4">
      {/* Comissão */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Comissão Imobiliária
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Valor da Comissão">
              <Controller
                control={form.control}
                name="comissao.valor"
                render={({ field }) => (
                  <MoneyInput
                    value={field.value || 0}
                    onChange={(v) => field.onChange(v)}
                  />
                )}
              />
            </FormField>

            <FormField label="Quem Paga a Comissão">
              <NativeSelect
                value={quemPaga || "comprador"}
                onChange={(v) => {
                  form.setValue("comissao.quem_paga", v, { shouldDirty: true });
                  const textos: Record<string, string> = {
                    comprador: "Parte Compradora",
                    vendedor: "Parte Vendedora",
                    ambos: "Ambas as Partes",
                    outro: "",
                  };
                  form.setValue("comissao.quem_paga_texto", textos[v] || "", { shouldDirty: true });
                }}
                options={[
                  { value: "comprador", label: "Comprador" },
                  { value: "vendedor", label: "Vendedor" },
                  { value: "ambos", label: "Ambos (50/50)" },
                  { value: "outro", label: "Outro" },
                ]}
              />
            </FormField>

            {quemPaga === "outro" && (
              <FormField label="Especificar quem paga" className="md:col-span-2">
                <Input
                  {...form.register("comissao.quem_paga_texto")}
                  placeholder="Especifique quem paga a comissão..."
                />
              </FormField>
            )}

            <FormField label="Quando Paga a Comissão">
              <NativeSelect
                value={quandoPaga || "assinatura"}
                onChange={(v) => form.setValue("comissao.quando_paga", v, { shouldDirty: true })}
                options={[
                  { value: "assinatura", label: "Na assinatura do contrato" },
                  { value: "chaves", label: "Na entrega das chaves" },
                  { value: "quitacao", label: "Na quitação total" },
                  { value: "registro", label: "No registro da escritura" },
                  { value: "parcelas", label: "Em parcelas" },
                ]}
              />
            </FormField>

            <FormField label="Forma de pagamento preferida">
              <NativeSelect
                value={form.watch("comissao.forma_pagamento_preferida") || "qualquer"}
                onChange={(v) =>
                  form.setValue("comissao.forma_pagamento_preferida", v, { shouldDirty: true })
                }
                options={[
                  { value: "qualquer", label: "Qualquer (escolher na cobrança)" },
                  { value: "pix", label: "PIX" },
                  { value: "boleto", label: "Boleto" },
                ]}
              />
            </FormField>

            <FormField label="Prazo após o marco (dias)">
              <Input
                type="number"
                min="0"
                placeholder="Padrão da modalidade"
                {...form.register("comissao.prazo_dias_apos_marco", {
                  valueAsNumber: true,
                  setValueAs: (v) => (v === "" || isNaN(v) ? undefined : Number(v)),
                })}
              />
              <p className="text-xs text-muted-foreground">
                Se vazio: 3 dias úteis (assinatura), 30 dias (chaves), 60 dias (registro).
              </p>
            </FormField>
          </div>

          <Separator />

          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-foreground">
              Comissionados (Corretores e Imobiliárias)
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {token && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setLookupOpen((v) => !v);
                    setLookupQuery("");
                  }}
                >
                  <Search className="h-3.5 w-3.5 mr-1.5" />
                  Selecionar cadastrado
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  appendComissionado({
                    nome: "",
                    tipo_pessoa: "fisica",
                    cpf: "",
                    cnpj: "",
                    creci: "",
                    email: "",
                    incluir_como_signatario: false,
                  })
                }
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                Novo corretor (PF)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  appendComissionado({
                    nome: "",
                    tipo_pessoa: "juridica",
                    cpf: "",
                    cnpj: "",
                    creci: "",
                    email: "",
                    incluir_como_signatario: false,
                  })
                }
              >
                <Building2 className="h-3.5 w-3.5 mr-1.5" />
                Nova imobiliária (PJ)
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Suporta múltiplos corretores e imobiliárias dividindo a comissão.
            O primeiro entra no corpo do contrato; demais aparecem só como
            assinantes adicionais no envelope ClickSign.
          </p>

          {lookupOpen && token && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  list={datalistId}
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  placeholder="Buscar por nome, CPF/CNPJ ou CRECI..."
                  className="bg-background"
                />
              </div>
              <datalist id={datalistId}>
                {lookupResults.map((r) => (
                  <option key={r.id} value={r.label}>
                    {r.label} — {r.tipoPessoa === "fisica" ? "Corretor" : "Imobiliária"}
                    {r.creci ? ` · CRECI ${r.creci}` : ""}
                  </option>
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Dados bancários ficam visíveis apenas no painel administrativo.
              </p>
              {lookupLoading && (
                <p className="text-xs text-muted-foreground">Buscando...</p>
              )}
              {!lookupLoading && lookupResults.length === 0 && lookupQuery && (
                <p className="text-xs text-muted-foreground">
                  Nenhum cadastrado encontrado. Use os botões "Novo corretor" ou
                  "Nova imobiliária" pra cadastrar.
                </p>
              )}
              {!lookupLoading && lookupResults.length > 0 && (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {lookupResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        const isPF = r.tipoPessoa === "fisica";
                        appendComissionado({
                          splitRecipientId: r.id,
                          nome: r.label,
                          tipo_pessoa: isPF ? "fisica" : "juridica",
                          cpf: isPF ? (r.doc ?? "") : "",
                          cnpj: !isPF ? (r.doc ?? "") : "",
                          creci: r.creci ?? "",
                          email: r.email ?? "",
                          mobile_phone: r.phone ?? "",
                          papel: (r.papel as
                            | "captador"
                            | "intermediador"
                            | "indicador"
                            | "imobiliaria_principal"
                            | "outro"
                            | null) ?? "imobiliaria_principal",
                          incluir_como_signatario: false,
                        });
                        toast.success(`${r.label} adicionado(a) como comissionado.`);
                        setLookupOpen(false);
                      }}
                      className="w-full text-left rounded border bg-background hover:bg-accent p-2 text-sm transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{r.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.tipoPessoa === "fisica" ? "Corretor" : "Imobiliária"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.doc ?? ""}{r.creci ? ` · CRECI ${r.creci}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {comissionadoFields.map((field, index) => {
            const tipoPath =
              `comissao.comissionados.${index}.tipo_pessoa` as const;
            const tipoPessoa = form.watch(tipoPath) || "juridica";
            const splitRecipientId = form.watch(
              `comissao.comissionados.${index}.splitRecipientId`
            ) as string | undefined;
            return (
              <div
                key={field.id}
                className="rounded-md border p-4 space-y-3 bg-muted/20"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">
                      {index === 0
                        ? "Comissionado principal"
                        : `Comissionado ${index + 1}`}
                    </p>
                    {splitRecipientId && (
                      <span className="inline-flex items-center rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300">
                        Cadastro vinculado
                      </span>
                    )}
                  </div>
                  {comissionadoFields.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => removeComissionado(index)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Remover
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Tipo de Cadastro" className="md:col-span-2">
                    <select
                      {...form.register(tipoPath)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <option value="juridica">Imobiliária (PJ)</option>
                      <option value="fisica">Corretor autônomo (PF)</option>
                    </select>
                  </FormField>
                  <FormField
                    label={
                      tipoPessoa === "fisica"
                        ? "Nome do Corretor"
                        : "Nome da Imobiliária"
                    }
                    className="md:col-span-2"
                  >
                    <Input
                      {...form.register(`comissao.comissionados.${index}.nome`)}
                      placeholder={
                        tipoPessoa === "fisica"
                          ? "Nome completo"
                          : "Razão Social ou Nome Fantasia"
                      }
                    />
                  </FormField>
                  {tipoPessoa === "fisica" ? (
                    <FormField label="CPF do Corretor">
                      <Input
                        {...form.register(
                          `comissao.comissionados.${index}.cpf`
                        )}
                        placeholder="000.000.000-00"
                      />
                    </FormField>
                  ) : (
                    <FormField label="CNPJ da Imobiliária">
                      <Input
                        {...form.register(
                          `comissao.comissionados.${index}.cnpj`
                        )}
                        placeholder="00.000.000/0000-00"
                      />
                    </FormField>
                  )}
                  <FormField label="CRECI">
                    <Input
                      {...form.register(
                        `comissao.comissionados.${index}.creci`
                      )}
                      placeholder={
                        tipoPessoa === "fisica" ? "Ex: 199.905" : "Ex: J-12345"
                      }
                    />
                  </FormField>
                  <FormField label="Percentual da comissão (%)">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      {...form.register(
                        `comissao.comissionados.${index}.percentual`,
                        {
                          setValueAs: (v) =>
                            v === "" || isNaN(v) ? undefined : Number(v),
                        }
                      )}
                      placeholder={index === 0 ? "100" : "Ex: 30"}
                    />
                  </FormField>
                  <FormField label="Papel">
                    <select
                      {...form.register(
                        `comissao.comissionados.${index}.papel`
                      )}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <option value="imobiliaria_principal">
                        Imobiliária / Corretora principal
                      </option>
                      <option value="captador">Captador</option>
                      <option value="intermediador">Intermediador</option>
                      <option value="indicador">Indicador</option>
                      <option value="outro">Outro</option>
                    </select>
                  </FormField>
                  <FormField
                    label="E-mail (para assinatura e notificações)"
                  >
                    <Input
                      type="email"
                      {...form.register(
                        `comissao.comissionados.${index}.email`
                      )}
                      placeholder="contato@imobiliaria.com"
                    />
                  </FormField>
                  <FormField label="Celular (com DDD)">
                    <Input
                      type="tel"
                      {...form.register(
                        `comissao.comissionados.${index}.mobile_phone`
                      )}
                      placeholder="(11) 99999-9999"
                    />
                  </FormField>
                  <Controller
                    control={form.control}
                    name={`comissao.comissionados.${index}.incluir_como_signatario`}
                    render={({ field: cf }) => (
                      <div className="md:col-span-2">
                        <CheckboxField
                          id={`incluir-comissionado-${index}`}
                          label="Incluir como signatário no envelope"
                          checked={!!cf.value}
                          onChange={cf.onChange}
                        />
                      </div>
                    )}
                  />
                </div>

                {token && !splitRecipientId && (
                  <div className="pt-2 border-t border-dashed">
                    <SaveAsCadastroButton
                      form={form}
                      index={index}
                      token={token}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {/* Soma de percentuais — só aparece se há múltiplos */}
          {comissionadoFields.length > 1 && (() => {
            const soma = comissionadoFields.reduce((acc, _f, i) => {
              const v = form.watch(
                `comissao.comissionados.${i}.percentual`
              ) as number | undefined;
              return acc + (v ?? 0);
            }, 0);
            const overflow = soma > 100;
            return (
              <div
                className={`rounded-md border p-2 text-xs ${
                  overflow
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : soma === 100
                      ? "border-green-300 bg-green-50 text-green-900"
                      : "border-amber-300 bg-amber-50 text-amber-900"
                }`}
              >
                Soma dos percentuais: <strong>{soma.toFixed(2)}%</strong>
                {overflow
                  ? " — excede 100%, ajuste antes de finalizar."
                  : soma === 100
                    ? " — comissão totalmente distribuída."
                    : ` — restam ${(100 - soma).toFixed(2)}% sem destino (campo opcional, mas recomendado completar).`}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/*
        Cláusula de desistência, foro e local/data de assinatura saíram daqui:
        são decisões jurídicas da imobiliária, não do cliente que preenche o
        link. Agora vivem na aba "Configurações" do editor de contrato, com
        padrão por org (lib/contracts/default-config.ts).
      */}

      {/* Testemunhas */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Testemunhas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {testemunhaFields.map((field, index) => (
            <div key={field.id} className="space-y-3">
              {index > 0 && <Separator />}
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  Testemunha {index + 1}
                </p>
                {index >= 2 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => removeTestemunha(index)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remover
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Nome">
                  <Input
                    {...form.register(`testemunhas.${index}.nome`)}
                    placeholder="Nome completo"
                  />
                </FormField>
                <FormField label="CPF">
                  <Input
                    {...form.register(`testemunhas.${index}.cpf`)}
                    placeholder="000.000.000-00"
                  />
                </FormField>
                <FormField label="E-mail (para assinatura digital)" className="md:col-span-2">
                  <Input
                    type="email"
                    {...form.register(`testemunhas.${index}.email`)}
                    placeholder="testemunha@email.com"
                  />
                </FormField>
              </div>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              appendTestemunha({ nome: "", cpf: "", email: "" })
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Adicionar testemunha
          </Button>
        </CardContent>
      </Card>

      {/* Observações gerais */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Observações Gerais
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FormField label="Algo mais que a imobiliária precise saber? (opcional)">
            <Textarea
              {...form.register("observacoes")}
              rows={5}
              maxLength={OBSERVACOES_MAX}
              placeholder="Combinados, prazos, condições especiais ou qualquer detalhe da negociação que não coube nos campos acima."
            />
          </FormField>
          <p className="mt-2 text-xs text-muted-foreground">
            Entra no resumo enviado à imobiliária e é considerado na análise do
            contrato. Não vira texto do contrato automaticamente.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
