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
        // Só o instrumento principal — sem isto, aditamentos (kind="addendum")
        // e o contrato de administração de locação (kind="administracao")
        // apareciam como "versões" do contrato na aba Contratos.
        where: { kind: "contract" },
        include: { template: { select: { name: true } } },
        orderBy: { version: "desc" },
      },
      certidaoJobs: { orderBy: { createdAt: "desc" }, take: 1 },
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

  if (!deal) notFound();

  return <DealDetail deal={deal} />;
}
