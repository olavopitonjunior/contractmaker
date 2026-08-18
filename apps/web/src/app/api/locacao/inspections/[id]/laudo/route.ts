import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import QRCode from "qrcode";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { exportPdfToBuffer } from "@/lib/render/exporter";
import { renderLaudoHtml } from "@/lib/locacao/laudo-template";
import {
  isInspectionContentEditable,
  type LaudoAmbiente,
  type LaudoMeta,
} from "@/lib/locacao/inspection-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Puppeteer serverless (Vercel Pro)

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSPECTION_EXECUTE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const inspection = await prisma.inspection.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      org: { select: { name: true } },
      property: {
        include: {
          ownerships: { include: { owner: { select: { nome: true } } } },
        },
      },
      leaseContract: {
        select: {
          tenants: { include: { tenant: { select: { nome: true } } } },
        },
      },
    },
  });
  if (!inspection) {
    return NextResponse.json({ error: "Vistoria não encontrada" }, { status: 404 });
  }
  if (!isInspectionContentEditable(inspection.status)) {
    return NextResponse.json(
      { error: `Laudo em "${inspection.status}" não pode ser regerado.` },
      { status: 422 }
    );
  }

  const ambientes = (inspection.ambientesJson as unknown as LaudoAmbiente[] | null) ?? [];
  const meta = (inspection.checklistJson as unknown as LaudoMeta | null) ?? {
    medidores: {},
    chaves: [],
    mobilia: [],
  };
  if (ambientes.length === 0) {
    return NextResponse.json(
      { error: "Adicione ao menos um ambiente antes de gerar o laudo." },
      { status: 422 }
    );
  }

  const qrToken = inspection.qrToken ?? randomUUID();
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  const verifyUrl = `${baseUrl}/vistoria/verificar/${qrToken}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 240, margin: 1 });

  const endereco = [
    [inspection.property.rua, inspection.property.numero].filter(Boolean).join(", "),
    inspection.property.bairro,
    [inspection.property.cidade, inspection.property.uf].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" · ");

  const html = renderLaudoHtml({
    tipo: inspection.tipo,
    criadaEm: inspection.createdAt,
    orgName: inspection.org.name,
    endereco,
    locatarios: inspection.leaseContract?.tenants.map((t) => t.tenant.nome) ?? [],
    proprietarios: inspection.property.ownerships.map((o) => o.owner.nome),
    ambientes,
    meta,
    qrDataUrl,
    qrToken,
    verifyUrl,
  });

  let pdf: Buffer;
  try {
    pdf = await exportPdfToBuffer(html, "A4", null);
  } catch (err) {
    console.error("[laudo pdf]", err);
    return NextResponse.json(
      { error: "Falha ao renderizar o PDF do laudo." },
      { status: 500 }
    );
  }

  const laudoPdfUrl = await uploadBufferToStorage({
    bucket: process.env.S3_BUCKET,
    key: `inspections/${id}/laudo.pdf`,
    body: pdf,
    contentType: "application/pdf",
  });

  const updated = await prisma.inspection.update({
    where: { id },
    data: { qrToken, laudoPdfUrl, laudoOrigem: "gerado", status: "laudo_gerado" },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "INSPECTION_LAUDO_GENERATED",
      result: "SUCCESS",
      resource: id,
      resourceType: "Inspection",
      metadata: { ambientes: ambientes.length, bytes: pdf.length },
    }
  );

  return NextResponse.json({ inspection: updated, laudoPdfUrl });
}
