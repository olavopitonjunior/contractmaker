"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { FileText, Plus, ExternalLink, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface DealDetailProps {
  deal: {
    id: string;
    title: string;
    value: number | null;
    createdAt: Date;
    stage: { name: string; color: string | null };
    form: { id: string; token: string; dataJson: unknown; status: string } | null;
    attachments: { id: string; filename: string; category: string | null; url: string; createdAt: Date }[];
    contracts: { id: string; version: number; status: string; template: { name: string }; createdAt: Date }[];
  };
}

export function DealDetail({ deal }: DealDetailProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);

  async function handleGenerateContract() {
    setGenerating(true);
    const res = await fetch(
      `/api/pipeline/deals/${deal.id}/generate-contract`,
      { method: "POST" }
    );
    const data = await res.json();
    setGenerating(false);
    if (res.ok) {
      router.push(`/contracts/${data.contractId}`);
    }
  }

  const formData = deal.form?.dataJson as Record<string, unknown> | null;
  const vendedores = (formData?.vendedores as Array<{ nome?: string }>) || [];
  const compradores = (formData?.compradores as Array<{ nome?: string }>) || [];
  const imoveis = (formData?.imoveis as Array<{ rua?: string; numero?: string }>) || [];
  const pagamento = formData?.pagamento as { valor_total?: number } | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/pipeline">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Pipeline
          </Link>
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <div>
          <h1 className="text-2xl font-semibold">{deal.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              style={{ backgroundColor: deal.stage.color || undefined }}
              className="text-white text-xs"
            >
              {deal.stage.name}
            </Badge>
            {deal.value != null && (
              <span className="text-sm text-muted-foreground">
                R$ {deal.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {deal.form && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/f/${deal.form.token}`} target="_blank">
                <ExternalLink className="h-4 w-4 mr-1" />
                Formulario
              </Link>
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleGenerateContract}
            disabled={generating}
          >
            <FileText className="h-4 w-4 mr-1" />
            {generating ? "Gerando..." : "Confeccionar Contrato"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="anexos">
            Anexos ({deal.attachments.length})
          </TabsTrigger>
          <TabsTrigger value="contratos">
            Contratos ({deal.contracts.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="mt-4">
          {formData ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Vendedor(es)</CardTitle>
                </CardHeader>
                <CardContent>
                  {vendedores.length > 0 ? (
                    vendedores.map((v, i) => (
                      <p key={i} className="text-sm">{v.nome || "—"}</p>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">Nao preenchido</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Comprador(es)</CardTitle>
                </CardHeader>
                <CardContent>
                  {compradores.length > 0 ? (
                    compradores.map((c, i) => (
                      <p key={i} className="text-sm">{c.nome || "—"}</p>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">Nao preenchido</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Imovel(is)</CardTitle>
                </CardHeader>
                <CardContent>
                  {imoveis.length > 0 ? (
                    imoveis.map((im, i) => (
                      <p key={i} className="text-sm">
                        {im.rua ? `${im.rua}, ${im.numero}` : "—"}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">Nao preenchido</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Pagamento</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">
                    {pagamento?.valor_total
                      ? `R$ ${pagamento.valor_total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                      : "Nao preenchido"}
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum dado de formulario vinculado.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="anexos" className="mt-4">
          <Card>
            <CardContent className="py-6">
              {deal.attachments.length === 0 ? (
                <p className="text-center text-muted-foreground">
                  Nenhum anexo. Upload disponivel em breve.
                </p>
              ) : (
                <div className="space-y-2">
                  {deal.attachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center justify-between p-2 rounded border"
                    >
                      <div>
                        <p className="text-sm font-medium">{att.filename}</p>
                        {att.category && (
                          <Badge variant="secondary" className="text-xs mt-1">
                            {att.category}
                          </Badge>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={att.url} target="_blank">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contratos" className="mt-4">
          <div className="space-y-3">
            {deal.contracts.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground mb-4">
                    Nenhum contrato gerado.
                  </p>
                  <Button onClick={handleGenerateContract} disabled={generating}>
                    {generating ? "Gerando..." : "Confeccionar Contrato"}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              deal.contracts.map((contract) => (
                <Link key={contract.id} href={`/contracts/${contract.id}`}>
                  <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                    <CardContent className="py-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">
                          {contract.template.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Versao {contract.version} -{" "}
                          {contract.createdAt.toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <Badge variant="outline">{contract.status}</Badge>
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
