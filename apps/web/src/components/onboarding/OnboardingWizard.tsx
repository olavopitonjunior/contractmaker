"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Circle,
  CloudUpload,
  Building2,
  FileText,
  BookOpen,
  Palette,
  Sparkles,
  Loader2,
  ExternalLink,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import type { OnboardingStatus, OnboardingStepKey } from "@/lib/onboarding/status";
import { GoogleDriveCard } from "@/components/settings/GoogleDriveCard";
import { AgencyProfileForm, type AgencyProfile } from "./AgencyProfileForm";
import { KnowledgeSeedButton } from "@/components/knowledge/KnowledgeSeedButton";
import { KnowledgeUploadCard } from "@/components/knowledge/KnowledgeUploadCard";

interface GoogleDriveState {
  connected: boolean;
  status: string;
  email: string | null;
  lastErrorMessage: string | null;
}

const STEP_META: Record<
  OnboardingStepKey,
  { title: string; blurb: string; icon: LucideIcon }
> = {
  google: {
    title: "Conectar o Google Drive",
    blurb:
      "É onde seus contratos são criados e guardados — no Drive da imobiliária, com a identidade visual de vocês.",
    icon: CloudUpload,
  },
  profile: {
    title: "Perfil da imobiliária",
    blurb:
      "Razão social, CNPJ, CRECI e endereço. É o que nomeia a administradora nas cláusulas dos contratos de locação.",
    icon: Building2,
  },
  templates: {
    title: "Modelos de contrato",
    blurb:
      "Suba o seu modelo timbrado (.docx). A IA insere as variáveis {{...}} e você revisa antes de ativar.",
    icon: FileText,
  },
  knowledge: {
    title: "Base de conhecimento (opcional)",
    blurb:
      "Cláusulas que a IA usa para revisar e sugerir. Dá pra começar com as cláusulas padrão da Lei 8.245/91 — ou pular e fazer depois.",
    icon: BookOpen,
  },
  docstyle: {
    title: "Estilo do documento (opcional)",
    blurb:
      "Fonte, margens e espaçamento padrão. Opcional para modelos do Google Docs, que já trazem o próprio layout.",
    icon: Palette,
  },
};

const STEP_ORDER: OnboardingStepKey[] = [
  "google",
  "profile",
  "templates",
  "knowledge",
  "docstyle",
];

export function OnboardingWizard({
  initialStatus,
  google,
  profile,
  landingHref,
}: {
  initialStatus: OnboardingStatus;
  google: GoogleDriveState;
  profile: AgencyProfile;
  landingHref: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const doneByKey = useMemo(
    () => Object.fromEntries(status.steps.map((s) => [s.key, s.done])),
    [status]
  );
  const detailByKey = useMemo(
    () => Object.fromEntries(status.steps.map((s) => [s.key, s.detail])),
    [status]
  );
  const requiredByKey = useMemo(
    () => Object.fromEntries(status.steps.map((s) => [s.key, s.required])),
    [status]
  );

  // Passo ativo default: primeiro obrigatório não-feito.
  const firstPending =
    STEP_ORDER.find((k) => requiredByKey[k] && !doneByKey[k]) ?? "google";
  const [active, setActive] = useState<OnboardingStepKey>(firstPending);

  async function refreshStatus() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/onboarding/complete");
      if (res.ok) setStatus(await res.json());
    } finally {
      setRefreshing(false);
    }
  }

  async function applyDefaultStyle() {
    const res = await fetch("/api/document-styles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Padrão", isDefault: true }),
    });
    if (res.ok) {
      toast.success("Estilo padrão aplicado.");
      await refreshStatus();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Falha ao aplicar o estilo.");
    }
  }

  async function markComplete(): Promise<boolean> {
    const res = await fetch("/api/onboarding/complete", { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Falha ao concluir o onboarding.");
      return false;
    }
    return true;
  }

  async function generateFirstContract() {
    setGenerating(true);
    try {
      const res = await fetch("/api/locacao/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finalidade: "residencial",
          title: "Contrato de teste (onboarding)",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.dealId) {
        toast.error(data.error || "Falha ao criar o negócio de teste.");
        return;
      }
      await markComplete();
      router.push(`/locacao/deals/${data.dealId}`);
    } finally {
      setGenerating(false);
    }
  }

  async function finishTour() {
    setFinishing(true);
    try {
      const ok = await markComplete();
      if (ok) router.push(landingHref);
    } finally {
      setFinishing(false);
    }
  }

  const meta = STEP_META[active];
  const ActiveIcon = meta.icon;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Checklist */}
      <div className="space-y-2">
        <div className="mb-3">
          <p className="text-sm font-medium">
            {status.requiredDone}/{status.requiredTotal} passos obrigatórios
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${(status.requiredDone / Math.max(1, status.requiredTotal)) * 100}%`,
              }}
            />
          </div>
        </div>
        {STEP_ORDER.map((key) => {
          const m = STEP_META[key];
          const done = doneByKey[key];
          const isActive = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                isActive ? "border-primary/50 bg-accent" : "hover:bg-muted/50"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  done ? "bg-green-600 text-white" : "border text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : <Circle className="h-2 w-2" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {m.title.replace(" (opcional)", "")}
                  {!requiredByKey[key] && (
                    <Badge variant="secondary" className="text-[10px]">
                      opcional
                    </Badge>
                  )}
                </span>
                {detailByKey[key] && (
                  <span className="text-xs text-amber-600">{detailByKey[key]}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Painel do passo ativo */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ActiveIcon className="h-5 w-5 text-primary" />
              {meta.title}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{meta.blurb}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {active === "google" && <GoogleDriveCard initial={google} />}

            {active === "profile" && (
              <AgencyProfileForm initial={profile} onSaved={refreshStatus} />
            )}

            {active === "templates" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Abra a página de modelos, clique em{" "}
                  <span className="font-medium">
                    “Novo do modelo da imobiliária (DOCX)”
                  </span>
                  , escolha a modalidade e suba o seu contrato. Depois revise as
                  variáveis e clique em <span className="font-medium">Ativar</span>.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild size="sm">
                    <Link href="/templates">
                      <ExternalLink className="mr-1 h-4 w-4" />
                      Abrir modelos
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshStatus}
                    disabled={refreshing}
                  >
                    <RefreshCw
                      className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                    />
                    Já ativei, atualizar
                  </Button>
                </div>
              </div>
            )}

            {active === "knowledge" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <KnowledgeSeedButton onDone={refreshStatus} />
                  <KnowledgeUploadCard onDone={refreshStatus} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Este passo é opcional — você pode gerar o primeiro contrato sem ele.
                </p>
              </div>
            )}

            {active === "docstyle" && (
              <div className="space-y-3">
                <Button variant="outline" size="sm" onClick={applyDefaultStyle}>
                  <Palette className="mr-1 h-4 w-4" />
                  Aplicar estilo padrão
                </Button>
                <p className="text-xs text-muted-foreground">
                  Opcional — modelos do Google Docs já trazem o próprio layout.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vitória: gerar o 1º contrato */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                Gerar meu primeiro contrato
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {status.complete
                  ? "Tudo pronto — criamos um negócio de teste e abrimos o editor."
                  : "Conclua os passos obrigatórios (Google, perfil e modelo) para liberar."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={finishTour}
                disabled={finishing}
              >
                {finishing ? "Concluindo…" : "Pular tour"}
              </Button>
              <Button
                size="sm"
                onClick={generateFirstContract}
                disabled={!status.complete || generating}
              >
                {generating ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-4 w-4" />
                )}
                Gerar contrato
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
