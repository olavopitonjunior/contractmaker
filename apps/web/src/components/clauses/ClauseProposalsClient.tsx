"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Check, X, Bot, User as UserIcon, Lightbulb } from "lucide-react";
import { toast } from "sonner";

interface ClauseProposal {
  id: string;
  authorType: string;
  userId: string | null;
  title: string;
  content: string;
  groupCode: string | null;
  category: string | null;
  reason: string;
  evidence: unknown;
  tags: string[];
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface Props {
  initialProposals: ClauseProposal[];
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const delta = Math.floor((Date.now() - d.getTime()) / 1000);
  if (delta < 60) return "agora";
  if (delta < 3600) return `${Math.floor(delta / 60)}min atrás`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h atrás`;
  return d.toLocaleDateString("pt-BR");
}

export function ClauseProposalsClient({ initialProposals }: Props) {
  const router = useRouter();
  const [proposals, setProposals] = useState(initialProposals);
  const [resolving, setResolving] = useState<string | null>(null);

  async function handleAction(id: string, action: "accept" | "reject") {
    setResolving(id);
    try {
      const res = await fetch(`/api/clauses/proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          action === "accept"
            ? "Cláusula criada na biblioteca"
            : "Proposta rejeitada"
        );
        setProposals((prev) =>
          prev.map((p) =>
            p.id === id
              ? { ...p, status: action === "accept" ? "approved" : "rejected" }
              : p
          )
        );
        router.refresh();
      } else {
        toast.error(data.error || "Erro");
      }
    } finally {
      setResolving(null);
    }
  }

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link href="/clauses">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Biblioteca de Cláusulas
          </Link>
        </Button>
        <h1 className="font-display tracking-tight text-2xl font-semibold flex items-center gap-2">
          <Lightbulb className="h-6 w-6 text-primary" />
          Propostas de Cláusulas
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          A IA sugere cláusulas novas quando detecta padrões recorrentes em contratos
          aprovados. Ao aprovar, a cláusula é adicionada à biblioteca do escritório.
        </p>
      </div>

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
          <TabsTrigger value="resolved">Resolvidas</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3">
          {pending.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma proposta pendente. Quando a IA (ou um membro) propuser uma cláusula
              nova para a biblioteca, ela aparecerá aqui.
            </p>
          )}
          {pending.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">{p.title}</CardTitle>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                      {p.authorType === "ai" ? (
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
                      <span>{formatRelative(p.createdAt)}</span>
                      {p.groupCode && (
                        <Badge variant="outline" className="text-[10px]">
                          {p.groupCode}
                        </Badge>
                      )}
                      {p.category && (
                        <Badge variant="secondary" className="text-[10px]">
                          {p.category}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Conteúdo proposto
                  </p>
                  <pre className="text-xs bg-muted/50 rounded p-3 whitespace-pre-wrap font-mono max-h-64 overflow-auto">
                    {p.content}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Justificativa
                  </p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {p.reason}
                  </p>
                </div>
                {p.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {p.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => handleAction(p.id, "accept")}
                    disabled={resolving === p.id}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Adicionar à biblioteca
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAction(p.id, "reject")}
                    disabled={resolving === p.id}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Rejeitar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="resolved" className="space-y-3">
          {resolved.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma proposta resolvida ainda.
            </p>
          )}
          {resolved.map((p) => (
            <Card key={p.id} className="opacity-80">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">{p.title}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      {p.authorType === "ai" ? "IA" : "Usuário"} · resolvida{" "}
                      {p.resolvedAt && formatRelative(p.resolvedAt)}
                    </p>
                  </div>
                  <Badge
                    variant={p.status === "approved" ? "default" : "secondary"}
                    className={p.status === "approved" ? "bg-green-600" : ""}
                  >
                    {p.status === "approved" ? "Aplicada" : "Rejeitada"}
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
