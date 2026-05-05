import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * GET /api/openapi.json
 *
 * Serve o spec OpenAPI 3.1 do Contractmaker. Sem auth (descoberta pública —
 * agentes precisam ler antes de obter token). Cache forte: spec só muda em
 * deploys, e sempre vem com hash no Vercel CDN.
 *
 * Spec gerado por scripts/generate-openapi.ts (rodado no prebuild).
 */
export function GET() {
  try {
    const filePath = path.join(process.cwd(), "public", "openapi.json");
    const content = fs.readFileSync(filePath, "utf8");
    const spec = JSON.parse(content);
    return NextResponse.json(spec, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    });
  } catch (err) {
    console.error(
      "[openapi.json] falha ao ler spec:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "OpenAPI spec não disponível", reason: "rodar `npm run gen:openapi` antes do build" },
      { status: 503 }
    );
  }
}
