import { prisma } from "@/lib/db/prisma";
import { requireAnyFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import {
  getEffectivePermissions,
  proposalScopeWhere,
  can,
} from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { redirect } from "next/navigation";
import { ProposalsListClient } from "@/components/proposals/ProposalsListClient";
import { statusesForFilter } from "@/lib/proposals/list-filters";
import { responsibleDisplay } from "@/lib/proposals/status-view";

export const dynamic = "force-dynamic";

export default async function PropostasPage({
  searchParams,
}: {
  searchParams: {
    tipo?: string;
    q?: string;
    status?: string;
    responsibleUserId?: string;
  };
}) {
  const { userId, orgId, enabled } = await requireAnyFeaturePage([
    FEATURE.VENDAS_PROPOSTAS,
    FEATURE.LOCACAO_PROPOSTAS,
  ]);

  const vendasOn = enabled[FEATURE.VENDAS_PROPOSTAS];
  const locacaoOn = enabled[FEATURE.LOCACAO_PROPOSTAS];
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
  if (!scope || !eff) redirect("/pipeline");

  const q = searchParams.q?.trim() || undefined;
  const statusList = statusesForFilter(searchParams.status);
  const responsibleUserId = searchParams.responsibleUserId || undefined;

  const [proposals, memberRows] = await Promise.all([
    prisma.proposal.findMany({
      where: {
        ...scope,
        kind: tipo === "venda" ? "venda" : "locacao",
        ...(statusList ? { status: { in: statusList } } : {}),
        ...(responsibleUserId ? { responsibleUserId } : {}),
        ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        kind: true,
        instrument: true,
        validUntil: true,
        createdAt: true,
        sentAt: true,
        firstViewedAt: true,
        lastReminderAt: true,
        convertedDealId: true,
        dataJson: true,
        user: { select: { name: true } },
        responsibleName: true,
        responsibleUser: { select: { id: true, name: true, image: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.orgMembership.findMany({
      where: { orgId },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const members = memberRows
    .map((m) => ({ id: m.user.id, name: m.user.name ?? "Sem nome" }))
    .filter((m) => m.id);

  const permissions = {
    send: can(eff, PERMISSION.PROPOSAL_SEND),
    convert: can(eff, PERMISSION.PROPOSAL_CONVERT),
    cancel: can(eff, PERMISSION.PROPOSAL_CANCEL),
    delete: can(eff, PERMISSION.PROPOSAL_DELETE),
    resend: can(eff, PERMISSION.PROPOSAL_RESEND),
    assign: can(eff, PERMISSION.PROPOSAL_ASSIGN),
  };

  return (
    <ProposalsListClient
      proposals={proposals.map((p) => {
        const resp = responsibleDisplay({
          responsibleName: p.responsibleName,
          responsibleUser: p.responsibleUser,
          user: p.user,
        });
        return {
          id: p.id,
          title: p.title,
          status: p.status,
          instrument: p.instrument,
          validUntil: p.validUntil?.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
          sentAt: p.sentAt?.toISOString() ?? null,
          firstViewedAt: p.firstViewedAt?.toISOString() ?? null,
          convertedDealId: p.convertedDealId,
          responsible: resp,
          resumo: summarize(p.dataJson),
        };
      })}
      tipo={tipo}
      showTabs={vendasOn && locacaoOn}
      members={members}
      permissions={permissions}
      filters={{
        q: searchParams.q ?? "",
        status: searchParams.status ?? "all",
        responsibleUserId: responsibleUserId ?? "",
      }}
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
