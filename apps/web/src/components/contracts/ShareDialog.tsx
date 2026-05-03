"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Role = "writer" | "commenter" | "reader";

interface DocPermission {
  id: string;
  email: string | null;
  role: Role | "owner" | "fileOrganizer";
  displayName: string | null;
  type: string;
}

interface ShareDialogProps {
  open: boolean;
  contractId: string;
  onClose: () => void;
}

export function ShareDialog({ open, contractId, onClose }: ShareDialogProps) {
  const [permissions, setPermissions] = useState<DocPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("reader");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/share`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPermissions(data.permissions || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleAdd() {
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role, message: message.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Falha (${res.status})`);
        return;
      }
      toast.success(`Compartilhado com ${email.trim()}`);
      setEmail("");
      setMessage("");
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(permissionId: string, label: string) {
    setRemovingId(permissionId);
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/share?permissionId=${encodeURIComponent(permissionId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Falha ao remover");
        return;
      }
      toast.success(`Acesso de ${label} removido`);
      load();
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compartilhar contrato</DialogTitle>
          <DialogDescription>
            Adicione e-mails que terão acesso ao Google Doc deste contrato. O
            convite chega por e-mail e o destinatário precisa de uma conta
            Google ativa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="share-email" className="text-xs">
              E-mail
            </Label>
            <Input
              id="share-email"
              type="email"
              placeholder="alguem@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="share-role" className="text-xs">
              Permissão
            </Label>
            <select
              id="share-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              disabled={submitting}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="reader">Leitor (visualiza)</option>
              <option value="commenter">Comentador (visualiza + comenta)</option>
              <option value="writer">Editor (visualiza + comenta + edita)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="share-msg" className="text-xs">
              Mensagem (opcional)
            </Label>
            <Textarea
              id="share-msg"
              placeholder="Anexa ao e-mail de convite enviado pelo Google."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={submitting}
              maxLength={500}
              className="min-h-[60px] text-xs"
            />
          </div>

          <Button
            className="w-full"
            disabled={submitting || !email.trim()}
            onClick={handleAdd}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4 mr-1" />
            )}
            {submitting ? "Compartilhando…" : "Compartilhar"}
          </Button>
        </div>

        <div className="border-t pt-3 mt-2">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Pessoas com acesso
          </p>
          {loading ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : permissions.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Nenhum convidado externo. Você e a service-account do app têm acesso por padrão.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {permissions.map((p) => {
                const label = p.email || p.displayName || p.type;
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{label}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">
                        {roleLabel(p.role)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      disabled={removingId === p.id}
                      onClick={() => handleRemove(p.id, label)}
                    >
                      {removingId === p.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "writer":
      return "editor";
    case "commenter":
      return "comentador";
    case "reader":
      return "leitor";
    case "owner":
      return "proprietário";
    case "fileOrganizer":
      return "organizador";
    default:
      return role;
  }
}
