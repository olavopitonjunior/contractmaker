"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Plus, Search, Sparkles, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { KnowledgeItemForm } from "./KnowledgeItemForm";

interface KnowledgeItem {
  id: string;
  category: string;
  title: string;
  content: string;
  chunkTotal: number;
  tags: string[];
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  initialItems: KnowledgeItem[];
  initialCounts: Record<string, number>;
  embeddingsConfigured: boolean;
}

const CATEGORY_LABELS: Record<string, { label: string; description: string }> = {
  legislation: {
    label: "Legislação",
    description: "Artigos de lei, jurisprudência e normativas que o agente pode citar.",
  },
  model: {
    label: "Modelos Referenciais",
    description: "Contratos ou cláusulas modelo que servem de base para geração.",
  },
  rule: {
    label: "Regras do Escritório",
    description: 'Preferências fixas do escritório (ex: "multa padrão 2%", "foro eleito SP").',
  },
  glossary: {
    label: "Glossário",
    description: "Termos técnicos e definições customizadas do escritório.",
  },
  clause: {
    label: "Cláusulas (Biblioteca)",
    description:
      "Cláusulas padronizadas G1-G6 e customizadas — biblioteca jurídica do escritório.",
  },
};

export function KnowledgeBaseClient({
  initialItems,
  initialCounts,
  embeddingsConfigured,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [counts, setCounts] = useState(initialCounts);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; title: string; content: string; category: string; similarity?: number }>
  >([]);
  const [searchMode, setSearchMode] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeTab !== "all" && item.category !== activeTab) return false;
      if (search) {
        const haystack = `${item.title} ${item.content} ${item.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [items, activeTab, search]);

  async function refresh() {
    const res = await fetch("/api/knowledge");
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
      setCounts(data.counts);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este item da base de conhecimento?")) return;
    const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Item removido");
      await refresh();
      router.refresh();
    } else {
      toast.error("Erro ao remover");
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery,
          category: activeTab === "all" ? undefined : activeTab,
          topK: 5,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
        setSearchMode(data.mode || null);
      } else {
        toast.error("Erro na busca");
      }
    } finally {
      setSearching(false);
    }
  }

  function openEditor(item: KnowledgeItem | null) {
    setEditingItem(item);
    setFormOpen(true);
  }

  const totalItems = items.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Base de Conhecimento</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Legislação, modelos, regras e glossário que o agente consulta via RAG antes de
          responder ou editar cláusulas.
        </p>
      </div>

      {!embeddingsConfigured && (
        <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader className="flex-row items-start gap-3 space-y-0 pb-2">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
            <div>
              <CardTitle className="text-sm">
                Embeddings não configurados
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                A busca semântica está desabilitada. Adicione{" "}
                <code className="font-mono">VOYAGE_API_KEY</code> no .env para ativar o RAG
                especializado em texto jurídico. Sem a chave, o agente cai em busca por
                palavra-chave (recall inferior).
              </p>
            </div>
          </CardHeader>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="all">
            Todas <Badge variant="secondary" className="ml-2 text-[10px]">{totalItems}</Badge>
          </TabsTrigger>
          {Object.entries(CATEGORY_LABELS).map(([key, meta]) => (
            <TabsTrigger key={key} value={key}>
              {meta.label}
              {counts[key] > 0 && (
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  {counts[key]}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtrar por título, conteúdo ou tag"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSearchQuery(search)}
            disabled={!search.trim()}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Testar RAG
          </Button>
          <Button size="sm" onClick={() => openEditor(null)}>
            <Plus className="h-4 w-4 mr-1" />
            Novo item
          </Button>
        </div>

        {searchQuery && (
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Teste de busca: "{searchQuery}"
                </CardTitle>
                {searchMode && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Modo:{" "}
                    {searchMode === "semantic"
                      ? "semântico (Voyage-law-2)"
                      : "palavra-chave (fallback sem embeddings)"}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={handleSearch} disabled={searching}>
                  {searching ? "Buscando…" : "Rodar"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                >
                  Fechar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {searchResults.length === 0 && !searching && (
                <p className="text-xs text-muted-foreground">
                  Clique em "Rodar" para executar a busca.
                </p>
              )}
              {searchResults.map((r) => (
                <div
                  key={r.id}
                  className="rounded border p-3 text-xs space-y-1 bg-muted/30"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {CATEGORY_LABELS[r.category]?.label || r.category}
                    </Badge>
                    <span className="font-medium">{r.title}</span>
                    {typeof r.similarity === "number" && (
                      <span className="text-muted-foreground ml-auto">
                        similaridade: {r.similarity.toFixed(3)}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground line-clamp-3">{r.content}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <TabsContent value={activeTab} className="space-y-3">
          {activeTab !== "all" && CATEGORY_LABELS[activeTab] && (
            <p className="text-xs text-muted-foreground px-1">
              {CATEGORY_LABELS[activeTab].description}
            </p>
          )}

          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <p>Nenhum item nesta categoria.</p>
              <p className="mt-1">Clique em "Novo item" para começar a popular a base.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredItems.map((item) => (
                <Card key={item.id} className="group">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-sm truncate">{item.title}</CardTitle>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">
                            {CATEGORY_LABELS[item.category]?.label || item.category}
                          </Badge>
                          {item.chunkTotal > 1 && (
                            <Badge variant="secondary" className="text-[10px]">
                              {item.chunkTotal} chunks
                            </Badge>
                          )}
                          {item.source && item.source !== "manual" && (
                            <Badge variant="secondary" className="text-[10px]">
                              {item.source}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEditor(item)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => handleDelete(item.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                      {item.content}
                    </p>
                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <KnowledgeItemForm
        open={formOpen}
        item={editingItem}
        onClose={() => setFormOpen(false)}
        onSaved={async () => {
          setFormOpen(false);
          await refresh();
          router.refresh();
        }}
      />
    </div>
  );
}
