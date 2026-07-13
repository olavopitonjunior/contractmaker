"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DownloadCloud, Search } from "lucide-react";

type Entity = "cliente" | "imovel";

interface LookupResult {
  configured: boolean;
  message?: string;
  fields?: Record<string, unknown>;
}

/**
 * Popup de importação por ID no CRM. Genérico por `entity` (cliente | imovel).
 * O endpoint /api/locacao/crm/lookup é stub (Fase 1): responde "não configurado".
 * A UI já cobre o fluxo futuro: busca por ID → preview → importar.
 */
export function ImportarCrmDialog({ entity }: { entity: Entity }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [crmId, setCrmId] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);

  const noun = entity === "cliente" ? "cliente" : "imóvel";

  function reset() {
    setCrmId("");
    setResult(null);
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!crmId.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/locacao/crm/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, crmId: crmId.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as LookupResult;
      setResult(d);
      if (res.status === 501) {
        // Estado esperado enquanto o conector não está plugado.
        return;
      }
      if (!res.ok) {
        toast.error(d.message ?? `HTTP ${res.status}`);
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!result?.fields) return;
    setImporting(true);
    try {
      const endpoint = entity === "cliente" ? "/api/locacao/clients" : "/api/locacao/properties";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...result.fields, source: "crm", crmId: crmId.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} importado do CRM`);
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao importar");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <DownloadCloud className="mr-1 h-4 w-4" />
          Importar do CRM
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Importar {noun} do CRM</DialogTitle>
          <DialogDescription>
            Localize o registro pelo ID no CRM e importe os dados para o cadastro.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleLookup} className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label>ID no CRM</Label>
            <Input
              value={crmId}
              onChange={(e) => setCrmId(e.target.value)}
              placeholder="ex.: 12345"
              autoFocus
            />
          </div>
          <Button type="submit" disabled={loading || !crmId.trim()}>
            <Search className="mr-1 h-4 w-4" />
            {loading ? "Buscando..." : "Buscar"}
          </Button>
        </form>

        {result && !result.configured && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
            {result.message ?? "Integração com o CRM ainda não configurada."}
          </div>
        )}

        {result?.configured && result.fields && (
          <div className="space-y-2">
            <div className="rounded-md border p-3 text-sm">
              {Object.entries(result.fields).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium">{String(v)}</span>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset} disabled={importing}>
                Limpar
              </Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? "Importando..." : "Importar"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
