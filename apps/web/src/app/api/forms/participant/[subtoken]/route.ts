import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { verifyParticipantToken } from "@/lib/forms/participant-token";
import {
  ROLE_PATHS,
  filterDataJsonByRole,
} from "@/lib/forms/role-paths";
import { deepMergeAtPaths } from "@/lib/forms/dataJson-merge";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { waitUntil } from "@vercel/functions";
import { emitNotification } from "@/lib/notifications/emit";

const ROLE_LABELS: Record<string, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  locador: "Locador",
  locatario: "Locatário",
  fiador: "Fiador",
};

/**
 * GET /api/forms/participant/[subtoken]
 * Público — sem session. Valida JWT, retorna dataJson filtrado pelo role.
 *
 * O token decodificado precisa BATER com `SalesFormParticipant.token` no DB
 * (canônico). Isso permite que "regenerar link" invalide o JWT antigo mesmo
 * que a assinatura ainda seja válida.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { subtoken: string } },
) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "AUTH_SECRET não configurado" },
      { status: 500 },
    );
  }

  const verify = verifyParticipantToken(params.subtoken, secret);
  if (!verify.ok) {
    return NextResponse.json({ error: verify.error }, { status: 401 });
  }

  const participant = await prisma.salesFormParticipant.findFirst({
    where: {
      id: verify.payload.participantId,
      token: params.subtoken, // confirma DB canônico
    },
    include: { form: true },
  });
  if (!participant) {
    return NextResponse.json(
      { error: "Token inválido ou revogado" },
      { status: 401 },
    );
  }

  // lastAccessAt best-effort — não bloqueia leitura.
  prisma.salesFormParticipant
    .update({
      where: { id: participant.id },
      data: { lastAccessAt: new Date() },
    })
    .catch(() => {});

  const role = participant.role as keyof typeof ROLE_PATHS;
  const fullData = (participant.form.dataJson ?? {}) as Record<string, unknown>;
  const filtered = filterDataJsonByRole(fullData, role);

  return NextResponse.json({
    role,
    partyIndex: participant.partyIndex,
    formTitle: participant.form.title,
    formStatus: participant.form.status,
    completedAt: participant.completedAt?.toISOString() ?? null,
    // Travamento do form: cliente do subtoken renderiza somente-leitura.
    lockedAt: participant.form.lockedAt
      ? participant.form.lockedAt.toISOString()
      : null,
    dataJson: filtered,
    allowedTopKeys: ROLE_PATHS[role],
  });
}

/**
 * PATCH /api/forms/participant/[subtoken]
 * Público — sem session. Auto-save do subtoken. Allowlist enforced via
 * `deepMergeAtPaths(current, incoming, ROLE_PATHS[role])`.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { subtoken: string } },
) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "AUTH_SECRET não configurado" },
      { status: 500 },
    );
  }

  const verify = verifyParticipantToken(params.subtoken, secret);
  if (!verify.ok) {
    return NextResponse.json({ error: verify.error }, { status: 401 });
  }

  const participant = await prisma.salesFormParticipant.findFirst({
    where: {
      id: verify.payload.participantId,
      token: params.subtoken,
    },
    include: { form: true },
  });
  if (!participant) {
    return NextResponse.json(
      { error: "Token inválido ou revogado" },
      { status: 401 },
    );
  }

  // Guard de travamento: form travado congela também os subtokens por parte.
  if (participant.form.lockedAt) {
    return NextResponse.json(
      { error: "Formulário travado — não aceita mais alterações" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const role = participant.role as keyof typeof ROLE_PATHS;
  const currentData = (participant.form.dataJson ?? {}) as Record<
    string,
    unknown
  >;
  const incoming = (body.dataJson ?? {}) as Record<string, unknown>;

  const mergeOutcome = deepMergeAtPaths(
    currentData,
    incoming,
    ROLE_PATHS[role],
  );

  if (mergeOutcome.rejectedPaths.length > 0) {
    // Log + audit (não bloqueia save — bug de UI não pode quebrar fluxo).
    console.warn("[participant PATCH] rejected paths", {
      participantId: participant.id,
      role,
      rejectedPaths: mergeOutcome.rejectedPaths,
    });
    audit(
      extractAuditContextFromRequest(req, participant.form.orgId, null),
      {
        action: "PARTICIPANT_PATCH_REJECTED_PATH",
        result: "DENIED",
        resourceType: "SalesFormParticipant",
        resource: participant.id,
        metadata: {
          role,
          rejectedPaths: mergeOutcome.rejectedPaths,
        },
      },
    );
  }

  // Status do subtoken: "completo" só se body explicitamente pediu.
  // Form principal só transiciona pra "completo" via token principal —
  // subtoken faz "completedAt" apenas no próprio participant.
  const markCompleted = body.markCompleted === true;
  const updated = await prisma.$transaction([
    prisma.salesForm.update({
      where: { id: participant.formId },
      data: { dataJson: mergeOutcome.merged as Prisma.InputJsonValue },
    }),
    prisma.salesFormParticipant.update({
      where: { id: participant.id },
      data: {
        lastAccessAt: new Date(),
        ...(markCompleted && !participant.completedAt
          ? { completedAt: new Date() }
          : {}),
      },
    }),
  ]);

  if (markCompleted && !participant.completedAt) {
    audit(
      extractAuditContextFromRequest(req, participant.form.orgId, null),
      {
        action: "PARTICIPANT_COMPLETED",
        result: "SUCCESS",
        resourceType: "SalesFormParticipant",
        resource: participant.id,
        metadata: { role, formId: participant.formId },
      },
    );

    // Sino: a parte terminou de preencher — operador não precisa ficar
    // conferindo o form. batchId=participant.id deduplica re-submissões.
    // waitUntil obrigatório: `void promise` após o response é cancelado na
    // Vercel (feedback_vercel_fire_and_forget).
    const isLocacao = participant.form.schemaType?.startsWith("locacao");
    waitUntil(emitNotification({
      orgId: participant.form.orgId,
      type: "participant_completed",
      title: `${ROLE_LABELS[role] ?? role} preencheu os dados`,
      body: `"${participant.form.title ?? "Formulário"}" — a parte ${
        ROLE_LABELS[role]?.toLowerCase() ?? role
      } concluiu a qualificação pelo link exclusivo.`,
      linkUrl: isLocacao ? undefined : `/forms/${participant.formId}/share`,
      metadata: { formId: participant.formId, participantId: participant.id, role },
      batchId: participant.id,
    }));
  }

  return NextResponse.json({
    role,
    completedAt: updated[1].completedAt?.toISOString() ?? null,
    rejectedPaths: mergeOutcome.rejectedPaths,
  });
}
