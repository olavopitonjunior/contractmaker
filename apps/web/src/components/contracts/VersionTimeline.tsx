"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

interface Version {
  id: string;
  version: number;
  createdAt: string;
  status: string;
  isLatest: boolean;
}

interface VersionTimelineProps {
  versions: Version[];
  currentId: string;
  /** dealId opcional — sem ele o redirect pós-delete fica em /pipeline. */
  dealId?: string;
}

export function VersionTimeline({ versions, currentId, dealId }: VersionTimelineProps) {
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<Version | null>(null);
  const [deleting, setDeleting] = useState(false);

  function handleClick(versionId: string) {
    if (versionId === currentId) return;
    router.push(`/contracts/${versionId}`);
    router.refresh();
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/contracts/${pendingDelete.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || "Erro ao excluir versão");
        return;
      }
      toast.success(`Versão ${pendingDelete.version} excluída`);
      // Se deletou a versão atualmente aberta, redireciona
      if (pendingDelete.id === currentId) {
        if (data?.promoted?.contractId) {
          router.push(`/contracts/${data.promoted.contractId}`);
        } else if (dealId) {
          router.push(`/deals/${dealId}`);
        } else {
          router.push("/pipeline");
        }
      } else {
        router.refresh();
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  return (
    <>
      <div className="space-y-3 py-4">
        {versions.map((v) => (
          <div
            key={v.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/50",
              v.id === currentId && "border-primary bg-primary/5"
            )}
          >
            <button
              type="button"
              onClick={() => handleClick(v.id)}
              className="flex flex-1 items-center gap-3 text-left min-w-0"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium shrink-0">
                v{v.version}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  Versão {v.version}
                  {v.isLatest && (
                    <Badge variant="default" className="ml-2 text-[10px]">
                      atual
                    </Badge>
                  )}
                  {v.id === currentId && !v.isLatest && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      visualizando
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(v.createdAt).toLocaleString("pt-BR")}
                </p>
              </div>
              <Badge variant="outline" className="text-xs shrink-0">
                {v.status}
              </Badge>
            </button>
            {v.status !== "aprovado" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDelete(v);
                }}
                title="Excluir esta versão"
                aria-label="Excluir versão"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir versão {pendingDelete?.version}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  A versão <strong>v{pendingDelete?.version}</strong> e seus dados
                  associados (comentários, sugestões, histórico de chat) serão
                  removidos. O Google Doc será movido para a lixeira do Drive.
                </p>
                {pendingDelete?.isLatest && (
                  <p className="text-amber-700">
                    Esta é a versão atual. A versão anterior será promovida automaticamente.
                  </p>
                )}
                <p className="font-medium">Não pode ser desfeito.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo..." : "Excluir versão"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
