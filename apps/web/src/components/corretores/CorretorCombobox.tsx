"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Shape mínimo comum às duas fontes de dados (admin autenticado e form
 *  público token-scoped) — cada caller mapeia sua resposta pra este formato. */
export interface CorretorComboboxOption {
  id: string;
  label: string;
  tipoPessoa?: "fisica" | "juridica" | null;
  doc?: string | null;
  creci?: string | null;
  papel?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface CorretorComboboxProps {
  /** Opção atualmente selecionada (controlado pelo pai) — null = nada exibido no trigger. */
  value?: CorretorComboboxOption | null;
  onSelect: (recipient: CorretorComboboxOption) => void;
  fetchOptions: (q: string) => Promise<CorretorComboboxOption[]>;
  placeholder?: string;
  /** Quando definido, mostra um item de rodapé pra cadastrar um novo corretor com a query atual. */
  allowCreate?: (query: string) => void;
  createLabel?: string;
  disabled?: boolean;
  className?: string;
}

const DEBOUNCE_MS = 300;

/**
 * Combobox de busca de corretor compartilhado (padrão shadcn Popover+Command).
 * Fonte de dados é injetada via `fetchOptions` — telas autenticadas usam
 * /api/financeiro/split-recipients?kind=commissioner&q=, o form público usa
 * o endpoint token-scoped /api/forms/[token]/commissioners.
 */
export function CorretorCombobox({
  value = null,
  onSelect,
  fetchOptions,
  placeholder = "Buscar corretor por nome, CPF/CNPJ ou CRECI",
  allowCreate,
  createLabel = "Cadastrar novo corretor",
  disabled,
  className,
}: CorretorComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CorretorComboboxOption[]>([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;
    // q vazio = browse-all: as duas fontes de dados devolvem o roster inteiro
    // sem query (o painel antigo do form público listava tudo ao abrir — quem
    // não lembra a grafia exata precisa poder navegar, não só buscar).
    const q = query.trim();
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchOptions(q)
        .then((results) => {
          if (requestId.current === id) setOptions(results);
        })
        .catch(() => {
          if (requestId.current === id) setOptions([]);
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, fetchOptions]);

  function handleSelect(option: CorretorComboboxOption) {
    onSelect(option);
    setOpen(false);
    setQuery("");
    setOptions([]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{value ? value.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={query} onValueChange={setQuery} />
          <CommandList>
            {loading && (
              <div className="py-6 text-center text-sm text-muted-foreground">Buscando...</div>
            )}
            {!loading && options.length === 0 && (
              <CommandEmpty>
                Nenhum corretor encontrado.
                {allowCreate ? " Use o botão de cadastrar abaixo." : ""}
              </CommandEmpty>
            )}
            {!loading && options.length > 0 && (
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.id} value={o.id} onSelect={() => handleSelect(o)}>
                    <Check
                      className={cn("h-4 w-4", value?.id === o.id ? "opacity-100" : "opacity-0")}
                    />
                    <div className="flex flex-col overflow-hidden">
                      <span className="truncate font-medium">{o.label}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[
                          o.tipoPessoa === "fisica"
                            ? "Corretor"
                            : o.tipoPessoa === "juridica"
                              ? "Imobiliária"
                              : null,
                          o.creci ? `CRECI ${o.creci}` : null,
                          o.email,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {allowCreate && query.trim().length > 0 && (
              <CommandGroup>
                <CommandItem
                  value={`__create__${query}`}
                  onSelect={() => {
                    allowCreate(query.trim());
                    setOpen(false);
                    setQuery("");
                    setOptions([]);
                  }}
                >
                  <UserPlus className="h-4 w-4" />
                  {createLabel}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
