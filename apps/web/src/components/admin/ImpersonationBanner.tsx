"use client";

import { useEffect, useState } from "react";
import { impersonationBannerState } from "@/lib/auth/impersonation-banner-state";

/**
 * Barra de aviso quando o super-admin está operando um tenant que não é o dele
 * (Fase 1e). "Sair" encerra a sessão (DELETE) e volta pra org de origem.
 *
 * A sessão tem TTL (8h). A página é renderizada uma vez e pode ficar aberta
 * além disso — e aí o servidor já recusa as rotas do tenant (404) enquanto a
 * barra continua afirmando o contrário. Medido em produção (issue #587): o
 * diagnóstico só fechou indo ao banco. Agora a barra mostra a hora do
 * vencimento e, passada a hora, troca a mensagem por conta própria.
 */
export function ImpersonationBanner({
  orgId,
  orgName,
  endsAt,
}: {
  orgId: string;
  orgName?: string;
  /** ISO — vencimento da sessão de impersonation. */
  endsAt?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [endsAt]);

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

  const state = impersonationBannerState(endsAt, now);
  const expired = state.kind === "expired";

  return (
    <div
      className={
        expired
          ? "flex items-center justify-center gap-3 bg-destructive px-4 py-1.5 text-center text-xs font-medium text-destructive-foreground"
          : "flex items-center justify-center gap-3 bg-[hsl(var(--brand-accent))] px-4 py-1.5 text-center text-xs font-medium text-[hsl(var(--brand-accent-foreground))]"
      }
    >
      <span>
        {expired ? (
          <>
            ⚠ A sessão de teste em {orgName ? <strong>{orgName}</strong> : "este tenant"}{" "}
            <strong>venceu</strong> — as ações serão recusadas. Reabra em Admin → Tenants.
          </>
        ) : (
          <>
            ⚠ Você está operando {orgName ? <strong>{orgName}</strong> : "este tenant"} como
            o dono. Toda ação é auditada em nome da sua conta.
            {state.kind === "active" ? ` Expira às ${state.expiresAtLabel}.` : ""}
          </>
        )}
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
