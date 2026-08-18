"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Check,
  CheckCircle2,
  Info,
  ArrowRight,
  RefreshCw,
  Loader2,
} from "lucide-react";
import type { OnboardingStatus } from "@/lib/onboarding/status";
import {
  STEP_ORDER,
  STEP_META,
  stepUrl,
  type OnboardingStepKey,
} from "@/lib/onboarding/steps";
import { GoogleDriveCard } from "@/components/settings/GoogleDriveCard";
import { ClickSignConnectCard } from "@/components/settings/ClickSignConnectCard";
import { AgencyProfileForm, type AgencyProfile } from "./AgencyProfileForm";

interface GoogleDriveState {
  connected: boolean;
  status: string;
  email: string | null;
  lastErrorMessage: string | null;
}

// Info-banner por passo (o "porquê" que reforça a ação).
const STEP_NOTE: Partial<Record<OnboardingStepKey, string>> = {
  templates: "Precisa do Google conectado — os modelos ficam no Drive da imobiliária.",
  clicksign:
    "Opcional para concluir, mas sem conectar você não consegue enviar contratos para assinatura.",
  deal: "É o seu primeiro contrato saindo. Tudo que você configurou converge aqui.",
};

// Passo a passo do que vai acontecer depois do CTA. Só onde o fluxo não é
// óbvio pelo nome do botão — hoje, o envio dos modelos.
const STEP_BULLETS: Partial<Record<OnboardingStepKey, Array<{ t: string; d: string }>>> = {
  templates: [
    {
      t: "Você envia",
      d: "Todos os seus DOCX timbrados de uma vez — contratos, propostas e cláusulas.",
    },
    {
      t: "Nós organizamos",
      d: "Dizemos o que é cada arquivo, agrupamos os parecidos e separamos o que é cláusula.",
    },
    {
      t: "Você confirma",
      d: "Confere a sugestão e pronto: a biblioteca da sua imobiliária fica montada.",
    },
  ],
};

function ProgressRing({ pct, done, total }: { pct: number; done: number; total: number }) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - pct / 100);
  return (
    <div className="relative h-24 w-24 flex-none">
      <svg width="96" height="96" className="-rotate-90">
        <circle cx="48" cy="48" r={R} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle
          cx="48"
          cy="48"
          r={R}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          className="stroke-primary transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="font-display text-2xl font-semibold tabular-nums leading-none">{pct}%</span>
        <span className="mt-0.5 text-[10.5px] text-muted-foreground">
          {done} de {total}
        </span>
      </div>
    </div>
  );
}

