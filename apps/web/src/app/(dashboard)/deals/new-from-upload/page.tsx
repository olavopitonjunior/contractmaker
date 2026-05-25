"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, FileSignature, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { UploadContractDropzone } from "@/components/pipeline/UploadContractDropzone";

export default function NewDealFromUploadPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [targetStage, setTargetStage] = useState<
    "Confecção de Contrato" | "Enviado para assinatura" | "Contrato assinado"
  >("Confecção de Contrato");

  async function handleSubmit() {
    if (!file) {
      toast.error("Selecione um arquivo de contrato (PDF ou DOCX).");
      return;
    }
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    if (title.trim()) formData.append("title", title.trim());
    formData.append("targetStage", targetStage);

    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const res = await fetch("/api/deals/import-contract", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Falha ao importar contrato.");
        setUploading(false);
        // Mesmo em erro, se vier um dealId já criado, redireciona pro deal pra
        // que o usuário possa investigar (DealAttachment subiu, mas o GDoc falhou).
        if (data.dealId) {
          router.push(`/pipeline?highlight=${data.dealId}`);
        }
        return;
      }

      toast.success("Contrato importado! Abrindo no editor...");
      router.push(`/contracts/${data.contractId}`);
    } catch (err) {
      console.error(err);
      toast.error("Erro de rede ao enviar o arquivo. Tente novamente.");
      setUploading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link href="/pipeline">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar ao pipeline
          </Link>
        </Button>
        <h1 className="font-display tracking-tight text-2xl font-semibold">Cadastro rápido com upload</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Suba um contrato de compra e venda já pronto (PDF ou DOCX). O sistema
          converte para Google Docs, extrai os dados das partes e do imóvel, e
          abre o editor para você revisar antes de enviar para assinatura.
        </p>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm">O que esse fluxo faz</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2">
              <Upload className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              Converte o arquivo em Google Docs nativo, preservando o layout
              original.
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              IA lê o documento e preenche vendedores, compradores, imóvel e
              valores na aba "Dados".
            </li>
            <li className="flex items-start gap-2">
              <FileSignature className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              Você revisa no editor, aprova e envia para assinatura ClickSign.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar contrato</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título do negócio (opcional)</Label>
            <Input
              id="title"
              placeholder="Ex: Venda Apto 302 - Ed. Floresta"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={uploading}
            />
            <p className="text-xs text-muted-foreground">
              Se deixar em branco, vamos usar os nomes extraídos do contrato.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetStage">Em qual etapa este negócio entra?</Label>
            <Select
              value={targetStage}
              onValueChange={(v) =>
                setTargetStage(
                  v as
                    | "Confecção de Contrato"
                    | "Enviado para assinatura"
                    | "Contrato assinado"
                )
              }
              disabled={uploading}
            >
              <SelectTrigger id="targetStage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Confecção de Contrato">
                  Confecção de Contrato (padrão)
                </SelectItem>
                <SelectItem value="Enviado para assinatura">
                  Enviado para assinatura
                </SelectItem>
                <SelectItem value="Contrato assinado">
                  Contrato assinado
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Use "Contrato assinado" pra contratos já assinados externamente
              (escritura, distrato consumado, etc.).
            </p>
          </div>

          <div className="space-y-2">
            <Label>Contrato</Label>
            <UploadContractDropzone
              onFileSelected={setFile}
              uploading={uploading}
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!file || uploading}
            className="w-full"
            size="lg"
          >
            {uploading ? "Importando contrato..." : "Importar e abrir no editor"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
