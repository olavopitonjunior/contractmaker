"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  subdomain: string | null;
  createdAt: string;
  members: number;
  pipelines: number;
  asaasAccounts: number;
}

export function AdminOrgsClient({
  orgs,
  canCreate,
}: {
  orgs: OrgRow[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", subdomain: "", ownerEmail: "", ownerName: "" });

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    try {
      const res = await fetch("/api/admin/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Falha ao criar org");
        return;
      }
      toast.success(
        data.owner?.tempPassword
          ? `Org criada. Senha temp do owner: ${data.owner.tempPassword}`
          : "Org criada (owner já existia)."
      );
      setForm({ name: "", subdomain: "", ownerEmail: "", ownerName: "" });
      setCreating(false);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function impersonate(orgId: string) {
    const reason = window.prompt("Motivo da impersonação (auditado):");
    if (!reason) return;
    setBusy(orgId);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/impersonate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Falha ao impersonar");
        return;
      }
      toast.success("Impersonando — abrindo o app como o tenant…");
      window.location.href = "/pipeline";
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {canCreate && (
        <div className="rounded-lg border bg-card p-4">
          {!creating ? (
            <Button onClick={() => setCreating(true)}>+ Nova organização</Button>
          ) : (
            <form onSubmit={createOrg} className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Nome da imobiliária"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <Input
                placeholder="subdomínio (ex: imobiliaria-x)"
                value={form.subdomain}
                onChange={(e) => setForm({ ...form, subdomain: e.target.value })}
                required
              />
              <Input
                type="email"
                placeholder="email do owner"
                value={form.ownerEmail}
                onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                required
              />
              <Input
                placeholder="nome do owner (opcional)"
                value={form.ownerName}
                onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
              />
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy === "create"}>
                  {busy === "create" ? "Criando…" : "Criar"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Nome</th>
              <th className="p-3 font-medium">Subdomínio</th>
              <th className="p-3 font-medium">Membros</th>
              <th className="p-3 font-medium">Contas Asaas</th>
              <th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-t">
                <td className="p-3 font-medium">{o.name}</td>
                <td className="p-3 text-muted-foreground">{o.subdomain ?? "—"}</td>
                <td className="p-3">{o.members}</td>
                <td className="p-3">{o.asaasAccounts}</td>
                <td className="p-3 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === o.id}
                    onClick={() => impersonate(o.id)}
                  >
                    {busy === o.id ? "…" : "Impersonar"}
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
