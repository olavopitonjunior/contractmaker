import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ContractEditorPage } from "@/components/contracts/ContractEditorPage";

export default async function ContractPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) return null;

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: {
      deal: { select: { id: true, title: true } },
      template: { select: { id: true, name: true } },
      chatSessions: {
        include: { messages: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      exports: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  if (!contract) notFound();

  const versions = await prisma.contract.findMany({
    where: { dealId: contract.dealId },
    select: { id: true, version: true, createdAt: true, status: true, isLatest: true },
    orderBy: { version: "desc" },
  });

  return (
    <ContractEditorPage
      contract={{
        id: contract.id,
        dealId: contract.dealId,
        dealTitle: contract.deal.title,
        templateName: contract.template.name,
        version: contract.version,
        status: contract.status,
        htmlContent: contract.htmlContent || "",
        dataJson: contract.dataJson as Record<string, unknown>,
        messages: contract.chatSessions[0]?.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })) || [],
        exports: contract.exports.map((e) => ({
          id: e.id,
          format: e.format,
          url: e.url,
          createdAt: e.createdAt.toISOString(),
        })),
        googleDocId: contract.googleDocId,
        googleDocUrl: contract.googleDocUrl,
      }}
      versions={versions.map((v) => ({
        id: v.id,
        version: v.version,
        createdAt: v.createdAt.toISOString(),
        status: v.status,
        isLatest: v.isLatest,
      }))}
    />
  );
}
