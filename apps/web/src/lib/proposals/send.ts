import { prisma } from "@/lib/db/prisma";
import { resolveClickSignCreds, getSignatureSettings } from "@/lib/clicksign/account";
import type { ClickSignCreds } from "@/lib/clicksign/account";
import {
  checkProposalReadiness,
  checkProposalContent,
  type ReadinessIssue,
} from "./clicksign-readiness";
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

/** Intervalo mínimo entre re-tentativas do probe quando o veredito não conclui. */
const PROBE_RETRY_MS = 6 * 60 * 60 * 1000;

export type PrepareBlock =
  | { blocked: "not_configured" }
  | { blocked: "no_signers" }
  | { blocked: "already_sending" }
  // `signers` acompanha as issues porque `ReadinessIssue` só carrega
  // `signerIndex` — um número. Sem o nome ao lado, quem lê (operador ou agente)
  // atribui a pendência à pessoa errada: em 04/08 o agente leu "Informe o
  // e-mail" de um signatário fantasma e disse ao corretor que faltava o e-mail
  // da compradora, mandando ele atrás do dado errado.
  | {
      blocked: "preflight";
      issues: ReadinessIssue[];
      signers: Array<{ name: string; role: string }>;
    }
  | { blocked: "collision"; message: string }
  | { blocked: "routing"; message: string };

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
    probeCaps?: (
      orgId: string
    ) => Promise<CapabilityResult | { error: "not_configured" }>;
  } = {}
): Promise<PrepareResult> {
  const resolveCreds = deps.resolveCreds ?? resolveClickSignCreds;
  const probeCaps = deps.probeCaps ?? detectAndCacheCapabilities;

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { orgId: true, hiddenPaths: true, schemaType: true, dataJson: true },
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
  // Conteúdo do documento junto do preflight de signatários: os dois barram no
  // mesmo ponto e chegam ao usuário na mesma lista. Sem isto, proposta com
  // `dataJson` de forma errada é enviada como PDF vazio, sem ninguém notar.
  issues.push(...checkProposalContent(proposal.schemaType, proposal.dataJson));

  if (issues.length > 0) {
    return {
      blocked: "preflight",
      issues,
      signers: rows.map((r) => ({ name: r.name, role: r.role })),
    };
  }

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

  // Capacidade ainda NÃO MEDIDA + alguém quer WhatsApp: mede antes de decidir,
  // em vez de assumir `false` e rebaixar pra Aceite em silêncio. O probe cria um
  // envelope rascunho, testa um signer WhatsApp e deleta o rascunho — nunca
  // ativa, nunca envia, custo zero.
  //
  // O gatilho é `whatsappSignatureAvailable == null` (não `capabilitiesCheckedAt
  // == null`): `detectAndCacheCapabilities` carimba a data MESMO quando o
  // veredito é inconclusivo (rede/5xx), e só deixa o flag intacto. Gatear pela
  // data daria UMA tentativa por org — e logo na primeira conexão, quando falha
  // transitória é mais provável — desligando a auto-verificação pra sempre.
  //
  // O cooldown evita o extremo oposto: sem ele, uma conta genuinamente
  // inconclusiva pagaria 4 chamadas ClickSign a cada envio.
  const measured = settings.whatsappSignatureAvailable != null;
  const lastCheck = settings.capabilitiesCheckedAt?.getTime() ?? 0;
  const cooldownOver = Date.now() - lastCheck > PROBE_RETRY_MS;
  if (!measured && cooldownOver && routingSigners.some((s) => s.channel === "whatsapp")) {
    const probed = await probeCaps(proposal.orgId).catch(() => null);
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

  // 4. Custo planejado — vira `reservedCostCents`/`costCents` (histórico).
  //    Não há mais teto a comparar: o único limite legítimo é o do plano da
  //    conta ClickSign, e ele só aparece na resposta dela (lib/clicksign/quota).
  const planCostCents =
    decision.instrument === "aceite"
      ? plannedAcceptanceCostCents(deduped.signers.length)
      : plannedProposalCostCents({
          signerCount: deduped.signers.length,
          costOverrides: settings.costOverridesJson as Record<string, unknown> | null,
        });
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
