"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Search, Building2, FileText, User, Wallet, Plus, LayoutDashboard, ClipboardList } from "lucide-react";

interface SearchResult {
  id: string;
  type: "contrato" | "imovel" | "pessoa" | "cobranca";
  title: string;
  subtitle?: string;
  href: string;
}

const TYPE_ICON: Record<SearchResult["type"], React.ComponentType<{ className?: string }>> = {
  contrato: FileText,
  imovel: Building2,
  pessoa: User,
  cobranca: Wallet,
};

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  contrato: "Contratos",
  imovel: "Imóveis",
  pessoa: "Pessoas",
  cobranca: "Cobranças",
};

const QUICK_ACTIONS = [
  { label: "Ir para Dashboard de Locação", href: "/locacao", icon: LayoutDashboard },
  { label: "Ir para Pipeline de Locação", href: "/pipeline/locacao", icon: ClipboardList },
  { label: "Ir para Contratos", href: "/locacao/contratos", icon: FileText },
  { label: "Ir para Imóveis", href: "/locacao/imoveis", icon: Building2 },
  { label: "Ir para Cobranças", href: "/locacao/cobrancas", icon: Wallet },
  { label: "Ir para Despesas", href: "/locacao/despesas", icon: Wallet },
  { label: "Ir para Repasses", href: "/locacao/repasses", icon: Wallet },
  { label: "Cadastrar novo imóvel", href: "/locacao/imoveis?new=1", icon: Plus },
];

// Componente global que gerencia o estado do CommandDialog + atalho cmd+k.
// Renderizado uma vez por sessão dentro do DashboardHeader via `<CommandTrigger />`.
export function CommandTrigger() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Atalho cmd+k / ctrl+k.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Search debounced.
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search/global?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = (await res.json()) as { results: SearchResult[] };
          setResults(data.results);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function handleSelect(href: string) {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(href);
  }

  // Agrupa resultados por tipo.
  const byType = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="relative h-9 w-9 p-0 sm:h-9 sm:w-auto sm:px-3"
      >
        <Search className="h-4 w-4 sm:mr-1.5" />
        <span className="hidden text-xs text-muted-foreground sm:inline">Buscar…</span>
        <kbd className="ml-2 hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Buscar contratos, imóveis, pessoas, cobranças..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {loading && (
            <div className="py-6 text-center text-xs text-muted-foreground">Buscando…</div>
          )}
          {!loading && query.length < 2 && (
            <>
              <CommandGroup heading="Atalhos">
                {QUICK_ACTIONS.map((qa) => {
                  const Icon = qa.icon;
                  return (
                    <CommandItem
                      key={qa.href}
                      value={qa.label}
                      onSelect={() => handleSelect(qa.href)}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      {qa.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}
          {!loading && query.length >= 2 && results.length === 0 && (
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
          )}
          {!loading &&
            query.length >= 2 &&
            (["contrato", "imovel", "pessoa", "cobranca"] as const).map((type) => {
              const group = byType[type];
              if (!group?.length) return null;
              const Icon = TYPE_ICON[type];
              return (
                <CommandGroup key={type} heading={TYPE_LABEL[type]}>
                  {group.map((r) => (
                    <CommandItem
                      key={`${r.type}-${r.id}`}
                      value={`${r.title} ${r.subtitle ?? ""}`}
                      onSelect={() => handleSelect(r.href)}
                    >
                      <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 truncate">
                        <div className="text-sm font-medium">{r.title}</div>
                        {r.subtitle && (
                          <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          <CommandSeparator />
        </CommandList>
      </CommandDialog>
    </>
  );
}
