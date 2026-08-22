import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { limiteSuperior } from "@/lib/ai/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RecentEnvelope {
  id: string;
  name: string;
  status: string;
  sentAt: string | null;
  closedAt: string | null;
  contractId: string | null;
  attachmentId: string | null;
  source: string;
  // Null em envelope de proposta — ela vive fora do kanban e só ganha deal na
  // conversão.
  dealId: string | null;
  signerCount: number;
}

interface RecentEvent {
  id: string;
  eventName: string;
  receivedAt: string;
  envelopeId: string;
  source: string;
}

interface MetricsResponse {
  range: { from: string; to: string };
  /**
   * Consumo do plano ClickSign no mês corrente: envelopes ativados
   * (running/closed/canceled) + termos de Aceite WhatsApp, que não criam
   * Envelope. Independe do range do filtro. Substituiu "gasto vs orçamento" —
   * aqueles dois valores saíam de uma tabela de preços estimada no código, não
   * do que a ClickSign cobra. Como não há mais teto, este é o único sinal de
   * uso do plano dentro do app: subestimar aqui é pior que não mostrar.
   */
  envelopesMonth: number;
  totalEnvelopes: number;
  byStatus: Record<string, number>;
  closeRate: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  recentEnvelopes: RecentEnvelope[];
  recentEvents: RecentEvent[];
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length)
  );
  return sorted[idx];
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  // Mesmo helper do /api/ai-usage: data pura significa o DIA INTEIRO. Sem
  // isto, este painel também nunca mostrava o dia corrente — o cliente manda
  // `YYYY-MM-DD` e o `lte` cortava em meia-noite.
  const to = limiteSuperior(searchParams.get("to"));
  /**
   * Default de 30 dias medido do INÍCIO do dia do `to`, não do fim dele.
   *
   * Com o `to` valendo 23:59:59.999, subtrair 30 dias dali começaria a janela
   * às 23:59 de 30 dias atrás — cortando quase todo o primeiro dia. Não afeta
   * o painel (ele sempre manda `from`), mas afeta qualquer outro consumidor
   * do default documentado na rota.
   */
  const from = searchParams.get("from")
    ? new Date(searchParams.get("from")!)
    : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - 30 * 24 * 60 * 60 * 1000);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const where = {
    orgId: org.id,
    createdAt: { gte: from, lte: to },
  };

  // Início do mês corrente — o card "Envelopes no mês" é independente do
  // range escolhido no filtro (que move `from`/`to`).
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [envelopes, recentEvents, envelopesMonth, aceitesMonth] = await Promise.all([
    prisma.envelope.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { signers: true } },
      },
      take: 200,
    }),
    prisma.envelopeEvent.findMany({
      where: { envelope: { orgId: org.id } },
      orderBy: { receivedAt: "desc" },
      take: 30,
    }),
    // Consumo do plano no mês. `canceled` ENTRA: o envelope já foi ativado na
    // ClickSign antes de ser cancelado, ou seja, já foi consumido. Só `draft` e
    // `failed` ficam de fora (nunca chegaram a existir lá).
    prisma.envelope.count({
      where: {
        orgId: org.id,
        sentAt: { gte: startOfMonth },
        status: { in: ["running", "closed", "canceled"] },
      },
    }),
    // Aceite via WhatsApp não cria Envelope — vive só na Proposal. O antigo
    // getMonthlySpendCents somava isto de propósito; sem somar aqui, o card
    // subestima o consumo, e ele é agora o ÚNICO sinal de uso do plano dentro
    // do app (não há mais teto que avise).
    prisma.proposal.count({
      where: {
        orgId: org.id,
        instrument: "aceite",
        sentAt: { gte: startOfMonth },
      },
    }),
  ]);
  const consumoMes = envelopesMonth + aceitesMonth;

  const byStatus: Record<string, number> = {};
  const latencies: number[] = [];
  for (const env of envelopes) {
    byStatus[env.status] = (byStatus[env.status] ?? 0) + 1;
    if (env.sentAt && env.closedAt) {
      latencies.push(env.closedAt.getTime() - env.sentAt.getTime());
    }
  }
  const closed = byStatus.closed ?? 0;
  const denominator =
    (byStatus.closed ?? 0) +
    (byStatus.canceled ?? 0) +
    (byStatus.running ?? 0) +
    (byStatus.failed ?? 0);
  const closeRate = denominator > 0 ? closed / denominator : 0;

  const recentEnvelopes: RecentEnvelope[] = envelopes.slice(0, 50).map((e) => ({
    id: e.id,
    name: e.name,
    status: e.status,
    sentAt: e.sentAt ? e.sentAt.toISOString() : null,
    closedAt: e.closedAt ? e.closedAt.toISOString() : null,
    contractId: e.contractId,
    attachmentId: e.attachmentId,
    source: e.source,
    dealId: e.dealId,
    signerCount: e._count.signers,
  }));

  const recentEventsOut: RecentEvent[] = recentEvents.map((ev) => ({
    id: ev.id,
    eventName: ev.eventName,
    receivedAt: ev.receivedAt.toISOString(),
    envelopeId: ev.envelopeId,
    source: ev.source,
  }));

  const body: MetricsResponse = {
    range: { from: from.toISOString(), to: to.toISOString() },
    envelopesMonth: consumoMes,
    totalEnvelopes: envelopes.length,
    byStatus,
    closeRate,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    recentEnvelopes,
    recentEvents: recentEventsOut,
  };

  return NextResponse.json(body);
}
