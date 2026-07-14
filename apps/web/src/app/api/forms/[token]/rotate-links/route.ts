import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  signParticipantToken,
  type ParticipantRole,
} from "@/lib/forms/participant-token";
import { audit } from "@/lib/security/audit";

/**
 * POST /api/forms/[token]/rotate-links
 *
 * Corretor clica "Trocar todos os links" — revoga o acesso de quem tiver os
 * links atuais SEM alterar os dados preenchidos. Rotaciona de uma vez:
 *   1. o token principal do SalesForm (novo valor aleatório; o antigo passa a
 *      dar 404 em /f/[token] porque o lookup é por token);
 *   2. todos os subtokens por parte (re-assina cada SalesFormParticipant.token;
 *      o JWT antigo vira 401 mesmo com assinatura válida, pois o DB é canônico).
 *
 * Uso: link vazou / foi encaminhado por engano. Os dados (dataJson) ficam
 * intactos — o token só vive em SalesForm.token, nenhuma outra tabela o guarda.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "AUTH_SECRET não configurado" },
      { status: 500 },
    );
  }

  // Cross-org guard: form precisa pertencer à org do ctx. `[token]` é o
  // SalesForm.token atual (lookup único).
  const form = await prisma.salesForm.findFirst({
    where: { token: params.token, orgId: ctx.orgId },
    select: {
      id: true,
      participants: {
        select: { id: true, role: true, partyIndex: true },
      },
    },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }

  // Novo token principal — UUID (sem "."), então resolveFormScope continua
  // tratando como token principal, não como subtoken JWT.
  const newMainToken = randomUUID();

  // Re-assina cada subtoken (mesma lógica do endpoint regenerate).
  const rotatedParticipants: Array<{ role: string; url: string }> = [];
  await prisma.$transaction(async (tx) => {
    await tx.salesForm.update({
      where: { id: form.id },
      data: { token: newMainToken },
    });

    for (const p of form.participants) {
      const { token, exp } = signParticipantToken(
        {
          participantId: p.id,
          formId: form.id,
          role: p.role as ParticipantRole,
          partyIndex: p.partyIndex,
        },
        secret,
      );
      await tx.salesFormParticipant.update({
        where: { id: p.id },
        data: { token, tokenExp: exp },
      });
      rotatedParticipants.push({ role: p.role, url: `/f/p/${token}` });
    }
  });

  audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "FORM_LINK_ROTATED",
      result: "SUCCESS",
      resourceType: "SalesForm",
      resource: form.id,
      metadata: { participantsRotated: form.participants.length },
    },
  );

  return NextResponse.json({
    token: newMainToken,
    mainUrl: `/f/${newMainToken}`,
    participants: rotatedParticipants,
  });
}
