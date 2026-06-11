"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ModuleDef, ModuleKey } from "@/lib/modules/catalog";

interface ModulesView {
  enabled: Record<string, boolean>;
  features: Record<string, boolean>;
}

export function OrgModulesClient({
  orgId,
  catalog,
  initial,
  canEdit,
}: {
  orgId: string;
  catalog: readonly ModuleDef[];
  initial: ModulesView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<ModulesView>(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(
    module: ModuleKey,
    body: { enabled?: boolean; featureFlags?: Record<string, boolean> },
    busyKey: string
  ) {
    if (!canEdit) return;
    setBusy(busyKey);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/modules`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ module, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Falha ao atualizar");
        return;
      }
      setView(data.current as ModulesView);
      toast.success("Módulos atualizados.");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {catalog.map((mod) => {
        const moduleOn = view.enabled[mod.key] === true;
        return (
          <div key={mod.key} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium">{mod.label}</h2>
                <p className="text-xs text-muted-foreground">{mod.key}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!canEdit || busy !== null}
                  checked={moduleOn}
                  onChange={(e) =>
                    patch(mod.key, { enabled: e.target.checked }, `mod:${mod.key}`)
                  }
                />
                {moduleOn ? "Habilitado" : "Desabilitado"}
              </label>
            </div>

            <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
              {mod.features.map((f) => {
                const featOn = view.features[f.key] === true;
                return (
                  <label
                    key={f.key}
                    className={`flex items-center gap-2 text-sm ${
                      moduleOn ? "" : "opacity-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={!canEdit || !moduleOn || busy !== null}
                      checked={featOn}
                      onChange={(e) =>
                        patch(
                          mod.key,
                          { featureFlags: { [f.key]: e.target.checked } },
                          `feat:${f.key}`
                        )
                      }
                    />
                    {f.label}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Você tem acesso de leitura. Alterações exigem papel super_admin.
        </p>
      )}
    </div>
  );
}
