import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { LocacaoDealDetail } from "@/components/locacao/LocacaoDealDetail";
import { LOCACAO_SIMPLIFIED_MODE } from "@/lib/env/staging";
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
        },
      },
      pipeline: { select: { orgId: true } },
      attachments: { orderBy: { createdAt: "desc" } },
      stage: { select: { name: true } },
      envelopes: {
        where: { source: "contract", status: "closed" },
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
  const contract = await prisma.contract.findFirst({
    where: { dealId: deal.id, isLatest: true },
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
        where: { dealId: deal.id },
        select: { id: true, version: true, createdAt: true, status: true, isLatest: true },
        orderBy: { version: "desc" },
      })
    : [];

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
      property: { select: { rua: true, numero: true, cidade: true, uf: true } },
      guarantee: true,
      inspections: { orderBy: { createdAt: "desc" } },
      insurancePolicies: { orderBy: { createdAt: "desc" } },
      rentCharges: { orderBy: { competencia: "desc" }, take: 12 },
    },
  });

  const contractProp = contract
    ? {
        id: contract.id,
        dealId: contract.dealId,
        dealTitle: deal.title,
        templateName: contract.template?.name ?? "Contrato de locação",
        version: contract.version,
        status: contract.status,
        htmlContent: contract.htmlContent || "",
        dataJson: contract.dataJson as Record<string, unknown>,
        messages:
          contract.chatSessions[0]?.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            events: (m.events as unknown as AgentEvent[]) || undefined,
          })) || [],
        sessionId: contract.chatSessions[0]?.id ?? null,
        exports: contract.exports.map((e) => ({
          id: e.id,
          format: e.format,
          url: e.url,
          createdAt: e.createdAt.toISOString(),
        })),
        googleDocId: contract.googleDocId,
        googleDocUrl: contract.googleDocUrl,
        googleDocStatus: contract.googleDocStatus,
      }
    : null;

  return (
    <LocacaoDealDetail
      deal={{
        id: deal.id,
        title: deal.title,
        stageName: deal.stage?.name ?? null,
        formStatus: deal.form?.status ?? null,
        formToken: deal.form?.token ?? null,
        dataJson: (deal.form?.dataJson as Record<string, unknown>) ?? {},
        lostAt: deal.lostAt?.toISOString() ?? null,
        lostReason: deal.lostReason ?? null,
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
              guarantee: lease.guarantee
                ? { tipo: lease.guarantee.tipo, status: lease.guarantee.status, provider: lease.guarantee.provider }
                : null,
              inspections: lease.inspections.map((i) => ({ id: i.id, tipo: i.tipo, status: i.status })),
              insurancePolicies: lease.insurancePolicies.map((p) => ({
                id: p.id,
                seguradora: p.seguradora,
                status: p.status,
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
