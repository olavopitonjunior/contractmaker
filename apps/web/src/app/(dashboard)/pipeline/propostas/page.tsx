import { prisma } from "@/lib/db/prisma";
import { requireAnyFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import {
  getEffectivePermissions,
  proposalScopeWhere,
} from "@/lib/security/rbac/check";
import { redirect } from "next/navigation";
import { ProposalsListClient } from "@/components/proposals/ProposalsListClient";

export const dynamic = "force-dynamic";

export default async function PropostasPage({
  searchParams,
}: {
  searchParams: { tipo?: string };
}) {
  const { userId, orgId, enabled } = await requireAnyFeaturePage([
    FEATURE.VENDAS_PROPOSTAS,
    FEATURE.LOCACAO_PROPOSTAS,
  ]);

  const vendasOn = enabled[FEATURE.VENDAS_PROPOSTAS];
  const locacaoOn = enabled[FEATURE.LOCACAO_PROPOSTAS];
  // Aba ativa: respeita ?tipo=, senão o único módulo ligado.
  const tipo =
    searchParams.tipo === "locacao"
      ? "locacao"
      : searchParams.tipo === "venda"
        ? "venda"
        : vendasOn
          ? "venda"
          : "locacao";

  const eff = await getEffectivePermissions(userId, orgId);
  const scope = proposalScopeWhere(eff);
  if (!scope) redirect("/pipeline");

  const proposals = await prisma.proposal.findMany({
    where: { ...scope, kind: tipo === "venda" ? "venda" : "locacao" },
    select: {
      id: true,
      title: true,
      status: true,
      kind: true,
      validUntil: true,
      createdAt: true,
      dataJson: true,
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <ProposalsListClient
      proposals={proposals.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        validUntil: p.validUntil?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        corretor: p.user?.name ?? null,
        resumo: summarize(p.dataJson),
      }))}
      tipo={tipo}
      showTabs={vendasOn && locacaoOn}
    />
  );
}

// Resumo leve pra tabela (imóvel + valor) sem expor o dataJson inteiro.
function summarize(dataJson: unknown): { imovel: string | null; valor: number | null } {
  const d = (dataJson ?? {}) as Record<string, unknown>;
  const imoveis = d.imoveis as Array<{ endereco?: string; numero?: string }> | undefined;
  const im = imoveis?.[0];
  const imovel = im?.endereco
    ? `${im.endereco}${im.numero ? `, ${im.numero}` : ""}`
    : null;
  const pag = d.pagamento as { valor_total?: number } | undefined;
  const loc = d.locacao as { valor_aluguel?: number } | undefined;
  const valor = pag?.valor_total ?? loc?.valor_aluguel ?? null;
  return { imovel, valor: typeof valor === "number" ? valor : null };
}
