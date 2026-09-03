import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { googleErrorMessage } from "@/lib/google/auth-error";
import { applyDocEdits, type DocEditReason } from "@/lib/templates/doc-edit";
import { maskForReport } from "@/lib/templates/insertion-report";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  token: z.string().trim().min(1),
  phrase: z.string().min(2),
});

async function requireOwnerAdmin(userId: string, orgId: string) {
  const effUserId = await getEffectiveUserId(userId);
  const m = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  return !!m && ["owner", "admin"].includes(m.role);
}

/** Motivo técnico → frase que o operador entende. */
const MOTIVO: Partial<Record<DocEditReason, { msg: string; status: number }>> = {
  "not-found": { msg: "Trecho não encontrado no documento.", status: 422 },
  ambiguous: {
    msg: "Trecho aparece mais de uma vez — selecione algo mais específico.",
    status: 422,
  },
  "phrase-has-token": {
    msg: "O trecho selecionado já contém uma chave de preenchimento.",
    status: 422,
  },
  "unknown-token": { msg: "Chave desconhecida para esta modalidade.", status: 400 },
  "replace-noop": {
    msg: "O trecho existe no texto, mas a edição não pegou — costuma ser formatação invisível partindo o parágrafo no meio.",
    status: 422,
  },
  "over-matched": {
    msg: "A chave entraria em mais lugares do que o esperado (possivelmente cabeçalho ou rodapé) — confira no documento.",
    status: 422,
  },
  "verify-unavailable": {
    msg: "Não consegui conferir o documento agora (Drive indisponível). Tente de novo.",
    status: 502,
  },
  "verify-failed": {
    msg: "A edição foi enviada, mas a conferência no documento não confirmou o resultado.",
    status: 502,
  },
  "batch-failed": { msg: "O Google recusou a edição.", status: 502 },
};

/**
 * POST /api/templates/[id]/map-field — mapeia um campo manualmente: substitui o
 * TRECHO literal selecionado pelo `{{token}}` no Google Doc do template. Usado
 * pelo painel de "clicar a chave no texto" da revisão.
 *
 * Delega para `applyDocEdits`, que é o único caminho de escrita no Doc-modelo
 * fora do passe de IA. O ganho não é organização: esta rota enviava o
 * `replaceAllText` e respondia `ok` SEM ler a resposta da API e SEM reler o
 * documento — declarava sucesso sobre o que nunca conferiu, exatamente o
 * defeito que o passe de IA teve até 02/09/2026 (11 dos 12 modelos do lote 1 da
 * Trio declaravam chave "inserida" que não estava no Doc). Agora confere, gera
 * linha de auditoria e revalida.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!(await requireOwnerAdmin(session.user.id, org.id))) {
    return NextResponse.json({ error: "Apenas owner/admin." }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "token e trecho são obrigatórios." }, { status: 400 });
  }
  const { token, phrase } = parsed.data;

  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId: org.id },
    select: { googleTemplateDocId: true, modalidade: true, engine: true },
  });
  if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    return NextResponse.json({ error: "Modelo não é Google Docs." }, { status: 400 });
  }

  try {
    const { results } = await applyDocEdits({
      docId: template.googleTemplateDocId,
      modalidade: template.modalidade ?? "a_vista",
      ops: [{ op: "map-field", phrase, token }],
    });
    const result = results[0]!;

    if (result.status !== "applied") {
      const traduzido = result.reason ? MOTIVO[result.reason] : undefined;
      return NextResponse.json(
        { error: traduzido?.msg ?? "Não consegui aplicar a chave no documento.", result },
        { status: traduzido?.status ?? 422 }
      );
    }

    const effUserId = await getEffectiveUserId(session.user.id);
    await audit(extractAuditContextFromRequest(req, org.id, effUserId), {
      action: "TEMPLATE_FIELD_MAPPED",
      result: "SUCCESS",
      resource: params.id,
      resourceType: "ContractTemplate",
      // A frase vem do contrato-fonte e pode carregar dado pessoal: mascarada,
      // como em todo relatório que este módulo grava.
      metadata: { token, phrase: maskForReport(phrase).slice(0, 240) },
    });

    return NextResponse.json({ ok: true, token, result });
  } catch (err) {
    console.error("[templates/map-field] Erro:", err);
    return NextResponse.json({ error: googleErrorMessage(err) }, { status: 502 });
  }
}
