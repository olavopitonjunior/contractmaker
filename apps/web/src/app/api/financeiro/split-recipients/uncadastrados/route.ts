import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ComissionadoLite {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  mobile_phone?: string;
}

/**
 * GET /api/financeiro/split-recipients/uncadastrados
 *
 * Varre `Contract.dataJson.comissao.comissionados[]` dos últimos 90 dias na
 * org, deduplica por CPF/CNPJ normalizado e retorna apenas os que ainda não
 * têm `SplitRecipient` cadastrado. UI pode oferecer "cadastrar 1 a 1".
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.SPLIT_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const contracts = await prisma.contract.findMany({
    where: {
      deal: { pipeline: { orgId: ctx.orgId } },
      createdAt: { gte: ninetyDaysAgo },
    },
    select: { id: true, dataJson: true, deal: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const recipients = await prisma.splitRecipient.findMany({
    where: { orgId: ctx.orgId },
    select: { cpfCnpj: true, ownerCpfCnpj: true, walletId: true, pixAddressKey: true },
  });

  const cadastrados = new Set<string>();
  for (const r of recipients) {
    const doc = (r.cpfCnpj ?? r.ownerCpfCnpj ?? "").replace(/\D/g, "");
    if (doc.length >= 11) cadastrados.add(doc);
  }

  const uncadastrados = new Map<
    string,
    {
      nome: string;
      cpf?: string;
      cnpj?: string;
      email?: string;
      mobile_phone?: string;
      seenInDeals: string[];
    }
  >();

  for (const c of contracts) {
    const data = c.dataJson as { comissao?: { comissionados?: ComissionadoLite[] } } | null;
    const list = data?.comissao?.comissionados ?? [];
    for (const com of list) {
      const doc = (com.cpf || com.cnpj || "").replace(/\D/g, "");
      if (doc.length < 11) continue;
      if (cadastrados.has(doc)) continue;
      const existing = uncadastrados.get(doc);
      if (existing) {
        if (c.deal?.title && !existing.seenInDeals.includes(c.deal.title)) {
          existing.seenInDeals.push(c.deal.title);
        }
      } else {
        uncadastrados.set(doc, {
          nome: com.nome ?? "(sem nome)",
          cpf: com.cpf,
          cnpj: com.cnpj,
          email: com.email,
          mobile_phone: com.mobile_phone,
          seenInDeals: c.deal?.title ? [c.deal.title] : [],
        });
      }
    }
  }

  return NextResponse.json({
    items: Array.from(uncadastrados.entries()).map(([doc, info]) => ({
      cpfCnpj: doc,
      ...info,
    })),
  });
}
