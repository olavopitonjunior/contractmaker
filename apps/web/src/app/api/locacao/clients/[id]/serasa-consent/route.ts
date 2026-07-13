import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";

export const runtime = "nodejs";

const schema = z.object({
  baseLegal: z.enum(["protecao_credito", "execucao_contrato"]),
});

/**
 * POST /api/locacao/clients/:id/serasa-consent
 *
 * Registra consentimento LGPD pra consulta Serasa do cliente/prospect. Espelha
 * o consent do deal, mas grava em `LeaseClient.complianceJson.serasaConsent`.
 * Sem essa row, o POST de credit-analysis devolve 412 (requiresConsent).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_UPDATE);
  if (isRouteError(ctx)) return ctx;

  const client = await prisma.leaseClient.findUnique({ where: { id: params.id } });
  if (!client || client.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const existing = (client.complianceJson as Record<string, unknown> | null) ?? {};
  const consent = { at: new Date().toISOString(), by: ctx.userId, baseLegal: parsed.data.baseLegal };
  await prisma.leaseClient.update({
    where: { id: params.id },
    data: { complianceJson: { ...existing, serasaConsent: consent } },
  });

  waitUntil(
    audit(
      { orgId: ctx.orgId, userId: ctx.userId },
      {
        action: "SERASA_CONSENT_GIVEN",
        result: "SUCCESS",
        resource: params.id,
        resourceType: "LeaseClient",
        metadata: { baseLegal: parsed.data.baseLegal },
      }
    )
  );

  return NextResponse.json({ ok: true, consent });
}
