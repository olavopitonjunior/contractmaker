import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { assertFeatureEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { proposalFeatureForKind } from "@/lib/modules/catalog";
import {
  getEffectivePermissions,
  proposalScopeWhere,
  canAccessProposal,
  can,
} from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { generateProposalToken } from "@/lib/proposals/token";
import { computeDedupeKey } from "@/lib/proposals/signer-dedupe";
import { allocateProposalCode } from "@/lib/proposals/code";
import { sanitizeHiddenPaths } from "@/lib/proposals/hidden-fields";
import {
  createSchema,
  kindForSchema,
  defaultValidUntil,
} from "@/lib/proposals/create-schema";
import {
  RECREATABLE_STATUSES,
  TERMINAL_STATUSES,
} from "@/lib/proposals/status-sets";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { summarizeProposalData } from "@/lib/proposals/summarize";
import { formatDateTimeBR } from "@/lib/format/datetime";
import { waitUntil } from "@vercel/functions";
import { validatePartnerBrokersInData } from "@/lib/proposals/partner-brokers";
import { autoRegisterProposalCommissioners } from "@/lib/proposals/auto-register-commissioners";

// Schema e default de validade vivem em lib/proposals/create-schema.ts: são a
// fonte da verdade compartilhada com a tool MCP `create_proposal`, e o teste de
// paridade compara os dois (ver o cabeçalho de lá).

// Gateia pela sub-função (vendas.propostas / locacao.propostas), não só pelo
// módulo — o toggle "Propostas" precisa segurar a criação no servidor, não só
// esconder o menu. assertFeatureEnabled já implica o módulo habilitado.
async function featureGuard(orgId: string, schemaType: string) {
  await assertFeatureEnabled(orgId, proposalFeatureForKind(kindForSchema(schemaType)));
}

// GET /api/proposals — lista escopada (corretor vê só as dele).
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  const scope = proposalScopeWhere(eff);
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const kind = url.searchParams.get("kind");

  // `?eligible=convert` — modo enxuto pro picker do "Cadastro com proposta":
  // só assinadas completas ainda não convertidas, resumidas no servidor (o shape
  // completo carrega dataJson e sentSnapshotHtml, pesado demais pra um select).
  if (url.searchParams.get("eligible") === "convert") {
    const rows = await prisma.proposal.findMany({
      where: {
        ...scope,
        status: "completa",
        convertedDealId: null,
        ...(kind ? { kind } : {}),
      },
      select: {
        id: true,
        title: true,
        kind: true,
        completedAt: true,
        dossierUrl: true,
        dataJson: true,
      },
      orderBy: { completedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({
      proposals: rows.map((p) => {
        const resumo = summarizeProposalData(p.dataJson, p.kind);
        return {
          id: p.id,
          title: p.title,
          kind: p.kind,
          proponente: resumo.proponente,
          imovel: resumo.imovel,
          valorLabel: resumo.valorLabel,
          completedAtLabel: formatDateTimeBR(p.completedAt),
          // Sem dossiê = ClickSign ainda processando o PDF assinado — a
          // conversão responderia `dossier_pending`.
          dossierReady: !!p.dossierUrl,
        };
      }),
    });
  }

  const proposals = await prisma.proposal.findMany({
    where: {
      ...scope,
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ proposals });
}

// POST /api/proposals — cria rascunho.
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  if (!can(eff, PERMISSION.PROPOSAL_CREATE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    // `error` (string crua do Zod) preservado — a UI lê esse campo. `issues` é
    // aditivo, pra quem consome via API traduzir a falha em linguagem humana em
    // vez de repassar JSON: é o que a tool MCP faz antes de responder no
    // WhatsApp (apps/mcp-server/src/api-error.ts).
    return NextResponse.json(
      { error: parsed.error.message, issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const input = parsed.data;
  // Corretores parceiros vivem dentro do dataJson (`corretores_parceiros[]`);
  // o Zod acima não os enxerga. Validação leve aqui: teto, CRECI, telefone,
  // e-mail — 400 acionável em vez de e-mail que nunca sai.
  const partnerIssues = validatePartnerBrokersInData(input.dataJson);
  if (partnerIssues.length > 0) {
    return NextResponse.json(
      { error: partnerIssues.join(" "), issues: partnerIssues },
      { status: 400 }
    );
  }

  try {
    await featureGuard(auth.org.id, input.schemaType);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }

  // Responsável na criação — mesmas regras do PATCH /assignee: exige
  // PROPOSAL_ASSIGN, um só dos dois campos, e usuário-responsável precisa ser
  // membro da org.
  if (input.responsibleUserId || input.responsibleName) {
    if (!can(eff, PERMISSION.PROPOSAL_ASSIGN)) {
      return NextResponse.json(
        { error: "Sem permissão para atribuir responsável." },
        { status: 403 }
      );
    }
    if (input.responsibleUserId && input.responsibleName) {
      return NextResponse.json(
        { error: "Informe apenas um: responsibleUserId ou responsibleName." },
        { status: 400 }
      );
    }
    if (input.responsibleUserId) {
      const member = await prisma.orgMembership.findUnique({
        where: {
          userId_orgId: { userId: input.responsibleUserId, orgId: auth.org.id },
        },
        select: { userId: true },
      });
      if (!member) {
        return NextResponse.json(
          { error: "Usuário não é membro desta organização." },
          { status: 400 }
        );
      }
    }
  }

  // Recriação: o pai precisa existir, ser DESTA org E estar no escopo do ator
  // (dono/responsável/VIEW_ALL — MESMO corte da nova/page.tsx, sem
  // convertedDealManagerUserId). O escopo importa porque o handler ESCREVE no
  // pai (supersededById + evento) — sem ele, um VIEW_OWN_ONLY com o cuid de
  // proposta de colega marcaria a proposta alheia como recriada. 404 único nos
  // três casos pra não vazar existência. Nenhum status é exigido: a filha
  // nasce rascunho inofensivo, mas a ESCRITA no pai não é — por isso o status
  // do pai é gateado AQUI também (como cancel/convert fazem): só terminal
  // recriável. No fluxo da UI o pai já chega cancelado (o diálogo passa pelo
  // /cancel antes); recriar uma proposta VIVA por API criaria duas ativas na
  // mesma thread, com envelope ClickSign rodando na "superada".
  //
  // TOCTOU consciente (v1): o pai é lido AQUI, fora da transação — duas
  // recriações simultâneas do mesmo pai podem duplicar o `round` da thread.
  // `supersededById` resolve por "última vence" e o round é rótulo, não chave;
  // serializar a leitura não paga o custo.
  let parent: { id: string; code: string | null; round: number } | null = null;
  if (input.parentProposalId) {
    const row = await prisma.proposal.findUnique({
      where: { id: input.parentProposalId },
      select: {
        id: true,
        orgId: true,
        code: true,
        round: true,
        status: true,
        userId: true,
        responsibleUserId: true,
      },
    });
    if (
      !row ||
      row.orgId !== auth.org.id ||
      // `eff` nulo não chega aqui (o can() do CREATE já devolveu 403), mas o
      // narrowing não atravessa a chamada — o guard explícito é só pro TS.
      !eff ||
      !canAccessProposal({
        effective: eff,
        ownerUserId: row.userId,
        responsibleUserId: row.responsibleUserId,
      })
    ) {
      return NextResponse.json(
        { error: "Proposta de origem não encontrada." },
        { status: 404 }
      );
    }
    // Terminal recriável = RECREATABLE ∩ TERMINAL (cancelada/expirada/
    // recusadas). Viva → 409 acionável, espelhando cancel (409) e convert
    // (400) que já enforçam status server-side a partir dos mesmos sets.
    if (!RECREATABLE_STATUSES.has(row.status) || !TERMINAL_STATUSES.has(row.status)) {
      return NextResponse.json(
        { error: "Cancele a proposta de origem antes de recriá-la." },
        { status: 409 }
      );
    }
    parent = { id: row.id, code: row.code, round: row.round };
  }

  let result;
  try {
    result = await withIdempotency({
    userId: auth.actor.effectiveUserId,
    key: req.headers.get("x-idempotency-key"),
    method: "POST",
    path: "/api/proposals",
    handler: async () => {
      // Transação: o código sai de um contador (OrgSequence) que é incrementado
      // ANTES do insert. Fora de uma transação, um create que falhasse (P2002 de
      // dedupeKey, por exemplo) deixaria o número queimado e abriria um buraco
      // na sequência. Aqui o rollback devolve o contador junto.
      const proposal = await prisma.$transaction(async (tx) => {
        const code = await allocateProposalCode(tx, auth.org.id);
        const created = await tx.proposal.create({
          data: {
            orgId: auth.org.id,
            userId: auth.actor.effectiveUserId,
            schemaType: input.schemaType,
            kind: kindForSchema(input.schemaType),
            code,
            title: input.title,
            status: "rascunho",
            // Thread de recriação: round herda do pai; sem pai, default 1.
            ...(parent
              ? { parentProposalId: parent.id, round: parent.round + 1 }
              : {}),
            token: generateProposalToken(),
            dataJson: input.dataJson as Prisma.InputJsonValue,
            comissaoIncluida: input.comissaoIncluida ?? false,
            // Ocultar comissão do proprietário → sanitiza contra a allowlist do
            // schemaType. Não-vazio força o 2º envelope a sair na via reduzida.
            hiddenPaths: input.hiddenPaths
              ? sanitizeHiddenPaths(input.schemaType, input.hiddenPaths)
              : [],
            // Sem prazo informado → 7 dias. Nunca `null`: proposta sem validade
            // não expira em canto nenhum (ver create-schema.ts).
            validUntil: input.validUntil
              ? new Date(input.validUntil)
              : defaultValidUntil(),
            propertyId: input.propertyId ?? null,
            leaseClientId: input.leaseClientId ?? null,
            tenantId: input.tenantId ?? null,
            responsibleUserId: input.responsibleUserId ?? null,
            responsibleName: input.responsibleName ?? null,
            signers: input.signers?.length
              ? {
                  create: input.signers.map((s) => ({
                    role: s.role,
                    name: s.name,
                    email: s.email || null,
                    cpf: s.cpf || null,
                    phone: s.phone || null,
                    notifyChannel: s.notifyChannel ?? "email",
                    // Proponente assina primeiro (grupo 1); demais no grupo 2.
                    signingGroup: s.signingGroup ?? (s.role === "proponente" ? 1 : 2),
                    dedupeKey: computeDedupeKey({
                      name: s.name,
                      email: s.email,
                      cpf: s.cpf,
                      phone: s.phone,
                    }),
                  })),
                }
              : undefined,
          },
        });
        if (parent) {
          // Última recriação vence: o pai aponta sempre pra filha mais nova.
          await tx.proposal.update({
            where: { id: parent.id },
            data: { supersededById: created.id },
          });
          // Eventos de TIMELINE apenas — decisão deliberada de não notificar:
          // quem recria é o próprio corretor, na tela; sino/WhatsApp aqui
          // seria eco (por isso nenhum dos dois entra em TRACKING_KINDS nem
          // na allowlist de user-channels-registry).
          await tx.proposalEvent.createMany({
            data: [
              {
                proposalId: parent.id,
                eventName: "superseded_by_recreation",
                payload: { newProposalId: created.id, newCode: created.code },
                source: "system",
              },
              {
                proposalId: created.id,
                eventName: "recreated_from",
                payload: { parentProposalId: parent.id, parentCode: parent.code },
                source: "system",
              },
            ],
          });
        }
        return created;
      });
      await audit(
        extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
        {
          action: "PROPOSAL_CREATE",
          result: "SUCCESS",
          resource: proposal.id,
          resourceType: "Proposal",
          metadata: mergeAuditMetadata(
            {
              kind: proposal.kind,
              ...(parent ? { parentProposalId: parent.id } : {}),
            },
            auth.actor
          ),
        }
      ).catch(() => {});
      // Parceiros → registry (match-ou-cria + backfill de splitRecipientId).
      // Fire-and-forget: é o que dá a eles preferência de notificação antes
      // do primeiro e-mail e linha casada no Deal depois do convert.
      waitUntil(
        autoRegisterProposalCommissioners({ proposalId: proposal.id, orgId: auth.org.id })
      );
      return { status: 201, body: { proposal } };
    },
    });
  } catch (err) {
    // dedupeKey colide quando dois signatários têm o MESMO contato (ex.: casal
    // comprador com um e-mail só e sem CPF) → @@unique([proposalId, dedupeKey]).
    // 409 acionável em vez de 500: cada signatário precisa de contato distinto
    // (e-mail ou CPF) pra assinar separadamente na ClickSign.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // `@@unique([orgId, code])` também é P2002. Não deveria acontecer (o
      // contador serializa a alocação), mas responder "signatários duplicados"
      // pra uma colisão de código mandaria o corretor caçar um erro que não
      // existe. Distingue pelo alvo; alvo desconhecido cai no caso comum.
      const target = String(
        (err.meta as { target?: unknown } | undefined)?.target ?? ""
      );
      if (target.includes("code")) {
        return NextResponse.json(
          { error: "Conflito ao numerar a proposta. Tente novamente." },
          { status: 409 }
        );
      }
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
  return NextResponse.json(result.body, { status: result.status });
}
