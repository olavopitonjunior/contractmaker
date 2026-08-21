"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as SheetPrimitive } from "radix-ui";
import { toast } from "sonner";
import {
  ArrowUpCircle,
  ChevronRight,
  Lock,
  Maximize2,
  Minimize2,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { ResizableSheet, useResizableSheet } from "@/components/ui/resizable-sheet";
import { SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { GROUP_LABELS } from "@/lib/clauses/schema";
import { cn } from "@/lib/utils";
import { ClausePreviewFrame } from "./ClausePreviewFrame";
import {
  CLAUSE_STATUS_LABEL,
  CLAUSE_STATUS_VARIANT,
  isPlatformClause,
  type Clause,
  type PlatformUpdate,
} from "./types";

interface ClauseDetailSheetProps {
  clause: Clause | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Aviso de que a plataforma tem versão mais recente pra ESTA cláusula. */
  platformUpdate?: PlatformUpdate;
  onEdit: (clause: Clause) => void;
}

/**
 * Sheet de detalhe da cláusula — abre ao clicar na linha da tabela. Usa
 * `ResizableSheet` (drag + fullscreen + persistência), o mesmo padrão do
 * chat e das configurações de contrato: o componente NÃO impõe header, cada
 * consumidor monta o próprio (título + close), ver `ChatPanel`.
 */
export function ClauseDetailSheet({
  clause,
  open,
  onOpenChange,
  platformUpdate,
  onEdit,
}: ClauseDetailSheetProps) {
  return (
    <ResizableSheet
      open={open}
      onOpenChange={onOpenChange}
      defaultWidth={640}
      minWidth={420}
      storageKey="clause-detail:size"
    >
      <SheetTitle className="sr-only">
        {clause ? `Cláusula: ${clause.title}` : "Detalhe da cláusula"}
      </SheetTitle>
      {clause && (
        <ClauseDetailBody
          clause={clause}
          platformUpdate={platformUpdate}
          onEdit={onEdit}
          onClose={() => onOpenChange(false)}
        />
      )}
    </ResizableSheet>
  );
}

function ClauseDetailBody({
  clause,
  platformUpdate,
  onEdit,
  onClose,
}: {
  clause: Clause;
  platformUpdate?: PlatformUpdate;
  onEdit: (clause: Clause) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { fullscreen, toggleFullscreen, canToggleFullscreen } = useResizableSheet();
  const [adopting, setAdopting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  const platform = isPlatformClause(clause);
  const groupLabel = clause.groupCode ? GROUP_LABELS[clause.groupCode] ?? clause.groupCode : null;

  /**
   * Adota o texto da plataforma nesta cláusula (POST adopt-platform,
   * inalterado). A geração nunca faz isso sozinha — cláusula de slot vira
   * texto de contrato e congela no dataJson, então trocar o que a
   * imobiliária escreveu é decisão dela, tomada aqui via AlertDialog.
   */
  async function adotar() {
    if (!platformUpdate) return;
    setAdopting(true);
    try {
      const res = await fetch(`/api/clauses/${platformUpdate.orgClauseId}/adopt-platform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformClauseId: platformUpdate.platformClauseId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Falha ao adotar");
      toast.success("Texto da plataforma adotado.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao adotar");
    } finally {
      setAdopting(false);
    }
  }

  async function excluir() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/clauses/${clause.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Falha ao excluir");
      toast.success(
        data.status === "archived"
          ? "Cláusula vinculada a contratos — arquivada em vez de excluída."
          : "Cláusula removida."
      );
      onClose();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header próprio — ver nota acima do porquê. */}
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0 space-y-1.5">
          <h2 className="truncate font-display text-base font-semibold">{clause.title}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={CLAUSE_STATUS_VARIANT[clause.status] ?? "outline"} className="text-xs">
              {CLAUSE_STATUS_LABEL[clause.status] ?? clause.status}
            </Badge>
            {clause.groupCode && (
              <Badge variant="outline" className="text-xs" title={groupLabel ?? undefined}>
                {clause.groupCode}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {clause.category}
            </Badge>
            {platform && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Lock className="h-2.5 w-2.5" />
                Plataforma
              </Badge>
            )}
            {platformUpdate && (
              <Badge className="gap-1 border-amber-400/60 bg-amber-50 text-amber-900 text-xs dark:bg-amber-950/30 dark:text-amber-300">
                <ArrowUpCircle className="h-2.5 w-2.5" />
                Atualização disponível
              </Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canToggleFullscreen && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={toggleFullscreen}
                    aria-label={fullscreen ? "Sair de tela cheia" : "Tela cheia"}
                  >
                    {fullscreen ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {fullscreen ? "Sair de tela cheia" : "Tela cheia"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <SheetPrimitive.Close asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Fechar">
              <X className="h-4 w-4" />
            </Button>
          </SheetPrimitive.Close>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          {platformUpdate && (
            <div className="rounded border border-amber-400/60 bg-amber-50 p-3 text-xs dark:bg-amber-950/20">
              <div className="flex items-start gap-2">
                <ArrowUpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">A plataforma tem uma versão mais recente</p>
                  <p className="text-muted-foreground">
                    &quot;{platformUpdate.platformTitle}&quot;, de{" "}
                    {new Date(platformUpdate.platformUpdatedAt).toLocaleDateString("pt-BR")}. Seus
                    contratos continuam usando a cláusula desta imobiliária até você adotar.
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs"
                        disabled={adopting}
                      >
                        {adopting ? "Adotando…" : "Adotar o texto da plataforma"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Adotar texto da plataforma?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Substitui o texto desta cláusula pelo de &quot;{platformUpdate.platformTitle}
                          &quot;. Os contratos JÁ GERADOS não mudam — a troca vale para os próximos.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={adotar}>Adotar</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Preview</h3>
            <div className="flex h-[380px] flex-col">
              <ClausePreviewFrame content={clause.content} />
            </div>
          </section>

          <section className="space-y-1.5">
            <button
              type="button"
              onClick={() => setSourceOpen((v) => !v)}
              className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary"
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", sourceOpen && "rotate-90")}
              />
              Texto-fonte (Handlebars)
            </button>
            {sourceOpen && (
              <pre className="max-h-64 overflow-auto rounded border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                {clause.content}
              </pre>
            )}
          </section>

          {clause.agentNotes && (
            <section className="space-y-1.5">
              <h3 className="text-sm font-medium">Orientação de uso</h3>
              <p className="rounded-md border-l-4 border-primary/60 bg-muted/40 p-3 text-sm text-muted-foreground">
                {clause.agentNotes}
              </p>
            </section>
          )}

          {clause.tags.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="text-sm font-medium">Tags</h3>
              <div className="flex flex-wrap gap-1">
                {clause.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-1 text-sm text-muted-foreground">
            <h3 className="text-sm font-medium text-foreground">Uso</h3>
            <p>
              Nesta imobiliária: <span className="font-medium text-foreground">{clause.orgUsageCount}×</span>
            </p>
            {platform && (
              <p>
                Total na plataforma: <span className="font-medium text-foreground">{clause.usageCount}×</span>
              </p>
            )}
          </section>
        </div>
      </ScrollArea>

      <div className="flex items-center justify-end gap-2 border-t p-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Fechar
        </Button>
        {!platform && (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={deleting}>
                  <Trash2 className="mr-1 h-4 w-4" />
                  Excluir
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir cláusula?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se a cláusula estiver vinculada a contratos, será arquivada em vez de excluída.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={excluir}>Confirmar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button type="button" onClick={() => onEdit(clause)}>
              <Pencil className="mr-1 h-4 w-4" />
              Editar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
