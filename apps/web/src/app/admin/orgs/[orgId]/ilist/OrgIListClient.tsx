"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, RefreshCw, Unplug } from "lucide-react";

interface ConnectionView {
  regionId: number;
  officeIds: number[];
  enabled: boolean;
  syncStatus: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastFullSyncAt: string | null;
}

interface OfficeOption {
  id: number;
  name: string;
}

export function OrgIListClient({
  orgId,
  initialConnection,
  initialCounts,
}: {
  orgId: string;
  initialConnection: ConnectionView | null;
  initialCounts: { total: number; ativos: number } | null;
}) {
  const router = useRouter();
  const [regionInput, setRegionInput] = useState(
    initialConnection ? String(initialConnection.regionId) : "",
  );
  const [offices, setOffices] = useState<OfficeOption[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(
    new Set(initialConnection?.officeIds ?? []),
  );
  const [loadingOffices, setLoadingOffices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function loadOffices() {
    const regionId = Number(regionInput);
    if (!Number.isInteger(regionId) || regionId <= 0) {
      toast.error("Informe um ID de região válido (ex.: 60)");
      return;
    }
    setLoadingOffices(true);
    setOffices(null);
    try {
      const res = await fetch(`/api/admin/ilist/offices?regionId=${regionId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? json.error ?? "Falha ao listar offices");
      setOffices(json.offices);
      if (!json.offices.length) toast.warning("Região sem offices visíveis");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao consultar a RexAPI");
    } finally {
      setLoadingOffices(false);
    }
  }

  function toggleOffice(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    const regionId = Number(regionInput);
    if (!selected.size) {
      toast.error("Selecione ao menos 1 office");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/ilist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionId, officeIds: Array.from(selected) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar conexão");
      toast.success("Conexão salva. Rode a sincronização pra popular o catálogo.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function runSync(full: boolean) {
    setSyncing(true);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/ilist/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Sync falhou");
      toast.success(
        json.partial
          ? `Sync parcial: ${json.upserted} listings (continua no próximo tick)`
          : `Sync ok: ${json.upserted} listings${json.markedDeleted ? `, ${json.markedDeleted} removidos` : ""}`,
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na sincronização");
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Remover a conexão iList? O catálogo local desta org será apagado.")) {
      return;
    }
    const res = await fetch(`/api/admin/orgs/${orgId}/ilist`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Conexão removida");
      setSelected(new Set());
      setOffices(null);
      router.refresh();
    } else {
      toast.error("Falha ao remover conexão");
    }
  }

  return (
    <div className="space-y-6">
      {initialConnection && (
        <div className="rounded-lg border p-4 text-sm">
          <div className="mb-1 font-medium">Status da conexão</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
            <dt>Região</dt>
            <dd>{initialConnection.regionId}</dd>
            <dt>Offices</dt>
            <dd>{initialConnection.officeIds.join(", ")}</dd>
            <dt>Sync</dt>
            <dd>{initialConnection.syncStatus}</dd>
            <dt>Última sync</dt>
            <dd>
              {initialConnection.lastSyncAt
                ? new Date(initialConnection.lastSyncAt).toLocaleString("pt-BR")
                : "nunca"}
            </dd>
            {initialCounts && (
              <>
                <dt>Imóveis no catálogo</dt>
                <dd>
                  {initialCounts.total} ({initialCounts.ativos} ativos)
                </dd>
              </>
            )}
          </dl>
          {initialConnection.lastSyncError && (
            <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">
              {initialConnection.lastSyncError}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" disabled={syncing} onClick={() => runSync(false)}>
              {syncing ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Sincronizar agora
            </Button>
            <Button size="sm" variant="outline" disabled={syncing} onClick={() => runSync(true)}>
              Full resync
            </Button>
            <Button size="sm" variant="destructive" onClick={disconnect}>
              <Unplug className="mr-1 h-4 w-4" />
              Desconectar
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border p-4">
        <div className="mb-2 font-medium">
          {initialConnection ? "Alterar região/offices" : "Conectar tenant ao iList"}
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Região RE/MAX (56–96; 71 = teste)
            </label>
            <Input
              value={regionInput}
              onChange={(e) => setRegionInput(e.target.value)}
              placeholder="60"
              className="w-32"
              inputMode="numeric"
            />
          </div>
          <Button variant="secondary" onClick={loadOffices} disabled={loadingOffices}>
            {loadingOffices && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Carregar offices
          </Button>
        </div>

        {offices && (
          <div className="mt-4 max-h-72 space-y-1 overflow-y-auto rounded border p-2">
            {offices.map((o) => (
              <label key={o.id} className="flex items-center gap-2 rounded p-1 text-sm hover:bg-muted">
                <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggleOffice(o.id)} />
                <span className="font-mono text-xs text-muted-foreground">{o.id}</span>
                <span>{o.name}</span>
              </label>
            ))}
          </div>
        )}

        {(offices || initialConnection) && (
          <Button className="mt-4" onClick={save} disabled={saving || !selected.size}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Salvar conexão ({selected.size} office{selected.size === 1 ? "" : "s"})
          </Button>
        )}
      </div>
    </div>
  );
}
