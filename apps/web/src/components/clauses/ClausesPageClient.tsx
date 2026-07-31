"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Lock, ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ClauseEditor } from "./ClauseEditor";

const GROUP_LABELS: Record<string, string> = {
  G1: "G1 — Sinal, Arras e Início de Pagamento",
  G2: "G2 — Imissão na Posse",
  G3: "G3 — Rescisão e Condição Resolutiva",
  G4: "G4 — Financiamento e Registro",
  G5: "G5 — Comissão de Corretagem",
  G6: "G6 — Declarações e Disposições Especiais",
};

interface Clause {
  id: string;
  title: string;
  content: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  groupCode: string | null;
  isVariable: boolean;
  agentNotes: string | null;
  tags: string[];
  status: string;
  source: string;
  /** `null` = cláusula da PLATAFORMA: aparece pra todo tenant, editável só no /admin. */
  orgId?: string | null;
}

/** Cláusula de slot da org que tem versão mais recente na plataforma. */
interface PlatformUpdate {
  orgClauseId: string;
  platformClauseId: string;
  platformTitle: string;
  platformUpdatedAt: string;
}

interface ClausesPageClientProps {
  clauses: Clause[];
  platformUpdates?: PlatformUpdate[];
}

/** Item da plataforma: some com as ações, porque a API recusaria a escrita. */
function isPlatform(c: Clause): boolean {
  return c.orgId === null;
}

/**
 * Faixa de "a plataforma publicou versão mais recente".
 *
 * Existe porque a GERAÇÃO nunca troca a cláusula da imobiliária pela da
 * plataforma (ver `resolveClauseSlots`) — regra certa, porque o texto vira
 * contrato. O efeito colateral é que uma correção publicada centralmente ficava
 * invisível pra quem tem cláusula própria. Aqui ela aparece; adotar é decisão
 * da casa.
 */
