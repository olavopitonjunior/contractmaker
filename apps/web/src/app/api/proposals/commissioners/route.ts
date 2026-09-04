import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireApiAuth, isAuthFailure, authFailureResponse } from "@/lib/api/require-auth";
import { getEffectivePermissions, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";

/**
 * GET /api/proposals/commissioners?q= — busca no registry de corretores
 * (SplitRecipient kind="commissioner") para o repeater "Corretores parceiros"
 * da proposta.
 *
 * Existe porque `/api/financeiro/split-recipients` exige SPLIT_VIEW (tela
 * financeira): um corretor que pode CRIAR proposta, mas não vê a pagadoria,
 * receberia 403 e o combobox mostraria "falha ao buscar". Aqui o gate é o
 * mesmo da criação (PROPOSAL_CREATE ou PROPOSAL_SEND) e a projeção é só
 * contato — nada de PIX/conta, que é o que a tela financeira protege.
 */
const LIST_LIMIT = 50;

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  if (!can(eff, PERMISSION.PROPOSAL_CREATE) && !can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const digits = q.replace(/\D/g, "");
  const where = {
    orgId: auth.org.id,
    kind: "commissioner",
    archivedAt: null,
    ...(q
      ? {
          OR: [
            { label: { contains: q, mode: "insensitive" as const } },
            { creci: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            ...(digits.length >= 3
              ? [{ cpfCnpj: { contains: digits } }, { phone: { contains: digits } }]
              : []),
          ],
        }
      : {}),
  };

  const rows = await prisma.splitRecipient.findMany({
    where,
    orderBy: [{ label: "asc" }],
    take: LIST_LIMIT + 1,
    select: {
      id: true,
      label: true,
      tipoPessoa: true,
      creci: true,
      papel: true,
      email: true,
      phone: true,
      pendingFields: true,
    },
  });
  const hasMore = rows.length > LIST_LIMIT;
  const items = (hasMore ? rows.slice(0, LIST_LIMIT) : rows).map((r) => ({
    id: r.id,
    label: r.label,
    tipoPessoa: r.tipoPessoa === "juridica" ? "juridica" : "fisica",
    creci: r.creci ?? null,
    papel: r.papel ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    receivingPending: r.pendingFields.length > 0,
  }));
  return NextResponse.json({ items, hasMore });
}
