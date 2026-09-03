import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsConfigured } from "@/lib/google/client";
import { googleErrorMessage } from "@/lib/google/auth-error";
import { applyDocEdits, type DocEditOp } from "@/lib/templates/doc-edit";
import { validateGoogleDocTemplate } from "@/lib/templates/validate-gdoc";
import {
  persistableSemanticReport,
  type SemanticFix,
} from "@/lib/templates/semantic-checks";
import { maskForReport } from "@/lib/templates/insertion-report";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/templates/[id]/doc-edit — aplica correções cirúrgicas no Doc-modelo
 * e REVALIDA no mesmo passo.
 *
 * As checagens semânticas dizem o que está errado e propõem o conserto; esta
 * rota é onde ele acontece. Revalidar aqui não é conveniência: sem isso a tela
 * mostraria o estado ANTERIOR à edição, e o operador revalidaria à mão para
 * descobrir o que já aconteceu.
 *
 * Teto de 20 operações por chamada: é uma tela de conserto pontual, não um
 * caminho de migração em massa — e cada operação custa uma trava de unicidade
 * contra o texto simulado.
 */
const OpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("map-field"),
    phrase: z.string().min(2),
    token: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal("rekey"),
    phrase: z.string().min(2),
    fromToken: z.string().trim().min(1),
    toToken: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal("remove-leftover"),
    phrase: z.string().min(2),
    replacement: z.string().optional(),
  }),
  z.object({
    op: z.literal("restore-paragraph"),
    current: z.string().min(1),
    source: z.string().min(2),
  }),
]);

const Body = z
  .object({
    ops: z.array(OpSchema).min(1).max(20).optional(),
    /**
     * Aplica o conserto que as checagens semânticas propuseram para ESTE
     * achado, resolvido no servidor.
     *
     * A tela não tem como montar a operação sozinha: o relatório que ela recebe
     * guarda só o verbo do conserto (`{op}`), sem as frases — decisão do PR da
     * checagem semântica, para não trafegar trecho de contrato num payload que
     * nada consumia. Agora que existe consumidor, o caminho certo continua a
     * não ser mandar o texto para o navegador e de volta: o servidor recalcula
     * as checagens, acha o achado pelo id e usa a frase que ELE mesmo produziu.
     * De quebra, o cliente não pode pedir a edição de uma frase arbitrária por
     * este caminho.
     */
    findingId: z.string().min(1).optional(),
  })
  .refine((b) => !!b.ops?.length || !!b.findingId, {
    message: "Informe `ops` ou `findingId`.",
  });

async function requireOwnerAdmin(userId: string, orgId: string) {
  const effUserId = await getEffectiveUserId(userId);
  const m = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  return !!m && ["owner", "admin"].includes(m.role);
}

/**
 * Conserto proposto pelas checagens → operação de edição. `manual` (e ausência)
 * devolve `null`: há achado sem conserto automático — dado da própria
 * imobiliária fixo no modelo, citação de item inexistente — e inventar uma
 * edição para eles seria pior que a tela dizer "ajuste no documento".
 */
function opDoConserto(fix: SemanticFix | undefined): DocEditOp | null {
  if (!fix) return null;
  switch (fix.op) {
    case "rekey":
      return { op: "rekey", phrase: fix.phrase, fromToken: fix.fromToken, toToken: fix.toToken };
    case "remove-leftover":
      return { op: "remove-leftover", phrase: fix.phrase };
    case "restore-paragraph":
      return { op: "restore-paragraph", current: fix.current, source: fix.source };
    default:
      return null;
  }
}

