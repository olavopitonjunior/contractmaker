import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { detectPixKeyType } from "@/lib/asaas/pix";
import { verifyCompletionToken } from "@/lib/financeiro/completion-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/split-recipients/complete
 *
 * Página pública (sem login). Token JWT-HMAC é a auth — o destinatário
 * recebeu por email. Marca recipient `active: true` e esvazia pendingFields.
 */

const bodySchema = z.object({
  token: z.string().min(20),
  pixAddressKey: z.string().trim().min(3).max(200).optional(),
  walletId: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Servidor mal configurado" }, { status: 500 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const verify = verifyCompletionToken(parsed.data.token, secret);
  if (!verify.ok || !verify.payload) {
    return NextResponse.json(
      { error: verify.error ?? "Token inválido" },
      { status: 401 }
    );
  }

  const recipient = await prisma.splitRecipient.findFirst({
    where: { id: verify.payload.recipientId, orgId: verify.payload.orgId },
  });
  if (!recipient) {
    return NextResponse.json({ error: "Destinatário não encontrado" }, { status: 404 });
  }

  // Token deve bater com o persistido — invalida após uso ou reissue
  if (recipient.completionToken !== parsed.data.token) {
    return NextResponse.json(
      { error: "Token revogado — peça um novo link" },
      { status: 401 }
    );
  }
  if (
    recipient.completionTokenExp &&
    recipient.completionTokenExp.getTime() < Date.now()
  ) {
    return NextResponse.json({ error: "Token expirado" }, { status: 401 });
  }

  // Aplica os campos faltantes
  const pending = new Set(recipient.pendingFields ?? []);
  const updateData: Record<string, unknown> = {};

  if (pending.has("pixAddressKey")) {
    if (!parsed.data.pixAddressKey) {
      return NextResponse.json(
        { error: "Chave PIX obrigatória" },
        { status: 400 }
      );
    }
    const keyType = detectPixKeyType(parsed.data.pixAddressKey);
    if (!keyType) {
      return NextResponse.json(
        { error: "Chave PIX inválida (formato não reconhecido)" },
        { status: 400 }
      );
    }
    updateData.pixAddressKey = parsed.data.pixAddressKey;
    updateData.pixKeyType = keyType;
    pending.delete("pixAddressKey");
  }

  if (pending.has("walletId")) {
    if (!parsed.data.walletId) {
      return NextResponse.json(
        { error: "Wallet ID obrigatório" },
        { status: 400 }
      );
    }
    updateData.walletId = parsed.data.walletId;
    pending.delete("walletId");
  }

  updateData.pendingFields = Array.from(pending);
  updateData.active = pending.size === 0;
  updateData.completionToken = null;
  updateData.completionTokenExp = null;

  await prisma.splitRecipient.update({
    where: { id: recipient.id },
    data: updateData,
  });

  await audit(
    {
      orgId: recipient.orgId,
      userId: null,
      ipAddress: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
    {
      action: "SPLIT_RECIPIENT_COMPLETED",
      result: "SUCCESS",
      resourceType: "split_recipient",
      resource: `split_recipient:${recipient.id}`,
      metadata: {
        via: "magic_link",
        completedFields: Object.keys(updateData).filter(
          (k) => k !== "pendingFields" && k !== "active" && k !== "completionToken" && k !== "completionTokenExp"
        ),
      },
    }
  );

  return NextResponse.json({ ok: true, active: pending.size === 0 });
}
