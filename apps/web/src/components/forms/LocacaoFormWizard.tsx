"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useAutoSave } from "@/hooks/use-auto-save";
import {
  LOCACAO_COMERCIAL_SCHEMA_TYPE,
  stepLabelsForLocacaoType,
} from "@/lib/forms/validation-locacao";
import { PrivacyConsent } from "@/components/legal/PrivacyConsent";
import { SharePartyLinkButton } from "@/components/forms/PartyLinksPanel";
import type { ParticipantRole } from "@/lib/forms/participant-token";
import { LocacaoParteStep } from "@/components/forms/steps/locacao/_PartyFields";
import { DocumentosStep } from "@/components/forms/steps/DocumentosStep";
import { locacaoDocAdapter } from "@/components/forms/steps/locacao/locacao-doc-adapter";
import { ImovelLocacaoStep } from "@/components/forms/steps/locacao/ImovelLocacaoStep";
import { AluguelStep } from "@/components/forms/steps/locacao/AluguelStep";
import { GarantiaStep } from "@/components/forms/steps/locacao/GarantiaStep";
import { ConfirmacaoStep } from "@/components/forms/steps/locacao/ConfirmacaoStep";

interface LocacaoFormWizardProps {
  token: string;
  initialData: Record<string, unknown>;
  schemaType: string;
  /** Subtoken por parte: subset de índices REAIS dos steps visíveis. */
  stepIndexes?: readonly number[];
  /** Override do endpoint de auto-save (subtoken usa /api/forms/participant/...). */
  endpoint?: string;
  /** Allowlist de chaves top-level (ROLE_PATHS[role]) pro auto-save/finalize. */
  pathScope?: readonly string[];
  /** "participant" marca completedAt do participante; não finaliza o form. */
  finalizeMode?: "main" | "participant";
  /**
   * Somente-leitura: form travado (SalesForm.lockedAt). Desliga auto-save,
   * desabilita campos e esconde o finalizar. Navegação continua ativa.
   */
  readOnly?: boolean;
}

// Steps de partes (locador/locatário) — validados de forma CIENTE de
// `tipo_pessoa`: PJ qualifica por `razao_social` (não tem campo `nome`). Sem
// isso, uma parte Pessoa Jurídica trava o avanço com "campo obrigatório"
// fantasma (não há campo `nome` na tela pra preencher).
// Índices acompanham LOCACAO_STEP_LABELS — etapa 0 é "Documentos" (sem
// validação, igual venda), partes começam em 1.
const PARTY_STEP: Record<number, { list: "locadores" | "locatarios"; label: string }> = {
  1: { list: "locadores", label: "locador" },
  2: { list: "locatarios", label: "locatário" },
};

// Required mínimo dos demais steps (non-empty check manual, já que não usamos
// zodResolver). A validação completa roda no servidor no finalize
// (schemaForLocacaoType) e retorna validationIssues.
const STEP_REQUIRED: Record<number, string[]> = {
  3: ["imovel.descricao"],
  4: ["aluguel.valor"],
};

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
      encargos: 0,
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
  stepIndexes,
  endpoint: endpointProp,
  pathScope,
  finalizeMode = "main",
  readOnly = false,
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
  const [dealId, setDealId] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { ...defaultValues(comercial), ...initialData },
    mode: "onChange",
  });

  const watchedData = useWatch({ control: form.control }) as Record<string, unknown>;
  const endpoint = endpointProp ?? `/api/locacao/forms/${token}`;
  const { status: saveStatus } = useAutoSave(token, watchedData, {
    endpoint,
    pathScope,
    enabled: !readOnly,
  });

  const isLastStep = currentStep === TOTAL - 1;

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

  // `step` aqui é o índice REAL (PARTY_STEP/STEP_REQUIRED são indexados pelo
  // schema completo de 7 etapas).
  const validateStep = (step: number): boolean => {
    // Steps de partes: exige nome (PF) ou razão social (PJ) de CADA parte.
    const partyStep = PARTY_STEP[step];
    if (partyStep) {
      const parties =
        (form.getValues(partyStep.list as never) as unknown as Array<Record<string, unknown>>) ??
        [];
      for (const p of parties) {
        const pj = p?.tipo_pessoa === "juridica";
        const name = pj ? p?.razao_social : p?.nome;
        if (!name || String(name).trim() === "") {
          toast.error(
            `Preencha ${pj ? "a razão social" : "o nome"} do ${partyStep.label} antes de avançar.`,
          );
          return false;
        }
      }
      return true;
    }

    const required = STEP_REQUIRED[step] ?? [];
    for (const path of required) {
      const raw = form.getValues(path as never) as unknown;
      const empty =
        raw === undefined || raw === null || raw === "" || raw === 0 ||
        (Array.isArray(raw) && raw.length === 0);
      if (empty) {
        toast.error(`Preencha os campos obrigatórios da etapa ${step + 1} antes de avançar.`);
        return false;
      }
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
        if (data.dealId) setDealId(data.dealId);
        if (Array.isArray(data.validationIssues) && data.validationIssues.length > 0) {
          toast.warning(
            `Contrato gerado com ${data.validationIssues.length} ponto(s) a revisar no editor.`,
          );
        }
        setIsComplete(true);
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
          {isParticipant ? "Seus dados foram salvos!" : "Formulário concluído!"}
        </h2>
        <p className="text-muted-foreground max-w-md mb-6">
          {isParticipant
            ? "Obrigado! A imobiliária foi avisada e segue com o contrato."
            : "O contrato de locação foi gerado e está pronto para edição."}
        </p>
        {!isParticipant && dealId && (
          <Button asChild>
            <a href={`/locacao/deals/${dealId}`}>Abrir negócio de locação</a>
          </Button>
        )}
      </div>
    );
  }

  const steps = comercial
    ? [
        <DocumentosStep key="s0" form={form} token={token} adapter={locacaoDocAdapter} />,
        <LocacaoParteStep key="s1" form={form} listKey="locadores" singular="Locador" />,
        <LocacaoParteStep key="s2" form={form} listKey="locatarios" singular="Locatário" />,
        <ImovelLocacaoStep key="s3" form={form} comercial />,
        <AluguelStep key="s4" form={form} />,
        <GarantiaStep key="s5" form={form} />,
        <ConfirmacaoStep key="s6" form={form} />,
      ]
    : [
        <DocumentosStep key="s0" form={form} token={token} adapter={locacaoDocAdapter} />,
        <LocacaoParteStep key="s1" form={form} listKey="locadores" singular="Locador" />,
        <LocacaoParteStep key="s2" form={form} listKey="locatarios" singular="Locatário" />,
        <ImovelLocacaoStep key="s3" form={form} />,
        <AluguelStep key="s4" form={form} />,
        <GarantiaStep key="s5" form={form} />,
        <ConfirmacaoStep key="s6" form={form} />,
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
      </div>

      <fieldset disabled={readOnly} className="m-0 border-0 p-0 min-w-0 disabled:opacity-70">
        {steps[visibleStepIndexes[currentStep] ?? currentStep]}
      </fieldset>

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
