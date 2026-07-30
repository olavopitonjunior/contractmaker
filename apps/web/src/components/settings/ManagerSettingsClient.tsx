"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ElevationDialog } from "@/components/security/ElevationDialog";
import { useElevation } from "@/hooks/useElevation";
import { usePermissions } from "@/hooks/usePermissions";
import {
  PERMISSION,
  MANAGER_CONFIGURABLE_PERMISSIONS,
  PERMISSION_CATEGORIES,
  PERMISSION_LABELS_PT,
  type PermissionKey,
  type PermissionMap,
} from "@/lib/security/rbac/permissions";
import { ROLE_PRESETS } from "@/lib/security/rbac/roles";
import { UserCog, Users, ExternalLink } from "lucide-react";

interface ManagerCandidate {
  userId: string;
  name: string | null;
  email: string;
}

/** Default do preset `gerente` — chave ausente em permissionsJson herda daqui. */
const PRESET_DEFAULTS: PermissionMap = ROLE_PRESETS.gerente;

function presetDefault(key: PermissionKey): boolean {
  return PRESET_DEFAULTS[key] === true;
}

/** Categorias de PERMISSION_CATEGORIES que contêm ao menos uma chave configurável. */
const CONFIGURABLE_GROUPS: { title: string; keys: PermissionKey[] }[] =
  Object.entries(PERMISSION_CATEGORIES)
    .map(([title, keys]) => ({
      title,
      keys: keys.filter((k) => MANAGER_CONFIGURABLE_PERMISSIONS.includes(k)),
    }))
    .filter((g) => g.keys.length > 0);

type PendingAction = "required" | "permissions" | null;

