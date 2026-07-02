import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { searchMunicipios } from "@/lib/dimob/municipios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dimob/municipios?q=<nome>&uf=<UF>
 * Autocomplete da Tabela de Municípios (TOM) da RFB para o campo de código do
 * município na DIMOB. Retorna até 20 resultados { tom, uf, nome, ibge }.
 * Dado público de referência — exige apenas sessão autenticada.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;

  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, 80);
  const uf = (sp.get("uf") ?? "").slice(0, 2) || undefined;

  const results = searchMunicipios(q, uf, 20);
  return NextResponse.json({ results });
}
