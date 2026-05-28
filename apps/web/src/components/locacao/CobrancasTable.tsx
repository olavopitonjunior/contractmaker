"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { fmtBRL, fmtDate } from "@/components/data-table/columns-helpers";
import { Badge } from "@/components/ui/badge";

export interface CobrancaRow {
  id: string;
  leaseContractId: string;
  competencia: string;
  dueDate: string;
  inquilino: string;
  endereco: string;
  kind: string;
  totalValue: number;
  status: string;
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pendente: "secondary",
  emitida: "outline",
  paga: "default",
  atrasada: "destructive",
  cancelada: "outline",
  repassada: "default",
};

const columns: ColumnDef<CobrancaRow>[] = [
  {
    accessorKey: "competencia",
    header: "Competência",
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <div className="font-medium">{row.original.competencia}</div>
        <div className="text-xs text-muted-foreground">venc. {fmtDate(row.original.dueDate)}</div>
      </div>
    ),
  },
  {
    accessorKey: "inquilino",
    header: "Inquilino",
    cell: ({ row }) => (
      <Link
        href={`/locacao/contratos/${row.original.leaseContractId}`}
        className="block hover:underline"
      >
        <div className="font-medium">{row.original.inquilino}</div>
        <div className="text-xs text-muted-foreground">{row.original.endereco}</div>
      </Link>
    ),
  },
  {
    accessorKey: "kind",
    header: "Tipo",
    cell: ({ row }) => <Badge variant="outline">{row.original.kind}</Badge>,
  },
  {
    accessorKey: "totalValue",
    header: "Valor",
    cell: ({ row }) => (
      <span className="whitespace-nowrap font-semibold">{fmtBRL(row.original.totalValue)}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={STATUS_TONE[row.original.status] ?? "outline"}>{row.original.status}</Badge>
    ),
  },
];

interface Props {
  data: CobrancaRow[];
  emptyState: { icon: ReactNode; title: string; description: string };
}

export function CobrancasTable({ data, emptyState }: Props) {
  return (
    <DataTable
      columns={columns}
      data={data}
      filterColumn="inquilino"
      filterPlaceholder="Filtrar por inquilino..."
      emptyState={emptyState}
      mobileCardRenderer={(row) => (
        <Link
          key={row.id}
          href={`/locacao/contratos/${row.leaseContractId}`}
          className="block rounded-md border bg-card p-3 hover:bg-muted/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-sm font-medium">{row.inquilino}</div>
              <div className="text-xs text-muted-foreground">{row.endereco}</div>
            </div>
            <Badge variant={STATUS_TONE[row.status] ?? "outline"}>{row.status}</Badge>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {row.competencia} · {fmtDate(row.dueDate)}
            </span>
            <span className="font-semibold">{fmtBRL(row.totalValue)}</span>
          </div>
        </Link>
      )}
    />
  );
}
