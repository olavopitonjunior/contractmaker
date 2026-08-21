"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpCircle,
  Check,
  Lock,
  Plus,
  Sparkles,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CLAUSE_GROUP_CODES, CLAUSE_STATUSES, GROUP_LABELS } from "@/lib/clauses/schema";
import { cn } from "@/lib/utils";
import { ClauseDetailSheet } from "./ClauseDetailSheet";
import { ClauseEditor } from "./ClauseEditor";
import { GerarClausulaDialog } from "./GerarClausulaDialog";
import {
  CLAUSE_STATUS_LABEL,
  CLAUSE_STATUS_VARIANT,
  isPlatformClause,
  type Clause,
  type PlatformUpdate,
} from "./types";

interface ClausesPageClientProps {
  clauses: Clause[];
  platformUpdates?: PlatformUpdate[];
}

const ALL = "all";

export function ClausesPageClient({
  clauses,
  platformUpdates = [],
}: ClausesPageClientProps) {
  const atualizacoes = useMemo(
    () => new Map(platformUpdates.map((u) => [u.orgClauseId, u])),
    [platformUpdates]
  );

  // Toolbar
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("padronizadas");

  // Detail sheet
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailClauseId, setDetailClauseId] = useState<string | null>(null);

  // Editor sheet
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingClauseId, setEditingClauseId] = useState<string | null>(null);

  // Gerar com IA
  const [generateOpen, setGenerateOpen] = useState(false);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of clauses) for (const t of c.tags) set.add(t);
    return Array.from(set).sort();
  }, [clauses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clauses.filter((c) => {
      if (groupFilter !== ALL && c.groupCode !== groupFilter) return false;
      if (statusFilter !== ALL && c.status !== statusFilter) return false;
      if (tagFilter.length > 0 && !tagFilter.every((t) => c.tags.includes(t))) return false;
      if (q) {
        const haystack = `${c.title} ${c.content} ${c.subcategory ?? ""} ${c.tags.join(
          " "
        )}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [clauses, search, groupFilter, statusFilter, tagFilter]);

  const padronizadas = useMemo(
    () => filtered.filter((c) => c.isVariable && c.groupCode),
    [filtered]
  );
  // Base = tudo que NÃO entra em Padronizadas — partição exaustiva: uma
  // cláusula isVariable sem groupCode (o schema permite) sumia das três abas
  // e parecia deletada (achado de review; buraco pré-existente).
  const base = useMemo(
    () => filtered.filter((c) => !(c.isVariable && c.groupCode)),
    [filtered]
  );
  const plataforma = useMemo(() => filtered.filter((c) => isPlatformClause(c)), [filtered]);

  const selectedClause = clauses.find((c) => c.id === detailClauseId) ?? null;
  const editingClause = clauses.find((c) => c.id === editingClauseId) ?? null;

  const hasActiveFilters =
    search.trim() !== "" || groupFilter !== ALL || statusFilter !== ALL || tagFilter.length > 0;

  function openDetail(clause: Clause) {
    setDetailClauseId(clause.id);
    setDetailOpen(true);
  }

  function handleCreate() {
    setEditingClauseId(null);
    setEditorMode("create");
    setEditorOpen(true);
  }

  function handleEdit(clause: Clause) {
    setEditingClauseId(clause.id);
    setEditorMode("edit");
    setEditorOpen(true);
    setDetailOpen(false);
  }

  function handleUseExisting(clauseId: string) {
    const found = clauses.find((c) => c.id === clauseId);
    if (!found) {
      toast.info("Cláusula não encontrada nesta lista — tente buscar por ela.");
      return;
    }
    openDetail(found);
  }

  function toggleTag(tag: string) {
    setTagFilter((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function clearFilters() {
    setSearch("");
    setGroupFilter(ALL);
    setStatusFilter(ALL);
    setTagFilter([]);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Biblioteca de Cláusulas"
        description="Banco padronizado (G1–G6) + cláusulas base, usadas pelo agente e na montagem dos contratos."
      >
        <Button size="sm" variant="outline" onClick={() => setGenerateOpen(true)}>
          <Sparkles className="mr-1.5 h-4 w-4" />
          Gerar com IA
        </Button>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Nova cláusula
        </Button>
      </PageHeader>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por título, conteúdo, tag ou subcategoria..."
          className="w-full sm:w-72"
        />
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger size="sm" className="w-[210px]">
            <SelectValue placeholder="Grupo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os grupos</SelectItem>
            {CLAUSE_GROUP_CODES.map((g) => (
              <SelectItem key={g} value={g}>
                {GROUP_LABELS[g] ?? g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger size="sm" className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            {CLAUSE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {CLAUSE_STATUS_LABEL[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <TagIcon className="h-3.5 w-3.5" />
              Tags{tagFilter.length > 0 ? ` (${tagFilter.length})` : ""}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput placeholder="Filtrar tags..." />
              <CommandList>
                <CommandEmpty>Nenhuma tag no acervo.</CommandEmpty>
                <CommandGroup>
                  {allTags.map((t) => {
                    const active = tagFilter.includes(t);
                    return (
                      <CommandItem key={t} onSelect={() => toggleTag(t)}>
                        <span
                          className={cn(
                            "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            active && "border-primary bg-primary text-primary-foreground"
                          )}
                        >
                          {active && <Check className="h-3 w-3" />}
                        </span>
                        {t}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Limpar filtros
          </Button>
        )}
      </div>

      {tagFilter.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tagFilter.map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="cursor-pointer text-xs"
              onClick={() => toggleTag(t)}
            >
              {t}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="padronizadas">
            Padronizadas (G1–G6) ({padronizadas.length})
          </TabsTrigger>
          <TabsTrigger value="base">Cláusulas base ({base.length})</TabsTrigger>
          <TabsTrigger value="plataforma">Plataforma ({plataforma.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="padronizadas" className="mt-4">
          <ClauseTable
            rows={padronizadas}
            atualizacoes={atualizacoes}
            onRowClick={openDetail}
            emptyMessage="Nenhuma cláusula padronizada encontrada."
          />
        </TabsContent>
        <TabsContent value="base" className="mt-4">
          <ClauseTable
            rows={base}
            atualizacoes={atualizacoes}
            onRowClick={openDetail}
            emptyMessage="Nenhuma cláusula base encontrada."
          />
        </TabsContent>
        <TabsContent value="plataforma" className="mt-4">
          <ClauseTable
            rows={plataforma}
            atualizacoes={atualizacoes}
            onRowClick={openDetail}
            emptyMessage="Nenhuma cláusula de plataforma encontrada."
          />
        </TabsContent>
      </Tabs>

      <ClauseDetailSheet
        clause={selectedClause}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        platformUpdate={selectedClause ? atualizacoes.get(selectedClause.id) : undefined}
        onEdit={handleEdit}
      />

      <ClauseEditor
        key={editingClauseId ?? "new"}
        clause={editingClause}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        mode={editorMode}
      />

      <GerarClausulaDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        onUseExisting={handleUseExisting}
      />
    </div>
  );
}

function ClauseTable({
  rows,
  atualizacoes,
  onRowClick,
  emptyMessage,
}: {
  rows: Clause[];
  atualizacoes: Map<string, PlatformUpdate>;
  onRowClick: (clause: Clause) => void;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Título</TableHead>
            <TableHead>Grupo/Subcategoria</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead className="text-right">Uso</TableHead>
            <TableHead>Origem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((clause) => {
            const update = atualizacoes.get(clause.id);
            const platform = isPlatformClause(clause);
            const visibleTags = clause.tags.slice(0, 3);
            const extraTags = clause.tags.length - visibleTags.length;
            return (
              <TableRow
                key={clause.id}
                className="cursor-pointer"
                onClick={() => onRowClick(clause)}
              >
                <TableCell className="max-w-[280px] whitespace-normal">
                  <div className="flex items-center gap-1.5">
                    {update && (
                      <ArrowUpCircle
                        className="h-3.5 w-3.5 shrink-0 text-amber-600"
                        aria-label="Atualização da plataforma disponível"
                      />
                    )}
                    <span className="truncate font-medium">{clause.title}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {clause.groupCode && (
                      <Badge variant="outline" className="text-xs">
                        {clause.groupCode}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {clause.category}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={CLAUSE_STATUS_VARIANT[clause.status] ?? "outline"}
                    className="text-xs"
                  >
                    {CLAUSE_STATUS_LABEL[clause.status] ?? clause.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {visibleTags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-xs">
                        {t}
                      </Badge>
                    ))}
                    {extraTags > 0 && (
                      <Badge variant="outline" className="text-xs">
                        +{extraTags}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{clause.orgUsageCount}</TableCell>
                <TableCell>
                  {platform ? (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <Lock className="h-2.5 w-2.5" />
                      Plataforma
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Imobiliária</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
