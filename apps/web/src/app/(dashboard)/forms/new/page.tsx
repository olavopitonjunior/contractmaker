"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";

export default function NewFormPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    const res = await fetch("/api/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || undefined }),
    });
    const data = await res.json();
    setLoading(false);

    if (res.ok) {
      const fullUrl = `${window.location.origin}/f/${data.token}`;
      setCreatedUrl(fullUrl);
      setCreatedToken(data.token);
      toast.success("Formulário criado!");
    } else {
      toast.error(data.error || "Erro ao criar formulario");
    }
  }

  function handleCopy() {
    if (createdUrl) {
      navigator.clipboard.writeText(createdUrl);
      toast.success("Link copiado!");
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Novo Formulário</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Este formulário coleta todas as informações necessárias para gerar o contrato de compra e venda de imóvel.
          Após preenchido, um contrato é criado automaticamente e o negócio avança no pipeline.
        </p>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm">O que será perguntado (7 etapas)</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
            <li>Dados do(s) Vendedor(es) — pessoa física ou jurídica</li>
            <li>Dados do(s) Comprador(es)</li>
            <li>Imóvel(is) — endereço, matrícula, cartório</li>
            <li>Status da propriedade e débitos</li>
            <li>Pagamento — valor, sinal, modalidade</li>
            <li>Posse e título definitivo</li>
            <li>Comissão e configurações contratuais</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Criar Formulário</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título (opcional)</Label>
            <Input
              id="title"
              placeholder="Ex: Venda Apto 302 - Ed. Floresta"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              O título pode ser preenchido depois — ele ajuda a identificar o negócio no pipeline.
            </p>
          </div>

          {!createdUrl ? (
            <Button onClick={handleCreate} disabled={loading} className="w-full">
              {loading ? "Criando..." : "Criar Formulário"}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">
                  Link do formulario:
                </p>
                <p className="text-sm font-mono break-all">{createdUrl}</p>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleCopy} variant="outline" className="flex-1">
                  <Copy className="h-4 w-4 mr-2" />
                  Copiar Link
                </Button>
                <Button asChild className="flex-1">
                  <a href={`/f/${createdToken}`} target="_blank">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Abrir Formulário
                  </a>
                </Button>
              </div>

              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setCreatedUrl(null);
                  setCreatedToken(null);
                  setTitle("");
                }}
              >
                Criar Outro
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
