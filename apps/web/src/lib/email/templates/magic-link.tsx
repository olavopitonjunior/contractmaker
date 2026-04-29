import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function MagicLinkEmail({
  signInUrl,
  expiresInMinutes,
}: {
  signInUrl: string;
  expiresInMinutes: number;
}) {
  return (
    <EmailLayout title="Seu link de acesso ao Contractmaker">
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        Acesse sua conta no Contractmaker
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Clique no botão abaixo para entrar. O link é válido por{" "}
        <strong>{expiresInMinutes} minutos</strong> e funciona uma única vez.
      </p>
      <div style={{ margin: "24px 0" }}>
        <ActionButton href={signInUrl} label="Entrar agora" />
      </div>
      <p style={{ fontSize: 13, color: "#737373", lineHeight: 1.6 }}>
        Se você não pediu este link, ignore este email — sua conta permanece
        segura.
      </p>
    </EmailLayout>
  );
}