function AvisoPlataforma({
  u,
  ocupado,
  onAdotar,
}: {
  u: PlatformUpdate;
  ocupado: boolean;
  onAdotar: (u: PlatformUpdate) => void;
}) {
  return (
    <div className="rounded border border-amber-400/60 bg-amber-50 p-2 text-xs dark:bg-amber-950/20">
      <div className="flex items-start gap-2">
        <ArrowUpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">A plataforma tem uma versão mais recente</p>
          <p className="text-muted-foreground">
            &quot;{u.platformTitle}&quot;, de{" "}
            {new Date(u.platformUpdatedAt).toLocaleDateString("pt-BR")}. Seus
            contratos continuam usando a cláusula desta imobiliária até você
            adotar.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-1.5 h-7 text-xs"
            disabled={ocupado}
            onClick={() => onAdotar(u)}
          >
            {ocupado ? "Adotando…" : "Adotar o texto da plataforma"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ClausesPageClient({
  clauses,
  platformUpdates = [],
}: ClausesPageClientProps) {
  const router = useRouter();
  const [adotando, setAdotando] = useState<string | null>(null);
  const atualizacoes = new Map(platformUpdates.map((u) => [u.orgClauseId, u]));

  /**
   * Adota o texto da plataforma nesta cláusula.
   *
   * A GERAÇÃO nunca faz isso sozinha — cláusula de slot vira texto de contrato
   * e congela no dataJson, então trocar o que a imobiliária escreveu é decisão
   * dela. Este botão é o único caminho.
   */
  async function adotar(u: PlatformUpdate) {
    if (
      !confirm(
        `Substituir o texto desta cláusula pelo da versão da plataforma ` +
          `("${u.platformTitle}")? Os contratos JÁ GERADOS não mudam — a troca ` +
          `vale para os próximos.`
      )
    ) {
      return;
    }
    setAdotando(u.orgClauseId);
    try {
      const res = await fetch(`/api/clauses/${u.orgClauseId}/adopt-platform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformClauseId: u.platformClauseId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Falha ao adotar");
      toast.success("Texto da plataforma adotado.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao adotar");
    } finally {
      setAdotando(null);
    }
  }

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingClause, setEditingClause] = useState<Clause | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");

  function handleCreate() {
    setEditingClause(null);
    setEditorMode("create");
    setEditorOpen(true);
  }

  function handleEdit(clause: Clause) {
    setEditingClause(clause);
    setEditorMode("edit");
    setEditorOpen(true);
  }

  const variableClauses = clauses.filter((c) => c.isVariable && c.groupCode);
  const fixedClauses = clauses.filter((c) => !c.isVariable);

  const groupedVariable = variableClauses.reduce(
    (acc, clause) => {
      const group = clause.groupCode!;
      if (!acc[group]) acc[group] = [];
      acc[group].push(clause);
      return acc;
    },
    {} as Record<string, Clause[]>
  );

  const groupedFixed = fixedClauses.reduce(
    (acc, clause) => {
      if (!acc[clause.category]) acc[clause.category] = [];
      acc[clause.category].push(clause);
      return acc;
    },
    {} as Record<string, Clause[]>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Biblioteca de Cláusulas"
        description="Banco padronizado (G1–G6) + cláusulas base, usadas pelo agente e na montagem dos contratos."
      >
        <Button size="sm" onClick={handleCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Nova Cláusula
        </Button>
      </PageHeader>

      {/* Variable Clauses */}
      {Object.keys(groupedVariable).length > 0 && (
        <div className="space-y-6">
          <h2 className="font-display text-lg font-semibold text-primary tracking-tight">
            Banco de Cláusulas Padronizadas
          </h2>

          {["G1", "G2", "G3", "G4", "G5", "G6"].map((groupCode) => {
            const items = groupedVariable[groupCode];
            if (!items?.length) return null;
            return (
              <div key={groupCode} className="space-y-3">
                <h3 className="text-base font-medium">
                  {GROUP_LABELS[groupCode] || groupCode}
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {items.map((clause) => (
                    <Card key={clause.id} className="group relative transition-colors hover:border-primary/30">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">{clause.title}</CardTitle>
                          <div className="flex gap-1 items-center">
                            {/* Cláusula de plataforma não mostra lápis: a API
                                filtra por orgId e devolveria 404. Botão que
                                sempre falha é pior que botão nenhum. */}
                            {isPlatform(clause) ? (
                              <Badge variant="secondary" className="text-[10px] gap-1">
                                <Lock className="h-2.5 w-2.5" />
                                Plataforma
                              </Badge>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => handleEdit(clause)}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                            <Badge variant="outline" className="text-xs">
                              {clause.groupCode}
                            </Badge>
                            <Badge
                              variant={clause.status === "approved" ? "default" : "secondary"}
                              className="text-xs"
                            >
                              {clause.status}
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
                      {atualizacoes.has(clause.id) && (
                        <AvisoPlataforma
                          u={atualizacoes.get(clause.id)!}
                          ocupado={adotando === clause.id}
                          onAdotar={adotar}
                        />
                      )}

                        <div className="flex flex-wrap gap-1">
                          {clause.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        {clause.agentNotes && (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer font-medium">
                              Orientação de uso
                            </summary>
                            <p className="mt-1 pl-2 border-l-2 border-muted">
                              {clause.agentNotes}
                            </p>
                          </details>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fixed/Legacy Clauses */}
      {Object.keys(groupedFixed).length > 0 && (
        <div className="space-y-6">
          <h2 className="font-display text-lg font-semibold text-muted-foreground tracking-tight">
            Cláusulas Base
          </h2>

          {Object.entries(groupedFixed).map(([category, items]) => (
            <div key={category} className="space-y-3">
              <h3 className="text-base font-medium capitalize">{category}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((clause) => (
                  <Card key={clause.id} className="group relative transition-colors hover:border-primary/30">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{clause.title}</CardTitle>
                        <div className="flex gap-1 items-center">
                          {/* Ver a nota no bloco agrupado acima. */}
                          {isPlatform(clause) ? (
                            <Badge variant="secondary" className="text-[10px] gap-1">
                              <Lock className="h-2.5 w-2.5" />
                              Plataforma
                            </Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleEdit(clause)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {clause.source}
                          </Badge>
                          <Badge
                            variant={clause.status === "approved" ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {clause.status}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                    {atualizacoes.has(clause.id) && (
                      <AvisoPlataforma
                        u={atualizacoes.get(clause.id)!}
                        ocupado={adotando === clause.id}
                        onAdotar={adotar}
                      />
                    )}

                      <div className="flex flex-wrap gap-1">
                        {clause.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {clauses.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Nenhuma cláusula encontrada.</p>
          <p className="text-sm mt-1">Crie uma nova cláusula ou execute o seed.</p>
        </div>
      )}

      <ClauseEditor
        key={editingClause?.id ?? "new"}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        mode={editorMode}
        clause={editingClause ? {
          id: editingClause.id,
          title: editingClause.title,
          content: editingClause.content,
          description: editingClause.description || "",
          category: editingClause.category,
          subcategory: editingClause.subcategory || "",
          groupCode: editingClause.groupCode || "",
          isVariable: editingClause.isVariable,
          agentNotes: editingClause.agentNotes || "",
          tags: editingClause.tags,
          status: editingClause.status,
        } : undefined}
      />
    </div>
  );
}
