"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  dadosContratoSchema,
  DadosContratoForm,
  STEP_LABELS,
  STEP_REQUIRED_FIELDS,
} from "@/lib/forms/validation";
import { toast } from "sonner";
import { useAutoSave } from "@/hooks/use-auto-save";
import { VendedorStep } from "@/components/forms/steps/VendedorStep";
import { CompradorStep } from "@/components/forms/steps/CompradorStep";
import { ImovelStep } from "@/components/forms/steps/ImovelStep";
import { StatusDebitosStep } from "@/components/forms/steps/StatusDebitosStep";
import { PagamentoStep } from "@/components/forms/steps/PagamentoStep";
import { PosseTituloStep } from "@/components/forms/steps/PosseTituloStep";
import { ComissaoConfigStep } from "@/components/forms/steps/ComissaoConfigStep";

interface SalesFormWizardProps {
  token: string;
  initialData: Record<string, unknown>;
}

const TOTAL_STEPS = STEP_LABELS.length;

function SaveStatusBadge({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  if (status === "idle") return null;

  const config = {
    saving: {
      label: "Salvando...",
      className:
        "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
      dotClass: "bg-yellow-500 animate-pulse",
    },
    saved: {
      label: "Salvo",
      className:
        "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
      dotClass: "bg-green-500",
    },
    error: {
      label: "Erro ao salvar",
      className:
        "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
      dotClass: "bg-red-500",
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

function StepIndicator({
  currentStep,
  totalSteps,
}: {
  currentStep: number;
  totalSteps: number;
}) {
  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="flex items-start min-w-max">
        {STEP_LABELS.map((label, index) => {
          const stepNumber = index + 1;
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <div key={index} className="flex items-start">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`
                    flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold border-2 transition-all
                    ${
                      isCompleted
                        ? "bg-primary border-primary text-primary-foreground"
                        : isCurrent
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-background border-border text-muted-foreground"
                    }
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
                  ) : (
                    stepNumber
                  )}
                </div>
                <span
                  className={`text-xs whitespace-nowrap max-w-[80px] text-center leading-tight ${
                    isCurrent
                      ? "text-primary font-medium"
                      : isCompleted
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
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
      estado_civil: "Solteiro(a)",
      profissao: "",
      rg: "",
      cpf: "",
      email: "",
      endereco: "",
      numero: "",
      complemento: "",
      cidade: "",
      uf: "",
      cep: "",
      tem_procurador: false,
    },
  ],
  compradores: [
    {
      tipo_pessoa: "fisica",
      nome: "",
      nacionalidade: "Brasileiro(a)",
      estado_civil: "Solteiro(a)",
      profissao: "",
      rg: "",
      cpf: "",
      email: "",
      endereco: "",
      numero: "",
      complemento: "",
      cidade: "",
      uf: "",
      cep: "",
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
      descricao: "",
    },
  ],
  status_propriedade: "quitado-registrado",
  saldo_devedor: 0,
  tem_debitos: false,
  pagamento: {
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
    momento_texto: "assinatura do contrato",
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
    imobiliaria_nome: "",
    imobiliaria_cnpj: "",
    creci: "",
  },
  desistencia: {
    permite: false,
    prazo_dias: 7,
  },
  foro: "arbitragem",
  assinatura: {
    cidade: "",
    uf: "",
    data: "",
  },
  testemunhas: [
    { nome: "", cpf: "" },
    { nome: "", cpf: "" },
  ],
  config: {
    multa_penal_moratoria: 2,
    base_calculo_multa: "valor da parcela",
    juros_mensais_atraso: 1,
    atualizacao_monetaria: "IPCA",
    prazo_atraso_rescisao: 10,
    multa_cominatoria_diaria: 150,
    multa_penal_compensatoria: 10,
    prazo_multa_rescisoria: 7,
  },
};

export function SalesFormWizard({ token, initialData }: SalesFormWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [generatedContractId, setGeneratedContractId] = useState<string | null>(null);

  const form = useForm<DadosContratoForm>({
    defaultValues: {
      ...defaultFormValues,
      ...(initialData as Partial<DadosContratoForm>),
    },
    mode: "onChange",
  });

  const watchedData = useWatch({ control: form.control }) as Record<string, unknown>;
  const { status: saveStatus } = useAutoSave(token, watchedData);

  const isLastStep = currentStep === TOTAL_STEPS - 1;

  const goToNext = async () => {
    // Validate required fields for current step before advancing
    const fieldsToValidate = STEP_REQUIRED_FIELDS[currentStep];
    if (fieldsToValidate.length > 0) {
      const isValid = await form.trigger(fieldsToValidate as any);
      if (!isValid) {
        toast.error("Preencha os campos obrigatórios antes de avançar.");
        return;
      }
    }
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((prev) => prev + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const goToPrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleFinalize = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/forms/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataJson: form.getValues(),
          status: "completo",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.contractId) setGeneratedContractId(data.contractId);
        setIsComplete(true);
      } else {
        console.error("Erro ao finalizar formulario");
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
        <h2 className="text-2xl font-semibold text-foreground mb-2">
          Formulário Concluído!
        </h2>
        <p className="text-muted-foreground max-w-md mb-6">
          Todas as informações foram salvas com sucesso.{" "}
          {generatedContractId
            ? "O contrato foi gerado automaticamente e está pronto para edição."
            : "O contrato será gerado automaticamente."}
        </p>
        <div className="flex gap-3 flex-wrap justify-center">
          {generatedContractId && (
            <Button asChild>
              <a href={`/contracts/${generatedContractId}`}>Abrir Contrato</a>
            </Button>
          )}
          <Button variant="outline" asChild>
            <a href="/pipeline">Ver Pipeline</a>
          </Button>
        </div>
      </div>
    );
  }

  const stepComponents = [
    <VendedorStep key="step-1" form={form} />,
    <CompradorStep key="step-2" form={form} />,
    <ImovelStep key="step-3" form={form} />,
    <StatusDebitosStep key="step-4" form={form} />,
    <PagamentoStep key="step-5" form={form} />,
    <PosseTituloStep key="step-6" form={form} />,
    <ComissaoConfigStep key="step-7" form={form} />,
  ];

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Dados do Contrato
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Etapa {currentStep + 1} de {TOTAL_STEPS} &mdash;{" "}
              {STEP_LABELS[currentStep]}
            </p>
          </div>
          <SaveStatusBadge status={saveStatus} />
        </div>

        <StepIndicator currentStep={currentStep} totalSteps={TOTAL_STEPS} />

        <Separator />
      </div>

      {/* Step Content */}
      <div>{stepComponents[currentStep]}</div>

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

          {/* Progress dots */}
          <div className="hidden sm:flex items-center gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentStep(i)}
                className={`h-2 rounded-full transition-all ${
                  i === currentStep
                    ? "w-5 bg-primary"
                    : i < currentStep
                    ? "w-2 bg-primary/50"
                    : "w-2 bg-border"
                }`}
                aria-label={`Ir para etapa ${i + 1}: ${STEP_LABELS[i]}`}
              />
            ))}
          </div>

          {isLastStep ? (
            <Button
              type="button"
              onClick={handleFinalize}
              disabled={isSubmitting}
              className="min-w-[120px]"
            >
              {isSubmitting ? "Finalizando..." : "Finalizar"}
            </Button>
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
