import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { DealDetail } from "@/components/pipeline/DealDetail";

export default async function DealPage({
  params,
}: {
  params: { dealId: string };
}) {
  const session = await auth();
  if (!session?.user) return null;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      stage: true,
      form: {
        include: {
          attachments: { orderBy: { createdAt: "asc" } },
        },
      },
      attachments: { orderBy: { createdAt: "desc" } },
      contracts: {
        include: { template: { select: { name: true } } },
        orderBy: { version: "desc" },
      },
    },
  });

  if (!deal) notFound();

  return <DealDetail deal={deal} />;
}
