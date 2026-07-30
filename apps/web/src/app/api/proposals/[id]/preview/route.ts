import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { EDITABLE_STATUSES } from "@/lib/proposals/status-sets";
import { renderProposalVia } from "@/lib/proposals/render";
import { selectPropostaTemplate } from "@/lib/proposals/template-select";
import { stripActiveContent } from "@/lib/proposals/preview-html";

// Handlebars + seleção de template → node.
export const runtime = "nodejs";

/**
 * POST /api/proposals/[id]/preview — HTML da VIA COMPLETA como está agora.
 *
 * É o "ver antes de mandar": renderiza com o template que o envio usaria hoje
 * (`selectPropostaTemplate` com o MESMO `dataJson`, então a variante por
 * `matchCriteria` que aparece aqui é a que sai no envelope) e NÃO grava nada —
 * em especial não toca `sentSnapshotHtml`, que é congelado uma única vez em
 * `executeProposalSend` e é o que vale juridicamente.
 *
 * Só em status EDITÁVEL. Depois do envio o documento é o snapshot congelado (a
 * página de detalhe o exibe direto do banco); re-renderizar ali mostraria um
 * documento que ninguém assinou.
 *
 * POST (não GET) porque não é cacheável e porque a resposta é o documento
 * inteiro da proposta — fora do escopo de link compartilhável.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { proposal } = r;

  if (!EDITABLE_STATUSES.has(proposal.status)) {
    return NextResponse.json(
      {
        error:
          "A proposta já foi enviada — o documento exibido é o snapshot congelado no envio.",
      },
      { status: 409 }
    );
  }

  const dataJson = (proposal.dataJson ?? {}) as Record<string, unknown>;
  const tpl = proposal.templateId
    ? await prisma.contractTemplate.findUnique({
        where: { id: proposal.templateId },
        select: { handlebarsSource: true, name: true },
      })
    : ((await selectPropostaTemplate(proposal.orgId, proposal.schemaType, dataJson))
        ?.template ?? null);

  if (!tpl?.handlebarsSource) {
    // Sem template ativo da modalidade não há o que pré-visualizar. 200 com
    // `html: null` (e não erro): a tela mostra o aviso acionável em vez de um
    // toast vermelho que não diz o que fazer.
    return NextResponse.json({
      html: null,
      templateName: null,
      reason: "no_template",
    });
  }

  const html = renderProposalVia({
    templateSource: tpl.handlebarsSource,
    schemaType: proposal.schemaType,
    dataJson,
    hiddenPaths: [],
    via: "completa",
    numero: proposal.id.slice(-8),
    comissaoIncluida: proposal.comissaoIncluida,
  });

  return NextResponse.json({
    html: stripActiveContent(html),
    templateName: tpl.name ?? null,
  });
}
