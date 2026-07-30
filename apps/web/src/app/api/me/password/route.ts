import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";
import { decryptTotpSecret, verifyTotpCode } from "@/lib/security/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `currentPassword` é opcional porque conta criada por convite/provisionamento
// nasce sem `passwordHash` — não há senha antiga pra confirmar. A sessão já
// autentica a pessoa; a exigência volta assim que existe hash (abaixo).
const schema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8).max(200),
  twoFactorCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional(),
});

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent");

  const rl = await rateLimit({
    identifier: `change-pwd:${userId}`,
    limit: 5,
    window: "1 h",
  });
  if (!rl.success) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos. Nova senha precisa ter pelo menos 8 caracteres." },
      { status: 400 }
    );
  }
  const { currentPassword, newPassword, twoFactorCode } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(userId).catch(() => null);
  const auditCtx = {
    orgId: org?.id ?? "system",
    userId,
    ipAddress: ip,
    userAgent,
  };

  // Primeiro acesso (conta sem senha): não há senha antiga a confirmar.
  const isFirstPassword = !user.passwordHash;

  if (!isFirstPassword) {
    if (!currentPassword) {
      return NextResponse.json(
        { error: "Informe a senha atual" },
        { status: 400 }
      );
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash!);
    if (!ok) {
      await audit(auditCtx, {
        action: "PASSWORD_CHANGE",
        result: "FAILURE",
        metadata: { reason: "wrong_current_password" },
      }).catch(() => {});
      return NextResponse.json({ error: "Senha atual incorreta" }, { status: 401 });
    }
  }

  const totpRow = await prisma.twoFactorSecret.findUnique({
    where: { userId },
  });
  if (totpRow?.enabled) {
    if (!twoFactorCode) {
      return NextResponse.json(
        { error: "Código 2FA é obrigatório", requires2FA: true },
        { status: 400 }
      );
    }
    const secret = decryptTotpSecret({
      ciphertext: totpRow.secretEncrypted,
      iv: totpRow.secretIvBase64,
      tag: totpRow.secretTagBase64,
    });
    if (!verifyTotpCode(secret, twoFactorCode)) {
      await audit(auditCtx, {
        action: "PASSWORD_CHANGE",
        result: "FAILURE",
        metadata: { reason: "wrong_2fa_code" },
      }).catch(() => {});
      return NextResponse.json(
        { error: "Código 2FA incorreto" },
        { status: 401 }
      );
    }
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  await prisma.session
    .deleteMany({ where: { userId } })
    .catch(() => {});

  await audit(auditCtx, {
    action: "PASSWORD_CHANGE",
    result: "SUCCESS",
    resourceType: "user",
    resource: `user:${userId}`,
    metadata: { firstPassword: isFirstPassword },
  }).catch(() => {});

  return NextResponse.json({ ok: true, firstPassword: isFirstPassword });
}
