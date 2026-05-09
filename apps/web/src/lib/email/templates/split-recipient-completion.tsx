import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

const PENDING_LABEL: Record<string, string> = {
  pixAddressKey: "chave PIX",
  walletId: "wallet ID Asaas",
};

export function SplitRecipientCompletionEmail({
  recipientName,
  pendingFields,
  link,
  expiresAt,
}: {
  recipientName: string;
  pendingFields: string[];
  link: string;
  expiresAt: string;
}) {
  const items = pendingFields
    .map((f) => PENDING_LABEL[f] ?? f)
    .join(", ");
  return (
    <EmailLayout title="Complete seu cadastro">
      <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 0 }}>
        Complete seu cadastro
      </h1>
      <p>
        Olá {recipientName}, faltam dados para você receber repasses pelo
        Contractmaker. Precisamos de: <strong>{items}</strong>.
      </p>
      <div style={{ marginTop: 24 }}>
        <ActionButton href={link} label="Completar cadastro" />
      </div>
      <p style={{ fontSize: 12, color: "#737373", marginTop: 16 }}>
        Link válido até {expiresAt}.
      </p>
    </EmailLayout>
  );
}
