import { NextResponse } from "next/server";

/**
 * ⚠️ DEPRECATED (2026-07-15)
 *
 * Endpoint legado pré-Deal que criava Contract a partir de LegacyTemplate
 * SEM autenticação nenhuma — nenhum caller no código. A criação real de
 * contratos é via geração pelo deal (contract-generation) ou import
 * (/api/deals/import-contract), ambas autenticadas e escopadas por org.
 *
 * Mantém o endpoint apenas para retornar 410 Gone — mesma convenção do
 * /api/auth/register desativado.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Endpoint desativado. Crie contratos pelo negócio (deal)." },
    { status: 410 }
  );
}
