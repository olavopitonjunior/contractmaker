"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowUpCircle,
  Check,
  ClipboardCheck,
  Lock,
  Plus,
  Sparkles,
  Tag as TagIcon,
  Wand2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { CLAUSE_STATUSES } from "@/lib/clauses/schema";
import {
  apareceNaEsteira,
  axisFor,
  ESTEIRA_LABEL,
  type ClauseEsteira,
} from "@/lib/clauses/taxonomy";
import { isCanonicalTag } from "@/lib/clauses/tag-vocabulary";
import type { FormModule } from "@/lib/forms/presets";
import type { ClauseClassificationProposal } from "@/lib/clauses/classify";
import { cn } from "@/lib/utils";
import { EsteiraSwitch } from "@/components/common/EsteiraSwitch";
import { ClauseDetailSheet } from "./ClauseDetailSheet";
import { ClauseEditor } from "./ClauseEditor";
import { GerarClausulaDialog } from "./GerarClausulaDialog";
import { ClauseClassifyReview } from "./ClauseClassifyReview";
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
  /** Módulo de locação do tenant. Desligado = tela fica em venda, sem seletor. */
  locacaoEnabled?: boolean;
}

const ALL = "all";
/** Teto do lote de classificação — espelha o cap de `POST /api/clauses/classify`. */
const MAX_CLASSIFY = 25;

/** Buckets que não são grupo do eixo, mas precisam existir pra nada sumir. */
const BUCKET_AMBAS = "__ambas";
const BUCKET_SEM_GRUPO = "__sem_grupo";
const BUCKET_SEM_ESTEIRA = "__sem_esteira";

