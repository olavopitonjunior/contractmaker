import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  signParticipantToken,
  type ParticipantRole,
} from "@/lib/forms/participant-token";
import { formClosedResponse } from "@/lib/forms/form-gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";

export const runtime = "nodejs";

const bodySchema = z.object({
  roles: z
    .array(z.enum(["vendedor", "comprador", "locador", "locatario", "fiador"]))
    .min(1)
    .max(3),
});

const VENDA_ROLES: readonly string[] = ["vendedor", "comprador"];
const LOCACAO_ROLES: readonly string[] = ["locador", "locatario", "fiador"];

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
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "AUTH_SECRET não configurado" },
      { status: 500 },
    );
  }

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

  const isLocacao = form.schemaType?.startsWith("locacao") ?? false;
  const validRoles = isLocacao ? LOCACAO_ROLES : VENDA_ROLES;
  const invalid = parsed.data.roles.filter((r) => !validRoles.includes(r));
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: `Role(s) ${invalid.join(", ")} não valem pra um formulário de ${isLocacao ? "locação" : "venda"}`,
      },
      { status: 400 },
    );
  }

  const requested = Array.from(new Set<ParticipantRole>(parsed.data.roles));
  const existing = await prisma.salesFormParticipant.findMany({
    where: { formId: form.id, role: { in: requested } },
  });
  const existingRoles = new Set(existing.map((p) => p.role));
  const created: typeof existing = [];

  for (const role of requested.filter((r) => !existingRoles.has(r))) {
    const partial = await prisma.salesFormParticipant.create({
      data: {
        formId: form.id,
        role,
        partyIndex: 0,
        token: "",
        tokenExp: new Date(),
      },
    });
    const { token, exp } = signParticipantToken(
      { participantId: partial.id, formId: form.id, role, partyIndex: 0 },
      secret,
    );
    const final = await prisma.salesFormParticipant.update({
      where: { id: partial.id },
      data: { token, tokenExp: exp },
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
      const { token, exp } = signParticipantToken(
        {
          participantId: p.id,
          formId: form.id,
          role: p.role as ParticipantRole,
          partyIndex: p.partyIndex,
        },
        secret,
      );
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
