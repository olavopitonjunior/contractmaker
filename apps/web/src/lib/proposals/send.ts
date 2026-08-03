import { prisma } from "@/lib/db/prisma";
import { resolveClickSignCreds, getSignatureSettings } from "@/lib/clicksign/account";
import { getMonthlySpendCents } from "@/lib/clicksign/executor";
import { getMonthlyBudgetCents } from "@/lib/clicksign/costs";
import type { ClickSignCreds } from "@/lib/clicksign/account";
import { checkProposalReadiness, type ReadinessIssue } from "./clicksign-readiness";
import { dedupeSigners, SignerCollisionError, type DedupableSigner } from "./signer-dedupe";
import { decideInstrument, type RoutingSigner, type Instrument, type Channel } from "./routing";
import { plannedProposalCostCents, plannedAcceptanceCostCents } from "./cost";
import {
  detectAndCacheCapabilities,
  type CapabilityResult,
} from "@/lib/clicksign/capabilities";

/**
 * `prepareSend` — a DECISÃO de envio de uma proposta. Compõe, em ordem:
 *   preflight (campos ClickSign) → dedupe → roteamento (assinatura vs Aceite,
 *   por capacidade da conta) → budget. Puro o suficiente pra ser testado; a
 *   execução real (criar envelope/Aceite, mandar link) fica no route/executor.
 */

export type PrepareBlock =
  | { blocked: "not_configured" }
  | { blocked: "no_signers" }
  | { blocked: "already_sending" }
  | { blocked: "preflight"; issues: ReadinessIssue[] }
  | { blocked: "collision"; message: string }
  | { blocked: "routing"; message: string }
  | { blocked: "budget"; spentCents: number; budgetCents: number; planCostCents: number };

export interface PrepareOk {
  ok: true;
  instrument: Instrument;
  resolvedChannels: Channel[];
  signers: DedupableSigner[];
  warnings: string[];
  /** Caiu no default de "conta não assina por WhatsApp" sem medição conclusiva. */
  capabilitiesUnverified?: boolean;
  planCostCents: number;
  creds: ClickSignCreds;
}

export type PrepareResult = PrepareOk | PrepareBlock;

export async function prepareSend(
  proposalId: string,
  deps: {
    resolveCreds?: (orgId: string) => Promise<ClickSignCreds | null>;
    getSpent?: (orgId: string) => Promise<number>;
    probeCaps?: (
      orgId: string
    ) => Promise<CapabilityResult | { error: "not_configured" }>;
  } = {}
): Promise<PrepareResult> {
  const resolveCreds = deps.resolveCreds ?? resolveClickSignCreds;
  const getSpent = deps.getSpent ?? getMonthlySpendCents;
  const probeCaps = deps.probeCaps ?? detectAndCacheCapabilities;

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { orgId: true, hiddenPaths: true },
  });
  if (!proposal) return { blocked: "no_signers" };

  const creds = await resolveCreds(proposal.orgId);
  if (!creds) return { blocked: "not_configured" };

  const rows = await prisma.proposalSigner.findMany({
    where: { proposalId, included: true },
    orderBy: { signingGroup: "asc" },
  });
  if (rows.length === 0) return { blocked: "no_signers" };

  // 1. Preflight — nome com 2 palavras, CPF válido, telefone com DDI, etc.
  const issues = checkProposalReadiness(
    rows.map((r) => ({
      name: r.name,
      email: r.email,
      cpf: r.cpf,
      phone: r.phone,
      notifyChannel: r.notifyChannel,
    }))
  );
  if (issues.length > 0) return { blocked: "preflight", issues };

  // 2. Dedupe — "sem duplicidade". Colisão entre grupos → erro duro.
  let deduped;
  try {
    deduped = dedupeSigners(
      rows.map<DedupableSigner>((r) => ({
        role: r.role,
        name: r.name,
        email: r.email,
        cpf: r.cpf,
        phone: r.phone,
        signingGroup: r.signingGroup,
      }))
    );
  } catch (err) {
    if (err instanceof SignerCollisionError) {
      return { blocked: "collision", message: err.message };
    }
    throw err;
  }

  // 3. Roteamento — assinatura (Plus+) vs Aceite, por capacidade da conta.
  let settings = await getSignatureSettings(proposal.orgId);
  const routingSigners: RoutingSigner[] = deduped.signers.map((s) => ({
    channel: rowsChannel(rows, s),
    hasEmail: Boolean(s.email && s.email.includes("@")),
    hasPhone: Boolean(s.phone),
  }));

  // Conta nunca verificada + alguém quer WhatsApp: MEDE antes de decidir, em vez
  // de assumir `false` e rebaixar pra Aceite em silêncio. O probe cria um
  // envelope rascunho, testa um signer WhatsApp e deleta o rascunho — nunca
  // ativa, nunca envia, custo zero. Roda uma vez por org (cacheia em
  // OrgSignatureSettings); as chamadas seguintes leem o cache.
  if (settings.capabilitiesCheckedAt == null && routingSigners.some((s) => s.channel === "whatsapp")) {
    const probed = await probeCaps(proposal.orgId).catch(() => null);
    // Veredito inconclusivo (rede, etc.) NÃO é cacheado como indisponível — o
    // reread devolve `capabilitiesCheckedAt` preenchido mas o flag ainda null,
    // e o roteamento segue no default marcado como não-verificado.
    if (probed && !("error" in probed)) settings = await getSignatureSettings(proposal.orgId);
  }

  const decision = decideInstrument({
    hiddenCommission: proposal.hiddenPaths.length > 0,
    signers: routingSigners,
    caps: {
      whatsappSignatureAvailable: settings.whatsappSignatureAvailable ?? false,
      acceptanceWhatsappAvailable:
        settings.acceptanceWhatsappAvailable ?? settings.acceptanceEnabled,
      capabilitiesVerified: settings.whatsappSignatureAvailable != null,
    },
  });
  if (decision.blocked) return { blocked: "routing", message: decision.blocked };

  // 4. Budget — reserva o custo total ANTES de gastar. Sub-teto de propostas
  //    (proposalBudgetCents) tem precedência sobre o mensal.
  const planCostCents =
    decision.instrument === "aceite"
      ? plannedAcceptanceCostCents(deduped.signers.length)
      : plannedProposalCostCents({
          signerCount: deduped.signers.length,
          costOverrides: settings.costOverridesJson as Record<string, unknown> | null,
        });
  const budgetCents =
    settings.proposalBudgetCents ??
    getMonthlyBudgetCents(settings.monthlyBudgetCents);
  const spentCents = await getSpent(proposal.orgId);
  if (spentCents + planCostCents > budgetCents) {
    return { blocked: "budget", spentCents, budgetCents, planCostCents };
  }

  return {
    ok: true,
    instrument: decision.instrument,
    resolvedChannels: decision.resolvedChannels,
    signers: deduped.signers,
    warnings: decision.warnings,
    ...(decision.capabilitiesUnverified ? { capabilitiesUnverified: true } : {}),
    planCostCents,
    creds,
  };
}

// Canal do signer deduplicado, casando de volta com o row original pelo nome
// (o dedupe funde, mas mantém o primeiro contato).
function rowsChannel(
  rows: Array<{ name: string; notifyChannel: string }>,
  s: { name: string }
): Channel {
  const r = rows.find((x) => x.name === s.name);
  return r?.notifyChannel === "whatsapp" ? "whatsapp" : "email";
}
