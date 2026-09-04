import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import {
  applyAcceptedProposals,
  DocChangedError,
  proposePlaceholdersWithAI,
} from "@/lib/templates/ai-placeholder-insertion";
import { getDocPlainText } from "@/lib/google/docs";
import { auditTemplateText, readDraftReport } from "@/lib/templates/pii-gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
// 300s: o passe de IA lê até 120k chars e pode gerar 8192 tokens numa chamada
// não-stream, e ainda relê o Doc depois — 120s era apertado no pior caso.
export const maxDuration = 300;

/**
 * O que a rota aceita. Sem corpo (ou corpo vazio) = `propose`: o disparo que
 * escrevia direto no Doc deixa de existir DE PROPÓSITO — um cliente antigo
 * que chame sem corpo recebe propostas, não uma edição.
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose") }),
  z.object({
    action: z.literal("apply"),
    accepted: z
      .array(
        z.object({
          token: z.string().trim().min(1),
          trecho: z.string().min(1),
        })
      )
      .min(1)
      .max(200),
    /**
     * OBRIGATÓRIO na rota: é o que garante "ou entra tudo sobre o texto
     * proposto, ou nada". O módulo aceita chamador sem hash (scripts), a API
     * não — um cliente que omitisse o campo desligaria a recusa em bloco sem
     * ninguém notar.
     */
    docTextHash: z.string().min(1),
  }),
]);

/** owner/admin da org (impersonation-aware). */
async function requireOwnerAdmin(userId: string, orgId: string) {
  const effUserId = await getEffectiveUserId(userId);
  const m = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  return !!m && ["owner", "admin"].includes(m.role);
}

/**
 * POST /api/templates/[id]/rerun-ai — "Pedir revisão pela IA", em dois tempos.
 *
 * `action: "propose"` — a IA lê o Doc e PROPÕE trechos → chaves, já passados
 * pelas travas determinísticas, e devolve cada proposta com o parágrafo antes
 * e depois. Nada é escrito no Doc. Os trechos vão crus na resposta (quem
 * revisa é owner/admin e precisa ler a cláusula); no banco fica só a contagem.
 *
 * `action: "apply"` — aplica as propostas que o operador marcou. O servidor
 * REPLANEJA sobre o texto atual com todas as travas (trecho que virou ambíguo
 * é pulado, nunca escrito errado) e recusa inteiro se o Doc mudou desde a
 * proposta (`409 DOC_CHANGED`).
 *
 * Até 2026-09-04 esta rota aplicava direto, e num dos dois usos em produção
 * colapsou um parágrafo inteiro numa chave.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!(await requireOwnerAdmin(session.user.id, org.id))) {
    return NextResponse.json({ error: "Apenas owner/admin." }, { status: 403 });
  }

  // Corpo ausente/vazio → propose. Corpo presente e inválido → 400 legível.
  const rawBody: unknown = await req.json().catch(() => null);
  const semCorpo =
    rawBody === null ||
    rawBody === undefined ||
    (typeof rawBody === "object" && Object.keys(rawBody as object).length === 0);
  const parsed = semCorpo ? Body.safeParse({ action: "propose" }) : Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Corpo inválido: use {action:'propose'} ou {action:'apply', accepted:[{token,trecho}], docTextHash} (1 a 200 propostas; o hash da proposta é obrigatório).",
      },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId: org.id },
    select: { googleTemplateDocId: true, modalidade: true, engine: true, draftReport: true, status: true },
  });
  if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    return NextResponse.json(
      { error: "A revisão por IA só vale para modelos importados (Google Docs)." },
      { status: 400 }
    );
  }
  // Modelo ativo é imutável (mesma regra do doc-edit): propor é leitura e pode;
  // aplicar é escrita e não pode.
  if (body.action === "apply" && template.status === "active") {
    return NextResponse.json(
      {
        error: "Modelo ativo não pode ser editado. Volte-o para rascunho primeiro.",
        code: "TEMPLATE_ACTIVE",
      },
      { status: 409 }
    );
  }

  const modalidade = template.modalidade ?? "a_vista";

  if (body.action === "propose") {
    try {
      const result = await proposePlaceholdersWithAI({
        docId: template.googleTemplateDocId,
        modalidade,
        orgId: org.id,
      });
      // Persistido: só o que não é texto de contrato. As propostas em si vivem
      // na resposta — e morrem com ela; o Doc é a fonte.
      const prev = readDraftReport(template.draftReport);
      await prisma.contractTemplate.update({
        where: { id: params.id },
        data: {
          draftReport: {
            ...prev,
            lastProposal: {
              count: result.proposals.length,
              withWarnings: result.proposals.filter((p) => p.warnings.length > 0).length,
              skipped: result.skipped,
              docTruncated: result.docTruncated,
              responseTruncated: result.responseTruncated,
              responseUnparsed: result.responseUnparsed,
              ranAt: result.ranAt,
            },
          } as object,
        },
      });
      return NextResponse.json({ proposal: result });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Falha na revisão por IA." },
        { status: 502 }
      );
    }
  }

  // action === "apply"
  try {
    const report = await applyAcceptedProposals({
      docId: template.googleTemplateDocId,
      modalidade,
      accepted: body.accepted,
      docTextHash: body.docTextHash,
    });

    // DEPOIS da escrita, com o ator efetivo (impersonação). Sem trecho cru: o
    // relatório já vem mascarado, e o log guarda chaves + motivos.
    const effUserId = await getEffectiveUserId(session.user.id);
    await audit(extractAuditContextFromRequest(req, org.id, effUserId), {
      action: "TEMPLATE_AI_PROPOSALS_APPLIED",
      result: report.inserted.length > 0 ? "SUCCESS" : "FAILURE",
      resource: params.id,
      resourceType: "ContractTemplate",
      metadata: {
        accepted: body.accepted.length,
        inserted: report.inserted.map((i) => i.token),
        skipped: report.skippedAmbiguous.map((s) => ({ token: s.token, reason: s.reason })),
        docTextHash: body.docTextHash,
      },
    });

    // Uma nova passada NÃO apaga o que a ingestão mediu (slots, neutralização):
    // merge raso sobre o relatório anterior. PII é re-auditada no texto que
    // acabou de ficar; se a releitura falhar, o relatório antigo NÃO é
    // re-carimbado — o campo sai e o gate da ativação mede de novo.
    const next: Record<string, unknown> = {
      ...readDraftReport(template.draftReport),
      ...(report as object),
    };
    delete next.lastProposal;
    try {
      const text = await getDocPlainText(template.googleTemplateDocId);
      if (text) next.pii = auditTemplateText(text);
      else delete next.pii;
    } catch (err) {
      console.error("[templates/rerun-ai] não consegui reler o doc pra auditar PII:", err);
      delete next.pii;
    }
    await prisma.contractTemplate.update({
      where: { id: params.id },
      data: { draftReport: next as object },
    });
    return NextResponse.json({ report: next });
  } catch (err) {
    if (err instanceof DocChangedError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao aplicar as propostas." },
      { status: 502 }
    );
  }
}
