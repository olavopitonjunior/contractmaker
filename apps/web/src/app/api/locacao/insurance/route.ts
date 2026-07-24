import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoApiAccess, isRouteError } from "@/lib/locacao/route-helpers";
import {
  insurancePolicyCreateSchema,
  insuranceWizardSchema,
  type InsuranceWizardInput,
} from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.INSURANCE_VIEW, { scope: "locacao:r" });
  if (isRouteError(ctx)) return ctx;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const tipo = url.searchParams.get("tipo");
  const leaseContractId = url.searchParams.get("leaseContractId");
  const expiringInDays = url.searchParams.get("expiringInDays");

  let expiringFilter = {};
  if (expiringInDays && Number(expiringInDays) > 0) {
    const limit = new Date();
    limit.setDate(limit.getDate() + Number(expiringInDays));
    expiringFilter = { vigenciaFim: { lte: limit, gte: new Date() } };
  }

  const policies = await prisma.insurancePolicy.findMany({
    where: {
      orgId: ctx.orgId,
      ...(status ? { status } : {}),
      ...(tipo ? { tipo } : {}),
      ...(leaseContractId ? { leaseContractId } : {}),
      ...expiringFilter,
    },
    include: {
      leaseContract: { select: { id: true } },
      property: { select: { id: true, rua: true, numero: true } },
    },
    orderBy: { vigenciaFim: "asc" },
    take: 200,
  });
  return NextResponse.json({ policies });
}

// Statuses que contam como "em andamento" pro guard anti-duplicata do wizard.
const IN_FLIGHT_STATUSES = ["cotacao", "em_analise", "pendente", "ativa"];

/** Despesas mensais (1 por mês de vigência) geradas pelo wizard quando gerarDespesa. */
function buildMonthlyExpenses(data: InsuranceWizardInput, orgId: string) {
  const inicio = data.vigenciaInicio;
  const fim = data.vigenciaFim;
  const expenses: Array<{
    orgId: string;
    leaseContractId: string;
    type: string;
    descricao: string;
    valor: number;
    dueDate: Date;
    parcelaN: number;
    parcelaTotal: number;
    debitoDe: string;
    creditoPara: string;
  }> = [];
  // Âncora ao meio-dia evita drift de timezone (memória feedback_date_parse_timezone).
  const first = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), 12);
  for (let n = 0; n < 60; n++) {
    const due = new Date(first.getFullYear(), first.getMonth() + n, first.getDate(), 12);
    if (due > fim) break;
    expenses.push({
      orgId,
      leaseContractId: data.leaseContractId,
      type: data.tipo === "seguro_fianca" ? "seguro_fianca" : "seguro_incendio",
      descricao: `Seguro ${data.seguradora} — parcela mensal`,
      valor: data.premioMensal!,
      dueDate: due,
      parcelaN: n + 1,
      parcelaTotal: 0, // preenchido depois que soubermos o total
      debitoDe: data.responsavelPagamento === "proprietario" ? "proprietario" : "locatario",
      creditoPara: "fornecedor",
    });
  }
  return expenses.map((e) => ({ ...e, parcelaTotal: expenses.length }));
}

export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.INSURANCE_MANAGE, { scope: "locacao:rw" });
  if (isRouteError(ctx)) return ctx;

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Caminho wizard (aba Seguros do contrato): presença de `gerarDespesa` discrimina.
  if ("gerarDespesa" in raw) {
    const parsed = insuranceWizardSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const data = parsed.data;

    const lc = await prisma.leaseContract.findFirst({
      where: { id: data.leaseContractId, orgId: ctx.orgId },
      select: { id: true, propertyId: true },
    });
    if (!lc) {
      return NextResponse.json({ error: "Contrato não pertence à org." }, { status: 422 });
    }

    const duplicate = await prisma.insurancePolicy.findFirst({
      where: {
        leaseContractId: data.leaseContractId,
        tipo: data.tipo,
        status: { in: IN_FLIGHT_STATUSES },
      },
      select: { id: true, status: true },
    });
    if (duplicate) {
      return NextResponse.json(
        {
          error: `Já existe uma apólice de ${data.tipo} em andamento (${duplicate.status}) neste contrato. Cancele-a antes de contratar outra.`,
        },
        { status: 409 }
      );
    }

    const status = data.status ?? (data.apoliceNumero ? "ativa" : "cotacao");
    const expenses = data.gerarDespesa ? buildMonthlyExpenses(data, ctx.orgId) : [];

    const policy = await prisma.$transaction(async (tx) => {
      const created = await tx.insurancePolicy.create({
        data: {
          orgId: ctx.orgId,
          leaseContractId: data.leaseContractId,
          propertyId: lc.propertyId,
          tipo: data.tipo,
          seguradora: data.seguradora,
          apoliceNumero: data.apoliceNumero,
          vigenciaInicio: data.vigenciaInicio,
          vigenciaFim: data.vigenciaFim,
          premioMensal: data.premioMensal,
          responsavelPagamento: data.responsavelPagamento,
          coberturaJson: data.coberturaJson ?? undefined,
          status,
          origem: "manual",
        },
      });
      if (expenses.length > 0) {
        let firstExpenseId: string | null = null;
        for (const e of expenses) {
          const exp = await tx.expense.create({ data: e });
          if (!firstExpenseId) firstExpenseId = exp.id;
        }
        return tx.insurancePolicy.update({
          where: { id: created.id },
          data: { expenseId: firstExpenseId },
        });
      }
      return created;
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId },
      {
        action: "INSURANCE_CREATE",
        result: "SUCCESS",
        resource: policy.id,
        resourceType: "InsurancePolicy",
        metadata: {
          tipo: policy.tipo,
          seguradora: policy.seguradora,
          status: policy.status,
          despesasGeradas: expenses.length,
        },
      }
    );

    return NextResponse.json({ policy, despesasGeradas: expenses.length }, { status: 201 });
  }

  // Caminho legado (cadastro direto de apólice por contrato ou imóvel).
  const parsed = insurancePolicyCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  if (parsed.data.leaseContractId) {
    const lc = await prisma.leaseContract.findFirst({
      where: { id: parsed.data.leaseContractId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!lc) return NextResponse.json({ error: "Contrato não pertence à org." }, { status: 422 });
  }
  if (parsed.data.propertyId) {
    const p = await prisma.property.findFirst({
      where: { id: parsed.data.propertyId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!p) return NextResponse.json({ error: "Imóvel não pertence à org." }, { status: 422 });
  }

  const policy = await prisma.insurancePolicy.create({
    data: { ...parsed.data, orgId: ctx.orgId },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "INSURANCE_CREATE",
      result: "SUCCESS",
      resource: policy.id,
      resourceType: "InsurancePolicy",
      metadata: { tipo: policy.tipo, seguradora: policy.seguradora },
    }
  );

  return NextResponse.json({ policy }, { status: 201 });
}
