import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { newParticipantToken } from "@/lib/forms/participant-token";
import {
  isValidRole,
  participantRoleSchema,
} from "@/lib/forms/participant-category";
import { listOrgParticipantCategories } from "@/lib/forms/participant-category-repo";
import { audit } from "@/lib/security/audit";

const bodySchema = z.object({
  // Quais roles criar/garantir. Sem `roles`, o default depende do schemaType
  // do form (venda: vendedor+comprador; locação: locador+locatario). Mandar
  // subset é útil quando o admin quer mandar link só pra uma parte primeiro.
  //
  // Aceita também `terceiro:<slug>` — categoria customizável da org (a
  // existência/atividade da categoria é checada abaixo, contra o banco). O
  // teto subiu de 3 pra 10 porque um negócio pode ter vários terceiros; os
  // papéis nativos continuam limitados pela allowlist por esteira.
  roles: z.array(participantRoleSchema).min(1).max(10).optional(),
});

/**
 * GET /api/forms/[token]/participants
 * Lista participants existentes do form. Admin via session.
 *
 * `[token]` é o SalesForm.token (único). Usar token em vez de id evita
 * conflito com `/api/forms/[token]/...` (Next.js não aceita slugs
 * diferentes no mesmo nível) e mantém um único nome de slug por route tree.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const form = await prisma.salesForm.findFirst({
    where: { token: params.token, orgId: ctx.orgId },
    select: { id: true, token: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }

  const participants = await prisma.salesFormParticipant.findMany({
    where: { formId: form.id },
    orderBy: [{ role: "asc" }, { partyIndex: "asc" }],
  });

  return NextResponse.json({
    formId: form.id,
    formToken: form.token,
    participants: participants.map((p) => ({
      id: p.id,
      role: p.role,
      partyIndex: p.partyIndex,
      token: p.token,
      tokenExp: p.tokenExp.toISOString(),
      completedAt: p.completedAt?.toISOString() ?? null,
      lastAccessAt: p.lastAccessAt?.toISOString() ?? null,
      url: `/f/p/${p.token}`,
    })),
  });
}

/**
 * POST /api/forms/[token]/participants
 * Cria participants pros roles solicitados. Idempotente — se já existir
 * participant pro (formId, role, partyIndex), retorna o existente sem
 * regenerar token. Pra regenerar, usar /participants/[id]/regenerate.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const form = await prisma.salesForm.findFirst({
    where: { token: params.token, orgId: ctx.orgId },
    select: { id: true, token: true, schemaType: true },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const isLocacao = form.schemaType?.startsWith("locacao") ?? false;
  const defaultRoles: string[] = isLocacao
    ? ["locador", "locatario"]
    : ["vendedor", "comprador"];
  const requestedRoles = parsed.data.roles ?? defaultRoles;

  // Categorias de terceiro da org — só carregadas quando alguém pediu uma.
  // `isValidRole` mantém a regra antiga intacta pros 5 nativos e, pro
  // terceiro, exige categoria EXISTENTE, ATIVA e habilitada pra esteira.
  const categories = requestedRoles.some((r) => r.startsWith("terceiro:"))
    ? await listOrgParticipantCategories(ctx.orgId)
    : [];
  const invalid = requestedRoles
    .map((r) => ({ role: r, check: isValidRole(r, form.schemaType, categories) }))
    .filter((x) => !x.check.ok);
  if (invalid.length > 0) {
    // 400 continua sendo a resposta de role NATIVO fora da esteira (contrato
    // antigo, preservado). Categoria de terceiro inexistente/inativa/em módulo
    // errado é 422: o body está bem formado, a configuração é que não bate.
    const status = invalid.some((x) => x.role.startsWith("terceiro:")) ? 422 : 400;
    return NextResponse.json(
      {
        error: invalid
          .map((x) => (x.check.ok ? "" : x.check.error))
          .join("; "),
      },
      { status },
    );
  }

  const requested = new Set<string>(requestedRoles);
  const existing = await prisma.salesFormParticipant.findMany({
    where: { formId: form.id, role: { in: Array.from(requested) } },
  });
  const existingRoles = new Set(existing.map((p) => p.role));

  const toCreate = Array.from(requested).filter((r) => !existingRoles.has(r));
  const created: typeof existing = [];

  for (const role of toCreate) {
    // Um create só: o token não depende mais do `participant.id` (era o payload
    // do JWT). Antes isso exigia criar com `token: ""` e atualizar em seguida —
    // e como `token` é @unique, dois creates concorrentes colidiam no "".
    const { token, exp } = newParticipantToken();
    const final = await prisma.salesFormParticipant.create({
      data: { formId: form.id, role, partyIndex: 0, token, tokenExp: exp },
    });
    created.push(final);
  }

  if (created.length > 0) {
    audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "PARTICIPANT_CREATED",
        result: "SUCCESS",
        resourceType: "SalesForm",
        resource: form.id,
        metadata: {
          createdRoles: created.map((p) => p.role),
          createdIds: created.map((p) => p.id),
        },
      },
    );
  }

  const all = [...existing, ...created].sort((a, b) =>
    a.role.localeCompare(b.role),
  );

  return NextResponse.json({
    formId: form.id,
    participants: all.map((p) => ({
      id: p.id,
      role: p.role,
      partyIndex: p.partyIndex,
      token: p.token,
      tokenExp: p.tokenExp.toISOString(),
      completedAt: p.completedAt?.toISOString() ?? null,
      lastAccessAt: p.lastAccessAt?.toISOString() ?? null,
      url: `/f/p/${p.token}`,
    })),
  });
}
