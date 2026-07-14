import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/security/crypto";
import { requireClickSignAdmin } from "@/lib/clicksign/settings-guard";

export const runtime = "nodejs";

const schema = z.object({ secret: z.string().min(8).max(500) });

/**
 * PATCH — fallback manual: quando a ClickSign não devolve o HMAC secret na
 * criação do webhook, o usuário copia o secret do painel ClickSign e cola aqui.
 */
export async function PATCH(req: NextRequest) {
  const gate = await requireClickSignAdmin();
  if (!gate.ok) return gate.response;
  const { orgId } = gate.ctx;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Secret inválido" }, { status: 400 });
  }

  const account = await prisma.clickSignAccount.findUnique({ where: { orgId } });
  if (!account) {
    return NextResponse.json(
      { error: "Conecte a conta ClickSign antes de configurar o secret." },
      { status: 400 }
    );
  }

  const enc = encryptSecret(parsed.data.secret.trim());
  await prisma.clickSignAccount.update({
    where: { orgId },
    data: {
      webhookSecretEncrypted: enc.ciphertext,
      webhookSecretIvBase64: enc.iv,
      webhookSecretTagBase64: enc.tag,
    },
  });

  return NextResponse.json({ ok: true });
}
