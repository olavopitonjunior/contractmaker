import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { newParticipantToken } from "@/lib/forms/participant-token";
import {
  isValidRole,
  participantRoleSchema,
} from "@/lib/forms/participant-category";
import { listOrgParticipantCategories } from "@/lib/forms/participant-category-repo";
import { formClosedResponse } from "@/lib/forms/form-gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";

const bodySchema = z.object({
  // Papéis nativos + `terceiro:<slug>` (categoria customizável da org). Teto
  // de 10 porque um negócio pode ter vários terceiros; o rate-limit por
  // token+IP abaixo continua sendo a trava de abuso.
  roles: z.array(participantRoleSchema).min(1).max(10),
});

/**
 * POST /api/forms/[token]/participants/from-main  (PÚBLICO, sem session)
 *
 * Gera/garante links por parte A PARTIR DO TOKEN PRINCIPAL do form — é o que
 * permite o botão "Pedir para esta pessoa preencher" dentro do próprio
 * formulário público. Segurança: REDUÇÃO de privilégio — quem tem o link
 * principal já vê e edita o form inteiro; o subtoken derivado vê só a fatia
 * da parte. Rate-limit por token+IP contra abuso de geração.
 *
 * Idempotente como o POST autenticado: (formId, role) existente é retornado
 * sem regenerar o token (regeneração continua exclusiva da rota com session).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = await rateLimit({
    identifier: `participants-from-main:${params.token}:${ip}`,
    limit: 10,
    window: "1 m",
  });
  if (!limited.success) {
    return NextResponse.json(
      { error: "Muitas tentativas — aguarde um instante." },
      { status: 429 },
    );
  }

  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    select: {
      id: true,
      orgId: true,
      schemaType: true,
      status: true,
      completedAt: true,
      reopenedAt: true,
    },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }
  // Sem este gate a rota é o bypass do gate inteiro: ela cunha (e RENOVA)
  // subtokens de 7d a partir do token principal, sem session. Quem tivesse o
  // link seguiria emitindo links de leitura novos pra um form já enviado.
  const closed = await formClosedResponse(form);
  if (closed) return closed;

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // Mesma validação da rota autenticada: nativo precisa casar a esteira;
  // terceiro precisa de categoria existente, ativa e habilitada pro módulo.
  const categories = parsed.data.roles.some((r) => r.startsWith("terceiro:"))
    ? await listOrgParticipantCategories(form.orgId)
    : [];
  const invalid = parsed.data.roles
    .map((r) => ({ role: r, check: isValidRole(r, form.schemaType, categories) }))
    .filter((x) => !x.check.ok);
  if (invalid.length > 0) {
    const status = invalid.some((x) => x.role.startsWith("terceiro:")) ? 422 : 400;
    return NextResponse.json(
      {
        error: invalid.map((x) => (x.check.ok ? "" : x.check.error)).join("; "),
      },
      { status },
    );
  }

  const requested = Array.from(new Set<string>(parsed.data.roles));
  const existing = await prisma.salesFormParticipant.findMany({
    where: { formId: form.id, role: { in: requested } },
  });
  const existingRoles = new Set(existing.map((p) => p.role));
  const created: typeof existing = [];

  for (const role of requested.filter((r) => !existingRoles.has(r))) {
    const { token, exp } = newParticipantToken();
    const final = await prisma.salesFormParticipant.create({
      data: { formId: form.id, role, partyIndex: 0, token, tokenExp: exp },
    });
    created.push(final);
  }

  if (created.length > 0) {
    audit(extractAuditContextFromRequest(req, form.orgId, null), {
      action: "PARTICIPANT_CREATED",
      result: "SUCCESS",
      resourceType: "SalesForm",
      resource: form.id,
      metadata: {
        via: "from_main_token",
        createdRoles: created.map((p) => p.role),
        createdIds: created.map((p) => p.id),
      },
    });
  }

  // Renova subtokens vencidos (TTL 7d) — sem isso a rota idempotente devolvia
  // URL morta pra forms antigos (locação costuma passar de 7 dias) e não há
  // caminho público de regeneração.
  const now = Date.now();
  const all = await Promise.all(
    [...existing, ...created].map(async (p) => {
      if (p.tokenExp.getTime() > now) return p;
      const { token, exp } = newParticipantToken();
      return prisma.salesFormParticipant.update({
        where: { id: p.id },
        data: { token, tokenExp: exp },
      });
    }),
  );

  return NextResponse.json({
    participants: all.map((p) => ({
      id: p.id,
      role: p.role,
      partyIndex: p.partyIndex,
      tokenExp: p.tokenExp.toISOString(),
      completedAt: p.completedAt?.toISOString() ?? null,
      url: `/f/p/${p.token}`,
    })),
  });
}
