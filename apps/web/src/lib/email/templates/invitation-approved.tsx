import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

/**
 * Convite aprovado. Dois modos:
 * - `set-password` (padrão): conta recém-criada, sem senha. O link leva a
 *   /reset-password?token= e a pessoa CRIA a senha na hora.
 * - `login`: a pessoa já tinha conta com senha nesta plataforma; só ganhou
 *   acesso a mais uma organização. Aqui não há senha pra criar.
 */
export function InvitationApprovedEmail({
  inviteeName,
  orgName,
  actionUrl,
  mode = "set-password",
}: {
  inviteeName: string | null;
  orgName: string;
  actionUrl: string;
  mode?: "set-password" | "login";
}) {
  const isSetPassword = mode === "set-password";

  return (
    <EmailLayout title={`Acesso aprovado em ${orgName}`}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        Bem-vindo{inviteeName ? `, ${inviteeName}` : ""}
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Seu acesso a <strong>{orgName}</strong> foi aprovado.
      </p>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        {isSetPassword
          ? "Clique no botão abaixo para criar sua senha de acesso e entrar. Não é preciso ter senha nenhuma antes disso — você define a sua agora."
          : "Use sua senha de sempre para entrar. Sua conta agora tem acesso a esta organização."}
      </p>
      <div style={{ margin: "24px 0" }}>
        <ActionButton
          href={actionUrl}
          label={isSetPassword ? "Criar minha senha" : "Entrar agora"}
        />
      </div>
      <p style={{ fontSize: 13, color: "#737373" }}>
        {isSetPassword
          ? "Este link expira em 7 dias. Se ele vencer, use “Esqueci minha senha” na tela de login com este mesmo e-mail."
          : "Se você não esperava este acesso, ignore este email."}
      </p>
    </EmailLayout>
  );
}
