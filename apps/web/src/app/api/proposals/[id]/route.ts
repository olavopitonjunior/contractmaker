import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { DELETABLE_STATUSES, EDITABLE_STATUSES } from "@/lib/proposals/status-sets";
import { sanitizeHiddenPaths } from "@/lib/proposals/hidden-fields";
import { computeDedupeKey } from "@/lib/proposals/signer-dedupe";
import { runEnvelopeCancel } from "@/lib/clicksign/cancel-action";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

// DELETE cancela envelopes ClickSign vivos antes de excluir → precisa de node + tempo.
export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/proposals/[id]
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const [signers, events, attachments, envelopes] = await Promise.all([
    prisma.proposalSigner.findMany({ where: { proposalId: params.id } }),
    prisma.proposalEvent.findMany({
      where: { proposalId: params.id },
      orderBy: { receivedAt: "desc" },
      take: 50,
    }),
    prisma.proposalAttachment.findMany({ where: { proposalId: params.id } }),
    prisma.envelope.findMany({
      where: { proposalId: params.id },
      include: { signers: true },
    }),
  ]);
  return NextResponse.json({ proposal: r.proposal, signers, events, attachments, envelopes });
}

const signerSchema = z.object({
  role: z.enum(["proponente", "vendedor", "conjuge", "testemunha"]),
  name: z.string().min(1),
  email: z.string().optional().nullable(),
  cpf: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  notifyChannel: z.enum(["email", "whatsapp", "sms"]).optional(),
  signingGroup: z.number().int().optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  dataJson: z.record(z.unknown()).optional(),
  validUntil: z.string().datetime().nullable().optional(),
  comissaoIncluida: z.boolean().optional(),
  hiddenPaths: z.array(z.string()).optional(),
  // Conjunto COMPLETO de signatários (substitui as linhas existentes). Só faz
  // sentido antes do envio — depois quem manda é o EnvelopeSigner, editado
  // pelas rotas /signers/[signerId]. Omitir preserva o conjunto atual.
  signers: z.array(signerSchema).optional(),
});

/** Sinaliza o 409 de dentro da transação do PATCH (aborta e faz rollback). */
class ProposalNotEditableError extends Error {}

