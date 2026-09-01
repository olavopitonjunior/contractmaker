import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { updateKnowledgeItem } from "@/lib/ai/knowledge";
import { areTagsFrozen } from "@/lib/clauses/tag-vocabulary";
import { deriveIsVariable, CLAUSE_ESTEIRA_VALUES } from "@/lib/clauses/schema";
import { assertRendered, extractHandlebarsPaths, validateKey } from "@/lib/clauses/key-catalog";
import { esteiraForModalidade } from "@/lib/clauses/taxonomy";
import type { FormModule } from "@/lib/forms/presets";
import { logError } from "@/lib/observability/log";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/clauses/classify/apply — aplica as alterações APROVADAS pelo revisor.
 *
 * ## Fail-closed
 *
 * Só entra o que vier marcado `true` em `approve`. Campo ausente é campo NÃO
 * aprovado — nunca "aplica tudo o que veio junto".
 *
 * ## O payload do client não é fonte de verdade
 *
 * A tela pode ter sido montada com uma proposta velha (outra aba já aplicou),
 * ou adulterada. Então aqui, do zero: relê a cláusula, refaz o congelamento de
 * tags a partir do `source` do BANCO, revalida cada chave do conteúdo final
 * contra o catálogo e confirma que ele compila. Só então grava.
 *
 * Escreve por `updateKnowledgeItem`, que já re-embeda (e re-chunka) quando
 * `content`/`title` mudam — `prisma.update` direto é o caminho que perde o
 * embedding e deixa a cláusula invisível pro RAG.
 */
const itemSchema = z.object({
  clauseId: z.string().min(1),
  approve: z
    .object({
      esteira: z.boolean().optional(),
      groupCode: z.boolean().optional(),
      subcategory: z.boolean().optional(),
      tags: z.boolean().optional(),
      agentNotes: z.boolean().optional(),
      content: z.boolean().optional(),
    })
    .default({}),
  values: z.object({
    esteira: z.enum(CLAUSE_ESTEIRA_VALUES).nullable().optional(),
    groupCode: z.string().nullable().optional(),
    subcategory: z.string().nullable().optional(),
    tags: z.array(z.string()).max(20).optional(),
    agentNotes: z.string().nullable().optional(),
    content: z.string().max(50_000).optional(),
  }),
});

const bodySchema = z.object({ items: z.array(itemSchema).min(1).max(25) });

type SkipReason =
  | "nao_encontrada"
  | "tags_congeladas"
  | "chave_invalida"
  | "render_falhou"
  | "sem_alteracao";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const applied: string[] = [];
  const skipped: Array<{ clauseId: string; reason: SkipReason }> = [];
  let reembedded = 0;

  for (const item of parsed.data.items) {
    const current = await prisma.knowledgeItem.findFirst({
      where: { id: item.clauseId, orgId: org.id, category: "clause" },
    });
    if (!current) {
      skipped.push({ clauseId: item.clauseId, reason: "nao_encontrada" });
      continue;
    }

    const patch: Record<string, unknown> = {};
    const { approve, values } = item;

    if (approve.esteira && values.esteira !== undefined) {
      patch.esteira = values.esteira;
    }

    // Esteira FINAL — decide se groupCode pode existir e contra qual catálogo
    // a chave é validada.
    const finalEsteira = (patch.esteira ?? current.esteira) as string | null;

    if (approve.groupCode && values.groupCode !== undefined) {
      // G1..G6 só existe em venda. Fora dela, o valor é sempre limpo — mesmo
      // que o client tenha mandado outra coisa.
      patch.groupCode = finalEsteira === "venda" ? values.groupCode : null;
    } else if (patch.esteira !== undefined && finalEsteira !== "venda" && current.groupCode) {
      // Mudou para locação/ambas com um grupo antigo pendurado: limpa junto,
      // senão a cláusula fica com um grupo que a UI da esteira nem exibe.
      patch.groupCode = null;
    }

    if (approve.subcategory && values.subcategory !== undefined) {
      patch.subcategory = values.subcategory;
    }
    if (approve.agentNotes && values.agentNotes !== undefined) {
      patch.agentNotes = values.agentNotes;
    }

    if (approve.tags && values.tags) {
      // Congelamento relido do BANCO, não do que o client afirmou.
      if (areTagsFrozen({ source: current.source, tags: current.tags })) {
        skipped.push({ clauseId: item.clauseId, reason: "tags_congeladas" });
        continue;
      }
      patch.tags = values.tags;
    }

    let contentChanged = false;
    if (approve.content && typeof values.content === "string") {
      const esteiras: FormModule[] =
        finalEsteira === "venda"
          ? ["venda"]
          : finalEsteira === "locacao"
            ? ["locacao"]
            : finalEsteira === "ambas"
              ? ["venda", "locacao"]
              : [];

      if (esteiras.length === 0) {
        // Sem esteira não há catálogo — não se grava texto tokenizado no escuro.
        skipped.push({ clauseId: item.clauseId, reason: "chave_invalida" });
        continue;
      }

      // Revalida TODA chave do conteúdo final (não só as que o client disse ter
      // mexido) contra o catálogo da esteira.
      const invalid = extractHandlebarsPaths(values.content).filter((path) =>
        esteiras.every((e) => validateKey(path, e) === "rejeitada")
      );
      if (invalid.length > 0) {
        skipped.push({ clauseId: item.clauseId, reason: "chave_invalida" });
        continue;
      }

      const renderFail = esteiras
        .map((e) => assertRendered(values.content!, e))
        .find((r) => !r.ok);
      if (renderFail && !renderFail.ok) {
        skipped.push({ clauseId: item.clauseId, reason: "render_falhou" });
        continue;
      }

      patch.content = values.content;
      contentChanged = values.content !== current.content;
    }

    if (Object.keys(patch).length === 0) {
      skipped.push({ clauseId: item.clauseId, reason: "sem_alteracao" });
      continue;
    }

    // Derivado do conteúdo final, sempre.
    patch.isVariable = deriveIsVariable(
      (patch.content as string | undefined) ?? current.content
    );

    try {
      await updateKnowledgeItem(item.clauseId, org.id, patch);
      applied.push(item.clauseId);
      if (contentChanged) reembedded += 1;
    } catch (err) {
      logError("clauses/classify/apply", err, { clauseId: item.clauseId });
      skipped.push({ clauseId: item.clauseId, reason: "nao_encontrada" });
    }
  }

  return NextResponse.json({ applied, skipped, reembedded });
}

/** Reexport só para o teste conseguir importar o mapa de motivos. */
export type { SkipReason };
