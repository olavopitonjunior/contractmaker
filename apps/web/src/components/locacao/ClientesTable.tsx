"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { INSURER_STATUS_SHORT, INSURER_STATUS_TONE } from "@/lib/locacao/insurers";

export interface InsurerBadge {
  key: string;
  label: string;
  /** null = seguradora ainda não acionada (não enviado). */
  status: string | null;
}

export interface ClienteRow {
  id: string;
  nome: string;
  cpfCnpj: string;
  tipoPessoa: string;
  phone: string;
  createdByName: string;
  insurers: InsurerBadge[];
  href: string;
}

function InsurerBadgeView({ ins }: { ins: InsurerBadge }) {
  // Sem análise ainda = "não enviado" (badge neutro esmaecido).
  if (!ins.status) {
    return (
      <Badge variant="outline" className="text-muted-foreground/70">
        {ins.label}: não enviado
      </Badge>
    );
  }
  return (
    <Badge variant={INSURER_STATUS_TONE[ins.status] ?? "outline"}>
      {ins.label}: {INSURER_STATUS_SHORT[ins.status] ?? ins.status}
    </Badge>
  );
}

function AnalysisCell({ row }: { row: ClienteRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {row.insurers.map((i) => (
        <InsurerBadgeView key={i.key} ins={i} />
      ))}
    </div>
  );
}

const columns: ColumnDef<ClienteRow>[] = [
  {
    accessorKey: "nome",
    header: "Nome",
    cell: ({ row }) => (
      <Link href={row.original.href} className="block hover:underline">
        <div className="font-medium">{row.original.nome}</div>
        {row.original.cpfCnpj && (
          <div className="text-xs text-muted-foreground">{row.original.cpfCnpj}</div>
        )}
      </Link>
    ),
  },
  {
    accessorKey: "phone",
    header: "Telefone",
    cell: ({ row }) => <span className="text-sm">{row.original.phone}</span>,
  },
  {
    accessorKey: "createdByName",
    header: "Quem cadastrou",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.createdByName}</span>
    ),
  },
  {
    id: "analises",
    header: "Análises das seguradoras",
    cell: ({ row }) => <AnalysisCell row={row.original} />,
  },
];

interface Props {
  data: ClienteRow[];
  emptyState: { icon: ReactNode; title: string; description: string };
}

export function ClientesTable({ data, emptyState }: Props) {
  return (
    <DataTable
      columns={columns}
      data={data}
      filterColumn="nome"
      filterPlaceholder="Filtrar por nome..."
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
              <div className="text-xs text-muted-foreground">{row.cpfCnpj || row.phone}</div>
            </div>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Cadastrado por {row.createdByName}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {row.insurers.map((i) => (
              <InsurerBadgeView key={i.key} ins={i} />
            ))}
          </div>
        </Link>
      )}
    />
  );
}
