"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";

/**
 * Helpers comuns pra criar colunas de DataTable — formatos repetidos no app:
 * BRL, datas, badges com tone, links.
 */

export function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("pt-BR");
}

export function moneyCell<TData>(accessor: keyof TData, header: string): ColumnDef<TData> {
  return {
    accessorKey: accessor as string,
    header,
    cell: ({ row }) => {
      const v = row.getValue(accessor as string) as number | null;
      return <span className="font-medium">{fmtBRL(v)}</span>;
    },
  };
}

export function dateCell<TData>(accessor: keyof TData, header: string): ColumnDef<TData> {
  return {
    accessorKey: accessor as string,
    header,
    cell: ({ row }) => fmtDate(row.getValue(accessor as string) as Date | null),
  };
}

export function badgeCell<TData>(
  accessor: keyof TData,
  header: string,
  toneMap: Record<string, "default" | "secondary" | "outline" | "destructive">
): ColumnDef<TData> {
  return {
    accessorKey: accessor as string,
    header,
    cell: ({ row }) => {
      const v = row.getValue(accessor as string) as string;
      return <Badge variant={toneMap[v] ?? "outline"}>{v}</Badge>;
    },
  };
}
