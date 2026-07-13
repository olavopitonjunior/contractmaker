"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DownloadCloud, Search } from "lucide-react";

interface ClientHit {
  id: string;
  nome: string;
  cpfCnpj: string | null;
  phone: string | null;
}

export interface ImportedTenant {
  id: string;
  label: string;
}

/**
 * Picker que importa um cliente cadastrado (LeaseClient) como locatário. Ao
 * selecionar, converte o prospect num Tenant (POST /convert) e devolve a option
 * pronta pro wizard via `onImported`. Reutilizável em qualquer form de criação.
 */
export function ImportarClientePicker({
  onImported,
}: {
  onImported: (tenant: ImportedTenant) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/locacao/clients?q=${encodeURIComponent(q.trim())}`);
      const d = await res.json().catch(() => ({}));
      setHits((d.clients ?? []).map((c: ClientHit) => ({ id: c.id, nome: c.nome, cpfCnpj: c.cpfCnpj, phone: c.phone })));
    } catch {
      toast.error("Erro na busca");
    } finally {
      setLoading(false);
    }
  }

  async function pick(hit: ClientHit) {
    setPickingId(hit.id);
    try {
      const res = await fetch(`/api/locacao/clients/${hit.id}/convert`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      onImported({
        id: d.tenant.id,
        label: `${d.tenant.nome}${d.tenant.cpfCnpj ? ` · ${d.tenant.cpfCnpj}` : ""}`,
      });
      toast.success(d.reused ? "Locatário vinculado" : "Cliente convertido e adicionado");
      setOpen(false);
      setQ("");
      setHits([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao importar");
    } finally {
      setPickingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <DownloadCloud className="mr-1.5 h-4 w-4" />
          Importar cliente cadastrado
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Importar cliente cadastrado</DialogTitle>
          <DialogDescription>
            Busque um cliente da tela de Clientes. Ao selecionar, ele é convertido em locatário e
            adicionado (exige CPF/CNPJ).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={search} className="flex items-end gap-2">
          <div className="flex-1">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, CPF ou telefone" autoFocus />
          </div>
          <Button type="submit" disabled={loading || q.trim().length < 2}>
            <Search className="mr-1 h-4 w-4" />
            {loading ? "Buscando…" : "Buscar"}
          </Button>
        </form>

        <div className="max-h-[260px] space-y-1 overflow-y-auto">
          {hits.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {q.trim().length >= 2 && !loading ? "Nenhum cliente encontrado." : "Digite para buscar."}
            </p>
          ) : (
            hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => pick(h)}
                disabled={pickingId !== null}
                className="flex w-full items-center justify-between gap-3 rounded-md border p-2 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <div className="min-w-0">
                  <div className="font-medium">{h.nome}</div>
                  <div className="text-xs text-muted-foreground">{h.cpfCnpj || h.phone || "sem documento"}</div>
                </div>
                <span className="shrink-0 text-xs text-primary">
                  {pickingId === h.id ? "Importando…" : "Selecionar"}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
