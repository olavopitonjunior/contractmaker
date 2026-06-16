"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface RoleRow {
  id: string;
  userId: string;
  role: string;
  scope: string[];
  name: string | null;
  email: string | null;
  createdAt: string;
}

const ROLE_OPTIONS = ["super_admin", "support", "billing"] as const;

export function PlatformRolesClient({ currentUserId }: { currentUserId: string }) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>("support");
  const [scope, setScope] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/platform/roles");
      if (!res.ok) {
        toast.error("Falha ao carregar staff");
        return;
      }
      const d = await res.json();
      setRoles(d.roles ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/platform/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          role,
          scope: scope.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.message ?? d.error ?? "Falha ao conceder");
        return;
      }
      toast.success(`Role ${role} concedida a ${email}`);
      setEmail("");
      setScope("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/platform/roles", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.message ?? d.error ?? "Falha ao revogar");
        return;
      }
      toast.success("Role revogada");
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={grant} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <Input type="email" placeholder="email do usuário (já cadastrado)" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value as (typeof ROLE_OPTIONS)[number])}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <Input className="sm:col-span-2" placeholder="scopes separados por vírgula (opcional): impersonate,audit_query" value={scope} onChange={(e) => setScope(e.target.value)} />
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>Conceder / atualizar</Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Usuário</th>
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium">Scopes</th>
              <th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td className="p-3 text-muted-foreground" colSpan={4}>Carregando…</td></tr>}
            {!loading && roles.length === 0 && <tr><td className="p-3 text-muted-foreground" colSpan={4}>Nenhum staff.</td></tr>}
            {roles.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3">
                  <div className="font-medium">{r.name ?? "(sem nome)"}</div>
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                </td>
                <td className="p-3"><Badge variant={r.role === "super_admin" ? "default" : "secondary"}>{r.role}</Badge></td>
                <td className="p-3 text-xs text-muted-foreground">{r.scope.join(", ") || "—"}</td>
                <td className="p-3 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || r.userId === currentUserId}
                    onClick={() => revoke(r.userId)}
                    title={r.userId === currentUserId ? "Você não pode revogar a própria role" : "Revogar"}
                  >
                    Revogar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
