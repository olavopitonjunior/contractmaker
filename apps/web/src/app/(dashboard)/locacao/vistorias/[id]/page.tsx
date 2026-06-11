import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { LaudoEditor } from "@/components/locacao/inspection/LaudoEditor";
import type { SignerSuggestion } from "@/components/locacao/inspection/EnviarAssinaturaDialog";
import type { LaudoAmbiente, LaudoMeta } from "@/lib/locacao/inspection-types";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";

export const dynamic = "force-dynamic";

const TIPO_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  contra: "Contra-vistoria",
};

interface Params {
  params: Promise<{ id: string }>;
}

export default async function VistoriaDetailPage({ params }: Params) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");
  const { id } = await params;

  const modules = await getOrgModules(org.id);
  if (!isFeatureEnabled(modules, FEATURE.LOCACAO_VISTORIAS)) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Recurso de vistorias não habilitado para esta organização.
        </CardContent>
      </Card>
    );
  }

  const inspection = await prisma.inspection.findFirst({
    where: { id, orgId: org.id },
    include: {
      property: {
        include: {
          ownerships: {
            include: { owner: { select: { nome: true, email: true } } },
          },
        },
      },
      leaseContract: {
        select: {
          id: true,
          dealId: true,
          tenants: {
            include: { tenant: { select: { nome: true, email: true } } },
          },
        },
      },
    },
  });
  if (!inspection) notFound();

  const endereco = [
    [inspection.property.rua, inspection.property.numero].filter(Boolean).join(", "),
    inspection.property.bairro,
    [inspection.property.cidade, inspection.property.uf].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" · ");

  // Sugestões de signatários: locatários do contrato + proprietários do imóvel.
  const signerSuggestions: SignerSuggestion[] = [
    ...(inspection.leaseContract?.tenants ?? []).map((t) => ({
      name: t.tenant.nome,
      email: t.tenant.email ?? "",
      origem: "Locatário",
    })),
    ...inspection.property.ownerships.map((o) => ({
      name: o.owner.nome,
      email: o.owner.email ?? "",
      origem: "Proprietário",
    })),
  ];

  return (
    <div className="space-y-4">
      <Link
        href={
          inspection.leaseContract
            ? `/locacao/contratos/${inspection.leaseContract.id}?tab=vistoria`
            : "/locacao/vistorias"
        }
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {inspection.leaseContract ? "Voltar pro contrato" : "Voltar pra vistorias"}
      </Link>

      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-semibold">
              <ClipboardList className="h-5 w-5" />
              Vistoria de {TIPO_LABEL[inspection.tipo] ?? inspection.tipo}
            </h2>
            <p className="text-sm text-muted-foreground">{endereco}</p>
            <p className="text-xs text-muted-foreground">
              Criada em {inspection.createdAt.toLocaleDateString("pt-BR")}
              {inspection.leaseContract && (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    href={`/locacao/contratos/${inspection.leaseContract.id}`}
                    className="text-primary hover:underline"
                  >
                    ver contrato
                  </Link>
                </>
              )}
            </p>
          </div>
          <Badge variant="outline" className="capitalize">
            {TIPO_LABEL[inspection.tipo] ?? inspection.tipo}
          </Badge>
        </CardContent>
      </Card>

      <LaudoEditor
        inspectionId={inspection.id}
        initialStatus={inspection.status}
        initialAmbientes={(inspection.ambientesJson as unknown as LaudoAmbiente[] | null) ?? []}
        initialMeta={(inspection.checklistJson as unknown as LaudoMeta | null) ?? {
          medidores: {},
          chaves: [],
          mobilia: [],
        }}
        laudoPdfUrl={inspection.laudoPdfUrl}
        signerSuggestions={signerSuggestions}
        signatureAvailable={Boolean(inspection.leaseContract?.dealId)}
      />
    </div>
  );
}
