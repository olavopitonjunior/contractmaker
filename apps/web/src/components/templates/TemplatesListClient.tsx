"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Pencil,
  Star,
  FileText,
  Archive,
  ArchiveRestore,
  Globe,
  Layers,
  Eye,
  Trash2,
  Check,
  Search,
  TriangleAlert,
  CircleAlert,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  isTemplateCategory,
  matchCriteriaSummary,
  modalidadeLabel,
} from "@/lib/contracts/template-category";
import {
  TEMPLATE_SECTIONS,
  sectionForModalidade,
  type SectionGap,
  type TemplateSectionKey,
} from "@/lib/templates/coverage";
import { TemplatePreview } from "@/components/templates/TemplatePreview";

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
  /** Filtro ativo por modalidade (vem do CTA "Escolher padrão" da aba Tipos). */
  modalidadeFilter?: string | null;
  /**
   * Templates ATRIBUÍDOS como padrão do sistema — os mesmos que a aba Tipos
   * exibe como padrão/atribuído (`assignedTemplateIds`). São os que ganham o
   * contorno verde.
   */
  assignedIds?: string[];
  /** O que falta por seção — mesma régua da aba Tipos (`gapsBySection`). */
  gaps?: Partial<Record<TemplateSectionKey, SectionGap[]>>;
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

/** Atribuídos primeiro, depois ativos por nome, rascunhos por último. */
function sortForSection(assigned: Set<string>) {
  const rank = (t: TemplateRow) =>
    assigned.has(t.id) ? 0 : t.status === "active" ? 1 : 2;
  return (a: TemplateRow, b: TemplateRow) =>
    rank(a) - rank(b) || a.name.localeCompare(b.name, "pt-BR");
}

/**
 * Repositório de Modelos (aba Modelos) — organizado por FAMÍLIA, na
 * classificação do dono: Vendas · Locação residencial · Locação comercial ·
 * Administração (propostas dentro da família). Cada seção mostra a contagem e
 * o que falta; cada card mostra se o modelo é o atribuído do sistema (contorno
 * verde — mesma fonte da aba Tipos), a descrição e as ações completas:
 * preview, editar, tornar padrão, arquivar e excluir.
 */
