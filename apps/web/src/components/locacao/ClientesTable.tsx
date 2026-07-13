"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";

export interface InsurerBadge {
  seguradora: string;
  status: string;
}

export interface ClienteRow {
  id: string;
  nome: string;
  cpfCnpj: string;
  tipoPessoa: string;
  phone: string;
  createdByName: string;
  /** Rótulo agregado da análise Serasa (null = ainda não analisado). */
  serasaLabel: string | null;
  serasaTone: "pending" | "ok" | "bad" | "info" | null;
  insurers: InsurerBadge[];
  href: string;
}

const INSURER_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  aprovado: "default",
  aprovado_com_restricao: "outline",
  em_analise: "secondary",
  enviado: "secondary",
  pendente: "outline",
  recusado: "destructive",
};

const INSURER_LABEL: Record<string, string> = {
  pendente: "pendente",
  enviado: "enviado",
  em_analise: "em análise",
  aprovado: "aprovado",
  aprovado_com_restricao: "aprov. c/ restrição",
  recusado: "recusado",
};

function SerasaBadge({ label, tone }: { label: string | null; tone: ClienteRow["serasaTone"] }) {
  if (!label) return <span className="text-xs text-muted-foreground">—</span>;
  if (tone === "pending") return <Badge variant="outline">{label}</Badge>;
  if (tone === "bad") return <Badge variant="destructive">{label}</Badge>;
  if (tone === "ok")
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400">
        {label}
      </Badge>
    );
  return <Badge variant="secondary">{label}</Badge>;
}

function AnalysisCell({ row }: { row: ClienteRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Serasa</span>
      <SerasaBadge label={row.serasaLabel} tone={row.serasaTone} />
      {row.insurers.length > 0 && <span className="mx-1 text-muted-foreground">·</span>}
      {row.insurers.map((i) => (
        <Badge key={i.seguradora} variant={INSURER_TONE[i.status] ?? "outline"} className="capitalize">
          {i.seguradora}: {INSURER_LABEL[i.status] ?? i.status}
        </Badge>
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
            <SerasaBadge label={row.serasaLabel} tone={row.serasaTone} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Cadastrado por {row.createdByName}</div>
          {row.insurers.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {row.insurers.map((i) => (
                <Badge key={i.seguradora} variant={INSURER_TONE[i.status] ?? "outline"} className="capitalize">
                  {i.seguradora}
                </Badge>
              ))}
            </div>
          )}
        </Link>
      )}
    />
  );
}
