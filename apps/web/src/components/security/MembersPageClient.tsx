"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ElevationDialog } from "./ElevationDialog";
import { useElevation } from "@/hooks/useElevation";
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ROLE_LABELS_PT, type RolePreset } from "@/lib/security/rbac/roles";
import { Shield, UserPlus, MoreVertical } from "lucide-react";

interface Member {
  id: string;
  userId: string;
  role: string;
  customRoleId: string | null;
  customRoleName: string | null;
  invitedAt: string;
  lastActiveAt: string | null;
  user: { id: string; name: string | null; email: string; image: string | null };
}

const ROLE_CHOICES: RolePreset[] = ["admin", "finance", "sales", "viewer"];

export function MembersPageClient() {
  const perms = usePermissions();
  const elevation = useElevation();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [elevOpen, setElevOpen] = useState(false);
  type PendingAction =
    | { type: "invite" }
    | { type: "change-role"; membershipId: string; newRole: string }
    | { type: "remove"; membershipId: string; userName: string }
    | null;
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const [inviteData, setInviteData] = useState({
    email: "",
    name: "",
    role: "finance" as RolePreset,
  });
  const [inviteLoading, setInviteLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/org/members", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleStartInvite() {
    if (!elevation.hasScope("MEMBER_MANAGE")) {
      setPendingAction({ type: "invite" });
      setElevOpen(true);
      return;
    }
    setInviteOpen(true);
  }

  async function handleInvite() {
    setInviteLoading(true);
    try {
      const res = await fetch("/api/org/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(inviteData),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao convidar");
        return;
      }
      toast.success("Convite enviado por email");
      setInviteOpen(false);
      setInviteData({ email: "", name: "", role: "finance" });
      await load();
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleChangeRole(membershipId: string, newRole: string) {
    if (!elevation.hasScope("MEMBER_MANAGE")) {
      setPendingAction({ type: "change-role", membershipId, newRole });
      setElevOpen(true);
      return;
    }
    const res = await fetch(`/api/org/members/${membershipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ role: newRole }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Falha ao alterar role");
      return;
    }
    toast.success("Role alterado");
    await load();
  }

  async function handleRemove(membershipId: string, userName: string) {
    if (!elevation.hasScope("MEMBER_MANAGE")) {
      setPendingAction({ type: "remove", membershipId, userName });
      setElevOpen(true);
      return;
    }
    if (!confirm(`Remover ${userName} da organização?`)) return;
    const res = await fetch(`/api/org/members/${membershipId}`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Falha ao remover");
      return;
    }
    toast.success("Membro removido");
    await load();
  }

  const canInvite = perms.can(PERMISSION.ORG_MEMBERS_INVITE);
  const canChangeRole = perms.can(PERMISSION.ORG_MEMBERS_CHANGE_ROLE);
  const canRemove = perms.can(PERMISSION.ORG_MEMBERS_REMOVE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Membros</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie quem tem acesso à organização e com que permissões.
          </p>
        </div>
        {canInvite && (
          <Button onClick={handleStartInvite}>
            <UserPlus className="h-4 w-4 mr-1" />
            Convidar membro
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Membro</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Entrou</th>
                <th className="px-3 py-2">Último acesso</th>
                <th className="px-3 py-2 w-0">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loading && members.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum membro
                  </td>
                </tr>
              )}
              {members.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{m.user.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.user.email}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {m.role === "owner" ? (
                      <Badge variant="default" className="bg-purple-600">
                        <Shield className="h-3 w-3 mr-1" />
                        Proprietário
                      </Badge>
                    ) : canChangeRole ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) => handleChangeRole(m.id, v)}
                      >
                        <SelectTrigger className="w-[140px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_CHOICES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABELS_PT[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">
                        {ROLE_LABELS_PT[m.role as RolePreset] ?? m.role}
                      </Badge>
                    )}
                    {m.customRoleName && (
                      <div className="text-xs text-muted-foreground">
                        {m.customRoleName}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(m.invitedAt).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {m.lastActiveAt
                      ? new Date(m.lastActiveAt).toLocaleString("pt-BR")
                      : "nunca"}
                  </td>
                  <td className="px-3 py-2">
                    {canRemove && m.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          handleRemove(m.id, m.user.name ?? m.user.email)
                        }
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar novo membro</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="inv-email">Email</Label>
              <Input
                id="inv-email"
                type="email"
                value={inviteData.email}
                onChange={(e) =>
                  setInviteData((d) => ({ ...d, email: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="inv-name">Nome (opcional)</Label>
              <Input
                id="inv-name"
                value={inviteData.name}
                onChange={(e) =>
                  setInviteData((d) => ({ ...d, name: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="inv-role">Função</Label>
              <Select
                value={inviteData.role}
                onValueChange={(v) =>
                  setInviteData((d) => ({ ...d, role: v as RolePreset }))
                }
              >
                <SelectTrigger id="inv-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_CHOICES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS_PT[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleInvite}
              disabled={inviteLoading || !inviteData.email}
            >
              {inviteLoading ? "Enviando..." : "Enviar convite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElevationDialog
        open={elevOpen}
        onOpenChange={setElevOpen}
        scopes={["MEMBER_MANAGE"]}
        onSuccess={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (!action) return;
          if (action.type === "invite") {
            setInviteOpen(true);
          } else if (action.type === "change-role") {
            void handleChangeRole(action.membershipId, action.newRole);
          } else if (action.type === "remove") {
            void handleRemove(action.membershipId, action.userName);
          }
        }}
      />
    </div>
  );
}
