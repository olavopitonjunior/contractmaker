"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { fmtBRL } from "@/components/data-table/columns-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, Download, Settings2 } from "lucide-react";

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

const STATUS_OPTIONS = Object.keys(STATUS_LABEL);

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
  const router = useRouter();
  const [statusOpen, setStatusOpen] = useState(false);
  const [valorOpen, setValorOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("disponivel");
  const [newValor, setNewValor] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  async function bulkCall(body: Record<string, unknown>): Promise<Response> {
    return fetch("/api/locacao/properties/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function applyStatus() {
    if (pendingIds.length === 0) return;
    setBusy(true);
    try {
      const res = await bulkCall({ action: "setStatus", ids: pendingIds, status: newStatus });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { updated: number };
      toast.success(`${data.updated} imóvel(eis) atualizado(s)`);
      setStatusOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function applyValor() {
    if (pendingIds.length === 0) return;
    const v = Number(newValor.replace(",", "."));
    if (!Number.isFinite(v) || v < 0) {
      toast.error("Valor inválido");
      return;
    }
    setBusy(true);
    try {
      const res = await bulkCall({
        action: "setValorAluguelSugerido",
        ids: pendingIds,
        valor: v,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { updated: number };
      toast.success(`${data.updated} imóvel(eis) atualizado(s)`);
      setValorOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv(ids: string[]) {
    setBusy(true);
    try {
      const res = await bulkCall({ action: "exportCsv", ids });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `imoveis-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${ids.length} imóvel(eis) exportado(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        filterColumn="endereco"
        filterPlaceholder="Filtrar por endereço..."
        enableSelection
        bulkActions={(rows) => {
          const ids = rows.map((r) => r.id);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy}>
                  <Settings2 className="mr-1 h-3.5 w-3.5" />
                  Ações em massa
                  <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setPendingIds(ids);
                    setStatusOpen(true);
                  }}
                >
                  Alterar status
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setPendingIds(ids);
                    setNewValor("");
                    setValorOpen(true);
                  }}
                >
                  Alterar aluguel sugerido
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => exportCsv(ids)}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Exportar planilha (.csv)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }}
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
              <Badge variant={STATUS_TONE[row.status] ?? "outline"}>
                {STATUS_LABEL[row.status] ?? row.status}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{row.ownersLabel || "—"}</div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span>
                {row.contratos} contrato{row.contratos !== 1 ? "s" : ""}
              </span>
              <span className="font-semibold">{fmtBRL(row.valorAluguelSugerido)}</span>
            </div>
          </Link>
        )}
      />

      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar status em massa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {pendingIds.length} imóvel(eis) selecionado(s). Aplicar o status:
            </p>
            <Label>Status</Label>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={applyStatus} disabled={busy}>
              {busy ? "Aplicando..." : "Aplicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={valorOpen} onOpenChange={setValorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar aluguel sugerido em massa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {pendingIds.length} imóvel(eis) selecionado(s). Definir o valor (R$):
            </p>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={50}
              value={newValor}
              onChange={(e) => setNewValor(e.target.value)}
              placeholder="ex.: 2500"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setValorOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={applyValor} disabled={busy || !newValor}>
              {busy ? "Aplicando..." : "Aplicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
