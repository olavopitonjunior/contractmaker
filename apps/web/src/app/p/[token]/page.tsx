import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { renderProposalVia } from "@/lib/proposals/render";
import { selectPropostaTemplate } from "@/lib/proposals/template-select";
import { SIGNED_OR_LATER_STATUSES } from "@/lib/proposals/status-sets";
import { proposalNumero } from "@/lib/proposals/code";
import { ViewBeacon } from "./ViewBeacon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Página pública da proposta — `/p/[token]`.
 *
 * É o "inteiro teor" referenciado pelo texto vinculante do Aceite via WhatsApp
 * ("Declaro que li a Proposta cujo inteiro teor está em {link}…"). Antes esta
 * rota NÃO existia: o link do aceite apontava pra 404 num documento
 * juridicamente vinculante (achado do painel 360).
 *
 * Sem auth (o cliente não tem conta). Mostra a via COMPLETA a partir do
 * SNAPSHOT congelado no envio — o mesmo documento que a pessoa aceita, imune a
 * mudança de template posterior. Token = randomBytes(32), não enumerável.
 */

export default async function PublicProposalPage({
  params,
}: {
  params: { token: string };
}) {
  const proposal = await prisma.proposal.findUnique({
    where: { token: params.token },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      schemaType: true,
      dataJson: true,
      templateId: true,
      orgId: true,
      comissaoIncluida: true,
      validUntil: true,
      createdAt: true,
      sentSnapshotHtml: true,
      htmlContent: true,
    },
  });

  // 404 genérico pra token inválido — não vaza se o token existe ou não.
  if (!proposal) notFound();

  // Estados em que não faz sentido exibir a proposta pro público.
  if (["rascunho", "aguardando_aprovacao", "cancelada"].includes(proposal.status)) {
    notFound();
  }

  // "Expirou" é decidido pelo STATUS, não só pela data: proposta já assinada
  // (parcial ou completa) foi aceita DENTRO da validade — carimbar "expirou"
  // nela era falso e ainda suprimia o ViewBeacon. Data vencida só conta
  // enquanto a proposta espera manifestação; `expirada` (terminal do cron/
  // caducidade) vale mesmo sem validUntil.
  const expired =
    proposal.status === "expirada" ||
    (!SIGNED_OR_LATER_STATUSES.has(proposal.status) &&
      proposal.validUntil != null &&
      new Date() > proposal.validUntil);

  // Documento: snapshot congelado (o que a pessoa viu/aceita). Fallback ao
  // render atual só pra propostas antigas sem snapshot.
  let html = proposal.sentSnapshotHtml ?? "";
  if (!html) {
    const dataJson = (proposal.dataJson ?? {}) as Record<string, unknown>;
    const tpl = proposal.templateId
      ? await prisma.contractTemplate.findUnique({
          where: { id: proposal.templateId },
          select: { handlebarsSource: true },
        })
      : (await selectPropostaTemplate(proposal.orgId, proposal.schemaType, proposal.dataJson))?.template ?? null;
    html = tpl?.handlebarsSource
      ? renderProposalVia({
          templateSource: tpl.handlebarsSource,
          schemaType: proposal.schemaType,
          dataJson,
          hiddenPaths: [],
          via: "completa",
          numero: proposalNumero(proposal),
          comissaoIncluida: proposal.comissaoIncluida,
          meta: { emitidaEm: proposal.createdAt, validaAte: proposal.validUntil },
        })
      : (proposal.htmlContent ?? `<h1>${proposal.title}</h1>`);
  }

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "32px 20px 80px",
        fontFamily: "'EB Garamond', Georgia, serif",
        color: "#111",
        lineHeight: 1.55,
      }}
    >
      {expired && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 20,
            fontSize: 14,
          }}
        >
          Esta proposta expirou em{" "}
          {proposal.validUntil?.toLocaleDateString("pt-BR")}. O conteúdo é
          exibido apenas para referência.
        </div>
      )}
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {/* Beacon: só um browser real (humano) marca "visualizada"; crawlers não. */}
      {!expired && <ViewBeacon token={params.token} />}
    </main>
  );
}
