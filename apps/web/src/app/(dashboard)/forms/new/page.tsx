"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { PartyLinksPanel } from "@/components/forms/PartyLinksPanel";

export default function NewFormPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  // Key por INTENÇÃO (mount / "Criar Outro"), não por clique: duplo-clique e
  // retry de rede replayam a mesma resposta 201 no servidor em vez de criar
  // um segundo form + deal.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  async function postForm(key: string, force: boolean) {
    const res = await fetch("/api/forms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-idempotency-key": key,
      },
      body: JSON.stringify({
        title: title || undefined,
        ...(force ? { force: true } : {}),
      }),
    });
    return { res, data: await res.json() };
  }

  async function handleCreate() {
    setLoading(true);
    try {
      let { res, data } = await postForm(idemKey, false);

      // Soft-block do servidor: já existe negócio com este título criado há
      // pouco (recriação manual de card duplicado). A key atual acabou de
      // cachear o 409 — rotaciona JÁ, independente da escolha: sem isso, um
      // "Cancelar" deixaria toda tentativa seguinte (mesmo com outro título)
      // replayando o 409 stale por 24h.
      if (res.status === 409 && data?.error === "duplicate_recent") {
        const freshKey = crypto.randomUUID();
        setIdemKey(freshKey);
        const createdAt = data.existing?.createdAt
          ? new Date(data.existing.createdAt)
          : null;
        const mins = createdAt
          ? Math.max(1, Math.round((Date.now() - createdAt.getTime()) / 60000))
          : null;
        const proceed = window.confirm(
          `Já existe um negócio "${data.existing?.title ?? title}" criado há ${
            mins ?? "poucos"
          } minuto(s). Deseja criar outro mesmo assim?`,
        );
        if (!proceed) return;
        ({ res, data } = await postForm(freshKey, true));
      }

      if (res.ok) {
        const fullUrl = `${window.location.origin}/f/${data.token}`;
        setCreatedUrl(fullUrl);
        setCreatedToken(data.token);
        toast.success("Formulário criado!");
      } else {
        // Qualquer erro pode ter sido cacheado sob a key — rotaciona pra
        // próxima tentativa não replayar a resposta stale.
        setIdemKey(crypto.randomUUID());
        toast.error(data.error || "Erro ao criar formulário");
      }
    } catch {
      setIdemKey(crypto.randomUUID());
      toast.error("Erro de conexão ao criar formulário");
    } finally {
      setLoading(false);
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
        <h1 className="font-display tracking-tight text-2xl font-semibold">Novo Formulário</h1>
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
                  Link do formulário:
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

              {createdToken && (
                <PartyLinksPanel
                  formToken={createdToken}
                  roles={["vendedor", "comprador"]}
                />
              )}

              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setCreatedUrl(null);
                  setCreatedToken(null);
                  setTitle("");
                  // Nova intenção de criação → nova key de idempotência.
                  setIdemKey(crypto.randomUUID());
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
