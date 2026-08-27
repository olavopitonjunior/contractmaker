"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useAutoSave } from "@/hooks/use-auto-save";
import { useDirtyTopLevelScope } from "@/hooks/use-dirty-scope";
import {
  LOCACAO_COMERCIAL_SCHEMA_TYPE,
  stepLabelsForLocacaoType,
} from "@/lib/forms/validation-locacao";
import { PrivacyConsent } from "@/components/legal/PrivacyConsent";
import { RequiredFieldMarker } from "@/components/forms/RequiredFieldMarker";
import { RequiredFieldsProvider } from "@/components/forms/RequiredFieldsContext";
import { describeMissingPaths } from "@/lib/forms/field-labels";
import {
  PartyLinksPanel,
  SharePartyLinkButton,
} from "@/components/forms/PartyLinksPanel";
import type { ParticipantRole } from "@/lib/forms/participant-token";
import {
  effectiveRequiredPaths,
  findSignatureRecommendations,
  getByPath,
  isValueEmpty,
  PARTY_SUB_LABELS,
} from "@/lib/forms/party-required";
import { LocacaoParteStep } from "@/components/forms/steps/locacao/_PartyFields";
import { DocumentosStep } from "@/components/forms/steps/DocumentosStep";
import type { Assignment } from "@/lib/forms/extracted-to-form";
import { locacaoDocAdapter } from "@/components/forms/steps/locacao/locacao-doc-adapter";
import { ImovelLocacaoStep } from "@/components/forms/steps/locacao/ImovelLocacaoStep";
import { VoiceInputButton } from "@/components/forms/VoiceInputButton";
import { AluguelStep } from "@/components/forms/steps/locacao/AluguelStep";
import { GarantiaStep } from "@/components/forms/steps/locacao/GarantiaStep";
import { ComissaoLocacaoStep } from "@/components/forms/steps/locacao/ComissaoLocacaoStep";
import type { GarantiaOptionLike } from "@/lib/forms/garantia-catalog";

interface LocacaoFormWizardProps {
  token: string;
  initialData: Record<string, unknown>;
  schemaType: string;
  /**
   * Campos obrigatórios por step (índice REAL das 7 etapas), resolvidos no
   * servidor a partir do preset de LOCAÇÃO da org + snapshot do form
   * (lib/forms/required-snapshot.ts). Ausente/vazio = só o piso histórico.
   */
  requiredFieldsByStep?: readonly (readonly string[])[];
  /**
   * Catálogo de garantias da org (tipo × garantidor), resolvido no SERVIDOR
   * pela page do formulário — como o `requiredFieldsByStep`. O form é anônimo,
   * então não há API autenticada pra ele consultar. Ausente = defaults.
   */
  garantiaOptions?: readonly GarantiaOptionLike[];
  /** Subtoken por parte: subset de índices REAIS dos steps visíveis. */
  stepIndexes?: readonly number[];
  /** Override do endpoint de auto-save (subtoken usa /api/forms/participant/...). */
  endpoint?: string;
  /** Allowlist de chaves top-level (ROLE_PATHS[role]) pro auto-save/finalize. */
  pathScope?: readonly string[];
  /**
   * Link individual: slot do próprio participante (role + partyIndex) pro
   * auto-assign/auto-apply de OCR no DocumentosStep (Fix 4).
   */
  selfAssignment?: Assignment;
  /** "participant" marca completedAt do participante; não finaliza o form. */
  finalizeMode?: "main" | "participant";
  /**
   * Somente-leitura: form travado (SalesForm.lockedAt). Desliga auto-save,
   * desabilita campos e esconde o finalizar. Navegação continua ativa.
   */
  readOnly?: boolean;
  /**
   * Visitante é membro da org dona do form (`viewerIsOrgMember`, server-side).
   * Libera remover documento na etapa 0. Default false — o link público está
   * com o cliente. O servidor é o guard autoritativo (403); isto é UX.
   */
  viewerIsMember?: boolean;
}

// Steps de partes (locador/locatário) — validados de forma CIENTE de
// `tipo_pessoa`: PJ qualifica por `razao_social` (não tem campo `nome`). Sem
// isso, uma parte Pessoa Jurídica trava o avanço com "campo obrigatório"
// fantasma (não há campo `nome` na tela pra preencher).
// Índices acompanham LOCACAO_STEP_LABELS — etapa 0 é "Documentos" (sem
// validação, igual venda), partes começam em 1. A etapa final de confirmação
// saiu em 2026-07-30: a Garantia (5) é a última, e o consentimento LGPD
// continua sendo renderizado pelo wizard no `isLastStep`.
const PARTY_STEP: Record<number, { list: "locadores" | "locatarios"; label: string }> = {
  1: { list: "locadores", label: "locador" },
  2: { list: "locatarios", label: "locatário" },
};

