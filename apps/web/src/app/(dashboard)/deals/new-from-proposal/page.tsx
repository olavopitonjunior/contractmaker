"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ClipboardCheck, ListChecks, Sparkles } from "lucide-react";
import Link from "next/link";
import { ProposalUploadForm } from "@/components/deals/ProposalUploadForm";

// O formulário em si vive em components/deals/ProposalUploadForm.tsx — a mesma
// via existe dentro do diálogo "Cadastro com proposta" do dropdown Novo negócio
// (aba "Anexar PDF de fora"). Esta página permanece pra deep-link.
export default function NewDealFromProposalPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link href="/pipeline">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar ao pipeline
          </Link>
        </Button>
        <h1 className="font-display tracking-tight text-2xl font-semibold">Cadastro com proposta</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Suba uma proposta já preenchida (PDF) com dados das partes,
          valores, parcelas e comissão. O sistema lê tudo e abre o formulário
          pré-preenchido pra você revisar antes de gerar o contrato.
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
              IA extrai vendedores, compradores, imóvel, valor total, parcelas e
              comissão da proposta.
            </li>
            <li className="flex items-start gap-2">
              <ListChecks className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              Você revisa cada campo no formulário (8 etapas navegáveis). Edite
              o que vier errado da extração.
            </li>
            <li className="flex items-start gap-2">
              <ClipboardCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              Ao finalizar, o contrato é gerado com o template padrão da
              imobiliária — diferente do "Cadastro rápido", que abre o PDF
              original direto no editor.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar proposta</CardTitle>
        </CardHeader>
        <CardContent>
          <ProposalUploadForm kind="venda" />
        </CardContent>
      </Card>
    </div>
  );
}
