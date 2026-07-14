import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * APOSENTADO (2026-07-14).
 *
 * Gravava o logo em `OrgFinancialSettings.brandLogoUrl` (1:1 com a conta Asaas)
 * e exigia uma conta configurável — devolvia 422 sem ela, então uma imobiliária
 * recém-cadastrada não conseguia sequer subir o próprio logo. Hoje essas colunas
 * estão deprecated e ninguém as lê: um upload aqui subiria o arquivo pro Blob e
 * gravaria a URL num campo morto.
 *
 * Substituto: `POST /api/org/branding/logo` — grava em `BrandingSettings` e não
 * depende de meio de pagamento.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "ENDPOINT_APOSENTADO",
      message:
        "O logo agora é da imobiliária (não da conta de recebimento). Use POST /api/org/branding/logo.",
      replacement: "/api/org/branding/logo",
    },
    { status: 410 }
  );
}
