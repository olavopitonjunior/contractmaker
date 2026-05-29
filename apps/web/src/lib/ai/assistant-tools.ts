import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";

// Tools do assistente IA contextual (drawer + chat global). Subset enxuto que
// foca em leitura de dados de locação. Diferente do AGENT_TOOLS do editor de
// contrato (que tem write tools com policy engine).

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "query_lease_status",
    description:
      "Devolve snapshot do contrato de locação: cobranças recentes, garantia, próxima vencimento, próximo reajuste, alertas. Use quando o usuário pergunta sobre 1 contrato específico.",
    input_schema: {
      type: "object",
      properties: {
        leaseContractId: { type: "string", description: "ID do LeaseContract" },
      },
      required: ["leaseContractId"],
    },
  },
  {
    name: "summarize_owner_position",
    description:
      "Extrato consolidado do proprietário: imóveis vinculados, próximos repasses, IR retido, vencimentos. Use quando o usuário pergunta sobre 1 proprietário.",
    input_schema: {
      type: "object",
      properties: {
        ownerId: { type: "string", description: "ID do PropertyOwner" },
      },
      required: ["ownerId"],
    },
  },
  {
    name: "forecast_cashflow",
    description:
      "Projeção de fluxo de caixa por mês — receita prevista x recebida x repasse pendente. Use quando o usuário pergunta sobre caixa/receita/inadimplência geral.",
    input_schema: {
      type: "object",
      properties: {
        months: {
          type: "number",
          description: "Quantos meses pra frente projetar (1-12). Default 3.",
        },
      },
    },
  },
  {
    name: "suggest_dunning_strategy",
    description:
      "Analisa histórico de inadimplência de um contrato e sugere stage da régua de cobrança Newton apropriada (D-3 lembrete, D+1 atraso, D+5 formal, D+30 extrajudicial, D+60 acionar garantia).",
    input_schema: {
      type: "object",
      properties: {
        leaseContractId: { type: "string", description: "ID do LeaseContract com cobrança em atraso" },
      },
      required: ["leaseContractId"],
    },
  },
];

interface ToolContext {
  orgId: string;
}