/** O que vai para o AuditLog: verbo, chaves e frases MASCARADAS. */
function auditableOps(ops: readonly DocEditOp[]) {
  return ops.map((o) =>
    o.op === "restore-paragraph"
      ? { op: o.op, current: maskForReport(o.current), source: maskForReport(o.source).slice(0, 240) }
      : o.op === "rekey"
        ? { op: o.op, from: o.fromToken, to: o.toToken, phrase: maskForReport(o.phrase).slice(0, 240) }
        : o.op === "map-field"
          ? { op: o.op, token: o.token, phrase: maskForReport(o.phrase).slice(0, 240) }
          : { op: o.op, phrase: maskForReport(o.phrase).slice(0, 240) }
  );
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!(await requireOwnerAdmin(session.user.id, org.id))) {
    return NextResponse.json({ error: "Apenas owner/admin." }, { status: 403 });
  }
  if (!isGoogleDocsConfigured()) {
    return NextResponse.json(
      { error: "Integração Google Docs não está configurada." },
      { status: 503 }
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Corpo inválido: informe de 1 a 20 operações de edição válidas." },
      { status: 400 }
    );
  }
  const { ops, findingId } = parsed.data;

  // Escopo na QUERY: inexistente e de outro tenant devolvem o mesmo 404.
  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId: org.id },
  });
  if (!template) {
    return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  }
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    return NextResponse.json({ error: "Modelo não é Google Docs." }, { status: 400 });
  }
  // Modelo ativo é imutável: contrato já gerado a partir dele não pode ter o
  // texto do modelo mudando debaixo. Reabrir é decisão consciente (voltar a
  // rascunho), não efeito colateral de um conserto.
  if (template.status === "active") {
    return NextResponse.json(
      { error: "Modelo ativo não pode ser editado. Volte-o para rascunho primeiro.", code: "TEMPLATE_ACTIVE" },
      { status: 409 }
    );
  }

  try {
    // Com `findingId`, o conserto vem das checagens recalculadas AGORA: a frase
    // é a que o servidor produziu, contra o estado atual do Doc.
    let efetivas: DocEditOp[] = ops ?? [];
    if (findingId) {
      const atual = await validateGoogleDocTemplate({ template, orgId: org.id });
      const achado = atual.semantic.findings.find((f) => f.id === findingId);
      if (!achado) {
        return NextResponse.json(
          {
            error:
              "Este problema não aparece mais na revisão — o documento mudou desde a última verificação. Revalide e tente de novo.",
            code: "FINDING_STALE",
          },
          { status: 409 }
        );
      }
      const op = opDoConserto(achado.suggestedFix);
      if (!op) {
        return NextResponse.json(
          {
            error: "Este problema não tem correção automática: ajuste no documento e revalide.",
            code: "FINDING_MANUAL",
          },
          { status: 422 }
        );
      }
      efetivas = [op];
    }

    const result = await applyDocEdits({
      docId: template.googleTemplateDocId,
      modalidade: template.modalidade ?? "a_vista",
      ops: efetivas,
    });

    // DEPOIS da escrita, com o ator EFETIVO (impersonação) e IP/user-agent: o
    // log não pode afirmar uma edição que não aconteceu.
    const effUserId = await getEffectiveUserId(session.user.id);
    await audit(extractAuditContextFromRequest(req, org.id, effUserId), {
      action: "TEMPLATE_DOC_EDIT",
      result: result.results.some((r) => r.status === "applied") ? "SUCCESS" : "FAILURE",
      resource: params.id,
      resourceType: "ContractTemplate",
      metadata: {
        ops: auditableOps(efetivas),
        results: result.results.map((r) => ({ op: r.op, status: r.status, reason: r.reason })),
        ...(findingId ? { findingId } : {}),
      },
    });

    // Revalida com o Doc já editado. Falha aqui não desfaz a edição — o que
    // aconteceu, aconteceu; a tela recebe `validation: null` e o operador
    // revalida.
    let validation = null;
    try {
      const v = await validateGoogleDocTemplate({ template, orgId: org.id });
      validation = { ...v, semantic: persistableSemanticReport(v.semantic) };
    } catch (err) {
      console.error("[templates/doc-edit] revalidação falhou depois da edição:", err);
    }

    return NextResponse.json({
      ok: result.results.some((r) => r.status === "applied"),
      results: result.results,
      appliedAt: result.appliedAt,
      validation,
    });
  } catch (err) {
    console.error("[templates/doc-edit] Erro:", err);
    return NextResponse.json({ error: googleErrorMessage(err) }, { status: 502 });
  }
}
