import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { classifyOneClause } from "@/lib/clauses/classifier-llm";
import type { ClauseSnapshot, ClauseClassificationProposal } from "@/lib/clauses/classify";
import { getOrgAiBudgetStatus } from "@/lib/ai/budget";
import { detectPii } from "@/lib/ingestion/pii";
import { visibleEsteiras } from "@/lib/clauses/taxonomy";
import { logError } from "@/lib/observability/log";

// Handlebars (via catálogo de chaves) e Anthropic rodam em node.
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/clauses/classify — PROPÕE a classificação de cláusulas já gravadas.
 *
 * **Não persiste nada.** Devolve propostas com valor atual × proposto para a
 * tela de revisão; aplicar é o `/classify/apply`, que revalida tudo de novo.
 *
 * Por que síncrono e sem `IngestionRun`: o texto já está no banco, é uma
 * chamada Haiku curta por cláusula, o teto é 25 e a concorrência é 4 — cabe
 * folgado no `maxDuration`. Persistir estado custaria migration + máquina de
 * estados + tela de retomada para proteger uma proposta que custa centavos e é
 * trivial de refazer. Se o teto precisar passar de ~40, aí sim vale o run.
 */
const MAX_BATCH = 25;
const CONCURRENCY = 4;

const bodySchema = z.object({
  clauseIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH),
  // OPCIONAL de propósito. Ausente = comportamento de antes: nenhum recorte.
  // A tela passa a informá-la para que um lote disparado numa esteira não leve
  // junto cláusula da outra (issue #479) — a limpeza de seleção conserta a
  // tela, isto fecha o mesmo furo para quem chama a rota direto.
  esteira: z.enum(["venda", "locacao"]).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          raw?.clauseIds?.length > MAX_BATCH
            ? `Selecione no máximo ${MAX_BATCH} cláusulas por vez.`
            : "Body inválido",
        details: parsed.error.format(),
      },
      { status: 422 }
    );
  }

  const budget = await getOrgAiBudgetStatus(org.id, { skipSpendWhenNoCap: true });
  if (budget.budgetUsd != null && budget.budgetUsd > 0 && budget.spentUsd >= budget.budgetUsd) {
    return NextResponse.json(
      { error: "Orçamento mensal de IA da organização esgotado." },
      { status: 429 }
    );
  }

  // `orgId: org.id` (nunca null): cláusula de PLATAFORMA não é do tenant e não
  // pode ser reclassificada por ele — a escrita nem passaria no escopo.
  const rows = await prisma.knowledgeItem.findMany({
    where: {
      id: { in: parsed.data.clauseIds },
      orgId: org.id,
      category: "clause",
    },
    select: {
      id: true,
      title: true,
      content: true,
      tags: true,
      source: true,
      esteira: true,
      groupCode: true,
      subcategory: true,
      agentNotes: true,
      isVariable: true,
      _count: { select: { contractClauses: true } },
    },
  });

  if (rows.length === 0) {
    return NextResponse.json({ error: "Nenhuma cláusula elegível." }, { status: 404 });
  }

  // Recorte por esteira, espelhando o que a TELA mostra
  // (`ClausesPageClient.visiveis`): a própria, `ambas`, e a SEM esteira — esta
  // aparece nas duas abas, no balde de triagem, e descartá-la aqui tiraria do
  // usuário a única ação que a remove de lá.
  //
  // Filtra DEPOIS do findMany, não dentro do `where`, de propósito: assim
  // `ignored` distingue "está em outra esteira" de "não existe / é de
  // plataforma", que o `where` misturaria num sumiço mudo. O `orgId` — a
  // fronteira que de fato protege — continua no `where`.
  const visiveis = parsed.data.esteira
    ? (visibleEsteiras(parsed.data.esteira) as string[])
    : null;
  const naEsteira = (e: string | null) =>
    visiveis === null || e === null || visiveis.includes(e);

  const elegiveis = rows.filter((r) => naEsteira(r.esteira));
  const ignored = rows.filter((r) => !naEsteira(r.esteira)).map((r) => r.id);

  // Sem novo status code: lote inteiro fora da esteira volta 200 com
  // `proposals: []`. O 404 acima continua significando só "nada existe na org",
  // que é o que ele sempre significou — transformar descarte em erro de lote
  // mudaria mais comportamento do que o bug corrige.
  const snapshots: ClauseSnapshot[] = elegiveis.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    tags: r.tags,
    source: r.source,
    esteira: r.esteira,
    groupCode: r.groupCode,
    subcategory: r.subcategory,
    agentNotes: r.agentNotes,
    isVariable: r.isVariable,
    linkedContracts: r._count.contractClauses,
  }));

  const proposals: ClauseClassificationProposal[] = [];
  const failures: Array<{ clauseId: string; error: string }> = [];
  const unchanged: string[] = [];

  // Concorrência limitada: uma falha isolada não derruba o lote.
  for (let i = 0; i < snapshots.length; i += CONCURRENCY) {
    const slice = snapshots.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map((clause) =>
        classifyOneClause({
          clause,
          orgId: org.id,
          userId: session.user!.id,
          detectPii: (text) => detectPii(text).map((f) => f.excerpt),
        })
      )
    );
    settled.forEach((res, idx) => {
      const clause = slice[idx];
      if (res.status === "rejected") {
        const message =
          res.reason instanceof Error ? res.reason.message : String(res.reason);
        logError("clauses/classify", res.reason, { clauseId: clause.id });
        failures.push({ clauseId: clause.id, error: message });
        return;
      }
      if (res.value.proposal) proposals.push(res.value.proposal);
      else unchanged.push(clause.id);
    });
  }

  // `ignored` é ADITIVO — nenhum consumidor existente quebra por ele existir.
  return NextResponse.json({ proposals, failures, unchanged, ignored });
}
