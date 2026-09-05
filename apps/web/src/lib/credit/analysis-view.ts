import { prisma } from "@/lib/db/prisma";

/**
 * Projeção da análise de crédito para as telas (proposta E negócio). Só o que
 * o card mostra sai daqui — nunca o `resultData` cru do job nem o laudo
 * inteiro: dado de crédito é PII sob consentimento LGPD e o mesmo shape é
 * lido pelo corretor dono do negócio, então a projeção é a única fronteira.
 */

export const CREDIT_PROVIDER = "fichacerta";

export interface CreditJobView {
  id: string;
  label: string;
  targetKind: string;
  targetIndex: number;
  status: string;
  situacao: string | null;
  detalhes: string | null;
  scoreFc: number | null;
  parecer: string | null;
  recomendacoes: string[];
  errorMessage: string | null;
  expectedReadyAt: Date | null;
  createdAt: Date;
}

/** Parecer da locação — só o texto que a tela mostra. */
export interface CreditParecerView {
  locacao: {
    parecer_inquilinos?: { parecer: string };
    parecer_fiadores?: { parecer: string };
    risco?: string;
  };
}

export interface CreditRequestView {
  id: string;
  status: string;
  externalId: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
  lastSyncedAt: Date | null;
  errorMessage: string | null;
  costCents: number | null;
  /** Anexo do laudo NO SUJEITO consultado (ProposalAttachment ou DealAttachment). */
  reportAttachmentId: string | null;
  parecer: CreditParecerView | null;
  jobs: CreditJobView[];
}

/**
 * `CreditAnalysisRequest.resultJson` guarda o `parecer` INTEIRO da Ficha
 * Certa, que traz `sintese[{ cpf, nome, pretendente_id, parecer }]` por
 * pretendente. A tela só usa inquilinos/fiadores/risco — o resto é PII e não
 * sai daqui (mesma regra do `creditJobView`).
 */
export function creditParecerView(resultJson: unknown): CreditParecerView | null {
  const root = (resultJson && typeof resultJson === "object" ? resultJson : {}) as Record<string, unknown>;
  const locacao = root.locacao && typeof root.locacao === "object" ? (root.locacao as Record<string, unknown>) : null;
  if (!locacao) return null;
  const pick = (v: unknown): { parecer: string } | undefined => {
    const p = v && typeof v === "object" ? (v as Record<string, unknown>).parecer : undefined;
    return typeof p === "string" ? { parecer: p } : undefined;
  };
  const out: CreditParecerView = { locacao: {} };
  const inq = pick(locacao.parecer_inquilinos);
  const fia = pick(locacao.parecer_fiadores);
  if (inq) out.locacao.parecer_inquilinos = inq;
  if (fia) out.locacao.parecer_fiadores = fia;
  if (typeof locacao.risco === "string") out.locacao.risco = locacao.risco;
  return out;
}

export function creditJobView(j: {
  id: string;
  label: string;
  targetKind: string;
  targetIndex: number;
  status: string;
  errorMessage: string | null;
  expectedReadyAt: Date | null;
  resultData: unknown;
  createdAt: Date;
}): CreditJobView {
  const r = (j.resultData && typeof j.resultData === "object" ? j.resultData : {}) as Record<string, unknown>;
  const raw = (r.raw && typeof r.raw === "object" ? r.raw : {}) as Record<string, unknown>;
  return {
    id: j.id,
    label: j.label,
    targetKind: j.targetKind,
    targetIndex: j.targetIndex,
    status: j.status,
    situacao: typeof r.situacao === "string" ? r.situacao : null,
    detalhes: typeof r.detalhes === "string" ? r.detalhes : null,
    scoreFc: typeof raw.scoreFc === "number" ? raw.scoreFc : null,
    parecer: typeof raw.parecer === "string" ? raw.parecer : null,
    recomendacoes: Array.isArray(raw.recomendacoes) ? (raw.recomendacoes as string[]) : [],
    errorMessage: j.errorMessage,
    expectedReadyAt: j.expectedReadyAt,
    createdAt: j.createdAt,
  };
}

export type CreditSubject = { proposalId: string } | { dealId: string };

/**
 * Requests do sujeito com os jobs projetados. Para o negócio, o PDF do laudo é
 * o `reportDealAttachmentId` (casado na conversão); para a proposta, o
 * `reportProposalAttachmentId`. Um request convertido tem os dois — cada tela
 * lê o seu, porque a rota de arquivo é por sujeito.
 */
export async function listCreditRequests(subject: CreditSubject): Promise<CreditRequestView[]> {
  const where =
    "dealId" in subject
      ? { dealId: subject.dealId, provider: CREDIT_PROVIDER }
      : { proposalId: subject.proposalId, provider: CREDIT_PROVIDER };
  const requests = await prisma.creditAnalysisRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { jobs: { orderBy: { createdAt: "asc" } } },
  });
  return requests.map((r) => ({
    id: r.id,
    status: r.status,
    externalId: r.externalId,
    createdAt: r.createdAt,
    submittedAt: r.submittedAt,
    completedAt: r.completedAt,
    lastSyncedAt: r.lastSyncedAt,
    errorMessage: r.errorMessage,
    costCents: r.costCents,
    reportAttachmentId: "dealId" in subject ? r.reportDealAttachmentId : r.reportProposalAttachmentId,
    parecer: creditParecerView(r.resultJson),
    jobs: r.jobs.map(creditJobView),
  }));
}
