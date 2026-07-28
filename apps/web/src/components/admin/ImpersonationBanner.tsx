"use client";

import { useState } from "react";

/**
 * Barra de aviso quando o super-admin está operando um tenant que não é o dele
 * (Fase 1e). "Sair" encerra a sessão (DELETE) e volta pra org de origem.
 */
export function ImpersonationBanner({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function stop() {
    setBusy(true);
    try {
      await fetch(`/api/admin/orgs/${orgId}/impersonate`, { method: "DELETE" });
      // Volta pro app na org de origem (o cookie já foi limpo). "/" roteia por módulo.
      window.location.href = "/";
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-[hsl(var(--brand-accent))] px-4 py-1.5 text-center text-xs font-medium text-[hsl(var(--brand-accent-foreground))]">
      <span>
        ⚠ Você está operando {orgName ? <strong>{orgName}</strong> : "este tenant"} como
        o dono. Toda ação é auditada em nome da sua conta.
      </span>
      <button
        onClick={stop}
        disabled={busy}
        className="rounded bg-black/20 px-2 py-0.5 underline-offset-2 hover:underline disabled:opacity-50"
      >
        {busy ? "Saindo…" : "Sair"}
      </button>
    </div>
  );
}