export function ManagerSettingsClient() {
  const perms = usePermissions();
  const elevation = useElevation();

  const [loading, setLoading] = useState(true);
  const [managerRequired, setManagerRequired] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [savedChecked, setSavedChecked] = useState<Record<string, boolean>>({});
  const [managers, setManagers] = useState<ManagerCandidate[]>([]);
  const [savingRequired, setSavingRequired] = useState(false);
  const [savingPerms, setSavingPerms] = useState(false);
  const [elevOpen, setElevOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingRequired, setPendingRequired] = useState<boolean | null>(null);

  const canWrite = perms.can(PERMISSION.ORG_MEMBERS_CHANGE_ROLE);

  const hydrate = useCallback((permissions: PermissionMap) => {
    const next: Record<string, boolean> = {};
    for (const key of MANAGER_CONFIGURABLE_PERMISSIONS) {
      const stored = permissions?.[key];
      next[key] = typeof stored === "boolean" ? stored : presetDefault(key);
    }
    setChecked(next);
    setSavedChecked(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, contextRes] = await Promise.all([
        fetch("/api/org/manager-settings", { credentials: "include" }),
        fetch("/api/deals/manager-context", { credentials: "include" }),
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setManagerRequired(data.managerRequired === true);
        hydrate((data.permissions ?? {}) as PermissionMap);
      } else {
        toast.error("Não foi possível carregar as configurações de gerentes.");
      }
      if (contextRes.ok) {
        const data = await contextRes.json();
        setManagers(data.candidates ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () =>
      MANAGER_CONFIGURABLE_PERMISSIONS.some(
        (k) => checked[k] !== savedChecked[k]
      ),
    [checked, savedChecked]
  );

  /** 403 ELEVATION_REQUIRED → abre o sudo e reexecuta a ação depois. */
  function needsElevation(action: PendingAction, required?: boolean): boolean {
    if (elevation.hasScope("MEMBER_MANAGE")) return false;
    setPendingAction(action);
    setPendingRequired(required ?? null);
    setElevOpen(true);
    return true;
  }

  async function saveRequired(next: boolean) {
    if (needsElevation("required", next)) return;
    setSavingRequired(true);
    try {
      const res = await fetch("/api/org/manager-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ managerRequired: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "ELEVATION_REQUIRED") {
          setPendingAction("required");
          setPendingRequired(next);
          setElevOpen(true);
          return;
        }
        toast.error(data.error ?? "Falha ao salvar");
        return;
      }
      setManagerRequired(data.managerRequired === true);
      toast.success(
        data.managerRequired
          ? "Gerente responsável passa a ser obrigatório."
          : "Gerente responsável voltou a ser opcional."
      );
    } finally {
      setSavingRequired(false);
    }
  }

  async function savePermissions() {
    if (needsElevation("permissions")) return;
    setSavingPerms(true);
    try {
      const payload: Record<string, boolean> = {};
      for (const key of MANAGER_CONFIGURABLE_PERMISSIONS) {
        payload[key] = checked[key] === true;
      }
      const res = await fetch("/api/org/manager-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ permissions: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "ELEVATION_REQUIRED") {
          setPendingAction("permissions");
          setElevOpen(true);
          return;
        }
        toast.error(data.error ?? "Falha ao salvar");
        return;
      }
      hydrate((data.permissions ?? payload) as PermissionMap);
      toast.success("Permissões dos gerentes atualizadas.");
      void perms.refresh();
    } finally {
      setSavingPerms(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <UserCog className="h-5 w-5" />
          Gerentes
        </h1>
        <p className="text-sm text-muted-foreground">
          O gerente enxerga e opera apenas os negócios em que foi atribuído.
          Defina aqui se ele é obrigatório e o que ele pode fazer.
        </p>
      </div>

      {!canWrite && !perms.loading && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Você pode consultar estas configurações, mas só quem altera funções de
          membros pode editá-las.
        </p>
      )}

      {/* Card 1 — Obrigatoriedade */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Obrigatoriedade</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <Label
              htmlFor="manager-required"
              className="text-sm font-normal leading-snug"
            >
              Exigir gerente responsável em todo negócio novo (vendas e locação)
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Quando ligado, os fluxos de criação de negócio pedem um gerente
                antes de concluir.
              </span>
            </Label>
            <Switch
              id="manager-required"
              checked={managerRequired}
              disabled={loading || savingRequired || !canWrite}
              onCheckedChange={(v) => void saveRequired(v === true)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Card 2 — Permissões configuráveis */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Permissões dos gerentes</CardTitle>
          <p className="text-xs text-muted-foreground">
            Vale para todos os gerentes da organização. A visão restrita (só os
            negócios atribuídos) não é configurável.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            CONFIGURABLE_GROUPS.map((group) => (
              <div key={group.title} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {group.keys.map((key) => (
                    <label
                      key={key}
                      htmlFor={`perm-${key}`}
                      className="flex items-start gap-2 rounded-md border p-2 text-sm"
                    >
                      <Checkbox
                        id={`perm-${key}`}
                        className="mt-0.5"
                        checked={checked[key] === true}
                        disabled={!canWrite}
                        onCheckedChange={(v) =>
                          setChecked((prev) => ({ ...prev, [key]: v === true }))
                        }
                      />
                      <span className="leading-snug">
                        {PERMISSION_LABELS_PT[key]}
                        {presetDefault(key) && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (padrão: ligado)
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
          {canWrite && (
            <div className="flex items-center justify-end gap-2 pt-1">
              {dirty && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setChecked(savedChecked)}
                  disabled={savingPerms}
                >
                  Descartar
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void savePermissions()}
                disabled={loading || savingPerms || !dirty}
              >
                {savingPerms ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 3 — Gerentes da org */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Gerentes da organização
          </CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings/membros">
              Gerenciar membros
              <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : managers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum membro com a função Gerente. Defina a função em{" "}
              <Link href="/settings/membros" className="underline">
                Membros
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {managers.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.name ?? "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.email}
                    </p>
                  </div>
                  <Badge variant="outline">Gerente</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ElevationDialog
        open={elevOpen}
        onOpenChange={setElevOpen}
        scopes={["MEMBER_MANAGE"]}
        onSuccess={() => {
          const action = pendingAction;
          const required = pendingRequired;
          setPendingAction(null);
          setPendingRequired(null);
          if (action === "required" && required !== null) {
            void saveRequired(required);
          } else if (action === "permissions") {
            void savePermissions();
          }
        }}
      />
    </div>
  );
}
