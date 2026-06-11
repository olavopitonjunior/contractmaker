"use client";

import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { fmtBRL, fmtDate } from "@/components/data-table/columns-helpers";
import { Badge } from "@/components/ui/badge";
import { BulkActions } from "@/components/locacao/BulkActions";

export interface DespesaRow {
  id: string;
  dueDate: string;
  type: string;
  parcelaLabel: string;
  endereco: string;
  fluxo: string;
  valor: number;
  status: string;
  isOverdue: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  iptu: "IPTU",
  condominio: "Condomínio",
  seguro_incendio: "Seguro incêndio",
  seguro_fianca: "Seguro fiança",
  juros: "Juros",
  multa: "Multa",
  honorarios: "Honorários",
  atualizacao_monetaria: "Atualização monet.",
  custas: "Custas",
  moratorios: "Moratórios",
  taxa_locacao: "Taxa de locação",
  outro: "Outro",
};

const columns: ColumnDef<DespesaRow>[] = [
  {
    accessorKey: "dueDate",
    header: "Vencimento",
    cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.dueDate)}</span>,
  },
  {
    accessorKey: "type",
    header: "Tipo",
    cell: ({ row }) => (
      <div>
        <div className="font-medium">
          {TYPE_LABEL[row.original.type] ?? row.original.type}
          {row.original.parcelaLabel && ` · ${row.original.parcelaLabel}`}
        </div>
        <div className="text-xs text-muted-foreground">{row.original.fluxo}</div>
      </div>
    ),
  },
  {
    accessorKey: "endereco",
    header: "Imóvel",
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.endereco}</span>,
  },
  {
    accessorKey: "valor",
    header: "Valor",
    cell: ({ row }) => <span className="whitespace-nowrap font-semibold">{fmtBRL(row.original.valor)}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const tone = row.original.status === "pago" ? "default" : row.original.status === "cancelado" ? "outline" : row.original.isOverdue ? "destructive" : "secondary";
      return <Badge variant={tone}>{row.original.status}</Badge>;
    },
  },
];

interface Props {
  data: DespesaRow[];
  emptyState: { icon: ReactNode; title: string; description: string };
}

export function DespesasTable({ data, emptyState }: Props) {
  return (
    <DataTable
      columns={columns}
      data={data}
      filterColumn="endereco"
      filterPlaceholder="Filtrar por imóvel..."
      advancedFilters={[
        {
          column: "status",
          label: "Status",
          options: [
            { value: "pendente", label: "Pendente" },
            { value: "pago", label: "Pago" },
            { value: "cancelado", label: "Cancelado" },
          ],
        },
        {
          column: "type",
          label: "Tipo",
          options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })),
        },
      ]}
      emptyState={emptyState}
      enableSelection
      bulkActions={(rows) => (
        <BulkActions
          endpoint="/api/locacao/expenses/bulk"
          ids={rows.map((r) => r.id)}
          actions={[
            { key: "liquidar", label: "Liquidar selecionadas" },
            { key: "estornar", label: "Estornar liquidação" },
            { key: "marcar_pendente", label: "Marcar como pendente" },
            {
              key: "cancelar",
              label: "Cancelar selecionadas",
              destructive: true,
              confirm: `Cancelar ${rows.length} despesa(s)?`,
            },
          ]}
        />
      )}
      mobileCardRenderer={(row) => (
        <div key={row.id} className="rounded-md border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium">
                {TYPE_LABEL[row.type] ?? row.type}
                {row.parcelaLabel && ` · ${row.parcelaLabel}`}
              </div>
              <div className="text-xs text-muted-foreground">{row.endereco}</div>
              <div className="text-xs text-muted-foreground">{row.fluxo}</div>
            </div>
            <Badge variant={row.status === "pago" ? "default" : row.isOverdue ? "destructive" : "secondary"}>
              {row.status}
            </Badge>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{fmtDate(row.dueDate)}</span>
            <span className="font-semibold">{fmtBRL(row.valor)}</span>
          </div>
        </div>
      )}
    />
  );
}
