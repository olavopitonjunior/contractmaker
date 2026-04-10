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
      form: true,
      attachments: { orderBy: { createdAt: "desc" } },
      contracts: {
        where: { isLatest: true },
        include: { template: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!deal) notFound();

  return <DealDetail deal={deal} />;
}
