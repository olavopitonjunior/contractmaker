import { prisma } from "@/lib/db/prisma";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE, type ModuleKey } from "@/lib/modules/catalog";
import { getMaxReach } from "@/lib/max/reach";
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
  const [org, googleAccount, clicksignAccount, branding, modules] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { creci: true, legalName: true, onboardingCompletedAt: true },
    }),
    prisma.orgGoogleAccount.findUnique({
      where: { orgId },
      select: { status: true },
    }),
    prisma.clickSignAccount.findUnique({
      where: { orgId },
      select: { status: true },
    }),
    prisma.brandingSettings.findUnique({
      where: { orgId },
      select: { logoUrl: true },
    }),
    getOrgModules(orgId),
  ]);

  const enabledModules = (Object.keys(modules.enabled) as ModuleKey[]).filter(
    (m) => modules.enabled[m]
  );
  const modalidadesNeeded = enabledModules.flatMap((m) => MODALIDADES_BY_MODULE[m]);

  const [activeTemplates, formSettings, invites, extraMembers, deals] = await Promise.all([
    prisma.contractTemplate.count({
      where: { orgId, status: "active", modalidade: { in: modalidadesNeeded } },
    }),
    // A row de OrgFormSettings nasce no preset "legado" por default (= o rádio
    // pré-selecionado na UI), então "preset != legado" não flipa quando o dono
    // só salva. Sinal correto: houve SAVE real (updatedAt > createdAt) — os
    // únicos writers são o create lazy e o PATCH; ou preset != legado; ou custom.
    prisma.orgFormSettings.findUnique({
      where: { orgId },
      select: { preset: true, customRequiredPaths: true, createdAt: true, updatedAt: true },
    }),
    prisma.orgInvitation.count({
      where: { orgId, status: { in: ["pending", "approved"] } },
    }),
    // Fallback do convite: alguém além do owner já entrou (cobre o direct-add
    // POST /api/org/members, que não cria OrgInvitation).
    prisma.orgMembership.count({ where: { orgId, role: { not: "owner" } } }),
    // Deal não tem orgId direto — escopo via pipeline.
    prisma.deal.count({ where: { pipeline: { orgId } } }),
  ]);

  const formDone =
    !!formSettings &&
    (formSettings.updatedAt.getTime() > formSettings.createdAt.getTime() ||
      formSettings.preset !== "legado" ||
      (Array.isArray(formSettings.customRequiredPaths) &&
        (formSettings.customRequiredPaths as unknown[]).length > 0));
  const inviteDone = invites > 0 || extraMembers > 0;

  // --- google ---
  const googleDone = googleAccount?.status === "connected";

  // --- clicksign (passo OPCIONAL — não bloqueia os 100%) ---
  // Conta própria conectada OU org compartilhada legada (usa a conta global da
  // plataforma). Sem isso, o envio pra assinatura fica bloqueado, mas o
  // onboarding pode ser concluído.
  const clicksignDone =
    clicksignAccount?.status === "connected" ||
    orgId === process.env.SHARED_ORG_ID;

  // --- profile ---
  // Quem liga a cláusula (administradora na locação, intermediadora na venda) é
  // a RAZÃO SOCIAL; o CRECI é impresso junto quando existe. Ainda assim o passo
  // só fecha com os dois: uma imobiliária sem CRECI no contrato é cadastro pela
  // metade — a diferença é que agora isso atrasa o checklist, não o contrato.
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

  // --- branding (passo OPCIONAL — não bloqueia os 100%) ---
  //
  // A linha de BrandingSettings costuma EXISTIR com `logoUrl` vazio (é criada
  // pelo resolver de branding), então "tem linha" não diz nada — o fato é o
  // arquivo. Opcional porque uma imobiliária pode legitimamente não ter logo, e
  // passo obrigatório que trava o onboarding num item estético é pior que a
  // ausência dele. Mas fica VISÍVEL e pendente, que é o ponto: em agosto de
  // 2026, 5 de 5 orgs em produção estavam sem logo — o buraco era ninguém ser
  // levado até a tela, não o cliente ter decidido não ter marca.
  const brandingDone = Boolean(branding?.logoUrl?.trim());

  // --- templates ---
  const templatesDone = activeTemplates > 0;

  // --- max (passo OPCIONAL, e só existe quando a org tem o canal disponível) ---
  //
  // A metade que importa é a SEGUNDA. Provisionar o Max sem ninguém com
  // telefone deixa o tenant com a feature verde e o agente mudo — foi
  // exatamente o estado dos quatro primeiros tenants, onde 1 de 13 pessoas
  // tinha telefone. Por isso o passo só fecha quando alguém de fato pode
  // receber, e o `detail` mostra o placar mesmo quando ainda não fechou.
  //
  // `deliveredAt` não-nulo, e não só `status: "active"`: "ativo sem
  // confirmação" é o estado das orgs provisionadas por script, e afirmar
  // entrega que ninguém observou é o erro que já custou um hotfix.
  const maxAvailable =
    isFeatureEnabled(modules, FEATURE.VENDAS_MAX) ||
    isFeatureEnabled(modules, FEATURE.LOCACAO_MAX);

  // A conta de alcance mora em `lib/max/reach.ts` — é a MESMA do card de
  // `/settings/ai-agents`, e duas cópias dela é o jeito mais rápido de as duas
  // telas discordarem sobre o mesmo fato.
  const [maxProvisioning, alcance] = maxAvailable
    ? await Promise.all([
        prisma.agentProvisioning.findUnique({
          where: { orgId_agentKey: { orgId, agentKey: "max" } },
          select: { status: true, deliveredAt: true },
        }),
        getMaxReach(orgId),
      ])
    : [null, { membersTotal: 0, membersWithPhone: 0, optedIn: 0 }];

  const comTelefone = alcance.membersWithPhone;
  const recebendo = alcance.optedIn;

  const maxProvisionado =
    maxProvisioning?.status === "active" && maxProvisioning.deliveredAt != null;
  const maxDone = maxProvisionado && recebendo > 0;

  const maxDetail = !maxAvailable
    ? undefined
    : !maxProvisionado
      ? "aguardando ativação"
      : recebendo === 0
        ? comTelefone === 0
          ? "ninguém com telefone cadastrado ainda"
          : `${comTelefone} com telefone · ninguém optou por receber`
        : undefined;

  const doneByKey: Record<OnboardingStepKey, boolean> = {
    google: googleDone,
    profile: profileDone,
    branding: brandingDone,
    templates: templatesDone,
    clicksign: clicksignDone,
    form: formDone,
    invite: inviteDone,
    deal: deals > 0,
    max: maxDone,
  };
  const detailByKey: Partial<Record<OnboardingStepKey, string>> = {
    profile: profileDetail,
    branding: !brandingDone ? "documentos saem só com o nome em texto" : undefined,
    templates: !templatesDone ? "nenhum modelo ativo ainda" : undefined,
    clicksign: !clicksignDone
      ? "necessário para enviar assinaturas"
      : undefined,
    max: maxDetail,
  };

  // clicksign e max sao OPCIONAIS (nao bloqueiam os 100%). Os demais sao
  // obrigatorios.
  //
  // O `branding` e opcional porque uma imobiliaria pode legitimamente nao ter
  // logo — mas aparece pendente ate subir, que e o que faltava.
  //
  // O `max` e opcional por dois motivos: o canal e compartilhado e nem toda org
  // o tem disponivel, e metade do passo depende de opt-in PESSOAL de outra
  // pessoa (LGPD — o dono nao liga WhatsApp por ninguem). Passo obrigatorio que
  // o dono nao consegue fechar sozinho e onboarding que nunca termina.
  const OPTIONAL_STEPS: OnboardingStepKey[] = ["clicksign", "branding", "max"];

  // Org sem o canal disponivel nao ve o passo — nao adianta oferecer o que o
  // super_admin ainda nao liberou.
  const visibleSteps = STEP_ORDER.filter((k) => k !== "max" || maxAvailable);

  const steps: OnboardingStep[] = visibleSteps.map((key) => ({
    key,
    done: doneByKey[key],
    required: !OPTIONAL_STEPS.includes(key),
    detail: detailByKey[key],
  }));

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
