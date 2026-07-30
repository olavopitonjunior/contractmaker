"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DadosContratoForm,
  STEP_LABELS,
  STEP_REQUIRED_FIELDS_LEGACY,
} from "@/lib/forms/validation";
import { collectPartyFormatIssues } from "@/lib/forms/field-formats";
import {
  PartyLinksPanel,
  SharePartyLinkButton,
} from "@/components/forms/PartyLinksPanel";
import {
  effectiveRequiredPaths,
  findMissingRequired,
  findCertidaoRecommendations,
  findSignatureRecommendations,
  CERTIDAO_FIELD_LABELS,
  PARTY_SUB_LABELS,
  isValueEmpty,
  getByPath,
} from "@/lib/forms/party-required";
import { toast } from "sonner";
import { useAutoSave } from "@/hooks/use-auto-save";
import { useDirtyTopLevelScope } from "@/hooks/use-dirty-scope";
import { DocumentosStep } from "@/components/forms/steps/DocumentosStep";
import type { Assignment } from "@/lib/forms/extracted-to-form";
import { VendedorStep } from "@/components/forms/steps/VendedorStep";
import { CompradorStep } from "@/components/forms/steps/CompradorStep";
import { ImovelStep } from "@/components/forms/steps/ImovelStep";
import { StatusDebitosStep } from "@/components/forms/steps/StatusDebitosStep";
import { PagamentoStep } from "@/components/forms/steps/PagamentoStep";
import { ComissaoConfigStep } from "@/components/forms/steps/ComissaoConfigStep";
import { PrivacyConsent } from "@/components/legal/PrivacyConsent";
import { RequiredFieldMarker } from "@/components/forms/RequiredFieldMarker";
import { VoiceInputButton } from "@/components/forms/VoiceInputButton";

// Apenas steps com schema definido em `lib/ai/voice-extract.ts` ativam o
// botão de voz. Steps 0, 4, 6 (Documentos, Status/Posse/Débitos,
// Comissão/Config) ficam fora da v1 — preenchimento por voz não casa bem
// com upload de docs ou cálculo de multa.
const STEPS_WITH_VOICE = new Set([1, 2, 3, 5]);

interface SalesFormWizardProps {
  token: string;
  initialData: Record<string, unknown>;
  /**
   * Required fields por step calculado server-side a partir de
   * OrgFormSettings.preset + customRequiredPaths (PR 1).
   * Quando ausente, cai no array legado pra manter retrocompat com
   * callers que ainda não passam (testes, eventual standalone).
   */
  requiredFieldsByStep?: readonly (readonly string[])[];
  /**
   * Quando true, mostra banner no topo informando que os dados foram
   * extraídos de uma proposta enviada pelo corretor e devem ser revisados
   * antes do finalize. Vem de `?prefilled=1` no `/f/[token]`.
   */
  prefilled?: boolean;
  /**
   * URL do FormAttachment da proposta original (PDF/DOCX). Quando presente,
   * banner ganha botão "Ver original".
   */
  proposalAttachmentUrl?: string | null;
  /**
   * Visitante é membro da org dona do form (`viewerIsOrgMember`, server-side).
   * Duas coisas dependem dele, ambas por o link público estar normalmente com o
   * CLIENTE: os campos de recebimento da comissão (PIX/conta) na etapa de
   * Comissão, e remover documento na etapa 0. Default `false`, e o subtoken por
   * parte nunca é membro. Nos dois casos o servidor é o guard autoritativo
   * (403); isto aqui é a metade visual.
   */
  viewerIsMember?: boolean;
  /**
   * Subset de step indexes (0..7) a mostrar. Usado por subtoken (PR 4)
   * pra esconder steps que não pertencem ao role (vendedor não vê
   * comprador, comprador não vê imóvel/comissão/pagamento). Quando
   * ausente, mostra todos os 8 steps (comportamento padrão).
   */
  stepIndexes?: readonly number[];
  /**
   * Endpoint custom pro auto-save (PR 4). Default `/api/forms/${token}`.
   * Subtoken passa `/api/forms/participant/${subtoken}`.
   */
  endpoint?: string;
  /**
   * pathScope pro useAutoSave (PR 4). Subtoken passa `ROLE_PATHS[role]`
   * pra mandar apenas keys autorizadas.
   */
  pathScope?: readonly string[];
  /**
   * Link individual: slot do próprio participante (role + partyIndex) pro
   * auto-assign/auto-apply de OCR no DocumentosStep (Fix 4).
   */
  selfAssignment?: Assignment;
  /**
   * Finalize do subtoken (PR 4): em vez de PATCH `status: "completo"` no
   * form principal (que dispara geração de contrato), PATCH no subtoken
   * com `markCompleted: true`. Subtoken nunca "finaliza" o form principal.
   */
  finalizeMode?: "main" | "participant";
  /**
   * Somente-leitura: form travado (SalesForm.lockedAt). Desliga o auto-save,
   * desabilita os campos (fieldset) e esconde o botão de finalizar. A navegação
   * entre etapas continua ativa pra visualizar os dados. O servidor é o guard
   * autoritativo (403 nos writes); isto é UX.
   */
  readOnly?: boolean;
}

