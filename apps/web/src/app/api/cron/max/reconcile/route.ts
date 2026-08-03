import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { syncMaxForOrg, MAX_AGENT_KEY } from "@/lib/max/provisioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/cron/max/reconcile";

/**
 * Máximo de tentativas antes de parar de insistir.
 *
 * Depois disso a linha continua visível no painel com o `lastError`, mas o cron
 * não a repica: entrega que falhou 8 vezes seguidas quase nunca é transitória —
 * é segredo divergente, URL errada ou serviço desligado —, e insistir só gera
 * ruído sem trazer informação nova. Reprovisionar pelo painel zera a contagem.
 */
const MAX_TENTATIVAS = 8;

/** Teto por execução: reconciliação é conserto, não um caminho de escala. */
const LOTE = 20;

/**
 * GET /api/cron/max/reconcile
 *
 * Reenvia às orgs cujo provisionamento do Max ficou pela metade.
 *
 * O buraco que isto fecha: se o serviço do Max estiver fora do ar no instante
 * em que alguém liga a feature no painel, o token é emitido e não chega do
 * outro lado. Sem reconciliação, esse estado é permanente e silencioso — o
 * flag fica verde, `/admin/max` mostra a org como roteada, e o agente não
 * responde. Ninguém tem motivo para clicar de novo, porque a tela não indica
 * que algo falhou.
 *
 * Reusa `syncMaxForOrg` em vez de reimplementar o reenvio: a decisão de "ligado
 * é os dois módulos, desligado revoga" mora lá, e uma segunda cópia divergiria
 * na primeira mudança de regra. O efeito colateral é desejado — se a feature
 * foi desligada nesse meio-tempo, o ciclo revoga em vez de reenviar.
 *
 * Schedule: de hora em hora — vercel.json.
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging(PATH))) {
    return NextResponse.json({ skipped: "staging-disabled", path: PATH });
  }

  const pendentes = await prisma.agentProvisioning.findMany({
    where: {
      agentKey: MAX_AGENT_KEY,
      status: { in: ["pending_delivery", "failed"] },
      attempts: { lt: MAX_TENTATIVAS },
    },
    select: { orgId: true, status: true, attempts: true },
    // Mais antigas primeiro: sem isso, uma org que falha sempre monopoliza o
    // lote e as outras nunca chegam a ser tentadas.
    orderBy: { updatedAt: "asc" },
    take: LOTE,
  });

  const resultados: Array<{
    orgId: string;
    antes: string;
    resultado: string;
    detail?: string;
  }> = [];

  for (const p of pendentes) {
    try {
      const r = await syncMaxForOrg(p.orgId);
      resultados.push({
        orgId: p.orgId,
        antes: p.status,
        resultado:
          r.action === "provisioned"
            ? r.delivered
              ? "entregue"
              : "ainda_falhando"
            : r.action,
        detail: r.action === "provisioned" ? r.detail : undefined,
      });
    } catch (err) {
      // Uma org quebrada não pode impedir as outras de serem reconciliadas.
      resultados.push({
        orgId: p.orgId,
        antes: p.status,
        resultado: "erro",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const entregues = resultados.filter((r) => r.resultado === "entregue").length;

  // `esgotadas` é reportado separado porque é o número que pede ação humana:
  // são orgs que o cron parou de tentar e que ninguém mais vai consertar
  // sozinho.
  const esgotadas = await prisma.agentProvisioning.count({
    where: {
      agentKey: MAX_AGENT_KEY,
      status: { in: ["pending_delivery", "failed"] },
      attempts: { gte: MAX_TENTATIVAS },
    },
  });

  return NextResponse.json({
    ok: true,
    tentadas: pendentes.length,
    entregues,
    esgotadas,
    resultados,
  });
}