export function TemplatesListClient({
  templates,
  showArchived,
  archivedCount,
  modalidadeFilter,
  assignedIds = [],
  gaps = {},
}: Props) {
  // A lista vive na aba Modelos: os filtros Ativos/Arquivados precisam
  // preservar a aba e o filtro de modalidade, senão o clique volta pra aba
  // Tipos e o operador perde o contexto do "Escolher padrão".
  const baseQuery = `tab=modelos${
    modalidadeFilter ? `&modalidade=${modalidadeFilter}` : ""
  }`;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // O CTA "Escolher padrão" da aba Tipos chega com ?modalidade= — o chip da
  // família correspondente já nasce selecionado.
  const [sectionFilter, setSectionFilter] = useState<TemplateSectionKey | null>(
    modalidadeFilter ? sectionForModalidade(modalidadeFilter) : null
  );
  const [preview, setPreview] = useState<TemplateRow | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<TemplateRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TemplateRow | null>(null);

  const assigned = useMemo(() => new Set(assignedIds), [assignedIds]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q)) return false;
      if (modalidadeFilter && t.modalidade !== modalidadeFilter) return false;
      return true;
    });
  }, [templates, search, modalidadeFilter]);

  const bySection = useMemo(() => {
    const map = new Map<TemplateSectionKey, TemplateRow[]>();
    for (const t of visible) {
      const key = sectionForModalidade(t.modalidade);
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    const cmp = sortForSection(assigned);
    for (const arr of map.values()) arr.sort(cmp);
    return map;
  }, [visible, assigned]);

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

  async function deleteTemplate(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao excluir");
        return;
      }
      // A rota preserva histórico: template com contratos gerados não some,
      // vira arquivado — e a tela conta a verdade.
      if (data.status === "archived") {
        toast.success(
          "Este modelo já gerou contratos, então foi ARQUIVADO em vez de excluído — o histórico continua íntegro."
        );
      } else {
        toast.success("Template excluído.");
      }
      start(() => router.refresh());
    } finally {
      setBusyId(null);
    }
  }

  async function restoreTemplate(
    id: string,
    flags: { forceActivate?: boolean; allowPii?: boolean } = {}
  ) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active", ...flags }),
      });
      const data = await res.json().catch(() => ({}));
      // O modelo tem espaço de cláusula e o acervo ainda não tem cláusula
      // aprovada pra ele: reativar assim faria o contrato sair com o texto
      // padrão da plataforma no lugar da redação da imobiliária. A trava é do
      // servidor; aqui damos a saída consciente.
      if (res.status === 409 && data?.code === "SLOT_CLAUSE_MISSING") {
        setBusyId(null);
        if (confirm(`${data.error}\n\nAtivar mesmo assim?`)) {
          await restoreTemplate(id, { ...flags, forceActivate: true });
        }
        return;
      }
      // Mesma trava do servidor que a página de revisão mostra: dado pessoal
      // literal no texto (ou texto que não pôde ser lido). Saída consciente
      // própria, `allowPii` — o `forceActivate` do slot não libera isto.
      if (res.status === 409 && (data?.code === "PII_LEFTOVER" || data?.code === "PII_UNVERIFIED")) {
        setBusyId(null);
        const pergunta =
          data.code === "PII_UNVERIFIED" ? "Ativar sem conferir?" : "Ativar mesmo assim?";
        if (confirm(`${data.error}\n\n${pergunta}`)) {
          await restoreTemplate(id, { ...flags, allowPii: true });
        }
        return;
      }
      if (!res.ok) {
        toast.error(data?.error ?? "Falha ao restaurar");
        return;
      }
      toast.success("Template restaurado.");
      start(() => router.refresh());
    } finally {
      setBusyId(null);
    }
  }

  const sectionsToRender = TEMPLATE_SECTIONS.filter(({ key }) => {
    if (sectionFilter && key !== sectionFilter) return false;
    const items = bySection.get(key) ?? [];
    const sectionGaps = gaps[key] ?? [];
    // Arquivados: só seções com item (falta é assunto dos ativos).
    if (showArchived) return items.length > 0;
    return items.length > 0 || sectionGaps.length > 0;
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button variant={showArchived ? "outline" : "default"} size="sm" asChild>
          <Link href={`/templates?${baseQuery}`}>Ativos</Link>
        </Button>
        <Button variant={showArchived ? "default" : "outline"} size="sm" asChild>
          <Link href={`/templates?${baseQuery}&archived=1`}>
            Arquivados ({archivedCount})
          </Link>
        </Button>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar modelo pelo nome…"
            className="h-8 pl-8"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SectionChip
          label="Todas"
          active={sectionFilter === null}
          onClick={() => setSectionFilter(null)}
        />
        {TEMPLATE_SECTIONS.filter(
          ({ key }) =>
            key !== "outros" ||
            templates.some((t) => sectionForModalidade(t.modalidade) === "outros")
        ).map(({ key, label }) => (
          <SectionChip
            key={key}
            label={label}
            active={sectionFilter === key}
            onClick={() => setSectionFilter(sectionFilter === key ? null : key)}
          />
        ))}
      </div>

      <div className="space-y-6">
        {sectionsToRender.map(({ key, label }) => {
          const items = bySection.get(key) ?? [];
          const sectionGaps = showArchived ? [] : gaps[key] ?? [];
          return (
            <section key={key}>
              <header className="mb-2 flex flex-wrap items-center gap-2 border-b pb-1.5">
                <h3 className="text-sm font-semibold">{label}</h3>
                <span className="text-xs text-muted-foreground">
                  {items.length} modelo{items.length === 1 ? "" : "s"}
                </span>
                {sectionGaps.length > 0 && (
                  <span className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
                    <span className="text-muted-foreground">· faltando:</span>
                    {sectionGaps.map((g) => (
                      <span
                        key={g.label}
                        title={
                          g.hard
                            ? "Nenhum modelo ativo gera este tipo — a geração falha"
                            : "Sem modelo próprio — gera com o padrão da modalidade"
                        }
                        className={
                          g.hard
                            ? "inline-flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-px font-medium text-destructive"
                            : "inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-px font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                        }
                      >
                        {g.hard ? (
                          <CircleAlert className="h-3 w-3" />
                        ) : (
                          <TriangleAlert className="h-3 w-3" />
                        )}
                        {g.label}
                      </span>
                    ))}
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" asChild>
                      <Link href="/templates?tab=modelos&ingest=1">Enviar modelo</Link>
                    </Button>
                  </span>
                )}
              </header>

              {items.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  Nenhum modelo nesta família ainda.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {items.map((t) => (
                    <TemplateCard
                      key={t.id}
                      t={t}
                      isAssigned={assigned.has(t.id)}
                      busy={busyId === t.id || pending}
                      onPreview={() => setPreview(t)}
                      onSetDefault={() => setAsDefault(t.id)}
                      onArchive={() => setConfirmArchive(t)}
                      onDelete={() => setConfirmDelete(t)}
                      onRestore={() => restoreTemplate(t.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {sectionsToRender.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          <p>
            {search
              ? "Nenhum modelo com esse nome."
              : showArchived
                ? "Nenhum template arquivado."
                : "Nenhum template ativo."}
          </p>
        </div>
      )}

      {preview && (
        <TemplatePreview
          templateId={preview.id}
          templateName={preview.name}
          templateModalidade={preview.modalidade}
          templateEngine={preview.engine}
          open
          onOpenChange={(open) => !open && setPreview(null)}
        />
      )}

      <AlertDialog
        open={confirmArchive !== null}
        onOpenChange={(open) => !open && setConfirmArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar este template?</AlertDialogTitle>
            <AlertDialogDescription>
              Contratos antigos continuam funcionando, mas &ldquo;
              {confirmArchive?.name}&rdquo; some da listagem ativa e não será
              usado em novas gerações.
              {confirmArchive && assigned.has(confirmArchive.id) && (
                <>
                  {" "}
                  <strong>
                    Ele é um padrão do sistema — arquivá-lo deixa o tipo
                    correspondente faltante na aba Tipos.
                  </strong>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmArchive) archiveTemplate(confirmArchive.id);
                setConfirmArchive(null);
              }}
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este template?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{confirmDelete?.name}&rdquo; será removido do repositório.
              Se ele já gerou contratos, será arquivado em vez de excluído —
              o histórico das versões não se perde.
              {confirmDelete && assigned.has(confirmDelete.id) && (
                <>
                  {" "}
                  <strong>
                    Ele é um padrão do sistema — sem ele, o tipo correspondente
                    fica faltante e a geração cai no fallback da modalidade.
                  </strong>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDelete) deleteTemplate(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SectionChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground"
          : "rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}

function TemplateCard({
  t,
  isAssigned,
  busy,
  onPreview,
  onSetDefault,
  onArchive,
  onDelete,
  onRestore,
}: {
  t: TemplateRow;
  isAssigned: boolean;
  busy: boolean;
  onPreview: () => void;
  onSetDefault: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const isGdocs = t.engine === "google_docs";
  return (
    <Card
      className={
        isAssigned ? "border-emerald-500/60 ring-1 ring-emerald-500/30" : ""
      }
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm leading-tight">{t.name}</CardTitle>
          <Badge variant="outline" className="shrink-0 text-xs">
            v{t.version}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {isAssigned && (
            <Badge
              className="gap-1 bg-emerald-600 text-xs hover:bg-emerald-700"
              title="Este modelo é o que a geração usa — aparece como atribuído na aba Tipos"
            >
              <Check className="h-3 w-3" />
              padrão do sistema
            </Badge>
          )}
          {t.isDefault && (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/60 text-xs text-emerald-700 dark:text-emerald-400"
              title="Padrão da modalidade — desempate e fallback quando o formulário não decide"
            >
              <Star className="h-3 w-3 fill-current" />
              padrão da modalidade
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
          {/* Variante: mostra por qual escolha do formulário este modelo é
              escolhido dentro da modalidade (sem isso, dois modelos "Locação
              residencial" ficam indistinguíveis na lista). */}
          {matchCriteriaSummary(t.matchCriteria).map((label) => (
            <Badge
              key={label}
              variant="outline"
              className="border-sky-300 text-xs text-sky-700"
              title="Critério de seleção pelas escolhas do formulário"
            >
              {label}
            </Badge>
          ))}
          <Badge
            variant="outline"
            className="gap-1 text-xs"
            title={
              isGdocs
                ? "Template aponta pra Google Doc existente (não suporta loops)"
                : "Template Handlebars (suporta loops, conditionals)"
            }
          >
            {isGdocs ? <Globe className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
            {isGdocs ? "Google Doc" : "Handlebars"}
          </Badge>
          {t.status === "draft" && (
            <Badge
              variant="outline"
              className="border-dashed border-amber-400 text-xs text-amber-700 dark:text-amber-400"
            >
              em revisão
            </Badge>
          )}
          {t.status === "archived" && (
            <Badge variant="outline" className="text-xs">
              Arquivado
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {t.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {t.description}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {t.contractsCount} contrato{t.contractsCount === 1 ? "" : "s"}
          </span>
          <span>Atualizado {formatDate(t.updatedAt)}</span>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" variant="outline" onClick={onPreview} title="Ver preview">
            <Eye className="mr-1 h-3.5 w-3.5" />
            Preview
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/templates/${t.id}`}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Editar
            </Link>
          </Button>

          {t.status === "active" && !t.isDefault && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onSetDefault}>
              <Star className="mr-1 h-3.5 w-3.5" />
              Tornar padrão
            </Button>
          )}

          {t.status !== "archived" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onArchive}
              title="Arquivar template"
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onRestore}
              title="Restaurar template"
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={onDelete}
            title="Excluir template"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