export function ClausesPageClient({
  clauses,
  platformUpdates = [],
  locacaoEnabled = false,
}: ClausesPageClientProps) {
  const atualizacoes = useMemo(
    () => new Map(platformUpdates.map((u) => [u.orgClauseId, u])),
    [platformUpdates]
  );

  // Esteira: abre na que tem acervo, pra tenant de locação nunca cair numa
  // tela vazia (era o comportamento antigo — a aba "Padronizadas (G1–G6)" era
  // default e, em locação, é estruturalmente vazia).
  const [esteira, setEsteira] = useState<FormModule>(() => {
    if (!locacaoEnabled) return "venda";
    const temVenda = clauses.some((c) => c.esteira === "venda");
    if (temVenda) return "venda";
    return clauses.some((c) => c.esteira === "locacao") ? "locacao" : "venda";
  });

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [originFilter, setOriginFilter] = useState<string>(ALL);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailClauseId, setDetailClauseId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingClauseId, setEditingClauseId] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);

  // Classificação
  const [reviewOpen, setReviewOpen] = useState(false);
  const [classifyLoading, setClassifyLoading] = useState(false);
  const [proposals, setProposals] = useState<ClauseClassificationProposal[]>([]);
  const [unchanged, setUnchanged] = useState<string[]>([]);
  const [failures, setFailures] = useState<Array<{ clauseId: string; error: string }>>([]);
  const [undecided, setUndecided] = useState<string[]>([]);

  const axis = axisFor(esteira);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of clauses) for (const t of c.tags) set.add(t);
    return Array.from(set).sort();
  }, [clauses]);

  // Mesmo predicado que `visiveis` usa. Antes eram duas cópias da regra, e só
  // uma lembrava das cláusulas SEM esteira: o badge dizia "Locação (23)" e a
  // lista mostrava 24 linhas (issue #480). O número mentia justamente sobre o
  // item não triado, que é o que mais precisa de atenção.
  const esteiraCounts = useMemo(
    () => ({
      venda: clauses.filter((c) => apareceNaEsteira(c.esteira, "venda")).length,
      locacao: clauses.filter((c) => apareceNaEsteira(c.esteira, "locacao")).length,
    }),
    [clauses]
  );

  /** Cláusulas visíveis na esteira atual: a própria + "ambas" + as sem esteira. */
  const visiveis = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clauses.filter((c) => {
      if (!apareceNaEsteira(c.esteira, esteira)) return false;
      if (statusFilter !== ALL && c.status !== statusFilter) return false;
      if (originFilter === "plataforma" && !isPlatformClause(c)) return false;
      if (originFilter === "org" && isPlatformClause(c)) return false;
      if (tagFilter.length > 0 && !tagFilter.every((t) => c.tags.includes(t))) return false;
      if (q) {
        const haystack = `${c.title} ${c.content} ${c.subcategory ?? ""} ${c.tags.join(
          " "
        )}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [clauses, esteira, search, statusFilter, originFilter, tagFilter]);

  /**
   * Partição EXAUSTIVA: cada cláusula visível cai em exatamente um bucket.
   * O modelo antigo (`isVariable && groupCode`) deixava linha fora de todas as
   * abas, e ela parecia deletada.
   */
  const buckets = useMemo(() => {
    const map = new Map<string, Clause[]>();
    const push = (key: string, c: Clause) => {
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    };

    for (const c of visiveis) {
      if (c.esteira === null) {
        push(BUCKET_SEM_ESTEIRA, c);
        continue;
      }
      if (c.esteira === "ambas") {
        push(BUCKET_AMBAS, c);
        continue;
      }
      const value = axis.kind === "groupCode" ? c.groupCode : c.subcategory;
      const known = value && axis.groups.some((g) => g.code === value);
      push(known ? (value as string) : BUCKET_SEM_GRUPO, c);
    }
    return map;
  }, [visiveis, axis]);

  const orderedSections = useMemo(() => {
    const out: Array<{ key: string; label: string; help?: string; rows: Clause[] }> = [];
    for (const g of axis.groups) {
      const rows = buckets.get(g.code);
      if (groupFilter !== ALL && groupFilter !== g.code) continue;
      if (rows?.length) out.push({ key: g.code, label: g.label, help: g.help, rows });
    }
    if (groupFilter !== ALL) return out;

    const semGrupo = buckets.get(BUCKET_SEM_GRUPO);
    if (semGrupo?.length) {
      out.push({
        key: BUCKET_SEM_GRUPO,
        label:
          axis.kind === "groupCode"
            ? "Sem grupo no roteiro"
            : "Outros temas",
        rows: semGrupo,
      });
    }
    const ambas = buckets.get(BUCKET_AMBAS);
    if (ambas?.length) {
      out.push({
        key: BUCKET_AMBAS,
        label: ESTEIRA_LABEL.ambas,
        help: "Valem nas duas esteiras — aparecem aqui e em Vendas/Locação, mas são uma cláusula só.",
        rows: ambas,
      });
    }
    const semEsteira = buckets.get(BUCKET_SEM_ESTEIRA);
    if (semEsteira?.length) {
      out.push({
        key: BUCKET_SEM_ESTEIRA,
        label: "Sem esteira — precisam de triagem",
        help: "Ainda não sabemos se são de compra e venda ou de locação, então continuam aparecendo nas duas. Selecione e use “Analisar e classificar”.",
        rows: semEsteira,
      });
    }
    return out;
  }, [axis, buckets, groupFilter]);

  const selectedClause = clauses.find((c) => c.id === detailClauseId) ?? null;
  const editingClause = clauses.find((c) => c.id === editingClauseId) ?? null;

  const hasActiveFilters =
    search.trim() !== "" ||
    groupFilter !== ALL ||
    statusFilter !== ALL ||
    originFilter !== ALL ||
    tagFilter.length > 0;

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
    setOriginFilter(ALL);
    setTagFilter([]);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectMany(rows: Clause[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        // Cláusula de plataforma não é do tenant — a rota recusaria.
        if (isPlatformClause(r)) continue;
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  /** Dispara a análise das cláusulas marcadas (ou de uma só, pelo detalhe). */
  async function runClassify(ids: string[]) {
    if (ids.length === 0) return;
    if (ids.length > MAX_CLASSIFY) {
      toast.error(`Selecione no máximo ${MAX_CLASSIFY} cláusulas por vez.`);
      return;
    }
    setProposals([]);
    setUnchanged([]);
    setUndecided([]);
    setFailures([]);
    setClassifyLoading(true);
    setReviewOpen(true);
    try {
      const res = await fetch("/api/clauses/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Manda a esteira: a rota recorta o lote por ela e devolve em
        // `ignored` o que ficou de fora. Redundante com a limpeza acima por
        // desenho — a limpeza é de UI e não cobre quem chama a rota direto.
        body: JSON.stringify({ clauseIds: ids, esteira }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Não foi possível analisar.");
        setReviewOpen(false);
        return;
      }
      setProposals(data.proposals ?? []);
      setUnchanged(data.unchanged ?? []);
      setUndecided(data.undecided ?? []);
      setFailures(data.failures ?? []);
      // `ignored` existia na resposta desde o #483 e ninguém o lia. Vindo
      // não-vazio, N cláusulas saíam da análise sem nenhum aviso — a mesma
      // "contagem mentindo" da #479, na direção oposta: sumiço a menos em vez
      // de fantasma a mais.
      if (data.ignored?.length > 0) {
        toast.warning(
          `${data.ignored.length} cláusula(s) ficaram de fora: são de outra esteira.`
        );
      }
    } catch {
      toast.error("Falha de rede ao analisar.");
      setReviewOpen(false);
    } finally {
      setClassifyLoading(false);
    }
  }

  /**
   * A seleção que de fato conta: a interseção do `Set` com o que está VISÍVEL.
   *
   * O `Set` sobrevive a qualquer filtro que esconda uma linha — status, origem,
   * tag, busca — e antes disto `selectedIds` era o `Set` inteiro. A barra dizia
   * "1 selecionada(s)" sem nenhum checkbox marcado na tela, e "Analisar e
   * classificar" mandava esse id (issue #484). O recorte por esteira do #483
   * não pegava: a cláusula é da mesma esteira, só está filtrada.
   *
   * Interseção com `visiveis`, NÃO com `orderedSections`: aquele já filtra por
   * `groupFilter` de propósito, e o contrato é que trocar o filtro de GRUPO
   * preserva a seleção. Derivar em vez de limpar também evita ter de lembrar de
   * zerar o `Set` em cada filtro novo que aparecer.
   */
  const visiveisIds = useMemo(
    () => new Set(visiveis.map((c) => c.id)),
    [visiveis]
  );
  const selectedIds = useMemo(
    () => Array.from(selected).filter((id) => visiveisIds.has(id)),
    [selected, visiveisIds]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Banco de cláusulas"
        description="O acervo que o agente consulta e que alimenta a montagem dos contratos. Cada esteira tem a sua organização."
      >
        {/*
          A conferência do acervo mora na mesma tela que a dos modelos, e o
          caminho tem de existir DAQUI: quem está olhando as cláusulas é quem
          quer saber se elas vão sobreviver à geração.
        */}
        <Button size="sm" variant="outline" asChild>
          <Link href="/templates/revisao">
            <ClipboardCheck className="mr-1.5 h-4 w-4" />
            Revisar biblioteca
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setGenerateOpen(true)}>
          <Sparkles className="mr-1.5 h-4 w-4" />
          Gerar com IA
        </Button>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Nova cláusula
        </Button>
      </PageHeader>

      <EsteiraSwitch
        value={esteira}
        onChange={(next) => {
          setEsteira(next);
          setGroupFilter(ALL);
          // A seleção sobrevivia à troca: cláusula marcada em Vendas seguia no
          // Set em Locação, sem checkbox visível, e "16 selecionada(s)" com 15
          // marcados mandava um item invisível para o classificador (#479).
          //
          // Só na troca de ESTEIRA. Trocar o filtro de grupo continua
          // preservando a seleção — ali o item some da lista mas segue na mesma
          // esteira, e limpar seria regressão travestida de correção.
          setSelected(new Set());
        }}
        locacaoEnabled={locacaoEnabled}
        counts={esteiraCounts}
      />

      <p className="text-xs text-muted-foreground">
        {axis.kind === "groupCode"
          ? "Compra e venda: as cláusulas seguem o roteiro de um CCV, do sinal às disposições finais. Os grupos G1 a G6 são as seis etapas desse roteiro."
          : "Locação (Lei 8.245/91): as cláusulas se organizam por tema, e o agente as encontra por busca semântica — não há códigos de grupo aqui."}
      </p>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por título, conteúdo, tag ou tema..."
          className="w-full sm:w-72"
        />
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger
            size="sm"
            className="w-[230px]"
            // Sem nome acessível o filtro é um combobox anônimo para leitor de
            // tela (o placeholder some assim que há valor) — e intestável.
            aria-label={axis.kind === "groupCode" ? "Filtrar por grupo" : "Filtrar por tema"}
          >
            <SelectValue placeholder={axis.kind === "groupCode" ? "Grupo" : "Tema"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {axis.kind === "groupCode" ? "Todos os grupos" : "Todos os temas"}
            </SelectItem>
            {axis.groups.map((g) => (
              <SelectItem key={g.code} value={g.code}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger size="sm" className="w-[160px]" aria-label="Filtrar por status">
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
        <Select value={originFilter} onValueChange={setOriginFilter}>
          <SelectTrigger size="sm" className="w-[170px]" aria-label="Filtrar por origem">
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as origens</SelectItem>
            <SelectItem value="org">Da imobiliária</SelectItem>
            <SelectItem value="plataforma">Da plataforma</SelectItem>
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

      {/* Barra de seleção em lote */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">
            {selectedIds.length} selecionada(s)
          </span>
          <Button size="sm" onClick={() => runClassify(selectedIds)}>
            <Wand2 className="mr-1.5 h-4 w-4" />
            Analisar e classificar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
          {selectedIds.length > MAX_CLASSIFY && (
            <span className="text-xs text-destructive">
              Máximo de {MAX_CLASSIFY} por vez.
            </span>
          )}
        </div>
      )}

      {orderedSections.length === 0 ? (
        <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
          {hasActiveFilters
            ? "Nenhuma cláusula com esses filtros."
            : `Nenhuma cláusula na esteira de ${ESTEIRA_LABEL[esteira as ClauseEsteira].toLowerCase()} ainda.`}
        </div>
      ) : (
        <div className="space-y-6">
          {orderedSections.map((section) => (
            <ClauseSection
              key={section.key}
              label={section.label}
              help={section.help}
              rows={section.rows}
              atualizacoes={atualizacoes}
              selected={selected}
              onToggle={toggleSelect}
              onToggleAll={(on) => selectMany(section.rows, on)}
              onRowClick={openDetail}
              onClassify={
                section.key === BUCKET_SEM_ESTEIRA
                  ? () =>
                      runClassify(
                        section.rows
                          .filter((r) => !isPlatformClause(r))
                          .slice(0, MAX_CLASSIFY)
                          .map((r) => r.id)
                      )
                  : undefined
              }
            />
          ))}
        </div>
      )}

      <ClauseDetailSheet
        clause={selectedClause}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        platformUpdate={selectedClause ? atualizacoes.get(selectedClause.id) : undefined}
        onEdit={handleEdit}
        onClassify={
          selectedClause && !isPlatformClause(selectedClause)
            ? (c) => {
                setDetailOpen(false);
                runClassify([c.id]);
              }
            : undefined
        }
      />

      <ClauseEditor
        key={editingClauseId ?? "new"}
        clause={editingClause}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        mode={editorMode}
        locacaoEnabled={locacaoEnabled}
        orgTags={allTags}
      />

      <GerarClausulaDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        onUseExisting={handleUseExisting}
      />

      <ClauseClassifyReview
        open={reviewOpen}
        onOpenChange={(o) => {
          setReviewOpen(o);
          if (!o) setSelected(new Set());
        }}
        proposals={proposals}
        unchanged={unchanged}
        undecided={undecided}
        failures={failures}
        loading={classifyLoading}
      />
    </div>
  );
}

function ClauseSection({
  label,
  help,
  rows,
  atualizacoes,
  selected,
  onToggle,
  onToggleAll,
  onRowClick,
  onClassify,
}: {
  label: string;
  help?: string;
  rows: Clause[];
  atualizacoes: Map<string, PlatformUpdate>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  onRowClick: (clause: Clause) => void;
  onClassify?: () => void;
}) {
  const selectableIds = rows.filter((r) => !isPlatformClause(r)).map((r) => r.id);
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">
            {label}{" "}
            <span className="font-normal text-muted-foreground">({rows.length})</span>
          </h2>
          {help && <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>}
        </div>
        {onClassify && (
          <Button size="sm" variant="outline" onClick={onClassify}>
            <Wand2 className="mr-1.5 h-4 w-4" />
            Analisar e classificar
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  disabled={selectableIds.length === 0}
                  onCheckedChange={(v) => onToggleAll(v === true)}
                  aria-label={`Selecionar todas de ${label}`}
                />
              </TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Tema</TableHead>
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
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(clause.id)}
                      disabled={platform}
                      onCheckedChange={() => onToggle(clause.id)}
                      aria-label={`Selecionar ${clause.title}`}
                    />
                  </TableCell>
                  <TableCell className="max-w-[280px] whitespace-normal">
                    <div className="flex items-center gap-1.5">
                      {update && (
                        <ArrowUpCircle
                          className="h-3.5 w-3.5 shrink-0 text-amber-600"
                          aria-label="Atualização da plataforma disponível"
                        />
                      )}
                      <span className="truncate font-medium">{clause.title}</span>
                      {clause.isVariable && (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px]"
                          title="O texto usa variáveis preenchidas pelo formulário."
                        >
                          {"{{ }}"}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {clause.category}
                    </Badge>
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
                        <Badge
                          key={t}
                          // Livre × canônica: a distinção é visual, sem migrar
                          // nada — tag legada continua valendo.
                          variant={isCanonicalTag(t) ? "secondary" : "outline"}
                          className="text-xs"
                          title={isCanonicalTag(t) ? undefined : "Tag livre (fora do vocabulário)"}
                        >
                          {t}
                        </Badge>
                      ))}
                      {extraTags > 0 && (
                        <Badge
                          variant="outline"
                          className="text-xs"
                          title={clause.tags.slice(3).join(", ")}
                        >
                          +{extraTags}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {clause.orgUsageCount}
                  </TableCell>
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
    </section>
  );
}
