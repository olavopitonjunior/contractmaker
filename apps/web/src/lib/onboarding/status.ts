import { prisma } from "@/lib/db/prisma";
import { getOrgModules } from "@/lib/modules/read";
import type { ModuleKey } from "@/lib/modules/catalog";

/**
 * Progresso do onboarding — **derivado dos dados**, não de uma tabela de estado.
 * Cada etapa é um fato consultável (conta Google conectada, org.creci, template
 * ativo, cláusula, estilo default), então o status nunca "mente" (ex.: o dono
 * apaga o único template → templates volta a `false`). A única coisa que os dados
 * não sabem — "o dono concluiu/pulou o tour" — mora em
 * `Organization.onboardingCompletedAt` e só serve pra parar o auto-launch.
 *
 * Alinhado à vitória (gerar o 1º contrato): obrigatórios = google + perfil +
 * templates; cláusulas (KB) e estilo são opcionais/"depois" — não entram na
 * geração de um contrato google_docs.
 */
export type OnboardingStepKey =
  | "google"
  | "profile"
  | "templates"
  | "knowledge"
  | "docstyle";

export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
  required: boolean;
  /** Dica curta do que falta (ex.: "CRECI em falta"). */
  detail?: string;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  requiredDone: number;
  requiredTotal: number;
  /** Todos os passos OBRIGATÓRIOS feitos → habilita "Gerar meu primeiro contrato". */
  complete: boolean;
  dismissedAt: Date | null;
}

// Famílias de modalidade por módulo — usadas pra achar um template ativo que o
// dono consiga de fato gerar. Administração (administracao_locacao) é instrumento
// acessório, não conta como o template de locação que destrava a vitória.
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

  const [activeTemplates, clauseCount, defaultStyle] = await Promise.all([
    prisma.contractTemplate.findMany({
      where: { orgId, status: "active", modalidade: { in: modalidadesNeeded } },
      select: { modalidade: true },
    }),
    prisma.knowledgeItem.count({
      where: { orgId, category: "clause", parentId: null },
    }),
    prisma.documentStyle.findFirst({
      where: { orgId, isDefault: true },
      select: { id: true },
    }),
  ]);

  // --- google (obrigatório: docs nascem na Drive da org, não na global) ---
  const googleDone = googleAccount?.status === "connected";

  // --- profile (obrigatório: creci liga a cláusula da administradora) ---
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

  // --- templates (obrigatório: ≥1 modelo ativo que o dono consiga gerar) ---
  const activeModalidades = new Set(activeTemplates.map((t) => t.modalidade));
  const modulesMissingTemplate = enabledModules.filter(
    (m) => !MODALIDADES_BY_MODULE[m].some((mod) => activeModalidades.has(mod))
  );
  // A vitória precisa de UM contrato gerável — basta ≥1 template ativo em algum
  // módulo habilitado. Módulos sem modelo viram nudge (detail), não bloqueio.
  const templatesDone = activeTemplates.length > 0;
  const templatesDetail = !templatesDone
    ? "nenhum modelo ativo ainda"
    : modulesMissingTemplate.length
      ? `falta modelo de ${modulesMissingTemplate.join(", ")}`
      : undefined;

  // --- knowledge (opcional/"depois": alimenta o agente IA, não a geração) ---
  const knowledgeDone = clauseCount >= 1;

  // --- docstyle (opcional/"depois": google_docs carrega layout próprio) ---
  const docstyleDone = Boolean(defaultStyle);

  const steps: OnboardingStep[] = [
    { key: "google", done: googleDone, required: true },
    { key: "profile", done: profileDone, required: true, detail: profileDetail },
    { key: "templates", done: templatesDone, required: true, detail: templatesDetail },
    { key: "knowledge", done: knowledgeDone, required: false },
    { key: "docstyle", done: docstyleDone, required: false },
  ];

  const requiredSteps = steps.filter((s) => s.required);
  const requiredDone = requiredSteps.filter((s) => s.done).length;

  return {
    steps,
    requiredDone,
    requiredTotal: requiredSteps.length,
    complete: requiredDone === requiredSteps.length,
    dismissedAt: org?.onboardingCompletedAt ?? null,
  };
}
