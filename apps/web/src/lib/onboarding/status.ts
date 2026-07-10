import { prisma } from "@/lib/db/prisma";
import { getOrgModules } from "@/lib/modules/read";
import type { ModuleKey } from "@/lib/modules/catalog";
import { STEP_ORDER, type OnboardingStepKey } from "./steps";

/**
 * Progresso do onboarding — **derivado dos dados**, não de uma tabela de estado.
 * Cada passo é um fato consultável (conta Google conectada, org.creci, template
 * ativo, formulário configurado, convite enviado, negócio criado), então o
 * status nunca "mente". `Organization.onboardingCompletedAt` só marca "onboarding
 * concluído/encerrado" (setado ao chegar em 100%) — a partir daí o checklist some
 * e o layout para de computar o status.
 *
 * Os 6 passos são todos obrigatórios: o guia fica ativo até 100%.
 */
export type { OnboardingStepKey };

export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
  required: boolean;
  detail?: string;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  requiredDone: number;
  requiredTotal: number;
  complete: boolean;
  dismissedAt: Date | null;
}

// Famílias de modalidade por módulo — pra achar um template ativo que o dono
// consiga de fato gerar. Administração é instrumento acessório, não conta como
// o template que destrava o passo.
const MODALIDADES_BY_MODULE: Record<ModuleKey, string[]> = {
  vendas: ["a_vista", "financiamento"],
  locacao: ["locacao", "locacao_comercial"],
};

export async function getOnboardingStatus(orgId: string): Promise<OnboardingStatus> {
  const [org, googleAccount, modules] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { creci: true, legalName: true, onboardingCompletedAt: true },
    }),
    prisma.orgGoogleAccount.findUnique({
      where: { orgId },
      select: { status: true },
    }),
    getOrgModules(orgId),
  ]);

  const enabledModules = (Object.keys(modules.enabled) as ModuleKey[]).filter(
    (m) => modules.enabled[m]
  );
  const modalidadesNeeded = enabledModules.flatMap((m) => MODALIDADES_BY_MODULE[m]);

  const [activeTemplates, formConfigured, invites, deals] = await Promise.all([
    prisma.contractTemplate.count({
      where: { orgId, status: "active", modalidade: { in: modalidadesNeeded } },
    }),
    // A row de OrgFormSettings nasce no preset "legado" por default → só conta
    // como "configurado" quando o dono escolhe um preset real.
    prisma.orgFormSettings.count({
      where: { orgId, preset: { not: "legado" } },
    }),
    prisma.orgInvitation.count({
      where: { orgId, status: { in: ["pending", "approved"] } },
    }),
    // Deal não tem orgId direto — escopo via pipeline.
    prisma.deal.count({ where: { pipeline: { orgId } } }),
  ]);

  // --- google ---
  const googleDone = googleAccount?.status === "connected";

  // --- profile (creci liga a cláusula da administradora) ---
  const creci = org?.creci?.trim();
  const legalName = org?.legalName?.trim();
  const profileDone = Boolean(creci && legalName);
  const missingProfile = [
    !legalName ? "razão social" : null,
    !creci ? "CRECI" : null,
  ].filter(Boolean);
  const profileDetail = missingProfile.length
    ? `${missingProfile.join(" + ")} em falta`
    : undefined;

  // --- templates ---
  const templatesDone = activeTemplates > 0;

  const doneByKey: Record<OnboardingStepKey, boolean> = {
    google: googleDone,
    profile: profileDone,
    templates: templatesDone,
    form: formConfigured > 0,
    invite: invites > 0,
    deal: deals > 0,
  };
  const detailByKey: Partial<Record<OnboardingStepKey, string>> = {
    profile: profileDetail,
    templates: !templatesDone ? "nenhum modelo ativo ainda" : undefined,
  };

  const steps: OnboardingStep[] = STEP_ORDER.map((key) => ({
    key,
    done: doneByKey[key],
    required: true,
    detail: detailByKey[key],
  }));

  const requiredDone = steps.filter((s) => s.done).length;

  return {
    steps,
    requiredDone,
    requiredTotal: steps.length,
    complete: requiredDone === steps.length,
    dismissedAt: org?.onboardingCompletedAt ?? null,
  };
}
