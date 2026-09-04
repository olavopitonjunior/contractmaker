import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsConfigured } from "@/lib/google/client";
import { googleErrorMessage } from "@/lib/google/auth-error";
import { reapplySlotsForTemplate, SlotReapplyError } from "@/lib/templates/reapply-slots";
import { validateGoogleDocTemplate } from "@/lib/templates/validate-gdoc";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Reaplica os slots de cláusula do modelo a partir do plano do lote. É o botão
 * "Tentar de novo" do aviso "a cláusula que varia continua fixa no modelo" —
 * antes a única saída era editar o Google Doc à mão.
 */
async function requireOwnerAdmin(userId: string, orgId: string) {
  const effUserId = await getEffectiveUserId(userId);
  const m = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  return !!m && ["owner", "admin"].includes(m.role);
}

const STATUS: Record<SlotReapplyError["code"], number> = {
  TEMPLATE_NOT_FOUND: 404,
  NOT_GOOGLE_DOCS: 400,
  TEMPLATE_ACTIVE: 409,
  // A requisição é válida; o dado necessário é que não existe. 404 é "não achei /
  // não posso ver" — e a impersonação vencida também responde 404, o que já
  // confundiu um diagnóstico.
  PLAN_MISSING: 422,
  NO_SLOTS: 422,
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!(await requireOwnerAdmin(session.user.id, org.id))) {
    return NextResponse.json({ error: "Apenas owner/admin." }, { status: 403 });
  }
  if (!isGoogleDocsConfigured()) {
    return NextResponse.json({ error: "Integração Google Docs não está configurada." }, { status: 503 });
  }

  try {
    const result = await reapplySlotsForTemplate({ templateId: params.id, orgId: org.id });

    const actorId = await getEffectiveUserId(session.user.id);
    await audit(extractAuditContextFromRequest(req, org.id, actorId), {
      action: "TEMPLATE_SLOTS_REAPPLIED",
      result: result.reports.some((r) => r.applied) ? "SUCCESS" : "FAILURE",
      resource: params.id,
      resourceType: "ContractTemplate",
      metadata: {
        slots: result.reports.map((r) => ({
          slot: r.slot,
          applied: r.applied,
          reasons: r.issues.map((i) => i.reason),
        })),
        declared: result.declared,
      },
    });

    // Revalida com o Doc já editado: é o que a tela mostra e o que a ativação lê.
    const template = await prisma.contractTemplate.findFirst({
      where: { id: params.id, orgId: org.id },
    });
    const validation = template
      ? await validateGoogleDocTemplate({ template, orgId: org.id })
      : null;

    return NextResponse.json({ slots: result.reports, declared: result.declared, validation });
  } catch (err) {
    if (err instanceof SlotReapplyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: STATUS[err.code] });
    }
    return NextResponse.json({ error: googleErrorMessage(err) }, { status: 502 });
  }
}
