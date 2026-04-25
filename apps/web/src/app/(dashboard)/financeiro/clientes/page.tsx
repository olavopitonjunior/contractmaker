"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/useDebounce";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, RefreshCw } from "lucide-react";
import { maskCpfCnpj } from "@/lib/security/pii";

interface CustomerRow {
  id: string;
  asaasId: string;
  name: string;
  cpfCnpj: string;
  email: string | null;
  mobilePhone: string | null;
  origin: string;
  chargesCount: number;
  totalPaid: number;
  createdAt: string;
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ClientesPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ name: "", cpfCnpj: "", email: "", mobilePhone: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/financeiro/customers?${params}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/financeiro/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.details?.[0]?.description ?? data.error ?? "Falha");
        return;
      }
      toast.success("Cliente criado");
      setNewOpen(false);
      setForm({ name: "", cpfCnpj: "", email: "", mobilePhone: "" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            {total} cliente{total !== 1 ? "s" : ""} cadastrado{total !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Novo cliente
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Nome, CPF/CNPJ, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="icon" onClick={load}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">CPF/CNPJ</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2 text-right">Cobranças</th>
                <th className="px-3 py-2 text-right">Total pago</th>
                <th className="px-3 py-2">Origem</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum cliente encontrado
                  </td>
                </tr>
              )}
              {rows.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/50">
                  <td className="px-3 py-2">
                    <Link href={`/financeiro/clientes/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{maskCpfCnpj(c.cpfCnpj)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{c.chargesCount}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtBRL(c.totalPaid)}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-xs">
                      {c.origin === "deal_sync" ? "via deal" : c.origin === "manual" ? "manual" : "webhook"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="c-name">Nome</Label>
              <Input
                id="c-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="c-cpf">CPF ou CNPJ</Label>
              <Input
                id="c-cpf"
                value={form.cpfCnpj}
                onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })}
                placeholder="000.000.000-00"
              />
            </div>
            <div>
              <Label htmlFor="c-email">Email</Label>
              <Input
                id="c-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="c-phone">Celular</Label>
              <Input
                id="c-phone"
                value={form.mobilePhone}
                onChange={(e) => setForm({ ...form, mobilePhone: e.target.value })}
                placeholder="(11) 9 9999-9999"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={create}
              disabled={busy || !form.name || !form.cpfCnpj}
            >
              {busy ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
