import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import {
  consumePasswordResetToken,
  peekPasswordResetToken,
} from "@/lib/auth/password-reset";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";
import { getUserOrg } from "@/lib/auth/auth";

const postSchema = z.object({
  token: z.string().min(16).max(200),
  password: z.string().min(8).max(200),
});

const getSchema = z.object({
  token: z.string().min(16).max(200),
});

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * GET /api/auth/reset-password?token=... — verifica validade do token sem
 * consumir. Usado pela página /reset-password para renderizar UI antes de
 * pedir senha (e detectar fluxo welcome vs reset).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = getSchema.safeParse({ token: url.searchParams.get("token") });
  if (!parsed.success) {
    return NextResponse.json({ valid: false }, { status: 200 });
  }

  const peek = await peekPasswordResetToken(parsed.data.token);
  if (!peek) {
    return NextResponse.json({ valid: false }, { status: 200 });
  }

  return NextResponse.json({
    valid: true,
    email: peek.email,
    reason: peek.reason,
  });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // Rate limit por IP (10 tentativas / hora) — protege contra brute force de tokens
  const rl = await rateLimit({
    identifier: `reset-pwd:${ip}`,
    limit: 10,
    window: "1 h",
  });
  if (!rl.success) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos. A senha precisa ter ao menos 8 caracteres." },
      { status: 400 }
    );
  }

  const consumed = await consumePasswordResetToken(parsed.data.token);
  if (!consumed) {
    return NextResponse.json(
      { error: "Token inválido ou expirado. Solicite um novo link." },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: consumed.email },
  });
  if (!user) {
    return NextResponse.json(
      { error: "Conta não encontrada. Solicite um novo convite." },
      { status: 404 }
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  // Invalida todas as sessões NextAuth ativas (DB sessions) — JWT permanece
  // válido até expirar, mas próximas autenticações usam senha nova.
  await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {});

  // Audit log — busca org do user (best-effort, opcional)
  const org = await getUserOrg(user.id).catch(() => null);
  await audit(
    {
      orgId: org?.id ?? "system",
      userId: user.id,
      ipAddress: ip,
      userAgent: req.headers.get("user-agent"),
    },
    {
      action: consumed.reason === "welcome" ? "PASSWORD_INITIAL_SET" : "PASSWORD_RESET",
      result: "SUCCESS",
      resourceType: "user",
      resource: `user:${user.id}`,
      metadata: { reason: consumed.reason },
    }
  ).catch((err) => {
    console.warn("[reset-password] audit fail", err);
  });

  return NextResponse.json({
    ok: true,
    email: user.email,
    reason: consumed.reason,
  });
}
