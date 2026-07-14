import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import {
  getSignatureSettings,
  isClickSignConfigured,
} from "@/lib/clicksign/account";

export const runtime = "nodejs";

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

  return NextResponse.json({
    configured,
    defaultAuthMethod: settings.defaultAuthMethod,
    allowedAuthMethods: settings.allowedAuthMethods,
  });
}
