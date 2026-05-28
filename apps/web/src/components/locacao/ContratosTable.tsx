"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { fmtBRL, fmtDate } from "@/components/data-table/columns-helpers";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";

export interface ContratoRow {
  id: string;
  vencimento: string | null;
  diaVencimento: number;
  endereco: string;
  inquilinos: string;
  aluguel: number;
  taxaAdm: number;
  cobrancasCount: number;
  despesasCount: number;
  status: string;
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  rascunho: "outline",
  assinatura: "secondary",
  ativo: "default",
  renovacao: "secondary",
  rescisao: "destructive",
  encerrado: "outline",
};

const columns: ColumnDef<ContratoRow>[] = [
  {
    id: "vencimento",
    accessorKey: "vencimento",
    header: "Vencimento",
    cell: ({ row }) => {
      const v = row.original.vencimento;
      return (
        <div className="whitespace-nowrap">
          <div className="font-medium">{v ? fmtDate(v) : "Indeterminado"}</div>
          <div className="text-xs text-muted-foreground">dia {row.original.diaVencimento}</div>
        </div>
      );
    },
  },
  {
    accessorKey: "endereco",
    header: "Imóvel",
    cell: ({ row }) => (
      <Link
        href={`/locacao/contratos/${row.original.id}`}
        className="block hover:underline"
      >
        <div className="flex items-center gap-1.5 font-medium">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {row.original.endereco}
        </div>
        <div className="text-xs text-muted-foreground">{row.original.inquilinos}</div>
      </Link>
    ),
  },
  {
    accessorKey: "aluguel",
    header: "Aluguel",
    cell: ({ row }) => (
      <div className="whitespace-nowrap text-right">
        <div className="font-semibold">{fmtBRL(row.original.aluguel)}</div>
        <div className="text-xs text-muted-foreground">Taxa adm {row.original.taxaAdm}%</div>
      </div>
    ),
  },
  {
    id: "counts",
    header: "Operação",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {row.original.cobrancasCount} cob · {row.original.despesasCount} desp
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={STATUS_TONE[row.original.status] ?? "outline"}>
        {row.original.status}
      </Badge>
    ),
  },
];

interface Props {
  data: ContratoRow[];
  emptyState: { icon: ReactNode; title: string; description: string };
}

export function ContratosTable({ data, emptyState }: Props) {
  return (
    <DataTable
      columns={columns}
      data={data}
      filterColumn="endereco"
      filterPlaceholder="Filtrar por imóvel ou inquilino..."
      emptyState={emptyState}
      mobileCardRenderer={(row) => (
        <Link
          key={row.id}
          href={`/locacao/contratos/${row.id}`}
          className="block rounded-md border bg-card p-3 hover:bg-muted/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                {row.endereco}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{row.inquilinos}</div>
            </div>
            <Badge variant={STATUS_TONE[row.status] ?? "outline"}>{row.status}</Badge>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {row.vencimento ? fmtDate(row.vencimento) : "Indeterminado"} · dia {row.diaVencimento}
            </span>
            <span className="font-semibold">{fmtBRL(row.aluguel)}</span>
          </div>
        </Link>
      )}
    />
  );
}