const FULL_STEP_INDEXES: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

// NOTA (fix estado_civil, 2026-07-16): removido o antigo `withPartyDefaults`,
// que fabricava `estado_civil: "Solteiro(a)"` em partes PF sem o campo
// (OCR/import/forms legados). Isso era risco jurídico: um casado cujo estado
// civil não foi extraído virava "solteiro" persistido → contrato sem outorga
// conjugal, sem ninguém decidir. Agora a ausência é preservada; o select mostra
// "Selecione…" (placeholder) e a validação de campo obrigatório força o
// operador a escolher conscientemente. A aprovação ainda emite um aviso quando
// o estado civil de uma parte PF ficou em branco (contract-generation.ts).

function SaveStatusBadge({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  if (status === "idle") return null;

  const config = {
    saving: {
      label: "Salvando...",
      className: "border-warning/30 bg-warning/10 text-warning",
      dotClass: "bg-warning animate-pulse",
    },
    saved: {
      label: "Salvo",
      className: "border-success/30 bg-success/10 text-success",
      dotClass: "bg-success",
    },
    error: {
      label: "Erro ao salvar",
      className: "border-destructive/30 bg-destructive/10 text-destructive",
      dotClass: "bg-destructive",
    },
  };

  const { label, className, dotClass } = config[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

type StepState = "completed" | "current" | "pending-warning" | "untouched";

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  /** Labels já filtradas pelos steps visíveis (subtoken vê subset). */
  stepLabels: readonly string[];
  visitedSteps: ReadonlySet<number>;
  /**
   * Quando true (forms `?prefilled=1`), todos os steps são avaliados pra
   * pendências de cara — não só os visitados. Permite revisar uma proposta
   * extraída vendo de imediato onde faltam dados.
   */
  proactive: boolean;
  /**
   * Reflete se um step VIRTUAL (cursor 0..N-1) tem campos obrigatórios ainda
   * vazios. Value-driven (não baseado em erros), então atualiza sozinho
   * conforme o usuário preenche. Recebe cursor virtual, não trueIndex.
   */
  stepHasPending: (stepIndex: number) => boolean;
  onStepClick: (target: number) => void;
}

function StepIndicator({
  currentStep,
  totalSteps,
  stepLabels,
  visitedSteps,
  proactive,
  stepHasPending,
  onStepClick,
}: StepIndicatorProps) {
  // Keyboard: ←/→ navegam para vizinhos. Hold Shift+arrow não pula validation —
  // mesma regra do click. Tab continua nativo (passa por cada bullet).
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      onStepClick(index - 1);
    } else if (e.key === "ArrowRight" && index < totalSteps - 1) {
      e.preventDefault();
      onStepClick(index + 1);
    }
  };

  function getState(index: number): StepState {
    if (index === currentStep) return "current";
    // Pendência tem prioridade sobre "completed": um step já passado mas com
    // campo obrigatório vazio deve continuar sinalizado em âmbar na revisão.
    if ((visitedSteps.has(index) || proactive) && stepHasPending(index)) {
      return "pending-warning";
    }
    if (index < currentStep) return "completed";
    return "untouched";
  }

  return (
    <div
      role="tablist"
      aria-label="Etapas do formulário"
      className="w-full overflow-x-auto pb-2"
    >
      <div className="flex items-start min-w-max">
        {stepLabels.map((label, index) => {
          const stepNumber = index + 1;
          const state = getState(index);
          const isCurrent = state === "current";
          const isCompleted = state === "completed";
          const isPending = state === "pending-warning";

          const bulletClass = {
            completed:
              "bg-primary border-primary text-primary-foreground hover:bg-primary/90",
            current: "bg-primary/10 border-primary text-primary",
            "pending-warning":
              "bg-warning/10 border-warning text-warning hover:bg-warning/20",
            untouched:
              "bg-background border-border text-muted-foreground hover:bg-muted hover:border-muted-foreground/30",
          }[state];

          const labelClass = isCurrent
            ? "text-primary font-medium"
            : isCompleted
              ? "text-foreground"
              : isPending
                ? "text-warning font-medium"
                : "text-muted-foreground";

          return (
            <div key={index} className="flex items-start">
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isCurrent}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={`Etapa ${stepNumber}: ${label}${
                    isPending ? " (pendências)" : ""
                  }`}
                  onClick={() => onStepClick(index)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  className={`
                    flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold border-2 transition-all cursor-pointer
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
                    ${bulletClass}
                  `}
                >
                  {isCompleted ? (
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : isPending ? (
                    "!"
                  ) : (
                    stepNumber
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onStepClick(index)}
                  className={`text-[11px] whitespace-normal max-w-[96px] text-center leading-tight cursor-pointer hover:underline ${labelClass}`}
                  tabIndex={-1}
                >
                  {label}
                </button>
              </div>

              {index < totalSteps - 1 && (
                <div
                  className={`h-0.5 w-8 mt-4 mx-1 flex-shrink-0 transition-all ${
                    isCompleted ? "bg-primary" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const defaultFormValues: Partial<DadosContratoForm> = {
  vendedores: [
    {
      tipo_pessoa: "fisica",
      nome: "",
      nacionalidade: "Brasileiro(a)",
      estado_civil: "", // vazio => select mostra "Selecione…"; força escolha (outorga)
      profissao: "",
      rg: "",
      cpf: "",
      data_nascimento: "",
      nome_mae: "",
      sexo: "",
      email: "",
      endereco: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      uf: "",
      cep: "",
      mobile_phone: "",
      tem_procurador: false,
    },
  ],
  compradores: [
    {
      tipo_pessoa: "fisica",
      nome: "",
      nacionalidade: "Brasileiro(a)",
      estado_civil: "", // vazio => select mostra "Selecione…"; força escolha (outorga)
      profissao: "",
      rg: "",
      cpf: "",
      data_nascimento: "",
      nome_mae: "",
      sexo: "",
      email: "",
      endereco: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      uf: "",
      cep: "",
      mobile_phone: "",
      tem_procurador: false,
    },
  ],
  imoveis: [
    {
      rua: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      uf: "",
      cep: "",
      matricula: "",
      cartorio: "",
      inscricao_iptu: "",
      sql: "",
      inscricao_municipal: "",
      descricao: "",
    },
  ],
  status_propriedade: "quitado-registrado",
  saldo_devedor: 0,
  tem_debitos: false,
  pagamento: {
    // valor_total é o único bucket editável diretamente pelo form 2026-05-16+.
    // Os demais (sinal_arras, fgts, ...) são derivados via enrichContractData
    // a partir de pagamento.parcelas[].tipo. Mantidos como 0 inicial pra
    // retrocompat com forms legados que ainda escrevem direto.
    valor_total: 0,
    sinal_arras: 0,
    recursos_proprios: 0,
    fgts: 0,
    cessao_consorcio: 0,
    alienacao_fiduciaria: 0,
    outras_formas: 0,
    meio_pagamento: "transferencia bancaria",
    parcelas: [],
  },
  ocupacao: "desocupado",
  entrega_posse: {
    momento: "assinatura",
    momento_texto: "na data da assinatura do presente instrumento",
  },
  titulo_definitivo: {
    prazo_dias: 60,
    opcao: "certidoes-apos",
  },
  comissao: {
    valor: 0,
    quem_paga: "comprador",
    quem_paga_texto: "Parte Compradora",
    quando_paga: "assinatura",
    quando_paga_texto: "no ato da assinatura",
    forma_pagamento_preferida: "qualquer" as const,
    corretora_tipo_pessoa: "juridica" as const,
    imobiliaria_nome: "",
    imobiliaria_cnpj: "",
    imobiliaria_email: "",
    creci: "",
    incluir_como_signatario: false,
  },
  testemunhas: [
    { nome: "", cpf: "", email: "", incluir_como_signatario: false },
    { nome: "", cpf: "", email: "", incluir_como_signatario: false },
  ],
  observacoes: "",
  // `desistencia`, `foro`, `assinatura` e `config` saíram daqui junto com os
  // campos: o form não deve mais gravá-los no dataJson, senão o valor de
  // fábrica do wizard venceria o padrão da imobiliária (o enrich é aditivo — só
  // preenche o que está ausente). Quem resolve isso agora é
  // `enrichContractData` na geração, com `DEFAULT_CONTRACT_SETTINGS` de piso.
};

export function SalesFormWizard({
  token,
  initialData,
  requiredFieldsByStep,
  prefilled,
  proposalAttachmentUrl,
  viewerIsMember = false,
  stepIndexes,
  endpoint,
  pathScope,
  selfAssignment,
  finalizeMode = "main",
  readOnly = false,
}: SalesFormWizardProps) {
  // `visibleStepIndexes` mapeia cursor virtual (0..N-1) para índice "real"
  // dos 8 steps existentes. Default = todos os 8. Subtoken passa subset.
  const visibleStepIndexes: readonly number[] = stepIndexes ?? FULL_STEP_INDEXES;
  const TOTAL_STEPS = visibleStepIndexes.length;

  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [emailCopyState, setEmailCopyState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function requestEmailCopy() {
    setEmailCopyState("sending");
    try {
      const res = await fetch(`/api/forms/${token}/send-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "parties", includeAttachments: true }),
      });
      setEmailCopyState(res.ok ? "sent" : "error");
    } catch {
      setEmailCopyState("error");
    }
  }
  // Incrementa toda vez que validateAndNavigate falha — RequiredFieldMarker observa
  // pra disparar scroll/focus no primeiro [aria-invalid="true"].
  const [failedTriggerCount, setFailedTriggerCount] = useState(0);
  // Cursors virtuais visitados (não trueIndexes). Step 0 (virtual) entra
  // na inicialização — é o primeiro step visível pro role.
  const [visitedSteps, setVisitedSteps] = useState<ReadonlySet<number>>(
    () => new Set([0]),
  );

  const form = useForm<DadosContratoForm>({
    defaultValues: {
      ...defaultFormValues,
      ...(initialData as Partial<DadosContratoForm>),
    },
    mode: "onChange",
  });

  const watchedData = useWatch({ control: form.control }) as Record<string, unknown>;
  const autoSaveEndpoint = endpoint ?? `/api/forms/${token}`;
  // Auto-save escopado pelas chaves top-level que ESTE cliente sujou: uma aba
  // do token principal hidratada antes de um participante salvar não ecoa mais
  // o template vazio de vendedores/compradores por cima do que a parte gravou
  // (arrays substituem inteiros no merge). O finalize continua full-state — é
  // ação explícita e a validação server roda sobre o merged completo.
  const autoSaveScope = useDirtyTopLevelScope(form.control, pathScope);
  const { status: saveStatus } = useAutoSave(token, watchedData, {
    endpoint: autoSaveEndpoint,
    pathScope: autoSaveScope,
    // Depois do finalize o form fecha e o PATCH público passa a responder 403.
    // Sem desligar aqui, um auto-save com debounce pendente cai DEPOIS do
    // finalize e a tela de sucesso nasce com a pill em "erro".
    enabled: !readOnly && !isComplete,
  });

  const isLastStep = currentStep === TOTAL_STEPS - 1;

  // Index "verdadeiro" no schema de 8 steps. Usado pra resolver label,
  // required fields e step component.
  const currentTrueIndex = visibleStepIndexes[currentStep] ?? 0;

  // Fallback pro array legado quando server não passa (testes etc.).
  const effectiveRequiredFields: readonly (readonly string[])[] =
    requiredFieldsByStep ?? STEP_REQUIRED_FIELDS_LEGACY;
  const currentRequiredFields = effectiveRequiredFields[currentTrueIndex] ?? [];

  // Leitura reativa de um path a partir dos valores observados (useWatch),
  // pra que stepper/bolha de pendências recalculem a cada digitação.
  const readValue = (path: string): unknown => getByPath(watchedData, path);

  // Required fields da etapa atual remapeados pelo tipo_pessoa vivo (PJ não
  // tem cpf/estado_civil/rg — vira cnpj/razão social ou é dispensado).
  const currentEffectiveRequired = effectiveRequiredPaths(
    currentRequiredFields,
    readValue,
  );
  const currentMissingCount = currentEffectiveRequired.filter((p) =>
    isValueEmpty(readValue(p)),
  ).length;

  // Guarda HÍBRIDA: nas etapas de parte (1=vendedor, 2=comprador), recomenda
  // (sem bloquear) os campos PF que as certidões precisam. O preset já cobre o
  // mínimo de assinatura (email/cpf); aqui é só aviso pra não travar TJSP/
  // Receita/Antecedentes depois. Agrupado por parte.
  const certRecoList: "vendedores" | "compradores" | null =
    currentTrueIndex === 1
      ? "vendedores"
      : currentTrueIndex === 2
        ? "compradores"
        : null;
  const certRecommendations = certRecoList
    ? findCertidaoRecommendations(
        certRecoList,
        ((readValue(certRecoList) as unknown[]) ?? []).length,
        readValue,
      )
    : [];
  const certRecoByParty = new Map<number, string[]>();
  for (const r of certRecommendations) {
    const arr = certRecoByParty.get(r.idx) ?? [];
    arr.push(CERTIDAO_FIELD_LABELS[r.field] ?? r.field);
    certRecoByParty.set(r.idx, arr);
  }
  const certRecoPartyLabel =
    certRecoList === "vendedores" ? "Vendedor" : "Comprador";
  const certRecoMultiple = ((readValue(certRecoList ?? "") as unknown[]) ?? []).length > 1;

  // Segunda guarda híbrida: e-mail das SUB-PARTES (cônjuge/procurador/
  // representante). Elas assinam o contrato como signatárias próprias na
  // ClickSign; sem e-mail não recebem o link e alguém tem que caçar o dado
  // depois. Também não bloqueia — o titular segue sendo o único e-mail duro.
  const signatureRecommendations = certRecoList
    ? findSignatureRecommendations(
        certRecoList,
        ((readValue(certRecoList) as unknown[]) ?? []).length,
        readValue,
      )
    : [];
  const sigRecoByParty = new Map<number, string[]>();
  for (const r of signatureRecommendations) {
    const arr = sigRecoByParty.get(r.idx) ?? [];
    arr.push(PARTY_SUB_LABELS[r.sub]);
    sigRecoByParty.set(r.idx, arr);
  }

  /**
   * Navega para o step target. Pra forward (target > current), revalida cada
   * step intermediário; primeiro fail interrompe e pousa o usuário no step
   * com erro. Pra backward (target ≤ current), navega direto sem revalidar —
   * usuário pode voltar livremente pra revisar.
   *
   * Marca todos os steps por onde a transição passou como visited (mesmo o
   * step que falhou), permitindo o StepIndicator destacar pendências em
   * cinza-âmbar pra steps que o usuário "encostou".
   */
  const validateAndNavigate = async (target: number): Promise<boolean> => {
    if (target < 0 || target >= TOTAL_STEPS) return false;
    if (target === currentStep) return true;

    if (target > currentStep) {
      for (let i = currentStep; i < target; i++) {
        const trueIndex = visibleStepIndexes[i] ?? i;
        const rawStepFields = effectiveRequiredFields[trueIndex] ?? [];
        // Remapeia pelo tipo_pessoa vivo: PJ não tem cpf/estado_civil/rg, então
        // exigi-los geraria pendência fantasma (campo nem renderiza). Vira
        // cnpj/razão social ou é dispensado. eslint: getValues tipado solto.
        const stepFields = effectiveRequiredPaths(
          rawStepFields,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (p) => form.getValues(p as any),
        );
        // Marca step como visited antes de validar — quem visita primeiro
        // gera o sinal de "pendência conhecida" se faltar coisa.
        setVisitedSteps((prev) => {
          if (prev.has(i)) return prev;
          const next = new Set(prev);
          next.add(i);
          return next;
        });
        if (stepFields.length > 0) {
          // Non-empty check manual: `form.trigger` só roda Zod schema, e a
          // maioria dos paths de DadosContrato é `.optional().default("")`
          // — string vazia passa no schema. Pra "obrigatório" funcionar
          // de verdade, checamos null/undefined/"" diretamente nos values
          // e marcamos `setError` pra aria-invalid + RequiredFieldMarker.
          let firstMissing: string | null = null;
          for (const path of stepFields) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw = form.getValues(path as any) as unknown;
            if (isValueEmpty(raw)) {
              if (!firstMissing) firstMissing = path;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              form.setError(path as any, {
                type: "required",
                message: "Campo obrigatório",
              });
            } else {
              // Limpa erro manual se valor agora existe (re-tentativa).
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              form.clearErrors(path as any);
            }
          }
          // Roda o trigger pra cobrir refines/min(N) que o non-empty não pega.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const triggerValid = await form.trigger(stepFields as any);
          if (firstMissing !== null || !triggerValid) {
            setFailedTriggerCount((n) => n + 1);
            toast.error(
              `Preencha os campos obrigatórios da etapa ${i + 1} antes de avançar.`,
            );
            setCurrentStep(i);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return false;
          }
        }

        // Regras de FORMATO (2026-06-01): bloqueia o avanço quando um campo
        // PREENCHIDO tem formato inválido (CPF/CNPJ checksum, nome+sobrenome,
        // nome da mãe, data de nascimento, CEP/UF/telefone). Campo vazio não
        // bloqueia. Mesma função do servidor (collectPartyFormatIssues) — regra
        // única nos dois lados. form.trigger é no-op sem zodResolver, então a
        // checagem é manual (igual ao non-empty acima).
        const formatList =
          trueIndex === 1 ? "vendedores" : trueIndex === 2 ? "compradores" : null;
        if (formatList) {
          // Formato só BLOQUEIA campos que a config marca como obrigatórios
          // (mesmo `stepFields` do gate de não-vazio acima). Campo opcional
          // preenchido com formato ruim — típico de OCR parcial, ex.: nome_mae
          // "Maria N" — não trava mais o avanço. `nome`/`razao_social` do
          // titular contam como obrigatórios quando o path guarda-chuva da
          // lista está no preset (é o que o umbrella enforce via o step).
          const requiredSet = new Set(stepFields);
          const umbrellaRequired = requiredSet.has(formatList);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parties = (form.getValues(formatList as any) as any[]) ?? [];
          let firstInvalid: string | null = null;
          let firstMessage = "";
          parties.forEach((parte, pIdx) => {
            for (const issue of collectPartyFormatIssues(parte)) {
              const path = `${formatList}.${pIdx}.${issue.path}`;
              const isNameField =
                issue.path === "nome" || issue.path === "razao_social";
              const blocks =
                requiredSet.has(path) || (umbrellaRequired && isNameField);
              if (!blocks) continue;
              if (!firstInvalid) {
                firstInvalid = path;
                firstMessage = issue.message;
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              form.setError(path as any, { type: "format", message: issue.message });
            }
          });
          if (firstInvalid) {
            setFailedTriggerCount((n) => n + 1);
            toast.error(firstMessage);
            setCurrentStep(i);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return false;
          }
        }
      }
    }

    setCurrentStep(target);
    setVisitedSteps((prev) => {
      if (prev.has(target)) return prev;
      const next = new Set(prev);
      next.add(target);
      return next;
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  };

  const goToNext = () => validateAndNavigate(currentStep + 1);
  const goToPrev = () => validateAndNavigate(currentStep - 1);

  /**
   * Reflete em tempo real se um step VIRTUAL (cursor) tem campos obrigatórios
   * ainda vazios. Value-driven (lê watchedData via readValue), não baseado em
   * erros do RHF — então some sozinho conforme o usuário preenche, sem depender
   * de um "Próximo" pra re-marcar. Ciente de tipo_pessoa (PJ ≠ PF).
   */
  const stepHasPending = (stepIndex: number): boolean => {
    const trueIndex = visibleStepIndexes[stepIndex] ?? stepIndex;
    const paths = effectiveRequiredFields[trueIndex] ?? [];
    if (paths.length === 0) return false;
    return findMissingRequired(paths, readValue).length > 0;
  };

  const handleFinalize = async () => {
    setIsSubmitting(true);
    try {
      // Subtoken (PR 4): PATCH no endpoint do participant com markCompleted.
      // Form principal NÃO transiciona pra "completo" — quem fecha o form
      // inteiro é o admin via token principal. Subtoken só sinaliza "essa
      // parte terminou de preencher".
      const isParticipant = finalizeMode === "participant";
      const fullValues = form.getValues();
      const body = isParticipant
        ? {
            dataJson: pathScope
              ? Object.fromEntries(
                  Object.entries(fullValues as Record<string, unknown>).filter(
                    ([k]) => pathScope.includes(k),
                  ),
                )
              : fullValues,
            markCompleted: true,
          }
        : { dataJson: fullValues, status: "completo", privacyAccepted };

      const res = await fetch(autoSaveEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        // A resposta traz contractId/dealId, mas a tela de sucesso é pública e
        // não os usa mais — quem preenche o link não tem acesso a /contracts
        // nem /pipeline.
        setIsComplete(true);
      } else {
        console.error("Erro ao finalizar formulário");
      }
    } catch (err) {
      console.error("Erro ao finalizar:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isComplete) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
          <svg
            className="h-8 w-8 text-green-600 dark:text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h2 className="font-display tracking-tight text-2xl font-semibold text-foreground mb-2">
          Formulário enviado!
        </h2>
        {/*
          Esta tela é vista pelo CLIENTE (o link principal é o que vai pra ele),
          então ela confirma só o envio. Falar em "contrato gerado e pronto para
          edição" prometia ao cliente algo que é etapa interna da imobiliária —
          e os botões levavam pra /contracts e /pipeline, rotas autenticadas que
          ele não acessa.
        */}
        <p className="text-muted-foreground max-w-md mb-6">
          Recebemos suas informações. A imobiliária responsável foi avisada e
          seguirá com o seu negócio a partir daqui.
        </p>

        {finalizeMode === "main" && (
          <div className="mt-8 w-full max-w-md rounded-lg border bg-muted/20 p-4 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              Quer uma cópia do resumo por e-mail? Enviaremos o PDF com os dados
              preenchidos para os e-mails informados no formulário.
            </p>
            {emailCopyState === "sent" ? (
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                Enviado! Verifique sua caixa de entrada.
              </p>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={requestEmailCopy}
                  disabled={emailCopyState === "sending"}
                >
                  {emailCopyState === "sending" ? "Enviando..." : "Receber cópia por e-mail"}
                </Button>
                {emailCopyState === "error" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    Não foi possível enviar agora. Verifique se há e-mail
                    preenchido para as partes.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const stepComponents = [
    <DocumentosStep
      key="step-0"
      form={form}
      token={token}
      allowedTopKeys={pathScope}
      selfAssignment={selfAssignment}
      viewerIsMember={viewerIsMember}
    />,
    <VendedorStep key="step-1" form={form} />,
    <CompradorStep key="step-2" form={form} />,
    <ImovelStep key="step-3" form={form} />,
    <StatusDebitosStep key="step-4" form={form} />,
    <PagamentoStep key="step-5" form={form} />,
    <ComissaoConfigStep
      key="step-6"
      form={form}
      token={token}
      viewerIsMember={viewerIsMember}
    />,
  ];

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Banner de travamento — form congelado pelo corretor (somente-leitura) */}
      {readOnly && (
        <div className="mb-6 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/60">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            🔒 Formulário travado
          </p>
          <p className="mt-0.5 text-xs text-slate-700 dark:text-slate-300">
            Este formulário foi travado pelo corretor e não aceita mais
            alterações. Você pode consultar os dados, mas não editá-los.
          </p>
        </div>
      )}

      {/* Banner "dados extraídos da proposta" — só com ?prefilled=1 */}
      {prefilled && !readOnly && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                Dados extraídos da proposta
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                Revise cada etapa antes de finalizar. A extração pode ter
                interpretado campos errado — é seguro corrigir.
              </p>
            </div>
            {proposalAttachmentUrl && (
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <a
                  href={proposalAttachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ver original
                </a>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Dados do Contrato
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Etapa {currentStep + 1} de {TOTAL_STEPS} &mdash;{" "}
              {STEP_LABELS[currentTrueIndex]}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* "Pedir para esta pessoa preencher" — só no token principal,
                nos steps de parte (1 vendedor / 2 comprador). */}
            {finalizeMode === "main" && currentTrueIndex === 1 && (
              <SharePartyLinkButton formToken={token} role="vendedor" />
            )}
            {finalizeMode === "main" && currentTrueIndex === 2 && (
              <SharePartyLinkButton formToken={token} role="comprador" />
            )}
            <SaveStatusBadge status={saveStatus} />
          </div>
        </div>

        <StepIndicator
          currentStep={currentStep}
          totalSteps={TOTAL_STEPS}
          stepLabels={visibleStepIndexes.map((i) => STEP_LABELS[i])}
          visitedSteps={visitedSteps}
          proactive={Boolean(prefilled)}
          stepHasPending={stepHasPending}
          onStepClick={(target) => {
            void validateAndNavigate(target);
          }}
        />

        <Separator />

        {/* Links por parte visíveis de dentro do próprio form (token
            principal): o painel nasce colapsado em 1 linha + botão "Gerar
            links por parte" — os SharePartyLinkButton por step continuam
            como atalho contextual. Subtoken não mostra (finalizeMode
            "participant" não gera links). */}
        {finalizeMode === "main" && !readOnly && (
          <PartyLinksPanel formToken={token} roles={["vendedor", "comprador"]} />
        )}
      </div>

      {/* Sticky bolha de pendências — value-driven (some conforme preenche).
          Proativa em forms ?prefilled=1; senão só após um "Próximo" com falha. */}
      <RequiredFieldMarker
        missing={currentMissingCount}
        total={currentEffectiveRequired.length}
        visible={Boolean(prefilled) || failedTriggerCount > 0}
        trigger={failedTriggerCount}
      />

      {/* Recomendação NÃO-bloqueante de campos de certidão (guarda híbrida).
          Não impede finalizar — só avisa que sem eles as certidões do TJSP/
          Receita/Antecedentes podem não ser emitidas. */}
      {certRecoByParty.size > 0 && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-800 dark:bg-sky-950/40">
          <p className="text-sm font-medium text-sky-900 dark:text-sky-200">
            Recomendado para as certidões
          </p>
          <p className="mt-0.5 text-xs text-sky-800/80 dark:text-sky-300/80">
            Não é obrigatório para gerar o contrato, mas sem estes dados algumas
            certidões (TJSP, Receita Federal, Antecedentes) não podem ser
            emitidas:
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-sky-900 dark:text-sky-200">
            {Array.from(certRecoByParty.entries()).map(([idx, fields]) => (
              <li key={idx}>
                {certRecoMultiple ? (
                  <span className="font-medium">
                    {certRecoPartyLabel} {idx + 1}:{" "}
                  </span>
                ) : null}
                {fields.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recomendação NÃO-bloqueante de e-mail das sub-partes. Elas assinam o
          contrato junto com o titular; sem e-mail não recebem o link da
          ClickSign e o envio fica travado até alguém completar o dado. */}
      {sigRecoByParty.size > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Recomendado para a assinatura
          </p>
          <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
            Não é obrigatório para gerar o contrato, mas quem assina precisa de
            e-mail: sem ele, estas pessoas não recebem o link da ClickSign e
            terão que ser completadas manualmente antes do envio. Falta o e-mail
            de:
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-amber-900 dark:text-amber-200">
            {Array.from(sigRecoByParty.entries()).map(([idx, subs]) => (
              <li key={idx}>
                {certRecoMultiple ? (
                  <span className="font-medium">
                    {certRecoPartyLabel} {idx + 1}:{" "}
                  </span>
                ) : null}
                {subs.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Voice input — só nos steps que têm schema mapeado em voice-extract.ts */}
      {STEPS_WITH_VOICE.has(currentTrueIndex) && !readOnly && (
        <div className="mb-3 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Prefere falar?
          </span>
          <VoiceInputButton
            form={form as never}
            stepIndex={currentTrueIndex}
            endpoint={`${autoSaveEndpoint}/voice-extract`}
            pathScope={pathScope}
          />
        </div>
      )}

      {/* Step Content — resolve trueIndex pra mapear no array de 8 components.
          fieldset[disabled] desabilita todos os inputs nativos descendentes
          quando o form está travado; a navegação (fora do fieldset) continua. */}
      <fieldset disabled={readOnly} className="m-0 border-0 p-0 min-w-0 disabled:opacity-70">
        {stepComponents[currentTrueIndex]}
      </fieldset>

      {/* LGPD consent — exibido só na última etapa (não em somente-leitura) */}
      {isLastStep && !readOnly && (
        <div className="mt-6">
          <PrivacyConsent
            checked={privacyAccepted}
            onChange={setPrivacyAccepted}
            context="Para finalizar este formulário,"
          />
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8">
        <Separator className="mb-4" />
        <div className="flex items-center justify-between gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={goToPrev}
            disabled={currentStep === 0}
          >
            Anterior
          </Button>

          {/* Progress dots — passam por validateAndNavigate igual ao stepper top */}
          <div className="hidden sm:flex items-center gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  void validateAndNavigate(i);
                }}
                className={`h-2 rounded-full transition-all ${
                  i === currentStep
                    ? "w-5 bg-primary"
                    : (visitedSteps.has(i) || prefilled) && stepHasPending(i)
                      ? "w-2 bg-amber-400"
                      : i < currentStep
                        ? "w-2 bg-primary/50"
                        : "w-2 bg-border"
                }`}
                aria-label={`Ir para etapa ${i + 1}: ${STEP_LABELS[visibleStepIndexes[i] ?? i]}`}
              />
            ))}
          </div>

          {isLastStep ? (
            readOnly ? (
              <span className="min-w-[120px]" aria-hidden />
            ) : (
              <Button
                type="button"
                onClick={handleFinalize}
                disabled={isSubmitting || !privacyAccepted}
                className="min-w-[120px]"
                title={
                  !privacyAccepted
                    ? "Aceite a Política de Privacidade abaixo para finalizar"
                    : undefined
                }
              >
                {isSubmitting ? "Finalizando..." : "Finalizar"}
              </Button>
            )
          ) : (
            <Button
              type="button"
              onClick={goToNext}
              className="min-w-[100px]"
            >
              Próximo
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
