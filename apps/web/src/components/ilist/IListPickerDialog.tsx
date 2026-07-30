"use client";

// Picker reutilizável de imóveis do iList (RE/MAX). Busca no espelho local
// org-scoped (código, endereço, cidade ou corretor — debounce 300ms) e, ao
// selecionar, busca o payload de import (3 shapes prontos + fotos) em
// GET /api/ilist/listings/[id]. Usado por: locação (ImportarCrmDialog),
// vendas (new-from-ilist) e propostas (ProposalForm).

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Loader2, Search } from "lucide-react";

export interface IListListingItem {
  id: string;
  ilistId: string;
  listingCode: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  price: number | null;
  currency: string | null;
  transactionType: number;
  listingStatus: number;
  statusLabel: string;
  associateName: string | null;
  bedrooms: number | null;
  builtArea: number | null;
  coverImageUrl: string | null;
}

export interface IListImportPayload {
  ilistId: string;
  listingCode: string | null;
  transactionType: number;
  listingStatus: number;
  statusLabel: string;
  locacaoFields: Record<string, unknown>;
  vendasImovel: Record<string, string>;
  proposalSnapshot: { endereco: string; listingCode?: string; preco?: number; ilistId: string };
  comissao: { totalPct?: number; corretor?: { nome: string; creci?: string } };
  fotos: string[];
}

type TransactionFilter = "venda" | "locacao";

function formatPrice(price: number | null, currency: string | null): string {
  if (price === null) return "Sob consulta";
  if (currency && currency.toUpperCase() !== "BRL") {
    return `${currency} ${price.toLocaleString("pt-BR")}`;
  }
  return price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function IListPickerDialog({
  open,
  onOpenChange,
  transactionType,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Trava o filtro venda/locação quando a superfície fixa o tipo. */
  transactionType?: TransactionFilter;
  onSelect: (payload: IListImportPayload, item: IListListingItem) => void | Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filter, setFilter] = useState<TransactionFilter>(transactionType ?? "venda");
  const [items, setItems] = useState<IListListingItem[] | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const effectiveFilter = transactionType ?? filter;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ transactionType: effectiveFilter, take: "30" });
    if (debouncedQ) params.set("q", debouncedQ);
    fetch(`/api/ilist/listings?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setConfigured(json.configured);
        if (json.configured) {
          setItems(json.items);
          setSyncedAt(json.syncedAt);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof Error ? err.message : "Erro ao buscar imóveis");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, debouncedQ, effectiveFilter, retryTick]);

  async function handleSelect(item: IListListingItem) {
    setSelectingId(item.id);
    try {
      const res = await fetch(`/api/ilist/listings/${item.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      await onSelect(json.payload as IListImportPayload, item);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar o imóvel");
    } finally {
      setSelectingId(null);
    }
  }

  const emptyLabel = useMemo(() => {
    if (debouncedQ) return `Nenhum imóvel encontrado para "${debouncedQ}".`;
    return syncedAt
      ? "Nenhum imóvel ativo no catálogo pra este filtro."
      : "Primeira sincronização do catálogo ainda em andamento. Tente novamente em instantes.";
  }, [debouncedQ, syncedAt]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Buscar imóvel no iList</DialogTitle>
          <DialogDescription>
            Catálogo RE/MAX da sua imobiliária
            {syncedAt
              ? ` · sincronizado ${new Date(syncedAt).toLocaleString("pt-BR")}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {configured === false ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
            Integração iList não habilitada para esta imobiliária — fale com o suporte.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Código, endereço, cidade ou corretor…"
                  className="pl-8"
                />
              </div>
              {!transactionType && (
                <div className="flex rounded-md border p-0.5">
                  {(["venda", "locacao"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                        filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {f === "venda" ? "Venda" : "Locação"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {loadError && (
              <div className="flex items-center justify-between rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                <span>{loadError}</span>
                <Button size="sm" variant="outline" onClick={() => setRetryTick((t) => t + 1)}>
                  Tentar novamente
                </Button>
              </div>
            )}

            <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
              {loading && !items && (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
                </div>
              )}
              {items && items.length === 0 && !loading && (
                <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
              )}
              {items?.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={selectingId !== null}
                  onClick={() => handleSelect(item)}
                  className="flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/50 disabled:opacity-60"
                >
                  <div className="flex h-14 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {item.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.coverImageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Building2 className="h-6 w-6 text-muted-foreground/50" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {item.listingCode && (
                        <span className="rounded bg-muted px-1.5 font-mono text-xs text-muted-foreground">
                          #{item.listingCode}
                        </span>
                      )}
                      <span className="truncate text-sm font-medium">
                        {item.endereco ?? "Endereço não informado"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{[item.cidade, item.uf].filter(Boolean).join("/") || "—"}</span>
                      {item.bedrooms ? <span>· {item.bedrooms} dorm.</span> : null}
                      {item.builtArea ? <span>· {item.builtArea}m²</span> : null}
                      {item.associateName && (
                        <span className="truncate">· {item.associateName}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold">
                      {formatPrice(item.price, item.currency)}
                    </div>
                    <Badge variant="outline" className="mt-0.5 text-[10px]">
                      {item.statusLabel}
                    </Badge>
                  </div>
                  {selectingId === item.id && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>

            {loading && items && (
              <p className="text-center text-xs text-muted-foreground">Atualizando…</p>
            )}
          </>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
