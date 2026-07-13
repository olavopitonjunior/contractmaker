import { createPasswordResetToken } from "@/lib/auth/password-reset";
import { sendEmail } from "@/lib/email/client";
import { OwnerAccessEmail } from "@/lib/email/templates/password-reset";

/**
 * Envia ao dono de um tenant o link de primeiro acesso (definir senha).
 *
 * A criação de org pelo painel super-admin gera uma senha temporária que só existia
 * na resposta da API — na prática o tenant nascia inacessível. Este é o caminho de
 * entrega: token `welcome` (7 dias) + link pro /reset-password.
 *
 * Nunca lança: falha de e-mail não pode derrubar a criação da org (a senha temporária
 * segue como fallback na tela do admin). Retorna se o envio foi aceito.
 */
export async function sendOwnerAccessEmail(input: {
  email: string;
  orgName: string;
}): Promise<boolean> {
  try {
    const { token } = await createPasswordResetToken(input.email, "welcome");
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const setupUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: input.email,
      subject: `Seu acesso ao imobpro.ai — ${input.orgName}`,
      react: OwnerAccessEmail({ orgName: input.orgName, setupUrl }) as any,
    });
    return true;
  } catch (err) {
    console.error("[owner-access] falha ao enviar e-mail de acesso:", err);
    return false;
  }
}
