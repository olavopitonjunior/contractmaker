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
import { getEffectivePermissions, proposalScopeWhere, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { generateProposalToken } from "@/lib/proposals/token";
import { computeDedupeKey } from "@/lib/proposals/signer-dedupe";
import { sanitizeHiddenPaths } from "@/lib/proposals/hidden-fields";
import {
  createSchema,
  kindForSchema,
  defaultValidUntil,
} from "@/lib/proposals/create-schema";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";

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

  let result;
  try {
    result = await withIdempotency({
    userId: auth.actor.effectiveUserId,
    key: req.headers.get("x-idempotency-key"),
    method: "POST",
    path: "/api/proposals",
    handler: async () => {
      const proposal = await prisma.proposal.create({
        data: {
          orgId: auth.org.id,
          userId: auth.actor.effectiveUserId,
          schemaType: input.schemaType,
          kind: kindForSchema(input.schemaType),
          title: input.title,
          status: "rascunho",
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
      await audit(
        extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
        {
          action: "PROPOSAL_CREATE",
          result: "SUCCESS",
          resource: proposal.id,
          resourceType: "Proposal",
          metadata: mergeAuditMetadata({ kind: proposal.kind }, auth.actor),
        }
      ).catch(() => {});
      return { status: 201, body: { proposal } };
    },
    });
  } catch (err) {
    // dedupeKey colide quando dois signatários têm o MESMO contato (ex.: casal
    // comprador com um e-mail só e sem CPF) → @@unique([proposalId, dedupeKey]).
    // 409 acionável em vez de 500: cada signatário precisa de contato distinto
    // (e-mail ou CPF) pra assinar separadamente na ClickSign.
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
  return NextResponse.json(result.body, { status: result.status });
}
