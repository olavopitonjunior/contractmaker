import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import {
  getSignatureSettings,
  isClickSignConfigured,
} from "@/lib/clicksign/account";
import { costCentsForMethod } from "@/lib/clicksign/costs";
import type { AuthMethod } from "@/lib/clicksign/types";

export const runtime = "nodejs";

const AUTH_METHODS: AuthMethod[] = ["email", "whatsapp", "selfie", "icp_brasil"];

/**
 * Config leve de assinatura pra os diálogos de envio (qualquer membro da org).
 * Expõe só o necessário — métodos permitidos, método padrão e se a org está
 * configurada pra enviar — sem dados sensíveis (token/secret ficam nos
 * endpoints admin /api/settings/clicksign).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const [settings, configured] = await Promise.all([
    getSignatureSettings(org.id),
    isClickSignConfigured(org.id),
  ]);

  // Custo por método (override per-org sobre a tabela global) — usado pelos
  // diálogos de envio pra estimar o custo do método escolhido.
  const overrides = settings.costOverridesJson as Record<string, unknown> | null;
  const costCentsByMethod = Object.fromEntries(
    AUTH_METHODS.map((m) => [m, costCentsForMethod(m, overrides)])
  ) as Record<AuthMethod, number>;

  return NextResponse.json({
    configured,
    defaultAuthMethod: settings.defaultAuthMethod,
    allowedAuthMethods: settings.allowedAuthMethods,
    costCentsByMethod,
  });
}
