import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Calendar, AlertCircle, CheckCircle2 } from "lucide-react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: { token: string };
}

export default async function CertidoesSharePage({ params }: PageProps) {
  const link = await prisma.certidoesShareLink.findUnique({
    where: { token: params.token },
    include: {
      deal: {
        include: {
          attachments: {
            where: { OR: [{ source: "infosimples" }, { category: "relatorio_certidoes" }] },
            orderBy: { createdAt: "asc" },
          },
          certidaoJobs: {
            where: { status: "success" },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  if (!link || link.revokedAt) notFound();
  if (link.expiresAt < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-muted/20">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center space-y-2">
            <AlertCircle className="h-10 w-10 mx-auto text-amber-500" />
            <h2 className="text-lg font-semibold">Link expirado</h2>
            <p className="text-sm text-muted-foreground">
              Este link de compartilhamento expirou em{" "}
              {link.expiresAt.toLocaleDateString("pt-BR")}. Solicite um novo link
              ao corretor.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Increment view count (fire and forget)
  prisma.certidoesShareLink
    .update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 } },
    })
    .catch(() => {});

  const { deal } = link;
  const relatorio = deal.attachments.find(
    (a) => a.category === "relatorio_certidoes"
  );
  const certidoes = deal.attachments.filter(
    (a) => a.category !== "relatorio_certidoes"
  );

  return (
    <div className="min-h-screen bg-muted/20 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-xl">Certidões</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">{deal.title}</p>
              </div>
              <Badge variant="secondary">
                <Calendar className="h-3 w-3 mr-1" />
                Expira em {link.expiresAt.toLocaleDateString("pt-BR")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Este é um link público temporário gerado pelo corretor. Os documentos
            abaixo foram extraídos automaticamente via Infosimples.
          </CardContent>
        </Card>

        {relatorio && (
          <Card className="border-primary/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Relatório de due diligence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <a
                href={`/s/certidoes/${params.token}/file/${relatorio.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
              >
                Abrir {relatorio.filename}
              </a>
            </CardContent>
          </Card>
        )}

        {certidoes.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              Nenhuma certidão disponível para consulta neste link.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Certidões ({certidoes.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {certidoes.map((att) => (
                <div
                  key={att.id}
                  className="py-2 flex items-start justify-between gap-3"
                >
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {att.filename}
                      </p>
                      {att.category && (
                        <p className="text-xs text-muted-foreground">
                          {att.category}
                        </p>
                      )}
                    </div>
                  </div>
                  <a
                    href={`/s/certidoes/${params.token}/file/${att.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline shrink-0"
                  >
                    Abrir PDF
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-center text-muted-foreground pt-4">
          Link visualizado {link.viewCount + 1} {link.viewCount === 0 ? "vez" : "vezes"}
        </p>
      </div>
    </div>
  );
}
