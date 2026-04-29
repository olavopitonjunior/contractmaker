"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Clock, Mail } from "lucide-react";

interface Invitation {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: "pending" | "approved" | "rejected" | "revoked" | "expired";
  invitedBy: { id: string; name: string | null; email: string };
  approvedBy: { id: string; name: string | null; email: string } | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  expiresAt: string;
  createdAt: string;
}

const STATUS_LABELS: Record<Invitation["status"], string> = {
  pending: "Aguardando aprovação",
  approved: "Aprovado",
  rejected: "Rejeitado",
  revoked: "Revogado",
  expired: "Expirado",
};

export function InvitationsTab({
  isApprover,
  refreshKey,
  onApproved,
}: {
  isApprover: boolean;
  refreshKey?: number;
  onApproved?: () => void;
}) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/org/invitations", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setInvitations(data.invitations);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function handleApprove(id: string, email: string) {
    setActingId(id);
    try {
      const res = await fetch(`/api/org/invitations/${id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao aprovar");
        return;
      }
      toast.success(`Convite aprovado — ${email} foi notificado`);
      await load();
      onApproved?.();
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(id: string) {
    const reason = window.prompt("Motivo da rejeição (opcional):", "");
    if (reason === null) return;
    setActingId(id);
    try {
      const res = await fetch(`/api/org/invitations/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao rejeitar");
        return;
      }
      toast.success("Convite rejeitado");
      await load();
    } finally {
      setActingId(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Convidado</th>
              <th className="px-3 py-2">Função</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Convidado por</th>
              <th className="px-3 py-2">Criado em</th>
              <th className="px-3 py-2 w-0">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && invitations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum convite criado ainda.
                </td>
              </tr>
            )}
            {invitations.map((inv) => {
              const isPending = inv.status === "pending";
              return (
                <tr key={inv.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{inv.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {inv.email}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{inv.role}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {inv.status === "pending" && (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <Clock className="h-3.5 w-3.5" />
                        {STATUS_LABELS[inv.status]}
                      </span>
                    )}
                    {inv.status === "approved" && (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <Check className="h-3.5 w-3.5" />
                        {STATUS_LABELS[inv.status]}
                      </span>
                    )}
                    {inv.status === "rejected" && (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <X className="h-3.5 w-3.5" />
                        {STATUS_LABELS[inv.status]}
                      </span>
                    )}
                    {(inv.status === "revoked" || inv.status === "expired") && (
                      <span className="text-muted-foreground">
                        {STATUS_LABELS[inv.status]}
                      </span>
                    )}
                    {inv.rejectionReason && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {inv.rejectionReason}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {inv.invitedBy.name ?? inv.invitedBy.email}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(inv.createdAt).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-3 py-2">
                    {isPending && isApprover && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actingId === inv.id}
                          onClick={() => handleApprove(inv.id, inv.email)}
                          title="Aprovar e enviar acesso"
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={actingId === inv.id}
                          onClick={() => handleReject(inv.id)}
                          title="Rejeitar convite"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                    {isPending && !isApprover && (
                      <span className="text-xs text-muted-foreground">
                        Aguardando aprovador
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
