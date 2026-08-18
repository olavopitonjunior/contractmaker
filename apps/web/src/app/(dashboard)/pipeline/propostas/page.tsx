import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requireAnyFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import {
  getEffectivePermissions,
  proposalScopeWhere,
  can,
} from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ProposalsListClient } from "@/components/proposals/ProposalsListClient";
import { ProposalsNoAccess } from "@/components/proposals/ProposalsNoAccess";
import { statusesForFilter } from "@/lib/proposals/list-filters";
import {
  OPEN_STATUSES,
  EXPIRABLE_STATUSES,
  CONVERSION_KPI_STATUSES,
} from "@/lib/proposals/status-sets";
import { responsibleDisplay } from "@/lib/proposals/status-view";
import { proposalDeadline } from "@/lib/proposals/deadline";
import { summarizeProposalData } from "@/lib/proposals/summarize";
import { formatDayMonthBR } from "@/lib/format/datetime";

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
  // Sem escopo = papel sem NENHUMA visão de proposta (inclui role fora do
  // catálogo, que resolve pra zero permissões). Mostrar o porquê em vez do
  // redirect silencioso que parecia "a página não abre".
  if (!scope || !eff) return <ProposalsNoAccess />;

  const q = searchParams.q?.trim() || undefined;
  const qLower = q?.toLowerCase();
  const statusList = statusesForFilter(searchParams.status);
  const responsibleUserId = searchParams.responsibleUserId || undefined;

  // Busca `q`: proponente e imóvel vivem no dataJson (JSON), onde o `contains` do
  // Prisma não alcança. Antes o filtro rodava em memória DEPOIS de `take: 200`, então
  // só buscava nas 200 mais recentes (matches mais antigos sumiam silenciosamente).
  // Agora resolvemos os IDs no banco (título + dataJson::text) e hidratamos por id —
  // o escopo (orgId/corretor) é re-aplicado no findMany. Fallback pro modo antigo se
  // o raw falhar (nunca quebra a listagem).
  let searchIdFilter: { id: { in: string[] } } | undefined;
  let searchRawFailed = false;
  if (qLower) {
    try {
      // Escapa os curingas do LIKE (\ % _) — senão "AP_02"/"50%" viravam padrão
      // curinga e casavam demais. O ESCAPE '\' no SQL abaixo casa com este escape.
      const escaped = qLower.replace(/[\\%_]/g, (c) => `\\${c}`);
      const like = `%${escaped}%`;
      const kindVal = tipo === "venda" ? "venda" : "locacao";
      // TODOS os filtros do escopo entram no raw (não só orgId): senão o LIMIT 500
      // pegava os 500 mais recentes DA ORG e, ao re-aplicar o escopo do corretor
      // (VIEW_OWN) na hidratação, um match ANTIGO dele podia cair fora. Aplicando
      // aqui, o teto vale sobre o conjunto que ele realmente vê.
      const conds: Prisma.Sql[] = [
        Prisma.sql`"orgId" = ${orgId}`,
        Prisma.sql`"kind" = ${kindVal}`,
        Prisma.sql`lower("title" || ' ' || COALESCE("dataJson"::text, '')) LIKE ${like} ESCAPE '\\'`,
      ];
      if (!can(eff, PERMISSION.PROPOSAL_VIEW_ALL)) {
        conds.push(Prisma.sql`("userId" = ${userId} OR "responsibleUserId" = ${userId})`);
      }
      if (statusList) conds.push(Prisma.sql`"status" = ANY(${statusList})`);
      if (responsibleUserId) conds.push(Prisma.sql`"responsibleUserId" = ${responsibleUserId}`);
      const matched = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "Proposal" WHERE ${Prisma.join(
          conds,
          " AND "
        )} ORDER BY "createdAt" DESC LIMIT 500`
      );
      searchIdFilter = { id: { in: matched.map((m) => m.id) } };
    } catch {
      searchRawFailed = true; // cai no post-filter em memória abaixo
    }
  }

  const [proposals, memberRows] = await Promise.all([
    prisma.proposal.findMany({
      where: {
        ...scope,
        kind: tipo === "venda" ? "venda" : "locacao",
        ...(statusList ? { status: { in: statusList } } : {}),
        ...(responsibleUserId ? { responsibleUserId } : {}),
        ...(searchIdFilter ?? {}),
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
      // Busca resolvida no banco → hidrata os ≤500 ids casados. Sem busca → 200 recentes.
      take: searchIdFilter ? 500 : 200,
    }),
    prisma.orgMembership.findMany({
      where: { orgId },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  // KPIs = totais da ORG (escopo + tipo), independentes dos filtros de busca/status
  // da tabela — senão filtrar pra "Concluídas" zerava "Em aberto"/"Expirando", e o
  // take:200 subcontava. "Assinadas/Convertidas" conta `completa` também: assinada
  // por todos JÁ é conversão, mesmo antes do clique "Converter em negócio".
  // "Expirando" = validUntil em ≤2 dias (inclui vencida) SÓ nos statuses que o
  // cron realmente expira — parciais assinados não expiram (nem aqui nem lá).
  const kpiWhere = { ...scope, kind: tipo === "venda" ? "venda" : "locacao" };
  const expiringCutoff = new Date(Date.now() + 2 * 86_400_000);
  const openList = [...OPEN_STATUSES];
  const [openCount, convertedCount, expiringCount] = await Promise.all([
    prisma.proposal.count({ where: { ...kpiWhere, status: { in: openList } } }),
    prisma.proposal.count({
      where: { ...kpiWhere, status: { in: [...CONVERSION_KPI_STATUSES] } },
    }),
    prisma.proposal.count({
      where: {
        ...kpiWhere,
        status: { in: [...EXPIRABLE_STATUSES] },
        validUntil: { not: null, lte: expiringCutoff },
      },
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

  const rows = proposals
    .map((p) => {
      const resp = responsibleDisplay({
        responsibleName: p.responsibleName,
        responsibleUser: p.responsibleUser,
        user: p.user,
      });
      // Datas, prazo e valor saem formatados do servidor — o client component não
      // pode usar `toLocale*` (padrão de locale difere entre o ICU do Node e o do
      // browser) nem `Date.now()` no render (muda entre SSR e hidratação). Os dois
      // dão hydration mismatch (React #418/#423). Ver lib/format/datetime.ts.
      const prazo = proposalDeadline(p.validUntil, p.status);
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        kind: p.kind,
        instrument: p.instrument,
        createdAtLabel: formatDayMonthBR(p.createdAt),
        sentAtLabel: formatDayMonthBR(p.sentAt, ""),
        firstViewedAtLabel: formatDayMonthBR(p.firstViewedAt, ""),
        prazo: { label: prazo.shortLabel, tone: prazo.tone },
        convertedDealId: p.convertedDealId,
        responsible: resp,
        resumo: summarizeProposalData(p.dataJson),
      };
    })
    .filter((r) => {
      // Busca já resolvida no banco (searchIdFilter). O post-filter em memória só
      // roda no FALLBACK (raw falhou) — aí sobre as 200 recentes, como antes.
      if (!qLower || !searchRawFailed) return true;
      const hay = [r.title, r.resumo.imovel, r.resumo.proponente]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(qLower);
    });

  return (
    <ProposalsListClient
      proposals={rows}
      kpis={{ open: openCount, converted: convertedCount, expiring: expiringCount }}
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
