import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClienteFichaCard } from "@/components/locacao/ClienteFichaCard";
import { ClientCreditAnalysisCard } from "@/components/locacao/ClientCreditAnalysisCard";
import { ClientInsurerAnalysisCard } from "@/components/locacao/ClientInsurerAnalysisCard";
import { ClientDocumentsCard } from "@/components/locacao/ClientDocumentsCard";

export const dynamic = "force-dynamic";

export default async function ClienteDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const client = await prisma.leaseClient.findUnique({
    where: { id: params.id },
    include: {
      createdBy: { select: { name: true, email: true } },
      insurerAnalyses: { orderBy: { createdAt: "desc" } },
      attachments: { orderBy: { createdAt: "desc" } },
      certidaoJobs: {
        where: { provider: "serasa" },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, label: true, status: true, resultData: true },
      },
    },
  });
  if (!client || client.orgId !== org.id) notFound();

  const createdByName = client.createdBy?.name ?? client.createdBy?.email ?? "—";

  // Mapa certidaoJobId → attachmentId (PDF Serasa vive no LeaseClientAttachment).
  const attByJob = new Map<string, string>();
  for (const a of client.attachments) {
    if (a.certidaoJobId) attByJob.set(a.certidaoJobId, a.id);
  }

  const serasaJobs = client.certidaoJobs.map((j) => {
    const r = j.resultData as { situacao?: string; detalhes?: string } | null;
    return {
      id: j.id,
      label: j.label,
      status: j.status,
      situacao: r?.situacao ?? null,
      detalhes: r?.detalhes ?? null,
      attachmentId: attByJob.get(j.id) ?? null,
    };
  });

  const compliance = (client.complianceJson as Record<string, unknown> | null) ?? null;
  const hasConsent = !!(compliance?.serasaConsent as { at?: string } | undefined)?.at;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/locacao/pessoas/clientes">
            <ArrowLeft className="mr-1 h-4 w-4" /> Clientes
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{client.nome}</h1>
          <Badge variant="outline">{client.tipoPessoa === "juridica" ? "PJ" : "PF"}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ClienteFichaCard
          ficha={{
            id: client.id,
            tipoPessoa: client.tipoPessoa,
            nome: client.nome,
            cpfCnpj: client.cpfCnpj ?? "",
            email: client.email ?? "",
            phone: client.phone ?? "",
            status: client.status,
            createdByName,
            createdAt: client.createdAt.toISOString(),
          }}
        />
        <ClientCreditAnalysisCard clientId={client.id} hasConsent={hasConsent} jobs={serasaJobs} />
        <ClientInsurerAnalysisCard
          clientId={client.id}
          analyses={client.insurerAnalyses.map((a) => ({
            id: a.id,
            seguradora: a.seguradora,
            status: a.status,
            premioMensal: a.premioMensal,
          }))}
        />
        <ClientDocumentsCard
          clientId={client.id}
          documents={client.attachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            category: a.category,
            createdAt: a.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
