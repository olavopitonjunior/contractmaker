import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { requireOrgAdmin } from "@/lib/security/org-scope";
import { runPreflight } from "@/lib/dev/preflight";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/preflight-qa
 *
 * Diagnóstico do ambiente antes de rodar o QA UX/UI do módulo Pagadoria.
 * Verifica env vars, database, Asaas, email, rate limit e deals.
 *
 * Requer sessão autenticada. Não modifica state. Seguro em produção.
 *
 * Uso típico (no Claude Chrome, logado):
 *   fetch('/api/admin/preflight-qa', { credentials: 'include' })
 *     .then(r => r.json()).then(console.log)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Preflight exercita integrações pagas e expõe estado de infra — owner/admin.
  const gate = await requireOrgAdmin(session.user.id);
  if (!gate.ok) return gate.res;

  const org = await getUserOrg(session.user.id);
  const orgId = org?.id ?? null;

  const report = await runPreflight(orgId);
  return NextResponse.json(report);
}
