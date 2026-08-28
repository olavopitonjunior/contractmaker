import { NextRequest, NextResponse } from "next/server";
import { hasScope } from "@/lib/auth/auth-or-bearer";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { prisma } from "@/lib/db/prisma";
import { phoneE164Schema } from "@/lib/validation/schemas";
import { resolveUserByPhone } from "@/lib/max/user-identity";

/**
 * GET /api/users/by-phone?phone=+5511987654321
 *
 * Lookup de usuário por telefone E.164. Usado pelos agentes de WhatsApp para
 * identificar qual usuário da plataforma corresponde a um número inbound.
 *
 * **A resposta é confinada à org de quem pergunta.** Telefone de usuário de
 * outro tenant devolve 404 — o mesmo 404 de telefone inexistente, de propósito:
 * distinguir os dois casos já entregaria a informação de que aquele número
 * pertence a alguém na plataforma.
 *
 * Isso corrige um vazamento real: a rota usava `authOrBearer` cru, checava só o
 * escopo e fazia `findUnique({ where: { phone } })` sem filtro nenhum de org.
 * Como `User.phone` é `@unique` GLOBAL, qualquer token com `metrics:r` — de
 * qualquer tenant — resolvia qualquer telefone da plataforma inteira para
 * `{ userId, orgId, role, name }`, e com `withScope` levava junto os ids de
 * deals e contratos. Não era superfície futura: os tokens dos agentes já têm
 * esse escopo.
 *
 * O helper canônico (`requireApiAuth`) é o que traz a org do caller — e no
 * caminho de máquina ele pina `subdomainHint: null`, então a org vem do dono do
 * token e não de um `Host` que o cliente controla.
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
 * Resposta NÃO retorna `email` para minimizar superfície.
 */
export async function GET(req: NextRequest) {
  const authed = await requireApiAuth(req, { scope: "metrics:r" });
  if (isAuthFailure(authed)) return authFailureResponse(authed);
  const { ident } = authed;
  const callerOrgId = authed.org.id;

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

  // A resolução mora em `lib/max/user-identity.ts` desde que o
  // `GET /api/agents/user-scope` passou a precisar da mesma resposta com um
  // campo a mais. Duas implementações divergiriam em silêncio, e o que
  // divergiria aqui é a política de 404 — decisão de segurança, não detalhe.
  //
  // **O shape desta resposta NÃO mudou.** A rota tem consumidores de fora
  // (duas MCP tools, contrato no `openapi.json`, teste com `toEqual` exato);
  // o `customRoleId` que a lib passou a trazer fica de fora daqui de
  // propósito.
  const user = await resolveUserByPhone({
    orgId: callerOrgId,
    phoneE164: parsed.data,
  });

  // Um 404 só, para os três casos (não existe / apagado / é de outro tenant):
  // separá-los revelaria que o número pertence a alguém na plataforma.
  if (!user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Versão básica (default)
  const base = {
    userId: user.userId,
    orgId: user.orgId,
    role: user.role,
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

  // Filtrado pela org do caller, não só pelo `userId`. Um usuário multi-org tem
  // deals nas duas casas, e devolver a lista inteira entregaria ids de negócio
  // de um tenant a quem perguntou por outro.
  //
  // Deal escopa por `pipeline.orgId` — não existe `Deal.orgId` (ver
  // lib/security/org-scope.ts).
  const SCOPE_CAP = 500;
  const [deals, contracts] = await Promise.all([
    prisma.deal.findMany({
      where: { userId: user.userId, pipeline: { orgId: callerOrgId } },
      select: { id: true },
      take: SCOPE_CAP,
    }),
    prisma.contract.findMany({
      where: { userId: user.userId, deal: { pipeline: { orgId: callerOrgId } } },
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
