import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { ShieldCheck, ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

// Página PÚBLICA de verificação de autenticidade do laudo (QR impresso no PDF).
// Sem auth() de propósito — padrão /pay/[token]. Exibe apenas metadados, sem
// PDF e sem PII (nomes de partes não aparecem).

const TIPO_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  contra: "Contra-vistoria",
};

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  em_campo: "Em elaboração",
  laudo_gerado: "Laudo emitido",
  assinatura: "Em assinatura",
  concluida: "Concluída (laudo assinado)",
};

interface Params {
  params: Promise<{ qrToken: string }>;
}

export default async function VerificarVistoriaPage({ params }: Params) {
  const { qrToken } = await params;
  if (!qrToken || qrToken.length < 10) notFound();

  const inspection = await prisma.inspection.findUnique({
    where: { qrToken },
    select: {
      tipo: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      property: { select: { cidade: true, uf: true } },
      org: { select: { name: true } },
    },
  });
  if (!inspection) notFound();

  const local = [inspection.property.cidade, inspection.property.uf]
    .filter(Boolean)
    .join("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-green-600">
          <ShieldCheck className="h-6 w-6" />
          <h1 className="text-lg font-semibold text-foreground">Laudo autêntico</h1>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Este código corresponde a um laudo de vistoria emitido pela plataforma.
        </p>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Tipo de vistoria</dt>
            <dd className="font-medium">
              <ClipboardList className="mr-1 inline h-3.5 w-3.5" />
              {TIPO_LABEL[inspection.tipo] ?? inspection.tipo}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Situação</dt>
            <dd className="font-medium">{STATUS_LABEL[inspection.status] ?? inspection.status}</dd>
          </div>
          {local && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Local do imóvel</dt>
              <dd className="font-medium">{local}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Criada em</dt>
            <dd className="font-medium">{inspection.createdAt.toLocaleDateString("pt-BR")}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Última atualização</dt>
            <dd className="font-medium">{inspection.updatedAt.toLocaleDateString("pt-BR")}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Imobiliária</dt>
            <dd className="font-medium">{inspection.org.name}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          Em caso de divergência com o documento apresentado, contate a imobiliária.
        </p>
      </div>
    </main>
  );
}