export async function runAssistantTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  if (toolName === "query_lease_status") {
    const leaseId = input.leaseContractId as string;
    const lc = await prisma.leaseContract.findFirst({
      where: { id: leaseId, orgId: ctx.orgId },
      include: {
        property: { select: { rua: true, numero: true, cidade: true } },
        tenants: { include: { tenant: { select: { nome: true } } } },
        rentCharges: { orderBy: { dueDate: "desc" }, take: 6 },
        guarantee: true,
      },
    });
    if (!lc) return JSON.stringify({ error: "Contrato não encontrado" });
    return JSON.stringify({
      status: lc.status,
      valorAluguel: lc.valorAluguel,
      diaVencimento: lc.diaVencimento,
      vigenciaFim: lc.vigenciaFim,
      dataProximoReajuste: lc.dataProximoReajuste,
      imovel: lc.property,
      inquilinos: lc.tenants.map((t) => t.tenant.nome),
      garantia: lc.guarantee ? { tipo: lc.guarantee.tipo, status: lc.guarantee.status } : null,
      cobrancasRecentes: lc.rentCharges.map((c) => ({
        competencia: c.competencia,
        status: c.status,
        valor: c.valorBase + c.encargos + c.multa + c.juros,
      })),
    });
  }

  if (toolName === "summarize_owner_position") {
    const ownerId = input.ownerId as string;
    const owner = await prisma.propertyOwner.findFirst({
      where: { id: ownerId, orgId: ctx.orgId },
      include: {
        ownerships: {
          include: {
            property: {
              select: {
                id: true,
                rua: true,
                numero: true,
                leaseContracts: {
                  where: { status: "ativo" },
                  select: { id: true, valorAluguel: true, regimeIr: true },
                },
              },
            },
          },
        },
      },
    });
    if (!owner) return JSON.stringify({ error: "Proprietário não encontrado" });

    let receitaTotal = 0;
    let irRetidoEstimado = 0;
    const imoveis = owner.ownerships.map((o) => {
      const lcAtivo = o.property.leaseContracts[0];
      if (lcAtivo) {
        const parteOwner = lcAtivo.valorAluguel * (o.percentual / 100);
        receitaTotal += parteOwner;
        if (lcAtivo.regimeIr === "retem_imobiliaria") {
          irRetidoEstimado += parteOwner * 0.275; // proxy alíquota IR
        }
      }
      return {
        endereco: `${o.property.rua} ${o.property.numero}`,
        percentual: o.percentual,
        leaseAtivoValor: lcAtivo?.valorAluguel,
      };
    });
    return JSON.stringify({
      nome: owner.nome,
      cpfCnpj: owner.cpfCnpj,
      imoveis,
      receitaMensalEstimada: receitaTotal,
      irRetidoEstimado,
      canalContato: owner.canalPreferido,
    });
  }

  if (toolName === "forecast_cashflow") {
    const months = Math.min(12, Math.max(1, (input.months as number) ?? 3));
    const now = new Date();
    const projection: Array<{
      mes: string;
      previsto: number;
      recebido: number;
      pendenteRepasse: number;
    }> = [];
    for (let i = 0; i < months; i++) {
      const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
      const mes = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
      const [previsto, recebido, pendente] = await Promise.all([
        prisma.rentCharge.aggregate({
          where: { orgId: ctx.orgId, dueDate: { gte: start, lt: end } },
          _sum: { valorBase: true, encargos: true },
        }),
        prisma.rentCharge.aggregate({
          where: {
            orgId: ctx.orgId,
            status: "paga",
            paidAt: { gte: start, lt: end },
          },
          _sum: { valorBase: true, encargos: true },
        }),
        prisma.rentCharge.aggregate({
          where: { orgId: ctx.orgId, status: "paga", repasseTransferId: null },
          _sum: { valorBase: true, encargos: true },
        }),
      ]);
      projection.push({
        mes,
        previsto: (previsto._sum.valorBase ?? 0) + (previsto._sum.encargos ?? 0),
        recebido: (recebido._sum.valorBase ?? 0) + (recebido._sum.encargos ?? 0),
        pendenteRepasse:
          i === 0
            ? (pendente._sum.valorBase ?? 0) + (pendente._sum.encargos ?? 0)
            : 0,
      });
    }
    return JSON.stringify({ projection });
  }

  if (toolName === "suggest_dunning_strategy") {
    const leaseId = input.leaseContractId as string;
    const lc = await prisma.leaseContract.findFirst({
      where: { id: leaseId, orgId: ctx.orgId },
      include: {
        rentCharges: {
          where: { status: { in: ["pendente", "atrasada"] } },
          orderBy: { dueDate: "asc" },
          take: 3,
        },
        guarantee: { select: { tipo: true, status: true } },
      },
    });
    if (!lc) return JSON.stringify({ error: "Contrato não encontrado" });
    if (lc.rentCharges.length === 0) {
      return JSON.stringify({ recommendation: "Sem cobrança pendente. Nada a cobrar." });
    }
    const now = new Date();
    const mostOverdue = lc.rentCharges[0];
    const diasAtraso = Math.floor(
      (now.getTime() - mostOverdue.dueDate.getTime()) / 86400000
    );
    let stage: string;
    if (diasAtraso < -1) stage = "lembrete_d_minus_3";
    else if (diasAtraso <= 4) stage = "atraso_d_plus_1";
    else if (diasAtraso <= 29) stage = "formal_d_plus_5";
    else if (diasAtraso <= 59) stage = "extrajudicial_d_plus_30";
    else stage = "garantia_d_plus_60";
    return JSON.stringify({
      diasAtraso,
      cobrancasPendentes: lc.rentCharges.length,
      garantia: lc.guarantee,
      recommendation: stage,
      acao: `Disparar régua Newton stage="${stage}" via POST /api/locacao/rent-charges/${mostOverdue.id}/remind`,
    });
  }

  return JSON.stringify({ error: `Tool desconhecida: ${toolName}` });
}
