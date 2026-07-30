"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { ArrowLeft, ClipboardCheck, ListChecks, Sparkles } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { UploadContractDropzone } from "@/components/pipeline/UploadContractDropzone";
import { ManagerSelect } from "@/components/deals/ManagerSelect";

export default function NewLocacaoDealFromProposalPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [finalidade, setFinalidade] = useState<"residencial" | "comercial">(
    "residencial"
  );
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // Gerente responsável pelo negócio (obrigatório quando a org liga o toggle).
  const [managerUserId, setManagerUserId] = useState<string | null>(null);
  const [managerRequired, setManagerRequired] = useState(false);

  async function handleSubmit() {
    if (!file) {
      toast.error("Selecione um PDF da proposta.");
      return;
    }
    if (file.type !== "application/pdf") {
      toast.error("Por ora só PDF funciona aqui. Exporte como PDF e tente de novo.");
      return;
    }
    if (managerRequired && !managerUserId) {
      toast.error("Selecione o gerente responsável");
      return;
    }
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("finalidade", finalidade);
    if (title.trim()) formData.append("title", title.trim());
    if (managerUserId) formData.append("managerUserId", managerUserId);

    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const res = await fetch("/api/locacao/deals/new-from-proposal", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        // Fallback do gate server-side (org exige gerente e o client não sabia).
        if (res.status === 422 && data?.error === "gerente_obrigatorio") {
          setManagerRequired(true);
          toast.error(data.message || "Selecione o gerente responsável");
        } else {
          toast.error(data.error || "Falha ao processar proposta.");
        }
        setUploading(false);
        if (data.formToken) {
          router.push(`/f/${data.formToken}?prefilled=1`);
        }
        return;
      }

      toast.success("Dados extraídos. Revise antes de gerar o contrato.");
      router.push(`/f/${data.formToken}?prefilled=1`);
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
          <Link href="/pipeline/locacao">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar ao pipeline
          </Link>
        </Button>
        <h1 className="font-display tracking-tight text-2xl font-semibold">
          Cadastro com proposta
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Suba uma proposta de locação já preenchida (PDF) com locador,
          locatário, imóvel, aluguel e garantia. O sistema lê tudo e abre o
          formulário pré-preenchido pra você revisar antes de gerar o contrato.
        </p>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm">O que esse fluxo faz</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-2 text-muted-foreground">
            <li className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              IA extrai locadores, locatários, imóvel, aluguel, vigência e
              garantia da proposta.
            </li>
            <li className="flex items-start gap-2">
              <ListChecks className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              Você revisa cada campo no formulário (7 etapas navegáveis). Edite
              o que vier errado da extração.
            </li>
            <li className="flex items-start gap-2">
              <ClipboardCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              Ao finalizar, o contrato de locação é gerado com o template padrão
              — diferente do "Cadastro rápido", que abre o PDF original direto
              no editor.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar proposta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título do negócio (opcional)</Label>
            <Input
              id="title"
              placeholder="Ex: Locação Apto 302 - Ed. Floresta"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={uploading}
            />
            <p className="text-xs text-muted-foreground">
              Se deixar em branco, vamos usar o nome do arquivo da proposta.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Finalidade</Label>
            <NativeSelect
              value={finalidade}
              onChange={(v) => setFinalidade(v as "residencial" | "comercial")}
              options={[
                { value: "residencial", label: "Residencial" },
                { value: "comercial", label: "Comercial" },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              A IA também detecta pela proposta — sua escolha vale quando a
              extração não conseguir decidir.
            </p>
          </div>

          <ManagerSelect
            value={managerUserId}
            onChange={setManagerUserId}
            disabled={uploading}
            onContextLoaded={(ctx) => setManagerRequired(ctx.managerRequired)}
          />

          <div className="space-y-2">
            <Label>Proposta</Label>
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
            {uploading
              ? "Extraindo dados da proposta..."
              : "Extrair dados e abrir formulário"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
