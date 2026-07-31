"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarGroup, SidebarSeparator } from "@/components/ui/sidebar";
import type { OnboardingStatus } from "@/lib/onboarding/status";
import { STEP_META, stepUrl } from "@/lib/onboarding/steps";

/**
 * Checklist "Primeiros passos" no topo da sidebar — o guia persistente do
 * onboarding. Fica ativo até 100%; ao concluir, grava o flag (client-side) e
 * some. Só é montado pra owner com onboarding em aberto (gate no layout).
 *
 * Auto-refetch: o layout server só computa o status uma vez (não re-roda em
 * navegação client), então ações inline (salvar formulário, convidar) não
 * refletiriam. Aqui re-buscamos `GET /api/onboarding/complete` em troca de rota,
 * foco/visibilidade da janela e num poll leve — assim o checklist atualiza sozinho.
 */
export function OnboardingSidebarChecklist({
  status: initialStatus,
  modules,
}: {
  status: OnboardingStatus;
  modules?: { enabled: Record<string, boolean> } | null;
}) {
  const pathname = usePathname();
  const [status, setStatus] = useState(initialStatus);
  const marked = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding/complete");
      if (res.ok) setStatus(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  // Re-busca ao trocar de rota (o dono voltou de /settings/formulario etc.).
  useEffect(() => {
    refetch();
  }, [pathname, refetch]);

  // Re-busca ao focar a janela / voltar a aba visível + poll leve enquanto incompleto.
  useEffect(() => {
    if (status.complete) return;
    const onFocus = () => refetch();
    const onVis = () => {
      if (document.visibilityState === "visible") refetch();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    const id = window.setInterval(refetch, 20000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(id);
    };
  }, [status.complete, refetch]);

  // Ao chegar em 100%, grava "concluído" uma vez (o layout para de mostrar).
  useEffect(() => {
    if (status.complete && !marked.current) {
      marked.current = true;
      fetch("/api/onboarding/complete", { method: "POST" }).catch(() => {});
    }
  }, [status.complete]);

  if (status.complete) return null;

  const locacaoOnly =
    !!modules && !!modules.enabled?.locacao && !modules.enabled?.vendas;
  const firstPending = status.steps.find((s) => !s.done)?.key ?? null;
  const pct = Math.round(
    (status.requiredDone / Math.max(1, status.requiredTotal)) * 100
  );

  return (
    <>
      <SidebarGroup className="gap-0 pb-1">
        <div className="flex items-center justify-between px-2 pb-2">
          <Link
            href="/onboarding"
            className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Primeiros passos
          </Link>
          <span className="rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-primary">
            {status.requiredDone}/{status.requiredTotal}
          </span>
        </div>

        <div className="mx-2 mb-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        <ol className="px-1">
          {status.steps.map((step, i) => {
            const meta = STEP_META[step.key];
            const url = stepUrl(step.key, { locacaoOnly });
            // Alguns destinos levam query (`?novo=1`, `?ingest=1`) — o
            // `pathname` nunca traz, então compare só a parte do caminho.
            const urlPath = url.split("?")[0];
            const active =
              pathname === urlPath || pathname.startsWith(urlPath + "/");
            const isNext = step.key === firstPending;
            const isLast = i === status.steps.length - 1;
            const Icon = meta.icon;
            return (
              <li key={step.key} className="relative">
                <Link
                  href={url}
                  aria-label={`${meta.title} — ${step.done ? "concluído" : "pendente"}`}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] transition-colors",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : isNext
                        ? "bg-brand-accent/10 hover:bg-sidebar-accent"
                        : "hover:bg-sidebar-accent"
                  )}
                >
                  <span className="relative flex-none">
                    <span
                      className={cn(
                        "flex h-[22px] w-[22px] items-center justify-center rounded-full border transition-colors",
                        step.done
                          ? "border-success bg-success text-white"
                          : isNext
                            ? "border-brand-accent text-brand-accent"
                            : "border-border bg-sidebar text-muted-foreground"
                      )}
                    >
                      {step.done ? (
                        <Check className="h-3 w-3 animate-in zoom-in-50 duration-300" strokeWidth={3} />
                      ) : (
                        <Icon className="h-3 w-3" />
                      )}
                    </span>
                    {!isLast && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute left-1/2 top-full h-3 w-0.5 -translate-x-1/2",
                          step.done ? "bg-success" : "bg-border"
                        )}
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className={cn("truncate", step.done && "text-muted-foreground")}>
                      {meta.short}
                    </span>
                    {isNext && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-brand-accent">
                        Próximo
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </SidebarGroup>
      <SidebarSeparator className="my-1" />
    </>
  );
}
