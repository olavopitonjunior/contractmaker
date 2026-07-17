import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveParticipantToken } from "@/lib/forms/participant-token";
import {
  ROLE_PATHS,
  filterDataJsonByRole,
} from "@/lib/forms/role-paths";
import {
  mergeSalesFormDataJson,
  FormNotFoundError,
} from "@/lib/forms/atomic-merge";
import { syncDealClientName } from "@/lib/forms/sync-deal-client-name";
import { formClosedResponse } from "@/lib/forms/form-gate";
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
  const resolved = await resolveParticipantToken(params.subtoken);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 401 });
  }

  const participant = await prisma.salesFormParticipant.findUniqueOrThrow({
    where: { id: resolved.participant.id },
    include: { form: true },
  });

  // Form-pai já enviado: o subtoken também para de servir dados. Mesmo gate do
  // token principal — senão o link por parte vira a porta dos fundos.
  const closed = await formClosedResponse(participant.form);
  if (closed) return closed;

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
  }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * PATCH /api/forms/participant/[subtoken]
 * Público — sem session. Auto-save do subtoken. Allowlist enforced via
 * `mergeSalesFormDataJson({ allowedTopKeys: ROLE_PATHS[role] })` — merge
 * atômico sob row lock (ver lib/forms/atomic-merge.ts).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { subtoken: string } },
) {
  const resolved = await resolveParticipantToken(params.subtoken);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 401 });
  }

  const participant = await prisma.salesFormParticipant.findUniqueOrThrow({
    where: { id: resolved.participant.id },
    include: { form: true },
  });

  // Guard de travamento: form travado congela também os subtokens por parte.
  if (participant.form.lockedAt) {
    return NextResponse.json(
      { error: "Formulário travado — não aceita mais alterações", reason: "form_locked" },
      { status: 403 },
    );
  }

  const closed = await formClosedResponse(participant.form);
  if (closed) return closed;

  const body = await req.json().catch(() => ({}));
  const role = participant.role as keyof typeof ROLE_PATHS;
  const incoming = (body.dataJson ?? {}) as Record<string, unknown>;

  // Status do subtoken: "completo" só se body explicitamente pediu.
  // Form principal só transiciona pra "completo" via token principal —
  // subtoken faz "completedAt" apenas no próprio participant.
  const markCompleted = body.markCompleted === true;

  // Merge atômico: releitura do dataJson sob FOR UPDATE dentro da transação —
  // o save do participante nunca regride edições concorrentes do token
  // principal (ou de outro subtoken) feitas depois da leitura acima.
  const completedNow =
    markCompleted && !participant.completedAt ? new Date() : null;
  let mergeOutcome;
  try {
    mergeOutcome = await mergeSalesFormDataJson({
      where: { id: participant.formId },
      incoming,
      allowedTopKeys: ROLE_PATHS[role],
      also: async (tx) => {
        await tx.salesFormParticipant.update({
          where: { id: participant.id },
          data: {
            lastAccessAt: new Date(),
            ...(completedNow ? { completedAt: completedNow } : {}),
          },
        });
      },
    });
  } catch (error) {
    // Form deletado entre o findUniqueOrThrow acima e o SELECT FOR UPDATE
    // (delete do deal com ?deleteForm=true durante o auto-save da parte).
    // 404 explícito — 500 faria o use-auto-save re-tentar pra sempre.
    if (error instanceof FormNotFoundError) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }
    throw error;
  }

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

  // Comprador/locatário titular pode ser preenchido EXCLUSIVAMENTE por este
  // link por parte — sem o sync aqui, o card no kanban ficava sem nome até
  // alguém salvar pelo token principal ou gerar o contrato.
  if (body.dataJson) {
    await syncDealClientName({
      formId: participant.formId,
      schemaType: participant.form.schemaType,
      mergedData: mergeOutcome.finalData as Record<string, unknown>,
    });
  }


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
    completedAt:
      (participant.completedAt ?? completedNow)?.toISOString() ?? null,
    rejectedPaths: mergeOutcome.rejectedPaths,
  });
}
