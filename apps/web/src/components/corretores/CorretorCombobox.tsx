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
import type { RecebimentoData } from "@/lib/forms/commissioner-receiving";

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
  /**
   * Cadastro sem meio de repasse (`SplitRecipient.pendingFields` não vazio).
   * Booleano derivado, e o único sinal que o visitante ANÔNIMO recebe sobre
   * dados bancários.
   */
  receivingPending?: boolean;
  /**
   * Dados bancários do cadastro. Só chegam quando quem preenche é MEMBRO da
   * imobiliária (o endpoint token-scoped decide) — é o que permite escolher um
   * corretor da lista e já vir com PIX/conta preenchidos.
   */
  recebimento?: RecebimentoData | null;
}

/**
 * A fonte pode devolver só a lista (telas antigas) ou a PÁGINA com `hasMore`.
 * O sinal de truncamento importa desde que a listagem passou a incluir os
 * cadastros sem meio de repasse: uma lista cheia era indistinguível de uma
 * lista completa, e quem não achava o corretor concluía que ele não existia.
 */
export type CorretorComboboxPage =
  | CorretorComboboxOption[]
  | { items: CorretorComboboxOption[]; hasMore?: boolean };

interface CorretorComboboxProps {
  /** Opção atualmente selecionada (controlado pelo pai) — null = nada exibido no trigger. */
  value?: CorretorComboboxOption | null;
  onSelect: (recipient: CorretorComboboxOption) => void;
  fetchOptions: (q: string) => Promise<CorretorComboboxPage>;
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
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // Falha de rede/HTTP tem estado próprio: engolir num `setOptions([])` fazia um
  // 429 (ou um 403 de form vinculado) se disfarçar de "Nenhum corretor
  // encontrado", e o usuário concluía que o roster estava vazio.
  const [failed, setFailed] = useState(false);
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
          if (requestId.current !== id) return;
          const page = Array.isArray(results)
            ? { items: results, hasMore: false }
            : results;
          setOptions(page.items ?? []);
          setHasMore(page.hasMore === true);
          setFailed(false);
        })
        .catch(() => {
          if (requestId.current === id) {
            setOptions([]);
            setHasMore(false);
            setFailed(true);
          }
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
    setHasMore(false);
    setFailed(false);
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
            {!loading && failed && (
              <div className="px-3 py-6 text-center text-sm text-destructive">
                Não foi possível carregar os corretores. Verifique a conexão e
                digite de novo para tentar outra vez.
              </div>
            )}
            {!loading && !failed && options.length === 0 && (
              <CommandEmpty>
                Nenhum corretor encontrado.
                {allowCreate ? " Use o botão de cadastrar abaixo." : ""}
              </CommandEmpty>
            )}
            {!loading && !failed && options.length > 0 && (
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.id} value={o.id} onSelect={() => handleSelect(o)}>
                    <Check
                      className={cn("h-4 w-4", value?.id === o.id ? "opacity-100" : "opacity-0")}
                    />
                    <div className="flex flex-col overflow-hidden">
                      <span className="truncate font-medium">
                        {o.label}
                        {/* A lista passou a incluir cadastro sem meio de
                            repasse (antes o filtro `active` escondia 40 dos 42
                            corretores da org). Dizer quais estão incompletos é
                            o que impede a lista maior de virar surpresa lá na
                            frente, na hora de pagar. */}
                        {o.receivingPending && (
                          <span className="ml-1.5 text-xs font-normal text-amber-700 dark:text-amber-500">
                            · sem dados bancários
                          </span>
                        )}
                      </span>
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
            {!loading && !failed && hasMore && (
              <p className="px-3 py-2 text-xs text-muted-foreground border-t">
                Mostrando os primeiros resultados — digite para refinar a busca.
              </p>
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
