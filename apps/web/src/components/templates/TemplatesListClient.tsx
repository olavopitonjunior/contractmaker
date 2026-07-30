"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Pencil,
  Star,
  FileText,
  Archive,
  ArchiveRestore,
  Globe,
  Layers,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  isTemplateCategory,
  matchCriteriaSummary,
  modalidadeLabel,
} from "@/lib/contracts/template-category";

function categoryLabel(category: string | null | undefined): string | null {
  return isTemplateCategory(category) ? CATEGORY_LABELS[category] : null;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  modalidade: string | null;
  category?: string | null;
  matchCriteria?: unknown;
  version: string;
  isDefault: boolean;
  status: string;
  engine: string;
  contractsCount: number;
  updatedAt: string;
}

interface Props {
  templates: TemplateRow[];
  showArchived: boolean;
  archivedCount: number;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}


export function TemplatesListClient({
  templates,
  showArchived,
  archivedCount,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setAsDefault(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Falha ao definir padrão");
        return;
      }
      toast.success("Template marcado como padrão.");
      start(() => router.refresh());
    } finally {
      setBusyId(null);
    }
  }

  async function archiveTemplate(id: string) {
    if (
      !confirm(
        "Arquivar este template? Contratos antigos continuam funcionando, mas ele some da listagem ativa e não será usado em novas criações."
      )
    ) {
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived", isDefault: false }),
      });
      if (!res.ok) {
        toast.error("Falha ao arquivar");
        return;
      }
      toast.success("Template arquivado.");
      start(() => router.refresh());
    } finally {
      setBusyId(null);
    }
  }

  async function restoreTemplate(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) {
        toast.error("Falha ao restaurar");
        return;
      }
      toast.success("Template restaurado.");
      start(() => router.refresh());
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        <Button
          variant={showArchived ? "outline" : "default"}
          size="sm"
          asChild
        >
          <Link href="/templates">Ativos</Link>
        </Button>
        <Button
          variant={showArchived ? "default" : "outline"}
          size="sm"
          asChild
        >
          <Link href="/templates?archived=1">
            Arquivados ({archivedCount})
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => {
          const isGdocs = t.engine === "google_docs";
          return (
            <Card
              key={t.id}
              className={
                t.isDefault
                  ? "border-emerald-500/60 ring-1 ring-emerald-500/30"
                  : ""
              }
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm leading-tight">
                    {t.name}
                  </CardTitle>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    v{t.version}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {t.isDefault && (
                    <Badge className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1">
                      <Star className="h-3 w-3 fill-current" />
                      Padrão atual
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    {modalidadeLabel(t.modalidade)}
                  </Badge>
                  {categoryLabel(t.category) && (
                    <Badge variant="outline" className="text-xs">
                      {categoryLabel(t.category)}
                    </Badge>
                  )}
                  {/* Variante: mostra por qual escolha do formulário este modelo
                      é escolhido dentro da modalidade (sem isso, dois modelos
                      "Locação residencial" ficam indistinguíveis na lista). */}
                  {matchCriteriaSummary(t.matchCriteria).map((label) => (
                    <Badge
                      key={label}
                      variant="outline"
                      className="text-xs border-sky-300 text-sky-700"
                      title="Critério de seleção pelas escolhas do formulário"
                    >
                      {label}
                    </Badge>
                  ))}
                  <Badge
                    variant="outline"
                    className="text-xs gap-1"
                    title={
                      isGdocs
                        ? "Template aponta pra Google Doc existente (não suporta loops)"
                        : "Template Handlebars (suporta loops, conditionals)"
                    }
                  >
                    {isGdocs ? (
                      <Globe className="h-3 w-3" />
                    ) : (
                      <Layers className="h-3 w-3" />
                    )}
                    {isGdocs ? "Google Doc" : "Handlebars"}
                  </Badge>
                  {t.status === "archived" && (
                    <Badge variant="outline" className="text-xs">
                      Arquivado
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {t.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {t.description}
                  </p>
                )}

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {t.contractsCount} contrato
                    {t.contractsCount === 1 ? "" : "s"}
                  </span>
                  <span>Atualizado {formatDate(t.updatedAt)}</span>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/templates/${t.id}`}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Editar
                    </Link>
                  </Button>

                  {t.status === "active" && !t.isDefault && (
                    <Button
                      size="sm"
                      variant="default"
                      disabled={busyId === t.id || pending}
                      onClick={() => setAsDefault(t.id)}
                    >
                      <Star className="h-3.5 w-3.5 mr-1" />
                      Tornar padrão
                    </Button>
                  )}

                  {t.status === "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === t.id || pending}
                      onClick={() => archiveTemplate(t.id)}
                      title="Arquivar template"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {t.status === "archived" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === t.id || pending}
                      onClick={() => restoreTemplate(t.id)}
                      title="Restaurar template"
                    >
                      <ArchiveRestore className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {templates.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>
            {showArchived
              ? "Nenhum template arquivado."
              : "Nenhum template ativo."}
          </p>
          {!showArchived && (
            <p className="text-sm mt-1">
              Crie um novo template para começar.
            </p>
          )}
        </div>
      )}
    </>
  );
}
