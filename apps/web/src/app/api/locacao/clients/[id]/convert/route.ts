import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";

export const dynamic = "force-dynamic";

function onlyDigits(s: unknown): string {
  return typeof s === "string" ? s.replace(/\D/g, "") : "";
}

/**
 * POST /api/locacao/clients/[id]/convert
 *
 * Materializa um Tenant (locatário) a partir do prospect. Idempotente por
 * (orgId, cpfCnpj) — reusa a ficha existente do locatário se já houver. Marca o
 * LeaseClient como "convertido" e guarda o vínculo em dataJson.convertedTenantId.
 * Exige cpfCnpj (Tenant tem @@unique([orgId, cpfCnpj])).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_UPDATE);
  if (isRouteError(ctx)) return ctx;

  const client = await prisma.leaseClient.findUnique({ where: { id: params.id } });
  if (!client || client.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const cpfCnpj = onlyDigits(client.cpfCnpj);
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return NextResponse.json(
      { error: "Preencha um CPF/CNPJ válido no cliente antes de converter em locatário." },
      { status: 422 }
    );
  }

  // Upsert por (orgId, cpfCnpj) — reusa a ficha do locatário se já existir.
  const existing = await prisma.tenant.findUnique({
    where: { orgId_cpfCnpj: { orgId: ctx.orgId, cpfCnpj } },
  });

  const tenant =
    existing ??
    (await prisma.tenant.create({
      data: {
        orgId: ctx.orgId,
        tipoPessoa: client.tipoPessoa,
        nome: client.nome,
        cpfCnpj,
        email: client.email,
        phone: client.phone,
        dataJson: (client.dataJson as object | null) ?? undefined,
      },
    }));

  const existingData = (client.dataJson as Record<string, unknown> | null) ?? {};
  await prisma.leaseClient.update({
    where: { id: client.id },
    data: {
      status: "convertido",
      dataJson: { ...existingData, convertedTenantId: tenant.id },
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "CLIENT_UPDATE",
      result: "SUCCESS",
      resource: client.id,
      resourceType: "LeaseClient",
      metadata: { kind: "converted", tenantId: tenant.id, reused: !!existing },
    }
  );

  return NextResponse.json({
    tenant: { id: tenant.id, nome: tenant.nome, cpfCnpj: tenant.cpfCnpj },
    reused: !!existing,
  });
}
