import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  signParticipantToken,
  type ParticipantRole,
} from "@/lib/forms/participant-token";
import { audit } from "@/lib/security/audit";

const bodySchema = z.object({
  // Quais roles criar/garantir. Sem `roles`, o default depende do schemaType
  // do form (venda: vendedor+comprador; locação: locador+locatario). Mandar
  // subset é útil quando o admin quer mandar link só pra uma parte primeiro.
  roles: z
    .array(z.enum(["vendedor", "comprador", "locador", "locatario", "fiador"]))
    .min(1)
    .max(3)
    .optional(),
});

// Roles válidos por esteira — vendedor num form de locação (ou vice-versa)
// criaria um subtoken com pathScope vazio/errado.
const VENDA_ROLES: readonly ParticipantRole[] = ["vendedor", "comprador"];
const LOCACAO_ROLES: readonly ParticipantRole[] = ["locador", "locatario", "fiador"];

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

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "AUTH_SECRET não configurado" },
      { status: 500 },
    );
  }

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
  const validRoles = isLocacao ? LOCACAO_ROLES : VENDA_ROLES;
  const defaultRoles: ParticipantRole[] = isLocacao
    ? ["locador", "locatario"]
    : ["vendedor", "comprador"];
  const requestedRoles = parsed.data.roles ?? defaultRoles;
  const invalid = requestedRoles.filter(
    (r) => !validRoles.includes(r as ParticipantRole),
  );
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: `Role(s) ${invalid.join(", ")} não valem pra um formulário de ${isLocacao ? "locação" : "venda"}`,
      },
      { status: 400 },
    );
  }

  const requested = new Set<ParticipantRole>(requestedRoles as ParticipantRole[]);
  const existing = await prisma.salesFormParticipant.findMany({
    where: { formId: form.id, role: { in: Array.from(requested) } },
  });
  const existingRoles = new Set(existing.map((p) => p.role));

  const toCreate = Array.from(requested).filter((r) => !existingRoles.has(r));
  const created: typeof existing = [];

  for (const role of toCreate) {
    // Cria row vazio primeiro pra ter o `participant.id` que vai assinar
    // o token (payload referencia o ID pra invalidação por regenerate).
    const partial = await prisma.salesFormParticipant.create({
      data: {
        formId: form.id,
        role,
        partyIndex: 0,
        token: "", // placeholder, atualiza na linha abaixo
        tokenExp: new Date(),
      },
    });
    const { token, exp } = signParticipantToken(
      {
        participantId: partial.id,
        formId: form.id,
        role,
        partyIndex: 0,
      },
      secret,
    );
    const final = await prisma.salesFormParticipant.update({
      where: { id: partial.id },
      data: { token, tokenExp: exp },
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
