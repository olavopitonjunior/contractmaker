"use client";

import { useState } from "react";

/**
 * Barra de aviso quando o super-admin está impersonando um tenant (Fase 1e).
 * "Sair" encerra a sessão (DELETE) e volta pro painel admin.
 */
export function ImpersonationBanner({ orgId }: { orgId: string }) {
  const [busy, setBusy] = useState(false);

  async function stop() {
    setBusy(true);
    try {
      await fetch(`/api/admin/orgs/${orgId}/impersonate`, { method: "DELETE" });
      window.location.href = "/admin/orgs";
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-[hsl(var(--brand-accent))] px-4 py-1.5 text-center text-xs font-medium text-[hsl(var(--brand-accent-foreground))]">
      <span>⚠ Modo suporte — você está impersonando este tenant. Toda ação é auditada.</span>
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
