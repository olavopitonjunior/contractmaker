import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { splitDocParagraphs } from "@/lib/templates/insertion-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireOwnerAdmin(userId: string, orgId: string) {
  const effUserId = await getEffectiveUserId(userId);
  const m = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  return !!m && ["owner", "admin"].includes(m.role);
}

/**
 * GET /api/templates/[id]/source-text — parágrafos do contrato ORIGINAL que
 * deu origem a este modelo, para a aba "Cláusulas" mostrar o Doc lado a lado
 * com o que ele substituiu.
 *
 * A junção é `(sourceHash, run.orgId)`, a mesma de `validate-gdoc`: não há FK
 * entre `ContractTemplate` e `IngestionItem`, e o SHA-256 do arquivo é a
 * identidade nos dois lados. O status do run é ignorado de propósito — um lote
 * cancelado ainda guarda o texto do arquivo que virou este modelo.
 *
 * O texto vai CRU: é o arquivo da própria imobiliária, para o mesmo papel que
 * já lê o Doc inteiro em `doc-text`. Mascarar aqui esconderia justamente o
 * dado que o operador precisa ver ao lado da chave para saber se a chave é a
 * certa. `available: false` cobre modelo sem `sourceHash` (criado do zero) e
 * upload direto sem lote (o arquivo não passou pela Central).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!(await requireOwnerAdmin(session.user.id, org.id))) {
    return NextResponse.json({ error: "Apenas owner/admin." }, { status: 403 });
  }

  // Escopo na QUERY: inexistente e de outro tenant devolvem o mesmo 404.
  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId: org.id },
    select: { engine: true, sourceHash: true },
  });
  if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  if (template.engine !== "google_docs") {
    return NextResponse.json({ error: "Modelo não é Google Docs." }, { status: 400 });
  }
  if (!template.sourceHash) {
    return NextResponse.json({ available: false, paragraphs: [] });
  }

  const item = await prisma.ingestionItem.findFirst({
    // `run.orgId` além do `sourceHash`: o hash é público por natureza (é o
    // arquivo), e dois tenants podem ter ingerido o mesmo modelo de mercado.
    where: { sourceHash: template.sourceHash, run: { orgId: org.id } },
    orderBy: { createdAt: "desc" },
    select: { id: true, runId: true, text: true },
  });
  if (!item?.text) {
    return NextResponse.json({ available: false, paragraphs: [] });
  }

  // Divisor compartilhado com `doc-text` e com as checagens semânticas: o
  // alinhamento na tela só faz sentido se os dois lados forem cortados igual.
  return NextResponse.json({
    available: true,
    paragraphs: splitDocParagraphs(item.text),
    itemId: item.id,
    runId: item.runId,
  });
}
