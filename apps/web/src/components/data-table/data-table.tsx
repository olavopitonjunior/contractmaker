"use client";

import { useState, type ReactNode } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ArrowUpDown, Search, X } from "lucide-react";
import { EmptyState } from "./empty-state";

export interface AdvancedFilter {
  /** Coluna do TanStack a aplicar `setFilterValue` */
  column: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Coluna alvo do filtro de texto principal (filtro tipo "search"). */
  filterColumn?: string;
  filterPlaceholder?: string;
  /** Habilita checkbox column pra row selection (necessário pra bulkActions). */
  enableSelection?: boolean;
  /** Slot pra ações em massa (aparece quando há rows selecionadas). */
  bulkActions?: (selectedRows: TData[]) => ReactNode;
  /** Filtros declarativos por coluna (Select com opções). Aparecem inline na toolbar. */
  advancedFilters?: AdvancedFilter[];
  /** Mostrado quando data.length === 0 e sem filtros aplicados. */
  emptyState?: {
    icon?: ReactNode;
    title: string;
    description?: string;
    action?: ReactNode;
  };
  /** Render mobile alternativo (vira cards em <md). Se não passado, mostra tabela com scroll horizontal. */
  mobileCardRenderer?: (row: TData, index: number) => ReactNode;
  /** Default pageSize. */
  pageSize?: number;
  /** Class extra no root. */
  className?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  filterColumn,
  filterPlaceholder = "Filtrar...",
  enableSelection = false,
  bulkActions,
  advancedFilters,
  emptyState,
  mobileCardRenderer,
  pageSize = 25,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState({});

  // Adiciona checkbox column quando enableSelection.
  const finalColumns: ColumnDef<TData, TValue>[] = enableSelection
    ? [
        {
          id: "_select",
          header: ({ table }) => (
            <input
              type="checkbox"
              checked={table.getIsAllPageRowsSelected()}
              onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)}
              aria-label="Selecionar todos"
              className="rounded border-input"
            />
          ),
          cell: ({ row }) => (
            <input
              type="checkbox"
              checked={row.getIsSelected()}
              onChange={(e) => row.toggleSelected(e.target.checked)}
              aria-label="Selecionar linha"
              onClick={(e) => e.stopPropagation()}
              className="rounded border-input"
            />
          ),
          enableSorting: false,
        } as ColumnDef<TData, TValue>,
        ...columns,
      ]
    : columns;

  const table = useReactTable({
    data,
    columns: finalColumns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    initialState: { pagination: { pageSize } },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  });

  const selectedRows = table.getFilteredSelectedRowModel().rows.map((r) => r.original);
  const totalFiltered = table.getFilteredRowModel().rows.length;
  const noData = data.length === 0;
  const filteredButEmpty = !noData && totalFiltered === 0;

  return (
    <div className={className}>
      {/* Toolbar: filtro + filtros avançados + ações em massa */}
      {(filterColumn || advancedFilters?.length || bulkActions) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {filterColumn && (
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={filterPlaceholder}
                value={(table.getColumn(filterColumn)?.getFilterValue() as string) ?? ""}
                onChange={(e) =>
                  table.getColumn(filterColumn)?.setFilterValue(e.target.value)
                }
                className="pl-8"
              />
            </div>
          )}
          {advancedFilters?.map((f) => {
            const current = (table.getColumn(f.column)?.getFilterValue() as string) ?? "__all";
            return (
              <Select
                key={f.column}
                value={current}
                onValueChange={(v) =>
                  table
                    .getColumn(f.column)
                    ?.setFilterValue(v === "__all" ? undefined : v)
                }
              >
                <SelectTrigger className="h-9 w-auto min-w-[140px]">
                  <SelectValue placeholder={f.label} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">{f.label}: todos</SelectItem>
                  {f.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}
          {(columnFilters.length > 0 || Boolean(filterColumn && table.getColumn(filterColumn)?.getFilterValue())) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setColumnFilters([]);
              }}
              className="h-9 text-xs"
            >
              <X className="mr-1 h-3 w-3" />
              Limpar
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {bulkActions && selectedRows.length > 0 && (
              <>
                <span className="text-xs text-muted-foreground">
                  {selectedRows.length} selecionado(s)
                </span>
                {bulkActions(selectedRows)}
              </>
            )}
          </div>
        </div>
      )}

      {/* Empty state quando não há dados */}
      {noData && emptyState ? (
        <EmptyState
          icon={emptyState.icon}
          title={emptyState.title}
          description={emptyState.description}
          action={emptyState.action}
        />
      ) : filteredButEmpty ? (
        <EmptyState
          title="Nenhum resultado pra esse filtro"
          description="Tente ajustar a busca ou limpar os filtros."
        />
      ) : (
        <>
          {/* Mobile: cards renderizados pelo caller */}
          {mobileCardRenderer && (
            <div className="grid gap-2 md:hidden">
              {table.getRowModel().rows.map((row, i) =>
                mobileCardRenderer(row.original, i)
              )}
            </div>
          )}

          {/* Desktop/tablet: tabela */}
          <div className={mobileCardRenderer ? "hidden md:block" : ""}>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => {
                        const canSort = header.column.getCanSort();
                        return (
                          <TableHead key={header.id} className="whitespace-nowrap">
                            {header.isPlaceholder ? null : canSort ? (
                              <button
                                onClick={header.column.getToggleSortingHandler()}
                                className="flex items-center gap-1 font-medium hover:text-foreground"
                              >
                                {flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                                <ArrowUpDown className="h-3 w-3 opacity-50" />
                              </button>
                            ) : (
                              flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )
                            )}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Paginação */}
          {table.getPageCount() > 1 && (
            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()} ·{" "}
                {totalFiltered} resultado{totalFiltered !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
