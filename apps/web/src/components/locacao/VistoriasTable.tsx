"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { fmtDate } from "@/components/data-table/columns-helpers";
import { Badge } from "@/components/ui/badge";

export interface VistoriaRow {
  id: string;
  tipo: string;
  endereco: string;
  executor: string;
  updatedAt: string;
  status: string;
}

const TIPO_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  contra: "Contra-vistoria",
};

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  rascunho: "outline",
  em_campo: "secondary",
  laudo_gerado: "default",
  assinatura: "secondary",
  concluida: "default",
};

const columns: ColumnDef<VistoriaRow>[] = [
  {
    accessorKey: "tipo",
    header: "Tipo",
    cell: ({ row }) => <Badge variant="outline">{TIPO_LABEL[row.original.tipo] ?? row.original.tipo}</Badge>,
  },
  {
    accessorKey: "endereco",
    header: "Imóvel",
    cell: ({ row }) => (
      <div>
        <Link
          href={`/locacao/vistorias/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.original.endereco}
        </Link>
        <div className="text-xs text-muted-foreground">
          Atualizada em {fmtDate(row.original.updatedAt)}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "executor",
    header: "Vistoriador",
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.executor}</span>,
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
  data: VistoriaRow[];
  emptyState: { icon: ReactNode; title: string; description: string };
}

export function VistoriasTable({ data, emptyState }: Props) {
  return (
    <DataTable
      columns={columns}
      data={data}
      filterColumn="endereco"
      filterPlaceholder="Filtrar por imóvel..."
      emptyState={emptyState}
      mobileCardRenderer={(row) => (
        <div key={row.id} className="rounded-md border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{row.endereco}</div>
              <div className="text-xs text-muted-foreground">{row.executor}</div>
            </div>
            <Badge variant={STATUS_TONE[row.status] ?? "outline"}>{row.status}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {TIPO_LABEL[row.tipo] ?? row.tipo} · {fmtDate(row.updatedAt)}
          </div>
        </div>
      )}
    />
  );
}
