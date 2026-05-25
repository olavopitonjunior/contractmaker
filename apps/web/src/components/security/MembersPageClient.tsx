"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ElevationDialog } from "./ElevationDialog";
import { InvitationsTab } from "./InvitationsTab";
import { useElevation } from "@/hooks/useElevation";
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ROLE_LABELS_PT, type RolePreset } from "@/lib/security/rbac/roles";
import { Shield, UserPlus, Trash2, Send, LogOut } from "lucide-react";

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
  const router = useRouter();
  const perms = usePermissions();
  const elevation = useElevation();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [elevOpen, setElevOpen] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  type PendingAction =
    | { type: "change-role"; membershipId: string; newRole: string }
    | { type: "remove"; membershipId: string; userName: string }
    | { type: "resend-invite"; membershipId: string; email: string }
    | null;
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const [inviteData, setInviteData] = useState({
    email: "",
    name: "",
    role: "finance" as RolePreset,
  });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [invitationsRefresh, setInvitationsRefresh] = useState(0);
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "convites" ? "convites" : "membros";
  const [activeTab, setActiveTab] = useState<"membros" | "convites">(initialTab);

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
    // Convite NÃO exige elevation: o backend /api/org/invitations cria
    // status=pending sem criar User. A aprovação posterior (que efetivamente
    // cria User+Membership) é gated pelo email do approver, suficiente como
    // segurança para essa operação reversível.
    setInviteOpen(true);
  }

  async function handleInvite() {
    setInviteLoading(true);
    try {
      const res = await fetch("/api/org/invitations", {
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
      toast.success("Convite criado — aprovador foi notificado");
      setInviteOpen(false);
      setInviteData({ email: "", name: "", role: "finance" });
      setInvitationsRefresh((n) => n + 1);
      setActiveTab("convites");
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

  async function handleResendInvite(membershipId: string, email: string) {
    if (!elevation.hasScope("MEMBER_MANAGE")) {
      setPendingAction({ type: "resend-invite", membershipId, email });
      setElevOpen(true);
      return;
    }
    setResendingId(membershipId);
    try {
      const res = await fetch(
        `/api/org/members/${membershipId}/resend-invite`,
        { method: "POST", credentials: "include" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao reenviar convite");
        return;
      }
      toast.success(`Convite reenviado para ${email}`);
    } finally {
      setResendingId(null);
    }
  }

  async function handleLeaveOrg() {
    const ok = confirm(
      "Tem certeza que deseja sair desta organização? Você perderá acesso imediato."
    );
    if (!ok) return;
    setLeaving(true);
    try {
      const res = await fetch("/api/org/members/leave", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Não foi possível sair");
        return;
      }
      toast.success("Você saiu da organização");
      router.push("/logout");
    } finally {
      setLeaving(false);
    }
  }

  const canInvite = perms.can(PERMISSION.ORG_MEMBERS_INVITE);
  const canChangeRole = perms.can(PERMISSION.ORG_MEMBERS_CHANGE_ROLE);
  const canRemove = perms.can(PERMISSION.ORG_MEMBERS_REMOVE);
  const myUserId = perms.userId;
  const myMembership = members.find((m) => m.userId === myUserId);
  const canLeave = !!myMembership && myMembership.role !== "owner";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold">Membros</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie quem tem acesso à organização e com que permissões.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canLeave && (
            <Button
              variant="outline"
              onClick={handleLeaveOrg}
              disabled={leaving}
            >
              <LogOut className="h-4 w-4 mr-1" />
              {leaving ? "Saindo..." : "Sair da organização"}
            </Button>
          )}
          {canInvite && (
            <Button onClick={handleStartInvite}>
              <UserPlus className="h-4 w-4 mr-1" />
              Convidar membro
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "membros" | "convites")}>
        <TabsList>
          <TabsTrigger value="membros">Membros ativos</TabsTrigger>
          <TabsTrigger value="convites">Convites</TabsTrigger>
        </TabsList>

        <TabsContent value="membros" className="mt-4">
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
              {members.map((m) => {
                const isSelf = m.userId === myUserId;
                const neverLogged = m.lastActiveAt === null;
                return (
                  <tr key={m.id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium flex items-center gap-2">
                        {m.user.name ?? "—"}
                        {isSelf && (
                          <Badge variant="secondary" className="text-[10px] h-4">
                            Você
                          </Badge>
                        )}
                      </div>
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
                      ) : canChangeRole && !isSelf ? (
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
                        : (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            convite pendente
                          </span>
                        )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {canInvite && neverLogged && !isSelf && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Reenviar convite"
                            disabled={resendingId === m.id}
                            onClick={() => handleResendInvite(m.id, m.user.email)}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        )}
                        {canRemove && m.role !== "owner" && !isSelf && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Remover membro"
                            onClick={() =>
                              handleRemove(m.id, m.user.name ?? m.user.email)
                            }
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="convites" className="mt-4">
          <InvitationsTab
            isApprover={perms.isInvitationApprover}
            refreshKey={invitationsRefresh}
            onApproved={() => {
              void load();
              setActiveTab("membros");
            }}
          />
        </TabsContent>
      </Tabs>

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
          if (action.type === "change-role") {
            void handleChangeRole(action.membershipId, action.newRole);
          } else if (action.type === "remove") {
            void handleRemove(action.membershipId, action.userName);
          } else if (action.type === "resend-invite") {
            void handleResendInvite(action.membershipId, action.email);
          }
        }}
      />
    </div>
  );
}
