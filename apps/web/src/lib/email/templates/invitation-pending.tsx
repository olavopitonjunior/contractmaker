import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function InvitationPendingEmail({
  inviterName,
  inviteeName,
  inviteeEmail,
  orgName,
  reviewUrl,
  isApprover,
}: {
  inviterName: string;
  inviteeName: string | null;
  inviteeEmail: string;
  orgName: string;
  reviewUrl: string;
  isApprover: boolean;
}) {
  const headline = isApprover
    ? "Novo convite aguarda sua aprovação"
    : "Novo convite criado";
  return (
    <EmailLayout title={headline}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>{headline}</h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        <strong>{inviterName}</strong> convidou{" "}
        <strong>{inviteeName ?? inviteeEmail}</strong> ({inviteeEmail}) para
        entrar em <strong>{orgName}</strong>.
      </p>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        {isApprover
          ? "Revise e aprove ou rejeite no painel de convites."
          : "Aguarde a aprovação do administrador antes do convidado receber acesso."}
      </p>
      <div style={{ margin: "24px 0" }}>
        <ActionButton
          href={reviewUrl}
          label={isApprover ? "Revisar convite" : "Ver convites"}
        />
      </div>
    </EmailLayout>
  );
}
