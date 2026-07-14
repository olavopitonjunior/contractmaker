import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * APOSENTADO (2026-07-14).
 *
 * Este endpoint gravava a marca da imobiliária em `OrgFinancialSettings.brand*`
 * — colunas 1:1 com a CONTA ASAAS, hoje deprecated e que **ninguém mais lê**.
 * Deixá-lo escrevendo seria pior do que aposentá-lo: o dado entraria e morreria
 * ali, sem aparecer na /pay, nos e-mails nem na sidebar — que é exatamente o bug
 * de "duas fontes sem reconciliação" que a unificação matou.
 *
 * Falha alto e diz onde é o novo lugar, em vez de aceitar um write órfão.
 * Fonte canônica: `BrandingSettings` via `/api/org/branding`.
 */
const GONE = {
  error: "ENDPOINT_APOSENTADO",
  message:
    "A identidade visual agora é da imobiliária (não da conta de recebimento). Use GET/PATCH /api/org/branding.",
  replacement: "/api/org/branding",
};

export async function GET() {
  return NextResponse.json(GONE, { status: 410 });
}

export async function PATCH() {
  return NextResponse.json(GONE, { status: 410 });
}
