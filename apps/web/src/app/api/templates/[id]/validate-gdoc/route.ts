import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsConfigured } from "@/lib/google/client";
import { getDocPlainText } from "@/lib/google/docs";
import { googleErrorMessage } from "@/lib/google/auth-error";
import { extractPlaceholdersFromText } from "@/lib/google/replace-placeholders";
import {
  catalogForModalidade,
  requiredTokens,
} from "@/lib/templates/placeholder-catalog";
import {
  CLAUSE_SLOT_KEYS,
  detectClauseSlots,
  slotDeclarationComment,
  slotToken,
  type ClauseSlotKey,
} from "@/lib/templates/clause-slots";

/** Cabeçalho do "source" de um template engine="google_docs" (ver from-docx). */
const GOOGLE_DOCS_SOURCE_HEADER =
  "<!-- engine=google_docs: a fonte é o Google Doc -->";

/**
 * POST /api/templates/[id]/validate-gdoc — revalida os placeholders do
 * Doc-modelo de um template engine="google_docs" contra o catálogo da
 * modalidade. Usado pela página de revisão (botão "Revalidar") e antes da
 * ativação.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  if (!isGoogleDocsConfigured()) {
    return NextResponse.json(
      { error: "Integração Google Docs não está configurada." },
      { status: 503 }
    );
  }

  const template = await prisma.contractTemplate.findUnique({
    where: { id: params.id },
  });
  if (!template || template.orgId !== org.id) {
    return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  }
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    return NextResponse.json(
      { error: "Template não é engine google_docs com doc associado." },
      { status: 400 }
    );
  }

  const modalidade = template.modalidade ?? "a_vista";

  try {
    const text = await getDocPlainText(template.googleTemplateDocId);
    const found = extractPlaceholdersFromText(text);
    const catalog = catalogForModalidade(modalidade);
    const known = new Set(catalog.map((d) => d.token));
    const slotTokens = new Set(CLAUSE_SLOT_KEYS.map(slotToken));
    // Slot NÃO é "chave desconhecida": ele é resolvido em `resolveClauseSlots`,
    // não pelo catálogo de placeholders.
    const unknown = found.filter((t) => !known.has(t) && !slotTokens.has(t));
    const foundSet = new Set(found);
    const missingRequired = requiredTokens(modalidade).filter((t) => !foundSet.has(t));

    // ─── RECONCILIA A DECLARAÇÃO DE SLOTS COM O DOCUMENTO ──────────────────
    // A declaração vive no `handlebarsSource` e o token vive no Doc — se as
    // duas pontas divergirem, a geração faz besteira em silêncio: declarado sem
    // token = a cláusula resolvida é jogada fora e o contrato sai com a garantia
    // chumbada; token sem declaração = `cleanupOrphanPlaceholders` apaga o token
    // e o contrato sai SEM cláusula de garantia.
    //
    // Como a revalidação já leu o Doc inteiro, ela é o lugar natural pra
    // sincronizar — e é o que faz o conserto manual (o operador escreve
    // `{{slot_garantia}}` no Doc, como a página de revisão instrui) passar a
    // valer sem nenhum passo extra.
    const slotsInDoc: ClauseSlotKey[] = CLAUSE_SLOT_KEYS.filter((s) =>
      foundSet.has(slotToken(s))
    );
    const declaredSlots = detectClauseSlots(template.handlebarsSource);
    const slotsChanged =
      slotsInDoc.length !== declaredSlots.length ||
      slotsInDoc.some((s) => !declaredSlots.includes(s));

    // Atualiza o relatório do draft com o estado mais recente da validação.
    const prevReport =
      template.draftReport && typeof template.draftReport === "object"
        ? (template.draftReport as Record<string, unknown>)
        : {};
    // O aviso de slot só some quando o token aparece no Doc — resolver na mão
    // limpa a trava da ativação; reingerir mal continua travando.
    const prevSlots = Array.isArray(prevReport.slots)
      ? (prevReport.slots as Array<Record<string, unknown>>)
      : [];
    const slots = prevSlots.map((s) =>
      typeof s?.slot === "string" && foundSet.has(slotToken(s.slot as ClauseSlotKey))
        ? { ...s, applied: true, token: `{{${slotToken(s.slot as ClauseSlotKey)}}}`, issues: [] }
        : s
    );

    await prisma.contractTemplate.update({
      where: { id: template.id },
      data: {
        draftReport: {
          ...prevReport,
          ...(prevSlots.length ? { slots } : {}),
          missingRequired,
          lastValidatedAt: new Date().toISOString(),
        } as object,
        ...(template.engine === "google_docs" && slotsChanged
          ? {
              handlebarsSource: [
                GOOGLE_DOCS_SOURCE_HEADER,
                slotDeclarationComment(slotsInDoc),
              ]
                .filter(Boolean)
                .join("\n"),
            }
          : {}),
      },
    });

    return NextResponse.json({
      ok: true,
      docId: template.googleTemplateDocId,
      found,
      unknown,
      missingRequired,
      slots,
      catalog: catalog.map((d) => ({
        token: d.token,
        label: d.label,
        description: d.description,
        required: d.required,
        kind: d.kind,
        present: foundSet.has(d.token),
      })),
    });
  } catch (err) {
    console.error("[templates/validate-gdoc/id] Erro:", err);
    // `invalid_grant` cru não diz nada pra quem está na tela — e é o erro mais
    // comum aqui (refresh token da org expira em 7 dias no modo Testing).
    return NextResponse.json({ error: googleErrorMessage(err) }, { status: 502 });
  }
}