export function OnboardingWizard({
  initialStatus,
  google,
  profile,
  locacaoOnly,
  landingHref,
}: {
  initialStatus: OnboardingStatus;
  google: GoogleDriveState;
  profile: AgencyProfile;
  locacaoOnly: boolean;
  landingHref: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [refreshing, setRefreshing] = useState(false);

  const firstPending = useMemo(
    () => status.steps.find((s) => !s.done)?.key ?? STEP_ORDER[0],
    [status]
  );
  const [active, setActive] = useState<OnboardingStepKey>(firstPending);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/onboarding/complete");
      if (res.ok) setStatus(await res.json());
      // Revalida o RSC: as props vindas do servidor (profile, google) são um
      // snapshot do load da página e ficariam velhas depois de um save.
      router.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  // Re-busca o status ao voltar pra aba (ex.: conectou o Google noutra aba,
  // salvou algo e voltou) — o painel reflete sem reload manual.
  useEffect(() => {
    const onFocus = () => {
      fetch("/api/onboarding/complete")
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s && setStatus(s))
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // "Continuar depois" NÃO conclui — o guia fica ativo (checklist na sidebar) até
  // 100%. Só navega pro app; o flag só é setado quando os 6 passos terminam.
  function continueLater() {
    router.push(landingHref);
  }

  const pct = Math.round((status.requiredDone / Math.max(1, status.requiredTotal)) * 100);

  // --- Conclusão ---
  if (status.complete) {
    return (
      <Card className="mx-auto max-w-xl overflow-hidden border-border text-center">
        <CardContent className="flex flex-col items-center px-8 py-10">
          <span className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-success text-white animate-in zoom-in-50 duration-500">
            <Check className="h-8 w-8" strokeWidth={2.5} />
          </span>
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Sua imobiliária está pronta
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Tudo configurado. Agora é criar negócios e deixar a esteira trabalhar por você.
          </p>
          <ul className="my-6 flex w-full max-w-xs flex-col gap-2 text-left">
            {STEP_ORDER.map((k) => (
              <li key={k} className="flex items-center gap-2.5 text-sm">
                <CheckCircle2 className="h-4 w-4 flex-none text-success" />
                {STEP_META[k].title}
              </li>
            ))}
          </ul>
          <Button asChild>
            <Link href={landingHref}>
              <ArrowRight className="mr-1.5 h-4 w-4" />
              Ir para o pipeline
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const meta = STEP_META[active];
  const activeIdx = STEP_ORDER.indexOf(active);
  const activeStep = status.steps.find((s) => s.key === active);
  const ActiveIcon = meta.icon;
  const note = STEP_NOTE[active];
  const bullets = STEP_BULLETS[active];

  return (
    <div>
      {/* Hero */}
      <div className="mb-6 flex flex-col-reverse items-start gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.14em] text-brand-accent">
            Configuração inicial
          </p>
          <h1 className="max-w-[16ch] text-balance font-display text-3xl font-semibold leading-[1.1] tracking-tight">
            Configure sua imobiliária
          </h1>
          <p className="mt-2 max-w-[46ch] text-sm text-muted-foreground">
            {status.requiredTotal} passos essenciais até o seu primeiro negócio, mais a
            conexão da ClickSign para enviar assinaturas. O guia acompanha na barra lateral.
          </p>
        </div>
        <ProgressRing pct={pct} done={status.requiredDone} total={status.requiredTotal} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* Checklist */}
        <div className="flex flex-col">
          {status.steps.map((step, i) => {
            const m = STEP_META[step.key];
            const Icon = m.icon;
            const isActive = step.key === active;
            const isNext = step.key === firstPending;
            const isLast = i === status.steps.length - 1;
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => setActive(step.key)}
                className={cn(
                  "relative grid grid-cols-[26px_1fr] gap-3 rounded-xl border border-transparent p-3 text-left transition-colors",
                  isActive ? "border-border bg-card shadow-xs" : "hover:bg-card"
                )}
              >
                <span className="relative">
                  <span
                    className={cn(
                      "flex h-[26px] w-[26px] items-center justify-center rounded-full border transition-colors",
                      step.done
                        ? "border-success bg-success text-white"
                        : isNext
                          ? "border-brand-accent text-brand-accent"
                          : "border-border bg-card text-muted-foreground"
                    )}
                  >
                    {step.done ? (
                      <Check className="h-3.5 w-3.5 animate-in zoom-in-50 duration-300" strokeWidth={3} />
                    ) : (
                      <Icon className="h-3.5 w-3.5" />
                    )}
                  </span>
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute left-1/2 top-full h-[calc(100%-4px)] min-h-3.5 w-0.5 -translate-x-1/2",
                        step.done ? "bg-success" : "bg-border"
                      )}
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-sm font-semibold", step.done && "text-muted-foreground")}>
                      {m.title}
                    </span>
                    {step.done ? (
                      <Badge className="border-transparent bg-success/15 text-[10.5px] font-bold uppercase tracking-wide text-success">
                        Concluído
                      </Badge>
                    ) : isNext ? (
                      <Badge className="border-transparent bg-brand-accent/10 text-[10.5px] font-bold uppercase tracking-wide text-brand-accent">
                        Próximo passo
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        Pendente
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{m.desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Painel do passo ativo */}
        <Card className="min-h-[340px] animate-in fade-in duration-300">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-primary text-primary-foreground">
                <ActiveIcon className="h-4 w-4" />
              </span>
              {/* `status.steps.length`, e NÃO `STEP_ORDER.length`: nem todo passo
                  é exibido para toda org (o do Max só aparece quando o canal
                  está disponível). Contar pelo catálogo faria a org sem o canal
                  ler "de 8" com sete passos na tela. */}
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Passo {activeIdx + 1} de {status.steps.length} · {meta.eyebrow}
              </span>
            </div>
            <h2 className="mt-3.5 font-display text-[22px] font-semibold tracking-tight text-balance">
              {meta.title}
            </h2>
            <p className="mt-1.5 max-w-[52ch] text-sm text-muted-foreground">{meta.blurb}</p>

            {/* O `detail` diz por que o passo AINDA não fechou — "ninguém com
                telefone cadastrado ainda", "necessário para enviar
                assinaturas". Ele era calculado em `getOnboardingStatus` e não
                era lido por superfície nenhuma: o dado existia e o usuário
                nunca via. Some quando o passo fecha, porque aí não há o que
                explicar. */}
            {!activeStep?.done && activeStep?.detail && (
              <p className="mt-2 max-w-[52ch] text-sm font-medium text-amber-700">
                {activeStep.detail}
              </p>
            )}

            <div className="mt-5">
              {active === "google" && <GoogleDriveCard initial={google} />}

              {/* Sempre montado (só escondido): desmontar o form ao trocar de
                  passo descartava o que estava digitado e ainda não tinha caído
                  no autosave. */}
              <div className={active === "profile" ? undefined : "hidden"}>
                <AgencyProfileForm initial={profile} onSaved={refresh} />
              </div>

              {active === "clicksign" && (
                <div className="space-y-4">
                  {note && (
                    <div className="flex gap-2.5 rounded-xl border border-info/30 bg-info/10 p-3.5 text-sm">
                      <Info className="mt-0.5 h-4 w-4 flex-none text-info" />
                      <span>{note}</span>
                    </div>
                  )}
                  <ClickSignConnectCard />
                  <Button variant="outline" onClick={refresh} disabled={refreshing}>
                    <RefreshCw className={cn("mr-1.5 h-4 w-4", refreshing && "animate-spin")} />
                    Atualizar
                  </Button>
                </div>
              )}

              {active !== "google" &&
                active !== "profile" &&
                active !== "clicksign" && (
                <div className="space-y-4">
                  {bullets && (
                    <ol className="grid gap-2.5 rounded-xl border border-border bg-muted/40 p-3.5">
                      {bullets.map((b, i) => (
                        <li key={b.t} className="flex items-start gap-2.5">
                          <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-brand-accent/10 text-[11px] font-bold tabular-nums text-brand-accent">
                            {i + 1}
                          </span>
                          <span className="text-sm leading-snug">
                            <strong className="font-semibold">{b.t}</strong>
                            <span className="text-muted-foreground"> — {b.d}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {note && (
                    <div className="flex gap-2.5 rounded-xl border border-info/30 bg-info/10 p-3.5 text-sm">
                      <Info className="mt-0.5 h-4 w-4 flex-none text-info" />
                      <span>{note}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Button asChild>
                      <Link href={stepUrl(active, { locacaoOnly })}>
                        <ArrowRight className="mr-1.5 h-4 w-4" />
                        {meta.cta}
                      </Link>
                    </Button>
                    {!activeStep?.done && (
                      <Button variant="outline" onClick={refresh} disabled={refreshing}>
                        <RefreshCw className={cn("mr-1.5 h-4 w-4", refreshing && "animate-spin")} />
                        Já fiz — atualizar
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rodapé: seguir usando o app — o guia continua na sidebar até 100% */}
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" size="sm" onClick={continueLater}>
          Continuar depois
        </Button>
      </div>
    </div>
  );
}
