"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { FileText, Plus, ExternalLink, ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
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
  const [signing, setSigning] = useState(false);
  const [confirmDuplicateOpen, setConfirmDuplicateOpen] = useState(false);

  async function doGenerateContract() {
    setGenerating(true);
    const res = await fetch(
      `/api/pipeline/deals/${deal.id}/generate-contract`,
      { method: "POST" }
    );
    const data = await res.json();
    setGenerating(false);
    if (res.ok) {
      router.push(`/contracts/${data.contractId}`);
    } else {
      toast.error(data.error || "Erro ao gerar contrato");
    }
  }

  function handleGenerateContract() {
    if (deal.contracts.length > 0) {
      setConfirmDuplicateOpen(true);
      return;
    }
    doGenerateContract();
  }

  async function handleMarkSigned() {
    setSigning(true);
    try {
      const res = await fetch(
        `/api/pipeline/deals/${deal.id}/mark-signed`,
        { method: "POST" }
      );
      if (res.ok) {
        toast.success("Negócio marcado como assinado e movido para Concluído!");
        router.refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || "Erro ao marcar como assinado");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setSigning(false);
    }
  }

  const formData = deal.form?.dataJson as Record<string, unknown> | null;
  type Parte = {
    nome?: string;
    razao_social?: string;
    tipo_pessoa?: string;
    cpf?: string;
    cnpj?: string;
    rg?: string;
    nacionalidade?: string;
    estado_civil?: string;
    profissao?: string;
    email?: string;
    endereco?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
  };
  type Imovel = {
    rua?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
    matricula?: string;
    cartorio?: string;
    inscricao_iptu?: string;
    descricao?: string;
  };
  const vendedores = (formData?.vendedores as Parte[]) || [];
  const compradores = (formData?.compradores as Parte[]) || [];
  const imoveis = (formData?.imoveis as Imovel[]) || [];
  const pagamento = formData?.pagamento as
    | {
        valor_total?: number;
        sinal_arras?: number;
        recursos_proprios?: number;
        fgts?: number;
        alienacao_fiduciaria?: number;
      }
    | undefined;

  const formatBRL = (v: number | undefined) =>
    v != null ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—";

  const formatAddress = (p: Parte | Imovel) => {
    const rua = (p as Parte).endereco || (p as Imovel).rua;
    const parts = [
      rua,
      p.numero && `nº ${p.numero}`,
      p.complemento,
      p.bairro && `Bairro: ${p.bairro}`,
      p.cidade && `${p.cidade}${p.uf ? `/${p.uf}` : ""}`,
      p.cep && `CEP ${p.cep}`,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : "—";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start sm:items-center gap-4 flex-wrap">
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
        <div className="w-full sm:w-auto sm:ml-auto flex gap-2 flex-wrap">
          {deal.form && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={`/f/${deal.form.token}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Formulário
              </a>
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
          {deal.stage.name === "Assinatura" && (
            <Button
              size="sm"
              variant="default"
              className="bg-green-600 hover:bg-green-700"
              onClick={handleMarkSigned}
              disabled={signing}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {signing ? "Processando..." : "Marcar como Assinado"}
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="anexos">
            Anexos ({deal.attachments.length})
          </TabsTrigger>
          <TabsTrigger value="contratos">
            Contratos ({deal.contracts.length} {deal.contracts.length === 1 ? "versão" : "versões"})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="mt-4">
          {formData ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <details>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Vendedor(es)</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-3 pt-0">
                    {vendedores.length > 0 ? (
                      vendedores.map((v, i) => (
                        <div key={i} className="space-y-1 text-sm border-b last:border-b-0 pb-2 last:pb-0">
                          <p className="font-medium">{v.nome || v.razao_social || "—"}</p>
                          {v.tipo_pessoa === "juridica" ? (
                            <>
                              {v.cnpj && <p><span className="text-muted-foreground">CNPJ:</span> {v.cnpj}</p>}
                            </>
                          ) : (
                            <>
                              {v.cpf && <p><span className="text-muted-foreground">CPF:</span> {v.cpf}</p>}
                              {v.rg && <p><span className="text-muted-foreground">RG:</span> {v.rg}</p>}
                              {v.estado_civil && <p><span className="text-muted-foreground">Estado civil:</span> {v.estado_civil}</p>}
                              {v.profissao && <p><span className="text-muted-foreground">Profissão:</span> {v.profissao}</p>}
                              {v.email && <p><span className="text-muted-foreground">E-mail:</span> {v.email}</p>}
                            </>
                          )}
                          <p className="text-muted-foreground text-xs">{formatAddress(v)}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">Não preenchido</p>
                    )}
                  </CardContent>
                </details>
              </Card>

              <Card>
                <details>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Comprador(es)</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-3 pt-0">
                    {compradores.length > 0 ? (
                      compradores.map((c, i) => (
                        <div key={i} className="space-y-1 text-sm border-b last:border-b-0 pb-2 last:pb-0">
                          <p className="font-medium">{c.nome || c.razao_social || "—"}</p>
                          {c.tipo_pessoa === "juridica" ? (
                            <>
                              {c.cnpj && <p><span className="text-muted-foreground">CNPJ:</span> {c.cnpj}</p>}
                            </>
                          ) : (
                            <>
                              {c.cpf && <p><span className="text-muted-foreground">CPF:</span> {c.cpf}</p>}
                              {c.rg && <p><span className="text-muted-foreground">RG:</span> {c.rg}</p>}
                              {c.estado_civil && <p><span className="text-muted-foreground">Estado civil:</span> {c.estado_civil}</p>}
                              {c.profissao && <p><span className="text-muted-foreground">Profissão:</span> {c.profissao}</p>}
                              {c.email && <p><span className="text-muted-foreground">E-mail:</span> {c.email}</p>}
                            </>
                          )}
                          <p className="text-muted-foreground text-xs">{formatAddress(c)}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">Não preenchido</p>
                    )}
                  </CardContent>
                </details>
              </Card>

              <Card>
                <details>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Imóvel(is)</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-3 pt-0">
                    {imoveis.length > 0 ? (
                      imoveis.map((im, i) => (
                        <div key={i} className="space-y-1 text-sm border-b last:border-b-0 pb-2 last:pb-0">
                          <p className="font-medium">{formatAddress(im)}</p>
                          {im.matricula && <p><span className="text-muted-foreground">Matrícula:</span> {im.matricula}</p>}
                          {im.cartorio && <p><span className="text-muted-foreground">Cartório:</span> {im.cartorio}</p>}
                          {im.inscricao_iptu && <p><span className="text-muted-foreground">Inscrição IPTU:</span> {im.inscricao_iptu}</p>}
                          {im.descricao && <p className="text-muted-foreground text-xs">{im.descricao}</p>}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">Não preenchido</p>
                    )}
                  </CardContent>
                </details>
              </Card>

              <Card>
                <details>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Pagamento</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-1 text-sm pt-0">
                    <p><span className="text-muted-foreground">Valor total:</span> <strong>{formatBRL(pagamento?.valor_total)}</strong></p>
                    {pagamento?.sinal_arras ? <p><span className="text-muted-foreground">Sinal:</span> {formatBRL(pagamento.sinal_arras)}</p> : null}
                    {pagamento?.recursos_proprios ? <p><span className="text-muted-foreground">Recursos próprios:</span> {formatBRL(pagamento.recursos_proprios)}</p> : null}
                    {pagamento?.alienacao_fiduciaria ? <p><span className="text-muted-foreground">Financiamento:</span> {formatBRL(pagamento.alienacao_fiduciaria)}</p> : null}
                    {pagamento?.fgts ? <p><span className="text-muted-foreground">FGTS:</span> {formatBRL(pagamento.fgts)}</p> : null}
                  </CardContent>
                </details>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum dado de formulário vinculado.
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
                          Versão {contract.version} -{" "}
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

      <AlertDialog open={confirmDuplicateOpen} onOpenChange={setConfirmDuplicateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Criar nova versão do contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              Este negócio já possui {deal.contracts.length} versão(ões). A nova versão (V{deal.contracts.length + 1}) será gerada a partir do template padrão com os dados atuais do negócio.
              <br /><br />
              <strong>Atenção:</strong> as edições manuais ou via Chat IA feitas na versão anterior <strong>não serão transferidas automaticamente</strong>. O histórico das versões anteriores é mantido para consulta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDuplicateOpen(false);
                doGenerateContract();
              }}
            >
              Criar Nova Versão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
