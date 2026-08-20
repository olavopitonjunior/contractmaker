"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  MarkLostDialog,
  LOCACAO_LOST_CATEGORIES,
} from "@/components/pipeline/MarkLostDialog";
import {
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Lock,
  LockOpen,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  X,
  XOctagon,
} from "lucide-react";
import { AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { ReopenFormButton } from "@/components/forms/ReopenFormButton";
import { isFormFinished } from "@/lib/forms/form-status";
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { NO_PERMISSION_HINT } from "@/lib/security/rbac/ui";
import { formPublicPath } from "@/lib/forms/form-url";
import { PickTemplateDialog } from "@/components/contracts/PickTemplateDialog";

interface LocacaoDealHeaderActionsProps {
  dealId: string;
  title: string;
  stageName: string | null;
  formToken: string | null;
  formLockedAt: string | null;
  formStatus: string | null;
  formCompletedAt: string | null;
  formReopenedAt: string | null;
  hasContract: boolean;
  isLost: boolean;
  archivedAt: string | null;
}

/**
 * Ações do header do deal de locação — paridade com o header do DealDetail de
 * vendas (editar título, link do form, gerar/regerar contrato, perdido/reabrir,
 * excluir). Reusa os endpoints kind-agnósticos de /api/pipeline/deals/[dealId].
 */
export function LocacaoDealHeaderActions({
  dealId,
  title,
  stageName,
  formToken: initialFormToken,
  formLockedAt: initialFormLockedAt,
  formStatus,
  formCompletedAt,
  formReopenedAt,
  hasContract,
  isLost,
  archivedAt,
}: LocacaoDealHeaderActionsProps) {
  const router = useRouter();
  const perms = usePermissions();
  // Gating de CTA (feature Gerente) — libera enquanto carrega pra não piscar.
  const canCreateContract =
    perms.loading || perms.can(PERMISSION.CONTRACT_CREATE);
  const canEditDeal = perms.loading || perms.can(PERMISSION.DEAL_EDIT);
  const [markLostOpen, setMarkLostOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickTemplateOpen, setPickTemplateOpen] = useState(false);
  // Segurança do link: token em estado (rotação gera novo) + travamento.
  const [formToken, setFormToken] = useState(initialFormToken);
  const [formLockedAt, setFormLockedAt] = useState<string | null>(
    initialFormLockedAt,
  );
  const [linkBusy, setLinkBusy] = useState<"lock" | "rotate" | "reopen" | null>(null);
  // Form enviado pelo cliente (finalize) OU nascido preso a um contrato pronto
  // (import/upload = "vinculado"). Só esses podem ser reabertos.
  const formSubmitted = isFormFinished({
    completedAt: formCompletedAt,
    status: formStatus,
  });

  async function toggleFormLock() {
    if (!formToken) return;
    const next = !formLockedAt;
    setLinkBusy("lock");
    try {
      const res = await fetch(`/api/forms/${formToken}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Falha ao atualizar travamento");
        return;
      }
      setFormLockedAt(data.lockedAt ?? null);
      toast.success(next ? "Formulário travado" : "Formulário destravado");
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setLinkBusy(null);
    }
  }

  async function rotateFormLinks() {
    if (!formToken) return;
    setLinkBusy("rotate");
    try {
      const res = await fetch(`/api/forms/${formToken}/rotate-links`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Falha ao trocar os links");
        return;
      }
      setFormToken(data.token);
      toast.success("Links trocados — os anteriores foram desativados");
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setLinkBusy(null);
    }
  }

  const isTerminal = stageName === "ADM" || isLost;

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === title) {
      setEditingTitle(false);
      setTitleDraft(title);
      return;
    }
    setBusy("title");
    try {
      const res = await fetch(`/api/pipeline/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Erro ao renomear o negócio");
        return;
      }
      toast.success("Título atualizado");
      setEditingTitle(false);
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(null);
    }
  }

  function copyFormLink() {
    if (!formToken) return;
    navigator.clipboard.writeText(
      `${window.location.origin}${formPublicPath(formToken, title)}`
    );
    toast.success("Link do formulário copiado!");
  }

  async function generateContract(templateId?: string) {
    setBusy("generate");
    try {
      const res = await fetch(`/api/pipeline/deals/${dealId}/generate-contract`, {
        method: "POST",
        // Sem escolha manual, a chamada segue sem corpo — como sempre foi.
        ...(templateId
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ templateId }),
            }
          : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao gerar o contrato");
        return;
      }
      toast.success(
        hasContract
          ? `Nova versão v${data.version} gerada`
          : "Contrato de locação gerado"
      );
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(null);
    }
  }

  async function reopen() {
    setBusy("reopen");
    try {
      const res = await fetch(`/api/pipeline/deals/${dealId}/reopen`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao reabrir o negócio");
        return;
      }
      toast.success(`Negócio reaberto em "${data.stageName}"`);
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(null);
    }
  }

  async function toggleArchive() {
    const archived = archivedAt === null;
    setBusy("archive");
    try {
      const res = await fetch(`/api/pipeline/deals/${dealId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao arquivar o negócio");
        return;
      }
      toast.success(archived ? "Negócio arquivado" : "Negócio desarquivado");
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(null);
    }
  }

  async function deleteDeal() {
    setBusy("delete");
    try {
      const res = await fetch(`/api/pipeline/deals/${dealId}?deleteForm=true`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao excluir o negócio");
        return;
      }
      toast.success("Negócio excluído");
      router.push("/pipeline/locacao");
      router.refresh();
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(null);
      setDeleteOpen(false);
    }
  }

  return (
    <div className="space-y-1">
      {/* Título editável */}
      {editingTitle ? (
        <div className="flex items-center gap-2">
          <Input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            className="h-9 max-w-md text-lg font-semibold"
            maxLength={200}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle();
              if (e.key === "Escape") {
                setEditingTitle(false);
                setTitleDraft(title);
              }
            }}
            disabled={busy === "title"}
          />
          <Button size="sm" variant="ghost" onClick={saveTitle} disabled={busy === "title"}>
            <Check className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditingTitle(false);
              setTitleDraft(title);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="group flex items-center gap-2 text-left"
          onClick={() => setEditingTitle(true)}
          title="Renomear negócio"
        >
          <h2 className="text-2xl font-semibold">{title}</h2>
          <Pencil className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      )}

      {/* Ações */}
      <div className="flex gap-2 flex-wrap pt-1.5">
        {formToken && (
          <>
            {formLockedAt && (
              <Badge variant="secondary" className="gap-1 self-center">
                <Lock className="h-3 w-3" />
                Travado
              </Badge>
            )}
            <Button variant="outline" size="sm" asChild>
              <a
                href={formPublicPath(formToken, title)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Formulário
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyFormLink}
              title="Copiar link do formulário para compartilhar"
            >
              <Copy className="h-4 w-4 mr-1" />
              Copiar link
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleFormLock}
              disabled={linkBusy !== null}
              title={
                formLockedAt
                  ? "Destravar: permite editar o formulário novamente"
                  : "Travar: congela as informações — as partes só conseguem consultar"
              }
            >
              {linkBusy === "lock" ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : formLockedAt ? (
                <LockOpen className="h-4 w-4 mr-1" />
              ) : (
                <Lock className="h-4 w-4 mr-1" />
              )}
              {formLockedAt ? "Destravar" : "Travar"}
            </Button>
            <ReopenFormButton
              token={formToken}
              submitted={formSubmitted}
              reopenedAt={formReopenedAt}
              disabled={linkBusy !== null}
              onReopened={() => setFormLockedAt(null)}
              onBusyChange={(b) => setLinkBusy(b ? "reopen" : null)}
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={linkBusy !== null}
                  title="Trocar o link (revoga o acesso de quem já tem o link atual, mantém os dados)"
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-1 ${linkBusy === "rotate" ? "animate-spin" : ""}`}
                  />
                  Trocar link
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-500" />
                    Trocar todos os links?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    O link do formulário e os links de cada parte atuais vão
                    parar de funcionar imediatamente. Quem já recebeu algum
                    deles perde o acesso. Os dados preenchidos são mantidos.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={rotateFormLinks}>
                    Trocar links
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
        <Button
          size="sm"
          onClick={() => generateContract()}
          disabled={busy === "generate" || !canCreateContract}
          title={canCreateContract ? undefined : NO_PERMISSION_HINT}
        >
          <FileText className="h-4 w-4 mr-1" />
          {busy === "generate"
            ? "Gerando..."
            : hasContract
              ? "Regerar contrato"
              : "Gerar contrato"}
        </Button>
        {/* Caminho secundário de propósito: o automático acerta quase sempre,
            e cada escolha manual é uma chance de errar o contrato. */}
        {canCreateContract && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPickTemplateOpen(true)}
            disabled={busy === "generate"}
          >
            Escolher outro modelo
          </Button>
        )}
        <PickTemplateDialog
          open={pickTemplateOpen}
          onOpenChange={setPickTemplateOpen}
          dealId={dealId}
          hasContract={hasContract}
          onConfirm={(templateId) => generateContract(templateId)}
        />
        {isLost && (
          <Button size="sm" onClick={reopen} disabled={busy === "reopen"}>
            <RotateCcw className="h-4 w-4 mr-1" />
            {busy === "reopen" ? "Reabrindo..." : "Reabrir negócio"}
          </Button>
        )}
        {!isTerminal && (
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950/20"
            onClick={() => setMarkLostOpen(true)}
          >
            <XOctagon className="h-4 w-4 mr-1" />
            Marcar como perdido
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={toggleArchive}
          disabled={busy === "archive"}
        >
          {archivedAt === null ? (
            <>
              <Archive className="h-4 w-4 mr-1" />
              {busy === "archive" ? "Arquivando..." : "Arquivar"}
            </>
          ) : (
            <>
              <ArchiveRestore className="h-4 w-4 mr-1" />
              {busy === "archive" ? "Desarquivando..." : "Desarquivar"}
            </>
          )}
        </Button>
        {canEditDeal && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Excluir negócio
          </Button>
        )}
      </div>

      <MarkLostDialog
        dealId={dealId}
        open={markLostOpen}
        onOpenChange={setMarkLostOpen}
        categories={LOCACAO_LOST_CATEGORIES}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este negócio de locação?</AlertDialogTitle>
            <AlertDialogDescription>
              Exclui o negócio, o formulário, os contratos e os anexos. Envelopes
              de assinatura em andamento ou concluídos bloqueiam a exclusão.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "delete"}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                deleteDeal();
              }}
              disabled={busy === "delete"}
            >
              {busy === "delete" ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