// Required mínimo dos demais steps (non-empty check manual, já que não usamos
// zodResolver). A validação completa roda no servidor no finalize
// (schemaForLocacaoType) e retorna validationIssues.
// Steps com ditado por voz — os mesmos que têm schema em voice-extract.ts
// (LOCACAO_STEP_SCHEMA): 1 Locador, 2 Locatário, 3 Imóvel, 4 Aluguel,
// 5 Garantia. Fora: 0 Documentos e 6 Comissão.
const STEPS_WITH_VOICE = new Set([1, 2, 3, 4, 5]);

const STEP_REQUIRED: Record<number, string[]> = {
  // A etapa do imóvel não trava mais na descrição (ver imovelLocacaoSchema): o
  // endereço já identifica o imóvel, e a obrigatoriedade real vem do preset da
  // org quando ela quiser.
  4: ["aluguel.valor"],
};

// Os rótulos de campo (e o `describeLocacaoPath`) mudaram pra
// lib/forms/field-labels.ts: a tela de configuração e o wizard de VENDA
// precisam do mesmo vocabulário, e mantê-lo aqui dentro deixava a venda sem
// nenhum (o toast dela dizia só "etapa 3").

function defaultValues(comercial: boolean): Record<string, unknown> {
  const parte = {
    tipo_pessoa: "fisica",
    nome: "",
    nacionalidade: "Brasileiro(a)",
    estado_civil: "", // vazio => select mostra "Selecione…"; força escolha (outorga)
    incluir_como_signatario: true,
  };
  return {
    locadores: [{ ...parte }],
    locatarios: [{ ...parte }],
    imovel: {
      kind: comercial ? "comercial_sala" : "apartamento",
      rua: "",
      numero: "",
      bairro: "",
      cidade: "",
      uf: "",
      cep: "",
      descricao: "",
      ...(comercial ? { destinacao: "" } : {}),
    },
    aluguel: {
      valor: 0,
      // `encargos` é derivado (condomínio + IPTU + outros) pelo AluguelStep.
      encargos: 0,
      condominio_mensal: 0,
      iptu_mensal: 0,
      outros_encargos: 0,
      dia_vencimento: 10,
      indice_reajuste: "IGPM",
      vigencia_inicio: "",
      vigencia_meses: 30,
      meio_pagamento: "pix",
    },
    garantia: { tipo: "caucao", caucao_meses: 3 },
    assinatura: { cidade: "", uf: "", data: "" },
    foro: "",
  };
}