/**
 * PATCH /api/proposals/[id] — edita a proposta antes do envio (EDITABLE_STATUSES).
 *
 * Permissão: escopo NÃO basta, pelo mesmo motivo da rota de renomear.
 * `loadScopedProposal` libera quem tem `PROPOSAL_VIEW_ALL`, que é o recorte do
 * papel `viewer` — somente-leitura. Sem a checagem abaixo ele reescrevia o
 * `dataJson` inteiro, trocava `validUntil`/`comissaoIncluida`/`hiddenPaths` e
 * SUBSTITUÍA a lista de signatários de qualquer proposta pré-envio da org.
 *
 * Era o buraco mais largo da família: as rotas irmãs que fazem exatamente essas
 * escritas em pedaços (`/signers`, `/signers/[signerId]`, `/attachments`) já
 * exigiam `PROPOSAL_SEND`; só este PATCH monolítico, que faz tudo de uma vez,
 * não exigia nada. Fechar aqui é aplicar a convenção que já existe, não criar
 * regra nova.
 *
 * Consequência conhecida: o preset `gerente` tem `PROPOSAL_VIEW_OWN_ONLY` sem
 * CREATE/SEND, então um gerente atribuído como responsável perde esta escrita.
 * Isso é coerência, não perda: ele já não podia editar signatário, anexar
 * arquivo nem enviar — nenhum fluxo de edição fechava pra ele de qualquer jeito.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;

  if (!can(r.eff, PERMISSION.PROPOSAL_CREATE) && !can(r.eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Mesmo conjunto do claim de envio: tudo que ainda pode virar "enviada" é
  // editável, nada depois. Antes só `rascunho` passava, o que travava a correção
  // de uma proposta em `falha_envio` — exatamente o caso em que editar é o
  // conserto (contato errado, dado faltando) antes de reenviar.
  if (!EDITABLE_STATUSES.has(r.proposal.status)) {
    return NextResponse.json(
      { error: "A proposta já foi enviada e não pode mais ser editada." },
      { status: 409 }
    );
  }
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const p = parsed.data;
  const proposalData = {
    ...(p.title !== undefined ? { title: p.title } : {}),
    ...(p.dataJson !== undefined
      ? { dataJson: p.dataJson as Prisma.InputJsonValue }
      : {}),
    ...(p.validUntil !== undefined
      ? { validUntil: p.validUntil ? new Date(p.validUntil) : null }
      : {}),
    ...(p.comissaoIncluida !== undefined ? { comissaoIncluida: p.comissaoIncluida } : {}),
    // hiddenPaths sempre sanitizado contra a allowlist do schemaType.
    ...(p.hiddenPaths !== undefined
      ? { hiddenPaths: sanitizeHiddenPaths(r.proposal.schemaType, p.hiddenPaths) }
      : {}),
  };

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // Guarda ATÔMICA. O `EDITABLE_STATUSES.has(...)` acima é check-then-act: a
      // proposta é lida, o corpo é validado e só então a transação abre. Nessa
      // janela o claim de envio (`executeProposalSend`, que usa EXATAMENTE o
      // mesmo conjunto de status) pode ter movido a proposta pra "enviada" — e a
      // substituição de signatários rodaria por baixo dele, montando o envelope
      // com uma lista que ninguém aprovou. `count === 0` = perdemos a corrida →
      // 409 e rollback de tudo que veio depois.
      const claimed = await tx.proposal.updateMany({
        where: { id: params.id, status: { in: [...EDITABLE_STATUSES] } },
        data: { updatedAt: new Date() },
      });
      if (claimed.count === 0) throw new ProposalNotEditableError();

      if (p.signers !== undefined) {
        // Substituição atômica: o payload é o conjunto inteiro (a página de
        // edição sempre manda todos). Deletar-e-recriar em vez de diff porque
        // não há envelope ainda — nenhuma linha carrega estado de assinatura.
        await tx.proposalSigner.deleteMany({ where: { proposalId: params.id } });
        if (p.signers.length > 0) {
          await tx.proposalSigner.createMany({
            data: p.signers.map((s) => ({
              proposalId: params.id,
              role: s.role,
              name: s.name,
              email: s.email || null,
              cpf: s.cpf || null,
              phone: s.phone || null,
              notifyChannel: s.notifyChannel ?? "email",
              signingGroup: s.signingGroup ?? (s.role === "proponente" ? 1 : 2),
              dedupeKey: computeDedupeKey({
                name: s.name,
                email: s.email,
                cpf: s.cpf,
                phone: s.phone,
              }),
            })),
          });
        }
      }
      return tx.proposal.update({ where: { id: params.id }, data: proposalData });
    });
  } catch (err) {
    if (err instanceof ProposalNotEditableError) {
      return NextResponse.json(
        { error: "A proposta já foi enviada e não pode mais ser editada." },
        { status: 409 }
      );
    }
    // Mesmo 409 acionável do POST: dois signatários com o mesmo contato colidem
    // no @@unique([proposalId, dedupeKey]).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        {
          error:
            "Dois signatários têm o mesmo contato. Informe e-mail ou CPF distinto para cada um (cada pessoa assina separadamente).",
        },
        { status: 409 }
      );
    }
    throw err;
  }
  await audit(
    extractAuditContextFromRequest(req, r.auth.org.id, r.auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_UPDATE",
      result: "SUCCESS",
      resource: params.id,
      resourceType: "Proposal",
    }
  ).catch(() => {});
  return NextResponse.json({ proposal: updated });
}

// DELETE /api/proposals/[id] — exclui a proposta (cascata remove signers/events/
// attachments/envelopes). Só em estado frio e nunca depois de virar negócio.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_DELETE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (proposal.convertedDealId) {
    return NextResponse.json(
      { error: "Proposta já virou negócio; exclua o negócio no pipeline." },
      { status: 409 }
    );
  }
  if (!DELETABLE_STATUSES.has(proposal.status)) {
    return NextResponse.json(
      { error: "Cancele a assinatura antes de excluir." },
      { status: 409 }
    );
  }
  // `falha_envio` é deletável porque historicamente só se chegava lá por envio
  // que NUNCA saiu — proposta que ninguém de fora viu. Desde que cancelar o
  // envelope devolve a 1ª via pra cá, o mesmo status também cobre proposta que
  // o cliente recebeu e abriu, e essa não se apaga: a exclusão cascateia
  // ProposalEvent, envelopes e signatários, destruindo o registro de um
  // documento que circulou. `sentAt` é o discriminador — os dois caminhos
  // felizes de envio o gravam como último passo. Arquivar (cancelar) continua
  // disponível: `falha_envio` está em CANCELLABLE_STATUSES.
  if (proposal.status === "falha_envio" && proposal.sentAt) {
    return NextResponse.json(
      {
        error:
          "Esta proposta já foi enviada ao cliente e não pode ser excluída. Cancele-a para manter o histórico.",
      },
      { status: 409 }
    );
  }
  // Invariante da plataforma: não deixar um Envelope ClickSign VIVO órfão — a
  // cascata apagaria a linha local mas o envelope seguiria ativo/cobrável, e
  // assinaturas/webhooks posteriores não resolveriam mais a proposta. Cancela os
  // running best-effort ANTES de excluir. Não dá pra só bloquear com 409 "cancele
  // primeiro": 'expirada' não é cancelável (fora de CANCELLABLE_STATUSES) e o cron
  // de expiração deixa o Envelope local 'running' até o reconcile sincronizar —
  // seria um beco sem saída. O DELETE é uma ação explícita do usuário; cancelamos
  // o que der e registramos o resultado.
  const liveEnvelopes = await prisma.envelope.findMany({
    where: { proposalId: params.id, status: "running", clicksignId: { not: null } },
    select: { id: true },
  });
  const cancelOutcomes: { envelopeId: string; ok: boolean; error?: string }[] = [];
  for (const env of liveEnvelopes) {
    const res = await runEnvelopeCancel({
      envelopeId: env.id,
      reason: "Proposta excluída",
      actorUserId: auth.actor.effectiveUserId,
    }).catch((err) => ({
      status: 502,
      body: { error: err instanceof Error ? err.message : String(err) },
    }));
    cancelOutcomes.push(
      res.status >= 400
        ? { envelopeId: env.id, ok: false, error: (res.body as { error?: string })?.error }
        : { envelopeId: env.id, ok: true }
    );
  }
  // Se ALGUM cancelamento falhou, NÃO exclui: a cascata apagaria o Envelope local
  // e deixaria o remoto vivo/cobrável órfão (sem rastro pra reconciliar uma
  // assinatura posterior). 409. Não é beco sem saída: o cron reconcile sincroniza
  // o Envelope stale (sai de 'running') e a exclusão passa numa próxima tentativa.
  const failed = cancelOutcomes.filter((o) => !o.ok);
  if (failed.length > 0) {
    return NextResponse.json(
      {
        error:
          "A assinatura ainda está ativa na ClickSign e não pôde ser cancelada agora. Tente novamente em alguns minutos.",
        details: failed,
      },
      { status: 409 }
    );
  }

  await prisma.proposal.delete({ where: { id: params.id } });
  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_DELETE",
      result: "SUCCESS",
      resource: params.id,
      resourceType: "Proposal",
      metadata: {
        status: proposal.status,
        title: proposal.title,
        ...(cancelOutcomes.length > 0 ? { canceledEnvelopes: cancelOutcomes } : {}),
      },
    }
  ).catch(() => {});
  return NextResponse.json({ ok: true });
}
