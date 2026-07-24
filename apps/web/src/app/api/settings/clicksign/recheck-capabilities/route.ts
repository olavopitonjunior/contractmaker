import { NextResponse } from "next/server";
import { requireClickSignAdmin } from "@/lib/clicksign/settings-guard";
import { detectAndCacheCapabilities } from "@/lib/clicksign/capabilities";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/settings/clicksign/recheck-capabilities — "Reverificar recursos".
 * Roda o probe custo-zero (rascunho descartado) contra a conta ClickSign do
 * tenant e cacheia whatsappSignatureAvailable/acceptanceWhatsappAvailable em
 * OrgSignatureSettings. Útil quando o tenant faz upgrade de plano (ex.: Start→Plus)
 * — antes isso era setado à mão no banco.
 */
export async function POST() {
  const gate = await requireClickSignAdmin();
  if (!gate.ok) return gate.response;

  const result = await detectAndCacheCapabilities(gate.ctx.orgId);
  if ("error" in result) {
    return NextResponse.json(
      { error: "ClickSign não conectada nesta organização." },
      { status: 409 }
    );
  }
  await audit(
    { orgId: gate.ctx.orgId, userId: gate.ctx.userId },
    {
      action: "CLICKSIGN_SETTINGS_UPDATED",
      result: "SUCCESS",
      resourceType: "OrgSignatureSettings",
      metadata: {
        action: "recheck_capabilities",
        whatsappSignatureAvailable: result.whatsappSignatureAvailable,
        acceptanceWhatsappAvailable: result.acceptanceWhatsappAvailable,
      },
    }
  ).catch(() => {});

  return NextResponse.json({
    ok: true,
    whatsappSignatureAvailable: result.whatsappSignatureAvailable,
    acceptanceWhatsappAvailable: result.acceptanceWhatsappAvailable,
    checkedAt: result.checkedAt,
  });
}
