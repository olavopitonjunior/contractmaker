import { NextRequest, NextResponse } from "next/server";
import { authOrBearer, hasScope } from "@/lib/auth/auth-or-bearer";
import { prisma } from "@/lib/db/prisma";
import { phoneE164Schema } from "@/lib/validation/schemas";

/**
 * GET /api/users/by-phone?phone=+5511987654321
 *
 * Lookup de usuário por telefone E.164. Usado pelo Newton para identificar
 * qual usuário do contractmaker corresponde a um número de WhatsApp inbound.
 *
 * Auth: aceita Bearer (Newton) ou session (UI admin). Para Bearer, exige
 * escopo `metrics:r` (operação de leitura).
 *
 * Response: { userId, orgId, role, name } | { error: "not_found" }
 *
 * Com `?withScope=true` (requer scope adicional `users:delegate`):
 *   Response: { ..., accessibleDealIds: string[], accessibleContractIds: string[] }
 *   IDs computados em uma query única, cap 500 cada (se exceder, MCP entende
 *   role=admin/manager como scope=all e usa filtros server-side ao invés
 *   de lista enumerada).
 *
 * Privacy guard: telefone é PII. Endpoint não deve ser exposto publicamente.
 * Bearer scope é a primeira linha de defesa; UI admin é a segunda. Resposta
 * NÃO retorna `email` para minimizar superficie.
 */
export async function GET(req: NextRequest) {
  const ident = await authOrBearer(req);
  if (!ident) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(ident, "metrics:r")) {
    return NextResponse.json(
      { error: "Forbidden", reason: "missing scope metrics:r" },
      { status: 403 }
    );
  }

  const phoneRaw = req.nextUrl.searchParams.get("phone");
  if (!phoneRaw) {
    return NextResponse.json(
      { error: "Bad Request", reason: "phone query param required" },
      { status: 400 }
    );
  }

  const parsed = phoneE164Schema.safeParse(phoneRaw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", reason: parsed.error.errors[0]?.message },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { phone: parsed.data },
    select: {
      id: true,
      name: true,
      deletedAt: true,
      orgMemberships: {
        select: { orgId: true, role: true },
        take: 1,
      },
    },
  });

  if (!user || user.deletedAt) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (user.orgMemberships.length === 0) {
    return NextResponse.json(
      { error: "not_found", reason: "user has no active org" },
      { status: 404 }
    );
  }

  const membership = user.orgMemberships[0];

  // Versão básica (default)
  const base = {
    userId: user.id,
    orgId: membership.orgId,
    role: membership.role,
    name: user.name,
  };

  // Versão enriquecida: gated por `withScope=true` + scope `users:delegate`.
  // Usada pela MCP tool `resolve_caller` pra pré-computar o universo do caller.
  if (req.nextUrl.searchParams.get("withScope") !== "true") {
    return NextResponse.json(base);
  }
  if (!hasScope(ident, "users:delegate")) {
    return NextResponse.json(
      { error: "Forbidden", reason: "withScope requires scope users:delegate" },
      { status: 403 }
    );
  }

  // `userId` é globalmente único entre orgs, então não filtramos por orgId
  // explicitamente aqui — só os deals/contracts que pertencem ao user.
  const SCOPE_CAP = 500;
  const [deals, contracts] = await Promise.all([
    prisma.deal.findMany({
      where: { userId: user.id },
      select: { id: true },
      take: SCOPE_CAP,
    }),
    prisma.contract.findMany({
      where: { userId: user.id },
      select: { id: true },
      take: SCOPE_CAP,
    }),
  ]);

  return NextResponse.json({
    ...base,
    accessibleDealIds: deals.map((d) => d.id),
    accessibleContractIds: contracts.map((c) => c.id),
    scopeCapped: deals.length === SCOPE_CAP || contracts.length === SCOPE_CAP,
  });
}
