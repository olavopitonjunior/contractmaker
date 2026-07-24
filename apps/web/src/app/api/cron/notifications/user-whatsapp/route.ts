import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { sweepUserNotifications } from "@/lib/notifications/user-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Canal externo das notificações do sistema → usuários da plataforma
 * (WhatsApp via Newton), a cada 5 min.
 *
 * É o caminho ÚNICO de despacho, por escolha: `emitNotification` é `await`ada
 * dentro de handlers de request em ~11 lugares e seu contrato é "insert puro
 * que nunca rejeita" — cutucar o sidecar lá dentro seria latência no request
 * path. Varrer a tabela dá o mesmo alcance (todo tipo da allowlist entra sem
 * tocar em call-site) sem esse custo.
 *
 * Sem risco de rajada ao ligar a feature: o sweep só olha os últimos 30 min,
 * a preferência nasce opt-out e há cap por usuário/hora.
 */
export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  if (!(await isCronAllowedInStaging("/api/cron/notifications/user-whatsapp"))) {
    return NextResponse.json({ skipped: "staging" });
  }

  const result = await sweepUserNotifications();
  return NextResponse.json(result);
}
