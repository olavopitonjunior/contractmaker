import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { type ParticipantRole } from "./participant-token";

/**
 * Resolve o `[token]` das rotas públicas de form/attachments aceitando DOIS
 * formatos:
 *   1. token principal do SalesForm (acesso total ao form);
 *   2. subtoken de participante (acesso escopado por papel) — fecha o gap
 *      "subtoken não consegue subir documentos" sem mudar o cliente: o
 *      DocumentosStep continua batendo em /api/forms/{token}/attachments e o
 *      resolver decide o escopo.
 *
 * A ordem é a desambiguação: os dois são strings opacas e não dá pra saber qual
 * é qual olhando (antes o subtoken era um JWT e dava pra farejar pelo ponto —
 * heurística que morreu junto com o JWT). Tenta form, depois participante; as
 * duas colunas são `@unique` e o espaço é aleatório, então não há colisão real.
 *
 * Quando `participantId` vem preenchido, o caller DEVE: filtrar GETs por
 * participantId, carimbar participantId nos uploads e restringir mutações a
 * anexos do próprio participante.
 */
export interface FormScope {
  formId: string;
  orgId: string;
  schemaType: string;
  /** Null = token principal (sem escopo por parte). */
  participantId: string | null;
  role: ParticipantRole | null;
  partyIndex: number | null;
  /** Setado = form travado; callers DEVEM bloquear writes (uploads/delete). */
  lockedAt: Date | null;
  /**
   * Setado = form já enviado (status "completo" OU "vinculado"). Callers DEVEM
   * passar pelo gate de `form-gate.ts` — fechado só é acessível por membro da
   * org, inclusive na LEITURA (diferente do lockedAt, que só barra escrita).
   */
  completedAt: Date | null;
  /** Reaberto pela org → gate desligado até o próximo finalize. */
  reopenedAt: Date | null;
  /** "rascunho" | "completo" | "vinculado" — `vinculado` também fecha o gate. */
  status: string;
}

export async function resolveFormScope(token: string): Promise<FormScope | null> {
  // 1. Token principal do SalesForm.
  const form = await prisma.salesForm.findUnique({
    where: { token },
    select: {
      id: true,
      orgId: true,
      schemaType: true,
      lockedAt: true,
      completedAt: true,
      reopenedAt: true,
      status: true,
    },
  });
  if (form) {
    return {
      formId: form.id,
      orgId: form.orgId,
      schemaType: form.schemaType,
      participantId: null,
      role: null,
      partyIndex: null,
      lockedAt: form.lockedAt,
      completedAt: form.completedAt,
      reopenedAt: form.reopenedAt,
      status: form.status,
    };
  }

  // 2. Subtoken de participante. A própria busca autentica — o token é opaco e
  //    aleatório, e "regenerar link" troca o valor, invalidando o antigo.
  //    Expiração fica com `tokenExp` (não há mais `exp` assinado no token).
  const participant = await prisma.salesFormParticipant.findUnique({
    where: { token },
    select: {
      id: true,
      role: true,
      partyIndex: true,
      tokenExp: true,
      form: {
        select: {
          id: true,
          orgId: true,
          schemaType: true,
          lockedAt: true,
          completedAt: true,
          reopenedAt: true,
          status: true,
        },
      },
    },
  });
  if (!participant) return null;
  if (participant.tokenExp.getTime() < Date.now()) return null;

  return {
    formId: participant.form.id,
    orgId: participant.form.orgId,
    schemaType: participant.form.schemaType,
    participantId: participant.id,
    role: participant.role as ParticipantRole,
    partyIndex: participant.partyIndex,
    lockedAt: participant.form.lockedAt,
    completedAt: participant.form.completedAt,
    reopenedAt: participant.form.reopenedAt,
    status: participant.form.status,
  };
}

/**
 * Guard de travamento pros writes públicos de anexo. Retorna a resposta 403 se
 * o form estiver travado, ou null se liberado. Leituras (GET) NÃO usam — a
 * visão somente-leitura precisa listar/baixar os anexos já enviados.
 */
export function formLockedResponse(scope: FormScope): NextResponse | null {
  if (scope.lockedAt) {
    return NextResponse.json(
      { error: "Formulário travado — não aceita mais alterações" },
      { status: 403 },
    );
  }
  return null;
}
