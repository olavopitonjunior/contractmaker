"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";

export interface PessoaRow {
  id: string;
  nome: string;
  cpfCnpj: string;
  tipoPessoa: string;
  email: string;
  phone: string;
  vinculo: string;
  href: string;
}

const columns: ColumnDef<PessoaRow>[] = [
  {
    accessorKey: "nome",
    header: "Nome / Razão Social",
    cell: ({ row }) => (
      <Link href={row.original.href} className="block hover:underline">
        <div className="font-medium">{row.original.nome}</div>
        <div className="text-xs text-muted-foreground">{row.original.cpfCnpj}</div>
      </Link>
    ),
  },
  {
    accessorKey: "tipoPessoa",
    header: "Tipo",
    cell: ({ row }) => (
      <Badge variant="outline">
        {row.original.tipoPessoa === "juridica" ? "PJ" : "PF"}
      </Badge>
    ),
  },
  {
    accessorKey: "email",
    header: "Contato",
    cell: ({ row }) => (
      <div className="text-xs">
        <div>{row.original.email}</div>
        <div className="text-muted-foreground">{row.original.phone}</div>
      </div>
    ),
  },
  {
    accessorKey: "vinculo",
    header: "Vínculo",
    cell: ({ row }) => <span className="text-xs">{row.original.vinculo}</span>,
  },
];

interface Props {
  data: PessoaRow[];
  emptyState: { icon: ReactNode; title: string; description: string };
}

export function PessoasTable({ data, emptyState }: Props) {
  return (
    <DataTable
      columns={columns}
      data={data}
      filterColumn="nome"
      filterPlaceholder="Filtrar por nome ou CPF/CNPJ..."
      emptyState={emptyState}
      mobileCardRenderer={(row) => (
        <Link
          key={row.id}
          href={row.href}
          className="block rounded-md border bg-card p-3 hover:bg-muted/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{row.nome}</div>
              <div className="text-xs text-muted-foreground">{row.cpfCnpj}</div>
            </div>
            <Badge variant="outline">{row.tipoPessoa === "juridica" ? "PJ" : "PF"}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{row.email}</div>
          <div className="mt-1 text-xs">{row.vinculo}</div>
        </Link>
      )}
    />
  );
}
