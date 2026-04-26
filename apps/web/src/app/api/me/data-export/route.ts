import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/me/data-export
 *
 * LGPD art. 18, II — direito de acesso. Retorna JSON com TODOS os dados
 * pessoais associados ao usuário autenticado: conta, memberships, deals,
 * contratos, comentários, cobranças (escopadas pela org dele).
 *
 * Response: JSON estruturado (não ZIP — simplifica). Cliente pode salvar
 * via "Salvar como" ou usar fetch + download.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const [user, memberships, deals, contracts, comments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        deletionScheduledAt: true,
      },
    }),
    prisma.orgMembership.findMany({
      where: { userId },
      include: { org: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.deal.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        value: true,
        dataJson: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 1000,
    }),
    prisma.contract.findMany({
      where: { userId },
      select: {
        id: true,
        version: true,
        status: true,
        dataJson: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 1000,
    }),
    prisma.contractComment.findMany({
      where: { userId },
      select: {
        id: true,
        text: true,
        authorName: true,
        authorType: true,
        severity: true,
        resolved: true,
        createdAt: true,
      },
      take: 5000,
    }),
  ]);

  // Cobranças e transfers escopadas pela org do usuário (não dados pessoais
  // do user em si, mas que ele tem acesso por ser membro)
  const org = await getUserOrg(userId);
  const orgScopedData: Record<string, unknown> = {};
  if (org) {
    const [charges, transfers, customers] = await Promise.all([
      prisma.commissionCharge.findMany({
        where: { orgId: org.id },
        select: {
          id: true,
          asaasPaymentId: true,
          value: true,
          netValue: true,
          status: true,
          billingType: true,
          description: true,
          currentDueDate: true,
          paidAt: true,
          createdAt: true,
        },
        take: 1000,
      }),
      prisma.asaasTransfer.findMany({
        where: { orgId: org.id },
        select: {
          id: true,
          asaasTransferId: true,
          value: true,
          status: true,
          type: true,
          ownerName: true,
          createdAt: true,
        },
        take: 1000,
      }),
      prisma.asaasCustomer.findMany({
        where: { orgId: org.id },
        select: {
          id: true,
          name: true,
          cpfCnpj: true,
          email: true,
          mobilePhone: true,
          origin: true,
          createdAt: true,
        },
        take: 1000,
      }),
    ]);
    orgScopedData.charges = charges;
    orgScopedData.transfers = transfers;
    orgScopedData.customers = customers;
  }

  await audit(
    {
      orgId: org?.id ?? "",
      userId,
      ipAddress: ip,
      userAgent,
    },
    {
      action: "DATA_EXPORT_REQUESTED",
      result: "SUCCESS",
      resourceType: "user",
      resource: `user:${userId}`,
    }
  );

  const exportData = {
    exportedAt: new Date().toISOString(),
    legalBasis: "LGPD art. 18, II — Direito de acesso",
    user,
    memberships,
    organizations: org ? [{ id: org.id, name: org.name }] : [],
    deals,
    contracts,
    contractComments: comments,
    organizationScoped: orgScopedData,
    notes: [
      "Dados de auditoria (AuditLog) não incluídos por padrão — solicite separadamente.",
      "Documentos enviados (PDFs, imagens) são acessíveis via interface da plataforma.",
      "API keys e segredos criptografados não são exportados (impossível decriptar fora do contexto operacional).",
    ],
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="contractmaker-data-export-${userId}-${Date.now()}.json"`,
    },
  });
}
