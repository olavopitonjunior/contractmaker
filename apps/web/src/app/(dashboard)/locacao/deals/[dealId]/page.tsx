import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { LocacaoDealDetail } from "@/components/locacao/LocacaoDealDetail";
import { LOCACAO_SIMPLIFIED_MODE } from "@/lib/env/staging";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import type { AgentEvent } from "@/lib/ai/types";

export const dynamic = "force-dynamic";

export default async function LocacaoDealPage({ params }: { params: { dealId: string } }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: {
        select: {
          id: true,
          schemaType: true,
          status: true,
          token: true,
          dataJson: true,
          createdAt: true,
          completedAt: true,
          lockedAt: true,
        },
      },
      pipeline: { select: { orgId: true } },
      attachments: { orderBy: { createdAt: "desc" } },
      stage: { select: { name: true } },
      envelopes: {
        where: { source: "contract", status: "closed", contract: { kind: "contract" } },
        select: { closedAt: true },
        orderBy: { closedAt: "desc" },
        take: 1,
      },
      commissionCharges: {
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  if (!deal || deal.kind !== "locacao") notFound();
  // Cross-org guard via pipeline.orgId (Deal não tem orgId direto).
  if (deal.pipeline.orgId !== org.id) notFound();

  // Contrato mais recente do deal (mesma shape de /contracts/[id]).
  // kind="contract" — o instrumento de locação; a administração vive em row própria.
  const contract = await prisma.contract.findFirst({
    where: { dealId: deal.id, isLatest: true, kind: "contract" },
    include: {
      template: { select: { id: true, name: true } },
      chatSessions: {
        where: { archived: false },
        include: { messages: { orderBy: { createdAt: "asc" } } },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      exports: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  const versions = contract
    ? await prisma.contract.findMany({
        where: { dealId: deal.id, kind: "contract" },
        select: { id: true, version: true, createdAt: true, status: true, isLatest: true },
        orderBy: { version: "desc" },
      })
    : [];

  // Contrato de administração (imobiliária ↔ proprietário) — aba Administração.
  const adminContract = await prisma.contract.findFirst({
    where: { dealId: deal.id, isLatest: true, kind: "administracao" },
    include: {
      template: { select: { id: true, name: true } },
      chatSessions: {
        where: { archived: false },
        include: { messages: { orderBy: { createdAt: "asc" } } },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      exports: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  const adminVersions = adminContract
    ? await prisma.contract.findMany({
        where: { dealId: deal.id, kind: "administracao" },
        select: { id: true, version: true, createdAt: true, status: true, isLatest: true },
        orderBy: { version: "desc" },
      })
    : [];

  // Nome da administradora (org) pra pré-preencher o signatário da imobiliária.
  const orgRow = await prisma.organization.findUnique({
    where: { id: org.id },
    select: { name: true, legalName: true },
  });
  const orgName = orgRow?.legalName ?? orgRow?.name ?? undefined;

  // Análise de crédito (Serasa) — jobs do deal + consent LGPD.
  const serasaJobs = await prisma.certidaoJob.findMany({
    where: { dealId: deal.id, provider: "serasa" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      label: true,
      endpoint: true,
      status: true,
      resultData: true,
      attachmentId: true,
      createdAt: true,
    },
  });
  const compliance = (deal.complianceJson as Record<string, unknown> | null) ?? null;
  const serasaConsent = compliance?.serasaConsent as { at?: string } | undefined;

  const lease = await prisma.leaseContract.findFirst({
    where: { dealId: deal.id, orgId: org.id },
    include: {
      property: {
        select: { id: true, rua: true, numero: true, bairro: true, cidade: true, uf: true },
      },
      guarantee: true,
      inspections: { orderBy: { createdAt: "desc" }, take: 50 },
      insurancePolicies: { orderBy: { createdAt: "desc" } },
      rentCharges: { orderBy: { competencia: "desc" }, take: 12 },
    },
  });

  const propertyLabel = lease
    ? [
        [lease.property.rua, lease.property.numero].filter(Boolean).join(", "),
        lease.property.bairro,
        [lease.property.cidade, lease.property.uf].filter(Boolean).join("/"),
      ]
        .filter(Boolean)
        .join(" · ") || "Imóvel sem endereço"
    : "";

  // Mapeia uma row de Contract (locação OU administração) pro shape do
  // ContractEditorPage. `fallbackTemplateName` distingue o rótulo na aba.
  type ContractWithRelations = NonNullable<typeof contract>;
  const toContractProp = (
    c: ContractWithRelations | null,
    fallbackTemplateName: string
  ) =>
    c
      ? {
          id: c.id,
          dealId: c.dealId,
          dealTitle: deal.title,
          templateName: c.template?.name ?? fallbackTemplateName,
          version: c.version,
          status: c.status,
          htmlContent: c.htmlContent || "",
          dataJson: c.dataJson as Record<string, unknown>,
          messages:
            c.chatSessions[0]?.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              events: (m.events as unknown as AgentEvent[]) || undefined,
            })) || [],
          sessionId: c.chatSessions[0]?.id ?? null,
          exports: c.exports.map((e) => ({
            id: e.id,
            format: e.format,
            url: e.url,
            createdAt: e.createdAt.toISOString(),
          })),
          googleDocId: c.googleDocId,
          googleDocUrl: c.googleDocUrl,
          googleDocStatus: c.googleDocStatus,
        }
      : null;

  const contractProp = toContractProp(contract, "Contrato de locação");
  const adminContractProp = toContractProp(adminContract, "Contrato de administração");

  const modulesView = await getOrgModules(org.id);
  const surveysEnabled = isFeatureEnabled(modulesView, FEATURE.LOCACAO_PESQUISAS);

  return (
    <LocacaoDealDetail
      surveysEnabled={surveysEnabled}
      deal={{
        id: deal.id,
        title: deal.title,
        stageName: deal.stage?.name ?? null,
        formStatus: deal.form?.status ?? null,
        formToken: deal.form?.token ?? null,
        formLockedAt: deal.form?.lockedAt?.toISOString() ?? null,
        dataJson: (deal.form?.dataJson as Record<string, unknown>) ?? {},
        lostAt: deal.lostAt?.toISOString() ?? null,
        lostReason: deal.lostReason ?? null,
        archivedAt: deal.archivedAt?.toISOString() ?? null,
        formOpenedAt: deal.form?.createdAt?.toISOString() ?? null,
        formCompletedAt: deal.form?.completedAt?.toISOString() ?? null,
        contractSignedAt:
          deal.envelopes[0]?.closedAt?.toISOString() ??
          deal.contractSignedAt?.toISOString() ??
          null,
        chargeCreatedAt:
          deal.commissionCharges[0]?.createdAt.toISOString() ??
          deal.chargeIssuedAt?.toISOString() ??
          null,
        attachments: deal.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          url: a.url,
          mime: a.mime,
          category: a.category,
          extractedData: (a.extractedData as Record<string, unknown> | null) ?? null,
          createdAt: a.createdAt.toISOString(),
        })),
      }}
      contract={contractProp}
      adminContract={adminContractProp}
      adminVersions={adminVersions.map((v) => ({
        id: v.id,
        version: v.version,
        createdAt: v.createdAt.toISOString(),
        status: v.status,
        isLatest: v.isLatest,
      }))}
      orgName={orgName}
      serasaConsent={!!serasaConsent?.at}
      serasaJobs={serasaJobs.map((j) => {
        const result = (j.resultData as { situacao?: string; detalhes?: string } | null) ?? null;
        return {
          id: j.id,
          label: j.label,
          endpoint: j.endpoint,
          status: j.status,
          situacao: result?.situacao ?? null,
          detalhes: result?.detalhes ?? null,
          attachmentId: j.attachmentId,
          createdAt: j.createdAt.toISOString(),
        };
      })}
      versions={versions.map((v) => ({
        id: v.id,
        version: v.version,
        createdAt: v.createdAt.toISOString(),
        status: v.status,
        isLatest: v.isLatest,
      }))}
      simplified={LOCACAO_SIMPLIFIED_MODE}
      lease={
        lease
          ? {
              id: lease.id,
              status: lease.status,
              valorAluguel: lease.valorAluguel,
              taxaAdminPercent: lease.taxaAdminPercent,
              diaVencimento: lease.diaVencimento,
              propertyId: lease.property.id,
              propertyLabel,
              guarantee: lease.guarantee
                ? {
                    id: lease.guarantee.id,
                    tipo: lease.guarantee.tipo,
                    caucaoSubtipo: lease.guarantee.caucaoSubtipo,
                    provider: lease.guarantee.provider,
                    status: lease.guarantee.status,
                    coberturaMeses: lease.guarantee.coberturaMeses,
                    custoJson: lease.guarantee.custoJson,
                    dadosJson: lease.guarantee.dadosJson,
                    fiadorPartyJson: lease.guarantee.fiadorPartyJson,
                    externalRef: lease.guarantee.externalRef,
                    documentoPdfUrl: lease.guarantee.documentoPdfUrl,
                    historicoJson: lease.guarantee.historicoJson,
                    updatedAt: lease.guarantee.updatedAt.toISOString(),
                  }
                : null,
              inspections: lease.inspections.map((i) => ({
                id: i.id,
                tipo: i.tipo,
                status: i.status,
                createdAt: i.createdAt.toISOString(),
                laudoPdfUrl: i.laudoPdfUrl,
              })),
              insurancePolicies: lease.insurancePolicies.map((p) => ({
                id: p.id,
                tipo: p.tipo,
                seguradora: p.seguradora,
                apoliceNumero: p.apoliceNumero,
                vigenciaInicio: p.vigenciaInicio.toISOString(),
                vigenciaFim: p.vigenciaFim.toISOString(),
                premioMensal: p.premioMensal,
                responsavelPagamento: p.responsavelPagamento,
                status: p.status,
                pdfUrl: p.pdfUrl,
                coberturaJson: p.coberturaJson,
              })),
              rentCharges: lease.rentCharges.map((r) => ({
                id: r.id,
                competencia: r.competencia,
                valorBase: r.valorBase,
                status: r.status,
              })),
            }
          : null
      }
    />
  );
}
