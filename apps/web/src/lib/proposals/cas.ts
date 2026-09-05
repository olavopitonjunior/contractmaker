import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { TERMINAL_STATUSES } from "./status-sets";

/**
 * As rotas que editam a proposta fazem read-modify-write do JSON inteiro a
 * partir do snapshot lido no próprio request. Duas escritas concorrentes em
 * campos diferentes (duas abas, um job de certidão gravando `dataJson`
 * enquanto alguém salva renda no editor de partes) partiam do mesmo snapshot
 * e a segunda apagava a primeira em silêncio — sem erro, sem log (#610).
 *
 * O remédio é CAS: a escrita casa o `updatedAt` do snapshot, então quem
 * perdeu a corrida não responde "ok" sem ter escrito.
 */

export interface ProposalSnapshot {
  updatedAt: Date;
  dataJson: unknown;
  complianceJson: unknown;
}
export type ScopedWriteResult =
  /** `written` é o que de fato foi gravado — pode vir da re-tentativa, não do 1º cálculo. */
  | { ok: true; written: Prisma.ProposalUpdateManyMutationInput }
  | { ok: false; reason: "terminal" | "stale" };

/** `where` do claim: status vivo E o `updatedAt` que este request leu. */
export function casWhere(id: string, seenUpdatedAt: Date) {
  return { id, status: { notIn: [...TERMINAL_STATUSES] }, updatedAt: seenUpdatedAt };
}

/**
 * Escrita ESCOPADA com CAS e uma re-tentativa: perdida a corrida, relê o
 * estado fresco e REAPLICA o mesmo patch sobre ele.
 *
 * Serve para patch escopado (campos de uma parte, a chave do consentimento),
 * nunca para substituição do formulário inteiro vinda do cliente — ali
 * reaplicar significaria ressuscitar um payload velho por cima de dado novo,
 * e o 409 é a resposta certa.
 *
 * Por que a re-tentativa: sem ela, salvar a parte A e, antes da resposta
 * chegar, salvar a parte B devolveria "recarregue" na segunda, embora os
 * dois patches não se toquem. Com ela, a segunda pousa sobre o resultado da
 * primeira. Só duas perdas seguidas viram 409.
 */
export async function applyScopedProposalWrite(
  id: string,
  snapshot: ProposalSnapshot,
  apply: (current: { dataJson: unknown; complianceJson: unknown }) => Prisma.ProposalUpdateManyMutationInput,
  attempts = 2
): Promise<ScopedWriteResult> {
  let current: ProposalSnapshot = snapshot;
  for (let i = 0; i < attempts; i++) {
    const data = apply(current);
    const claimed = await prisma.proposal.updateMany({ where: casWhere(id, current.updatedAt), data });
    if (claimed.count > 0) return { ok: true, written: data };

    const fresh = await prisma.proposal.findUnique({
      where: { id },
      select: { status: true, updatedAt: true, dataJson: true, complianceJson: true },
    });
    // Sumiu ou encerrou: tentar de novo não melhora, e o motivo é esse.
    if (!fresh || TERMINAL_STATUSES.has(fresh.status)) return { ok: false, reason: "terminal" };
    // Proposta viva e o `updatedAt` não mudou: o claim deveria ter casado.
    // Não sabemos o motivo — e dizer "encerrada" seria mentir para quem lê.
    if (fresh.updatedAt.getTime() === current.updatedAt.getTime()) return { ok: false, reason: "stale" };
    current = fresh;
  }
  return { ok: false, reason: "stale" };
}

/** 409 do claim perdido, dizendo se recarregar resolve. */
export function proposalConflictResponse(reason: "terminal" | "stale", terminalMessage: string): NextResponse {
  if (reason === "stale") {
    return NextResponse.json(
      {
        error: "A proposta mudou enquanto você editava. Recarregue a página e refaça a alteração.",
        stale: true,
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ error: terminalMessage }, { status: 409 });
}
