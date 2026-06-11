import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { inspectionSendSignatureSchema } from "@/lib/locacao/validators";
import { sendEnvelopeForAttachment } from "@/lib/clicksign/executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSPECTION_EXECUTE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const inspection = await prisma.inspection.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      property: { select: { rua: true, numero: true, cidade: true, uf: true } },
      leaseContract: { select: { id: true, dealId: true } },
    },
  });
  if (!inspection) {
    return NextResponse.json({ error: "Vistoria não encontrada" }, { status: 404 });
  }
  if (inspection.status !== "laudo_gerado" || !inspection.laudoPdfUrl) {
    return NextResponse.json(
      { error: "Gere o laudo PDF antes de enviar pra assinatura." },
      { status: 422 }
    );
  }
  // Envelope.dealId é NOT NULL — laudo só assina quando o contrato tem deal de
  // origem. Tornar dealId nullable fica pra fase 2 (CHECK constraint + webhook).
  const dealId = inspection.leaseContract?.dealId;
  if (!dealId) {
    return NextResponse.json(
      {
        error:
          "Contrato sem negócio de origem — a assinatura do laudo requer um deal vinculado.",
      },
      { status: 422 }
    );
  }

  const parsed = await parseJsonBody(req, inspectionSendSignatureSchema);
  if (!parsed.ok) return parsed.response;

  const endereco = [
    [inspection.property.rua, inspection.property.numero].filter(Boolean).join(", "),
    [inspection.property.cidade, inspection.property.uf].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" · ");

  // Laudo entra na pasta do deal como anexo (idempotente por url) e o envelope
  // nasce dele — reusa o pipeline attachment do ClickSign sem mudanças.
  let attachment = await prisma.dealAttachment.findFirst({
    where: { dealId, url: inspection.laudoPdfUrl },
    select: { id: true },
  });
  if (!attachment) {
    attachment = await prisma.dealAttachment.create({
      data: {
        dealId,
        filename: `Laudo de vistoria (${inspection.tipo}).pdf`,
        mime: "application/pdf",
        url: inspection.laudoPdfUrl,
        category: "laudo_vistoria",
        source: "inspection",
      },
      select: { id: true },
    });
  }

  try {
    const envelope = await sendEnvelopeForAttachment({
      attachmentId: attachment.id,
      envelopeName: `Laudo de vistoria — ${endereco}`,
      signers: parsed.data.signers.map((s, idx) => ({
        name: s.name,
        email: s.email,
        documentation: s.documentation,
        sourceKind: "outro",
        sourceIndex: idx,
        role: s.role,
      })),
    });

    await prisma.inspection.update({
      where: { id },
      data: { envelopeId: envelope.id, status: "assinatura" },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId },
      {
        action: "INSPECTION_SIGNATURE_SENT",
        result: "SUCCESS",
        resource: id,
        resourceType: "Inspection",
        metadata: { envelopeId: envelope.id, signers: parsed.data.signers.length },
      }
    );

    return NextResponse.json({ envelope: { id: envelope.id, status: envelope.status } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro no envio pra ClickSign";
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId },
      {
        action: "INSPECTION_SIGNATURE_SENT",
        result: "FAILURE",
        resource: id,
        resourceType: "Inspection",
        metadata: { error: msg.slice(0, 300) },
      }
    );
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
