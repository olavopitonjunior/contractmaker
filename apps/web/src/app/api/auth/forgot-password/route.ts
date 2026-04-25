import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { createPasswordResetToken } from "@/lib/auth/password-reset";
import { sendEmail } from "@/lib/email/client";
import { PasswordResetEmail } from "@/lib/email/templates/password-reset";
import { rateLimit } from "@/lib/security/ratelimit";

const schema = z.object({
  email: z.string().email().max(200),
});

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // Rate limit por IP (3 tentativas / hora)
  const rl = await rateLimit({
    identifier: `forgot-pwd:${ip}`,
    limit: 3,
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
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();

  // SEMPRE retorna 200 — não vazar se email existe ou não.
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    try {
      const { token, expiresAt } = await createPasswordResetToken(email, "reset");
      const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
      const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
      const expiresInMinutes = Math.round(
        (expiresAt.getTime() - Date.now()) / 60_000
      );

      await sendEmail({
        to: email,
        subject: "Redefinir sua senha — Contractmaker",
        react: PasswordResetEmail({ resetUrl, expiresInMinutes }) as any,
      });
    } catch (err) {
      console.error("[forgot-password] erro ao enviar email", err);
      // não vazar — manter resposta genérica
    }
  }

  return NextResponse.json({
    ok: true,
    message:
      "Se este email estiver cadastrado, enviaremos instruções de recuperação.",
  });
}
