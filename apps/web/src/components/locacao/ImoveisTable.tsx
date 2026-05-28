"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { fmtBRL } from "@/components/data-table/columns-helpers";
import { Badge } from "@/components/ui/badge";

export interface ImovelRow {
  id: string;
  kind: string;
  endereco: string;
  cidade: string;
  area: number | null;
  ownersLabel: string;
  contratos: number;
  valorAluguelSugerido: number | null;
  status: string;
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  disponivel: "secondary",
  anunciado: "outline",
  em_negociacao: "outline",
  locado: "default",
  manutencao: "destructive",
  fora_catalogo: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  disponivel: "Disponível",
  anunciado: "Anunciado",
  em_negociacao: "Em negociação",
  locado: "Locado",
  manutencao: "Manutenção",
  fora_catalogo: "Fora do catálogo",
};

const columns: ColumnDef<ImovelRow>[] = [
  {
    accessorKey: "kind",
    header: "Tipo",
    cell: ({ row }) => (
      <span className="capitalize">{row.original.kind.replace(/_/g, " ")}</span>
    ),
  },
  {
    accessorKey: "endereco",
    header: "Endereço",
    cell: ({ row }) => (
      <Link href={`/locacao/imoveis/${row.original.id}`} className="block hover:underline">
        <div className="font-medium">{row.original.endereco}</div>
        <div className="text-xs text-muted-foreground">{row.original.cidade}</div>
      </Link>
    ),
  },
  {
    accessorKey: "area",
    header: "Área",
    cell: ({ row }) =>
      row.original.area ? <span className="whitespace-nowrap">{row.original.area} m²</span> : "—",
  },
  {
    accessorKey: "ownersLabel",
    header: "Proprietários",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.ownersLabel || "—"}</span>
    ),
  },
  {
    accessorKey: "contratos",
    header: "Contratos",
    cell: ({ row }) => <span className="text-xs">{row.original.contratos}</span>,
  },
  {
    accessorKey: "valorAluguelSugerido",
    header: "Aluguel sugerido",
    cell: ({ row }) => (
      <span className="whitespace-nowrap font-semibold">
        {fmtBRL(row.original.valorAluguelSugerido)}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={STATUS_TONE[row.original.status] ?? "outline"}>
        {STATUS_LABEL[row.original.status] ?? row.original.status}
      </Badge>
    ),
  },
];

interface Props {
  data: ImovelRow[];
  emptyState: { icon: ReactNode; title: string; description: string };
}

export function ImoveisTable({ data, emptyState }: Props) {
  return (
    <DataTable
      columns={columns}
      data={data}
      filterColumn="endereco"
      filterPlaceholder="Filtrar por endereço..."
      emptyState={emptyState}
      mobileCardRenderer={(row) => (
        <Link
          key={row.id}
          href={`/locacao/imoveis/${row.id}`}
          className="block rounded-md border bg-card p-3 hover:bg-muted/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{row.endereco}</div>
              <div className="text-xs text-muted-foreground">{row.cidade}</div>
            </div>
            <Badge variant={STATUS_TONE[row.status] ?? "outline"}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{row.ownersLabel || "—"}</div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span>{row.contratos} contrato{row.contratos !== 1 ? "s" : ""}</span>
            <span className="font-semibold">{fmtBRL(row.valorAluguelSugerido)}</span>
          </div>
        </Link>
      )}
    />
  );
}
