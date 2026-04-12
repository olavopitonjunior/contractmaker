"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Pencil } from "lucide-react";
import { ClauseEditor } from "./ClauseEditor";

const GROUP_LABELS: Record<string, string> = {
  G1: "G1 — Sinal, Arras e Inicio de Pagamento",
  G2: "G2 — Imissao na Posse",
  G3: "G3 — Rescisao e Condicao Resolutiva",
  G4: "G4 — Financiamento e Registro",
  G5: "G5 — Comissão de Corretagem",
  G6: "G6 — Declaracoes e Disposicoes Especiais",
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
}

interface ClausesPageClientProps {
  clauses: Clause[];
}

export function ClausesPageClient({ clauses }: ClausesPageClientProps) {
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Biblioteca de Cláusulas</h1>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Nova Cláusula
        </Button>
      </div>

      {/* Variable Clauses */}
      {Object.keys(groupedVariable).length > 0 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-primary">
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
                    <Card key={clause.id} className="group relative">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">{clause.title}</CardTitle>
                          <div className="flex gap-1 items-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleEdit(clause)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
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
          <h2 className="text-lg font-semibold text-muted-foreground">
            Cláusulas Base
          </h2>

          {Object.entries(groupedFixed).map(([category, items]) => (
            <div key={category} className="space-y-3">
              <h3 className="text-base font-medium capitalize">{category}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((clause) => (
                  <Card key={clause.id} className="group relative">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{clause.title}</CardTitle>
                        <div className="flex gap-1 items-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleEdit(clause)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
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
          <p>Nenhuma clausula encontrada.</p>
          <p className="text-sm mt-1">Crie uma nova clausula ou execute o seed.</p>
        </div>
      )}

      <ClauseEditor
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
