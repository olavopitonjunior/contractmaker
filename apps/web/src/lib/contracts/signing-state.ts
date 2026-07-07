/**
 * Detecta se o deal tem contrato assinado — base pra decidir entre
 * "aplicar no draft" e "criar aditamento".
 *
 * Critério: existe um Envelope com `source="contract"` e `status="closed"`
 * pra este deal. Envelopes com `source="attachment"` (aditivos, distratos,
 * procurações) NÃO contam pra esta detecção — eles são "papéis avulsos"
 * que podem coexistir com um CCV ainda em rascunho.
 *
 * Quando o envelope fechou via webhook ClickSign, ele também:
 *   - Setou `closedAt` (timestamp do fechamento)
 *   - Baixou o PDF assinado em `signedDocumentUrl`
 *   - Criou um DealAttachment `category="contrato_assinado"`
 *
 * Esta função é a fonte canônica usada por:
 *   - /api/deals/[dealId]/certidoes/analysis (popula `signingState` no
 *     payload da UI)
 *   - Editor specialist (decide entre `propose_suggestion` no draft vs
 *     `generateAddendumForDeal`)
 *   - AditamentoDialog (renderiza opções diferentes do selector)
 */

import { prisma } from "@/lib/db/prisma";

export interface DealSigningState {
  /** True quando há ao menos um Envelope source=contract status=closed. */
  hasSignedContract: boolean;
  /** Quando o envelope fechou (ClickSign close webhook). null se nunca fechou. */
  signedAt: Date | null;
  /** URL do PDF assinado (baixado da ClickSign no close). null antes do close. */
  signedDocumentUrl: string | null;
  /** ID do Contract original que foi assinado. Aditamento usa como
   *  `parentVersionId`. null se nunca assinou. */
  originalContractId: string | null;
  /** ID do Envelope que fechou. Útil pra audit + UI. null se não houver. */
  envelopeId: string | null;
}

const EMPTY_STATE: DealSigningState = {
  hasSignedContract: false,
  signedAt: null,
  signedDocumentUrl: null,
  originalContractId: null,
  envelopeId: null,
};

/**
 * Resolve o estado de assinatura do deal. Devolve estado vazio se não
 * há envelope contract closed.
 *
 * Performance: 1 query (Envelope.findFirst com `source=contract status=closed`
 * ordenado por closedAt desc). Cobre o caso de múltiplos contratos
 * assinados no mesmo deal (raro — usa o mais recente).
 */
export async function getDealSigningState(
  dealId: string
): Promise<DealSigningState> {
  const envelope = await prisma.envelope.findFirst({
    where: {
      dealId,
      source: "contract",
      status: "closed",
      // Só o instrumento principal conta — envelope do contrato de
      // administração de locação (kind="administracao") ou de aditamento
      // não significa "CCV/locação assinado".
      contract: { kind: "contract" },
    },
    orderBy: { closedAt: "desc" },
    select: {
      id: true,
      contractId: true,
      signedDocumentUrl: true,
      closedAt: true,
    },
  });

  if (!envelope) return EMPTY_STATE;

  return {
    hasSignedContract: true,
    signedAt: envelope.closedAt,
    signedDocumentUrl: envelope.signedDocumentUrl,
    originalContractId: envelope.contractId,
    envelopeId: envelope.id,
  };
}

/**
 * Variante batch — útil pra UI listar múltiplos deals (pipeline kanban) e
 * mostrar "signed" badge sem N+1.
 */
export async function getDealSigningStates(
  dealIds: string[]
): Promise<Map<string, DealSigningState>> {
  const envelopes = await prisma.envelope.findMany({
    where: {
      dealId: { in: dealIds },
      source: "contract",
      status: "closed",
      contract: { kind: "contract" },
    },
    orderBy: { closedAt: "desc" },
    select: {
      id: true,
      dealId: true,
      contractId: true,
      signedDocumentUrl: true,
      closedAt: true,
    },
  });

  const map = new Map<string, DealSigningState>();
  for (const id of dealIds) map.set(id, EMPTY_STATE);

  // findMany retorna múltiplos envelopes por deal se houver — só guarda o
  // primeiro (mais recente, graças ao orderBy).
  for (const e of envelopes) {
    if (map.get(e.dealId)?.hasSignedContract) continue;
    map.set(e.dealId, {
      hasSignedContract: true,
      signedAt: e.closedAt,
      signedDocumentUrl: e.signedDocumentUrl,
      originalContractId: e.contractId,
      envelopeId: e.id,
    });
  }

  return map;
}
