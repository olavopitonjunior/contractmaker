"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Check, X, Bot, User as UserIcon, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface DiffHunk {
  before: string;
  after: string;
  contextBefore?: string;
  contextAfter?: string;
}

interface TemplateSuggestion {
  id: string;
  templateId: string;
  authorType: string;
  userId: string | null;
  title: string;
  reason: string;
  diffHunks: DiffHunk[] | unknown;
  evidence: unknown;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

interface Template {
  id: string;
  name: string;
  version: string;
  modalidade: string | null;
  handlebarsSource: string;
}

interface Props {
  template: Template;
  initialSuggestions: TemplateSuggestion[];
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const delta = Math.floor((Date.now() - d.getTime()) / 1000);
  if (delta < 60) return "agora";
  if (delta < 3600) return `${Math.floor(delta / 60)}min atrás`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h atrás`;
  return d.toLocaleDateString("pt-BR");
}

function HunkView({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="space-y-1 text-[11px] font-mono">
      {hunk.contextBefore && (
        <div className="text-muted-foreground">…{hunk.contextBefore.slice(-80)}</div>
      )}
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded px-2 py-1">
        <span className="text-red-700 dark:text-red-400 select-none mr-1">−</span>
        <span className="whitespace-pre-wrap">{hunk.before}</span>
      </div>
      <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded px-2 py-1">
        <span className="text-green-700 dark:text-green-400 select-none mr-1">+</span>
        <span className="whitespace-pre-wrap">{hunk.after}</span>
      </div>
      {hunk.contextAfter && (
        <div className="text-muted-foreground">{hunk.contextAfter.slice(0, 80)}…</div>
      )}
    </div>
  );
}

export function TemplateSuggestionsClient({ template, initialSuggestions }: Props) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [resolving, setResolving] = useState<string | null>(null);

  async function handleAction(sugId: string, action: "accept" | "reject") {
    setResolving(sugId);
    try {
      const res = await fetch(`/api/templates/${template.id}/suggestions/${sugId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          action === "accept"
            ? `Aplicada — template agora está na versão ${data.newVersion}`
            : "Sugestão rejeitada"
        );
        if (data.warning) toast.warning(data.warning);
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === sugId
              ? { ...s, status: action === "accept" ? "approved" : "rejected" }
              : s
          )
        );
        router.refresh();
      } else {
        toast.error(data.error || "Erro ao aplicar");
      }
    } finally {
      setResolving(null);
    }
  }

  async function handleDelete(sugId: string) {
    if (!confirm("Remover esta sugestão?")) return;
    const res = await fetch(`/api/templates/${template.id}/suggestions/${sugId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Removida");
      setSuggestions((prev) => prev.filter((s) => s.id !== sugId));
    }
  }

  const pending = suggestions.filter((s) => s.status === "pending");
  const resolved = suggestions.filter((s) => s.status !== "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2">
            <Link href={`/templates/${template.id}`}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              {template.name}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">Sugestões do template</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline">v{template.version}</Badge>
            {template.modalidade && (
              <Badge variant="secondary">{template.modalidade}</Badge>
            )}
          </div>
        </div>
      </div>

      <Card className="bg-muted/30">
        <CardContent className="pt-4 pb-4 text-xs text-muted-foreground">
          <p>
            <strong>Modo Propose:</strong> a IA e outros membros podem propor mudanças
            no template, mas só admins aprovam e aplicam. Ao aprovar, o{" "}
            <code>handlebarsSource</code> é modificado e a versão do template é incrementada
            automaticamente (patch).
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending">
            Pendentes
            {pending.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {pending.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolvidas
            {resolved.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {resolved.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3">
          {pending.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma sugestão pendente. Quando a IA ou um membro propuser uma mudança,
              ela aparecerá aqui para revisão.
            </p>
          )}
          {pending.map((sug) => {
            const hunks = (Array.isArray(sug.diffHunks) ? sug.diffHunks : []) as DiffHunk[];
            const invalidHunks = hunks.filter(
              (h) => !template.handlebarsSource.includes(h.before)
            );
            return (
              <Card key={sug.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base">{sug.title}</CardTitle>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        {sug.authorType === "ai" ? (
                          <span className="flex items-center gap-1">
                            <Bot className="h-3 w-3 text-primary" />
                            IA
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <UserIcon className="h-3 w-3" />
                            Usuário
                          </span>
                        )}
                        <span>·</span>
                        <span>{formatRelative(sug.createdAt)}</span>
                        <span>·</span>
                        <span>{hunks.length} {hunks.length === 1 ? "hunk" : "hunks"}</span>
                        {invalidHunks.length > 0 && (
                          <Badge variant="destructive" className="gap-1 text-[9px]">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {invalidHunks.length} inválidos
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded border border-muted bg-muted/30 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Justificativa
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{sug.reason}</p>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Diff proposto
                    </p>
                    {hunks.map((hunk, i) => (
                      <HunkView key={i} hunk={hunk} />
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                      onClick={() => handleAction(sug.id, "accept")}
                      disabled={resolving === sug.id || invalidHunks.length === hunks.length}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Aplicar no template
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAction(sug.id, "reject")}
                      disabled={resolving === sug.id}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Rejeitar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-destructive hover:text-destructive"
                      onClick={() => handleDelete(sug.id)}
                    >
                      Descartar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="resolved" className="space-y-3">
          {resolved.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma sugestão resolvida ainda.
            </p>
          )}
          {resolved.map((sug) => (
            <Card key={sug.id} className="opacity-80">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">{sug.title}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      {sug.authorType === "ai" ? "IA" : "Usuário"} · resolvida{" "}
                      {sug.resolvedAt && formatRelative(sug.resolvedAt)}
                    </p>
                  </div>
                  <Badge
                    variant={sug.status === "approved" ? "default" : "secondary"}
                    className={sug.status === "approved" ? "bg-green-600" : ""}
                  >
                    {sug.status === "approved" ? "Aplicada" : "Rejeitada"}
                  </Badge>
                </div>
              </CardHeader>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
