"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface ManagerCandidate {
  userId: string;
  name: string | null;
  email: string;
}

export interface ManagerContext {
  managerRequired: boolean;
  candidates: ManagerCandidate[];
}

/**
 * Sentinela do item "Sem gerente" — Radix Select proíbe `value=""` em
 * SelectItem (string vazia é reservada pro estado "nada selecionado" da Root).
 */
const NONE_VALUE = "__none__";

/** Rótulo do candidato: nome quando existe, senão o e-mail. */
export function managerLabel(candidate: ManagerCandidate): string {
  return candidate.name?.trim() || candidate.email;
}

// Cache em memória com TTL (mesmo molde do usePermissions): o contexto é o
// mesmo pra toda a org e várias superfícies montam o select na mesma navegação.
let cache: { ts: number; data: ManagerContext } | null = null;
const TTL_MS = 60_000;

export async function fetchManagerContext(force = false): Promise<ManagerContext> {
  if (!force && cache && Date.now() - cache.ts < TTL_MS) return cache.data;
  // `same-origin` (nunca `omit`): sem o cookie de sessão a rota devolve 401.
  const res = await fetch("/api/deals/manager-context", {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = (await res.json()) as Partial<ManagerContext>;
  const data: ManagerContext = {
    managerRequired: raw?.managerRequired === true,
    candidates: Array.isArray(raw?.candidates) ? raw.candidates : [],
  };
  cache = { ts: Date.now(), data };
  return data;
}

/** Contexto de gerente da org (toggle + candidatos), com dedup entre componentes. */
export function useManagerContext(): { ctx: ManagerContext | null; loading: boolean } {
  const [ctx, setCtx] = useState<ManagerContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchManagerContext()
      .then((data) => {
        if (alive) setCtx(data);
      })
      .catch(() => {
        // Falha silenciosa: o gate real é server-side (422 gerente_obrigatorio).
        if (alive) setCtx(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { ctx, loading };
}

interface ManagerSelectProps {
  value: string | null;
  onChange: (userId: string | null) => void;
  /** Força obrigatoriedade. Omitido = segue o toggle da org (`managerRequired`). */
  required?: boolean;
  disabled?: boolean;
  /** Entrega o contexto carregado pra página validar o submit. */
  onContextLoaded?: (ctx: ManagerContext) => void;
  className?: string;
  id?: string;
}

/**
 * Seletor de gerente responsável, compartilhado pelas superfícies de criação de
 * negócio (vendas e locação) e pelo chip do cabeçalho do deal. Busca o contexto
 * sozinho — a página só precisa guardar o `userId` escolhido.
 */
export function ManagerSelect({
  value,
  onChange,
  required,
  disabled = false,
  onContextLoaded,
  className,
  id,
}: ManagerSelectProps) {
  const autoId = useId();
  const selectId = id ?? `manager-select-${autoId}`;
  const { ctx, loading } = useManagerContext();

  // Ref evita re-disparar o callback quando a página passa uma arrow nova a
  // cada render (loop de setState).
  const onContextLoadedRef = useRef(onContextLoaded);
  onContextLoadedRef.current = onContextLoaded;
  useEffect(() => {
    if (ctx) onContextLoadedRef.current?.(ctx);
  }, [ctx]);

  const candidates = ctx?.candidates ?? [];
  const isRequired = required ?? ctx?.managerRequired ?? false;
  const empty = !loading && candidates.length === 0;

  // Quando não é obrigatório, "sem gerente" é uma opção real e fica visível no
  // trigger; quando é obrigatório, string vazia mantém o placeholder.
  const currentValue = value ?? (isRequired ? "" : NONE_VALUE);

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={selectId}>
        Gerente responsável
        {isRequired && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <Select
        value={currentValue}
        onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
        disabled={disabled || loading || empty}
      >
        <SelectTrigger id={selectId} className="w-full">
          <SelectValue
            placeholder={loading ? "Carregando gerentes..." : "Selecione o gerente"}
          />
        </SelectTrigger>
        <SelectContent>
          {!isRequired && <SelectItem value={NONE_VALUE}>Sem gerente</SelectItem>}
          {candidates.map((c) => (
            <SelectItem key={c.userId} value={c.userId}>
              {managerLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {empty && (
        <p className="text-xs text-muted-foreground">
          Nenhum membro com perfil Gerente — convide em Configurações → Membros.
        </p>
      )}
    </div>
  );
}