export function LocacaoFormWizard({
  token,
  initialData,
  schemaType,
  requiredFieldsByStep,
  garantiaOptions,
  stepIndexes,
  endpoint: endpointProp,
  pathScope,
  selfAssignment,
  finalizeMode = "main",
  readOnly = false,
  viewerIsMember = false,
}: LocacaoFormWizardProps) {
  const comercial = schemaType === LOCACAO_COMERCIAL_SCHEMA_TYPE;
  const stepLabels = stepLabelsForLocacaoType(schemaType);
  // Cursor virtual (0..N-1) → índice REAL dos 7 steps. Default = todos;
  // subtoken passa subset (ROLE_STEP_INDEXES) — mesma mecânica do
  // SalesFormWizard.
  const visibleStepIndexes: readonly number[] =
    stepIndexes ?? stepLabels.map((_, i) => i);
  const TOTAL = visibleStepIndexes.length;

  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  // Paridade com a venda: incrementa a cada "Próximo" barrado e dispara o
  // scroll/focus do RequiredFieldMarker até a primeira pendência.
  const [failedTriggerCount, setFailedTriggerCount] = useState(0);

  const form = useForm({
    defaultValues: { ...defaultValues(comercial), ...initialData },
    mode: "onChange",
  });

  const watchedData = useWatch({ control: form.control }) as Record<string, unknown>;
  const endpoint = endpointProp ?? `/api/locacao/forms/${token}`;
  // Escopo por dirty-keys — ver comentário no SalesFormWizard: a aba do token
  // principal não pode ecoar locadores/locatarios template-vazios por cima do
  // que um link individual gravou.
  const autoSaveScope = useDirtyTopLevelScope(form.control, pathScope);
  const { status: saveStatus } = useAutoSave(token, watchedData, {
    endpoint,
    pathScope: autoSaveScope,
    // Ver SalesFormWizard: pós-finalize o PATCH público responde 403, e um
    // auto-save pendente sujaria a tela de sucesso com "erro".
    enabled: !readOnly && !isComplete,
  });

  const isLastStep = currentStep === TOTAL - 1;

  // Obrigatórios da etapa (bolha de pendências) e de todas as etapas (asterisco
  // dos campos). Leitura reativa via `watchedData` — a contagem tem que cair
  // conforme o cliente digita, não só quando ele tenta avançar.
  const currentRequiredRaw =
    requiredFieldsByStep?.[visibleStepIndexes[currentStep] ?? currentStep] ?? [];
  const currentEffectiveRequired = effectiveRequiredPaths(
    currentRequiredRaw,
    (path) => getByPath(watchedData, path),
  );
  const currentMissingCount = currentEffectiveRequired.filter((p) =>
    isValueEmpty(getByPath(watchedData, p)),
  ).length;
  // Remapeado por `tipo_pessoa` ANTES de virar asterisco: o preset declara
  // `locadores.0.cpf`/`.email`, que numa PJ viram `cnpj` e
  // `representante.email`. Sem o remap, o CNPJ ficava sem asterisco enquanto o
  // wizard barrava nele, e campos PF-only (RG, estado civil) apareciam
  // marcados numa ficha de empresa que nem os renderiza.
  const allRequiredPaths = effectiveRequiredPaths(
    (requiredFieldsByStep ?? []).flat(),
    (path) => getByPath(watchedData, path),
  );

  // "Pedir para esta pessoa preencher" — papel da etapa atual (índice REAL).
  // Só na visão do token principal (subtoken já É a visão da parte).
  const currentTrueIdx = visibleStepIndexes[currentStep] ?? currentStep;
  const shareRole: ParticipantRole | null =
    finalizeMode !== "main"
      ? null
      : currentTrueIdx === 1
        ? "locador"
        : currentTrueIdx === 2
          ? "locatario"
          : currentTrueIdx === 5 &&
              (form.getValues("garantia.tipo" as never) as unknown) === "fiador"
            ? "fiador"
            : null;

  // Guarda híbrida: sub-partes preenchidas (cônjuge de PF, representante de PJ)
  // que assinam mas estão sem e-mail. Só aviso — o bloqueio de avanço continua
  // sendo só nome/razão social. Locação não usa o sistema de presets de venda,
  // então o cálculo mora aqui.
  //
  // A etapa de garantia entra junto: o fiador casado é justamente o caso em que
  // a outorga é indispensável (art. 1.647, III CC). Ele não é array, então vira
  // uma lista sintética de 1 elemento com prefixo próprio.
  const isGarantiaStep =
    currentTrueIdx === 5 &&
    (getByPath(watchedData, "garantia.tipo") as unknown) === "fiador";
  const sigRecoList = isGarantiaStep
    ? "garantia"
    : (PARTY_STEP[currentTrueIdx]?.list ?? null);
  const sigRecoPartyLabel = isGarantiaStep
    ? "Fiador"
    : sigRecoList === "locadores"
      ? "Locador"
      : "Locatário";
  const signatureRecommendations = sigRecoList
    ? findSignatureRecommendations(
        // `garantia.fiador` ocupa a posição 0 de uma lista de um só item.
        isGarantiaStep ? "garantia" : sigRecoList,
        isGarantiaStep
          ? 1
          : ((getByPath(watchedData, sigRecoList) as unknown[]) ?? []).length,
        (path) =>
          getByPath(
            watchedData,
            isGarantiaStep ? path.replace(/^garantia\.0\./, "garantia.fiador.") : path,
          ),
      )
    : [];
  const sigRecoByParty = new Map<number, string[]>();
  for (const r of signatureRecommendations) {
    const arr = sigRecoByParty.get(r.idx) ?? [];
    arr.push(PARTY_SUB_LABELS[r.sub]);
    sigRecoByParty.set(r.idx, arr);
  }

  // `step` aqui é o índice REAL (PARTY_STEP/STEP_REQUIRED são indexados pelo
  // schema completo de 7 etapas).
  //
  // Duas camadas, nesta ordem:
  //   1. PISO histórico (PARTY_STEP/STEP_REQUIRED) — vale sempre, mesmo em org
  //      sem preset configurado. É o que locação já exigia antes.
  //   2. Preset da org (`requiredFieldsByStep`) — obrigatoriedade configurável,
  //      remapeada por tipo_pessoa como em venda (PJ não tem CPF/estado civil;
  //      e-mail/celular vão pro representante legal).
  const validateStep = (step: number): boolean => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const readValue = (path: string): unknown => form.getValues(path as any);

    // (1) Piso: steps de partes exigem nome (PF) ou razão social (PJ) de CADA
    // parte.
    const partyStep = PARTY_STEP[step];
    if (partyStep) {
      const parties =
        (form.getValues(partyStep.list as never) as unknown as Array<Record<string, unknown>>) ??
        [];
      // O PISO também marca `setError` e incrementa o trigger: sem isso os
      // campos que ele barra (nome/razão social — e, no ramo abaixo, valor do
      // aluguel e descrição do imóvel) ficavam sem borda vermelha, sem
      // mensagem e sem scroll, porque a bolha procura `[aria-invalid="true"]`.
      // Justo os campos do piso, que a org com preset legado NÃO tem no preset.
      for (const [idx, p] of parties.entries()) {
        const pj = p?.tipo_pessoa === "juridica";
        const field = pj ? "razao_social" : "nome";
        const name = pj ? p?.razao_social : p?.nome;
        if (!name || String(name).trim() === "") {
          const path = `${partyStep.list}.${idx}.${field}`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          form.setError(path as any, { type: "required", message: "Campo obrigatório" });
          setFailedTriggerCount((n) => n + 1);
          toast.error(`Preencha: ${describeMissingPaths([path])}`);
          return false;
        }
      }
    } else {
      const required = STEP_REQUIRED[step] ?? [];
      const missingPiso: string[] = [];
      for (const path of required) {
        const raw = readValue(path);
        // `0` conta como vazio aqui (valor do aluguel nasce 0 no default).
        const empty =
          raw === undefined || raw === null || raw === "" || raw === 0 ||
          (Array.isArray(raw) && raw.length === 0);
        if (empty) {
          missingPiso.push(path);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          form.setError(path as any, { type: "required", message: "Campo obrigatório" });
        }
      }
      if (missingPiso.length > 0) {
        setFailedTriggerCount((n) => n + 1);
        toast.error(`Preencha: ${describeMissingPaths(missingPiso)}`);
        return false;
      }
    }

    // (2) Obrigatoriedade configurada pela imobiliária.
    const configured = requiredFieldsByStep?.[step] ?? [];
    if (configured.length === 0) return true;

    const paths = effectiveRequiredPaths(configured, readValue);
    const missing = paths.filter((p) => isValueEmpty(readValue(p)));
    for (const p of paths) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (missing.includes(p)) form.setError(p as any, { type: "required", message: "Campo obrigatório" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else form.clearErrors(p as any);
    }
    if (missing.length > 0) {
      setFailedTriggerCount((n) => n + 1);
      toast.error(`Preencha: ${describeMissingPaths(missing)}`);
      return false;
    }
    return true;
  };

  const goTo = (target: number) => {
    if (target < 0 || target >= TOTAL) return;
    // Forward: valida steps intermediários (pelo índice REAL). Backward: livre.
    if (target > currentStep) {
      for (let i = currentStep; i < target; i++) {
        if (!validateStep(visibleStepIndexes[i] ?? i)) {
          setCurrentStep(i);
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
      }
    }
    setCurrentStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleFinalize = async () => {
    setIsSubmitting(true);
    try {
      // Subtoken: PATCH no endpoint do participant com markCompleted —
      // marca só o completedAt da parte; o form principal continua aberto.
      const isParticipant = finalizeMode === "participant";
      const values = form.getValues() as Record<string, unknown>;
      const dataJson = pathScope
        ? Object.fromEntries(
            Object.entries(values).filter(([k]) => pathScope.includes(k)),
          )
        : values;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isParticipant
            ? { dataJson, markCompleted: true }
            : { dataJson, status: "completo" },
        ),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data.validationIssues) && data.validationIssues.length > 0) {
          // Quem vê este toast é quem preencheu o link — normalmente o cliente.
          // "Contrato gerado, revisar no editor" era instrução interna vazando
          // pra ele.
          toast.warning(
            `Enviado com ${data.validationIssues.length} ponto(s) incompleto(s) — a imobiliária vai revisar.`,
          );
        }
        setIsComplete(true);
      } else if (res.status === 422) {
        // Obrigatoriedade da imobiliária (mesma regra do wizard, reaplicada no
        // servidor). Diz QUAIS campos faltam e deixa o usuário voltar.
        const data = await res.json().catch(() => ({}));
        const missing: string[] = Array.isArray(data?.missingRequired)
          ? data.missingRequired
          : [];
        toast.error(
          missing.length > 0
            ? `Faltam campos obrigatórios: ${describeMissingPaths(missing)}`
            : "Faltam campos obrigatórios para finalizar.",
        );
      } else {
        toast.error("Erro ao finalizar o formulário.");
      }
    } catch {
      toast.error("Erro ao finalizar o formulário.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isComplete) {
    const isParticipant = finalizeMode === "participant";
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
          <svg className="h-8 w-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="font-display tracking-tight text-2xl font-semibold text-foreground mb-2">
          {isParticipant ? "Seus dados foram salvos!" : "Formulário enviado!"}
        </h2>
        {/*
          Como no form de venda: o link é preenchido pelo cliente, então a tela
          confirma o envio e não promete contrato pronto.
        */}
        <p className="text-muted-foreground max-w-md mb-6">
          {isParticipant
            ? "Obrigado! A imobiliária foi avisada e segue com o contrato."
            : "Recebemos suas informações. A imobiliária responsável foi avisada e seguirá com o seu negócio a partir daqui."}
        </p>
      </div>
    );
  }

  // As rotas `api/forms/[token]/attachments/*` resolvem `SalesForm.token` — o
  // MESMO token do formulário de locação (a rota de commissioners já é reusada
  // assim). Aceitam subtoken via `resolveFormScope`, então a parte que recebe o
  // próprio link também consegue anexar a matrícula na etapa do imóvel.
  const attachmentsEndpoint = `/api/forms/${token}/attachments`;
  // O autoSave de locação aponta pra /api/locacao/forms/<token>, que não tem
  // subrota de voz. A rota de voz é a token-scoped de sempre (ela resolve
  // SalesForm.token e descobre a esteira pelo schemaType). No link por parte, o
  // endpoint do participante já é o certo.
  const voiceEndpoint =
    finalizeMode === "main"
      ? `/api/forms/${token}/voice-extract`
      : `${endpoint}/voice-extract`;

  const steps = comercial
    ? [
        <DocumentosStep key="s0" form={form} token={token} adapter={locacaoDocAdapter} allowedTopKeys={pathScope} selfAssignment={selfAssignment} viewerIsMember={viewerIsMember} />,
        <LocacaoParteStep key="s1" form={form} listKey="locadores" singular="Locador" />,
        <LocacaoParteStep key="s2" form={form} listKey="locatarios" singular="Locatário" />,
        <ImovelLocacaoStep key="s3" form={form} comercial attachmentsEndpoint={attachmentsEndpoint} />,
        <AluguelStep key="s4" form={form} />,
        <GarantiaStep key="s5" form={form} garantiaOptions={garantiaOptions} pathScope={pathScope} />,
        <ComissaoLocacaoStep key="s6" form={form} token={token} viewerIsMember={viewerIsMember} />,
      ]
    : [
        <DocumentosStep key="s0" form={form} token={token} adapter={locacaoDocAdapter} allowedTopKeys={pathScope} selfAssignment={selfAssignment} viewerIsMember={viewerIsMember} />,
        <LocacaoParteStep key="s1" form={form} listKey="locadores" singular="Locador" />,
        <LocacaoParteStep key="s2" form={form} listKey="locatarios" singular="Locatário" />,
        <ImovelLocacaoStep key="s3" form={form} attachmentsEndpoint={attachmentsEndpoint} />,
        <AluguelStep key="s4" form={form} />,
        <GarantiaStep key="s5" form={form} garantiaOptions={garantiaOptions} pathScope={pathScope} />,
        <ComissaoLocacaoStep key="s6" form={form} token={token} viewerIsMember={viewerIsMember} />,
      ];

  return (
    <div className="w-full max-w-4xl mx-auto">
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
      <div className="mb-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Dados da locação</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Etapa {currentStep + 1} de {TOTAL} &mdash;{" "}
              {stepLabels[visibleStepIndexes[currentStep] ?? currentStep]}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {shareRole && <SharePartyLinkButton formToken={token} role={shareRole} />}
            {saveStatus !== "idle" && (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {saveStatus === "saving" ? "Salvando..." : saveStatus === "saved" ? "Salvo" : "Erro ao salvar"}
              </span>
            )}
          </div>
        </div>

        {/* Stepper compacto (índices virtuais — subtoken vê só seus steps) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {visibleStepIndexes.map((trueIdx, i) => (
            <button
              key={trueIdx}
              type="button"
              onClick={() => goTo(i)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                i === currentStep
                  ? "border-primary bg-primary/10 text-primary"
                  : i < currentStep
                    ? "border-primary/40 bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <span>{i + 1}</span>
              <span className="hidden sm:inline">{stepLabels[trueIdx]}</span>
            </button>
          ))}
        </div>
        <Separator />

        {/* Links por parte visíveis de dentro do próprio form (token
            principal). Fiador só entra quando a garantia é fiador — mesma
            regra do LocacaoDadosTab. `watch` (não getValues) pra re-renderizar
            quando a garantia muda durante a sessão; a `key` remonta o painel
            quando o conjunto de roles muda — ele cacheia os links gerados e
            ignoraria o fiador novo (from-main é idempotente, regenerar é
            barato). */}
        {finalizeMode === "main" && !readOnly && (() => {
          const isFiador =
            (form.watch("garantia.tipo" as never) as unknown) === "fiador";
          const roles = [
            "locador" as const,
            "locatario" as const,
            ...(isFiador ? (["fiador"] as const) : []),
          ];
          return (
            <PartyLinksPanel
              key={roles.join(",")}
              formToken={token}
              roles={roles}
            />
          );
        })()}
      </div>

      {/* Recomendação NÃO-bloqueante de e-mail das sub-partes (cônjuge de PF,
          representante legal de PJ). Elas assinam junto com o titular; sem
          e-mail não recebem o link da ClickSign. Mesma guarda híbrida do
          wizard de venda. */}
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
                <span className="font-medium">
                  {isGarantiaStep ? sigRecoPartyLabel : `${sigRecoPartyLabel} ${idx + 1}`}:{" "}
                </span>
                {subs.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bolha de pendências — a locação não tinha (assimetria com a venda):
          value-driven, some sozinha conforme preenche, e é ela que leva o foco
          até a primeira pendência depois de um "Próximo" barrado. */}
      <RequiredFieldMarker
        missing={currentMissingCount}
        total={currentEffectiveRequired.length}
        visible={failedTriggerCount > 0}
        trigger={failedTriggerCount}
      />

      {/* Ditado por voz — existia só em venda desde a v1. Steps 1-5 (Locador,
          Locatário, Imóvel, Aluguel, Garantia) têm schema mapeado em
          voice-extract.ts; Documentos (0) e Comissão (6) ficam de fora pelo
          mesmo motivo da venda: voz não casa com upload nem com cálculo. */}
      {STEPS_WITH_VOICE.has(visibleStepIndexes[currentStep] ?? currentStep) &&
        !readOnly && (
          <div className="mb-3 flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Prefere falar?
            </span>
            <VoiceInputButton
              form={form as never}
              stepIndex={visibleStepIndexes[currentStep] ?? currentStep}
              endpoint={voiceEndpoint}
              pathScope={pathScope}
            />
          </div>
        )}

      <RequiredFieldsProvider paths={allRequiredPaths}>
        <fieldset disabled={readOnly} className="m-0 border-0 p-0 min-w-0 disabled:opacity-70">
          {steps[visibleStepIndexes[currentStep] ?? currentStep]}
        </fieldset>
      </RequiredFieldsProvider>

      {isLastStep && !readOnly && (
        <div className="mt-6">
          <PrivacyConsent
            checked={privacyAccepted}
            onChange={setPrivacyAccepted}
            context="Para finalizar este formulário,"
          />
        </div>
      )}

      <div className="mt-8">
        <Separator className="mb-4" />
        <div className="flex items-center justify-between gap-4">
          <Button type="button" variant="outline" onClick={() => goTo(currentStep - 1)} disabled={currentStep === 0}>
            Anterior
          </Button>
          {isLastStep ? (
            readOnly ? (
              <span className="min-w-[120px]" aria-hidden />
            ) : (
              <Button
                type="button"
                onClick={handleFinalize}
                disabled={isSubmitting || !privacyAccepted}
                className="min-w-[120px]"
                title={!privacyAccepted ? "Aceite a Política de Privacidade abaixo para finalizar" : undefined}
              >
                {isSubmitting ? "Finalizando..." : "Finalizar"}
              </Button>
            )
          ) : (
            <Button type="button" onClick={() => goTo(currentStep + 1)} className="min-w-[100px]">
              Próximo
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
