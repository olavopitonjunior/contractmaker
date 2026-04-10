import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";

export default async function PipelinePage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-muted-foreground">
          Nenhuma organizacao encontrada.
        </p>
      </div>
    );
  }

  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: org.id },
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: {
          deals: {
            orderBy: { position: "asc" },
            include: {
              form: { select: { id: true, status: true } },
              contracts: {
                where: { isLatest: true },
                select: { id: true, version: true },
              },
            },
          },
        },
      },
    },
  });

  if (!pipeline) {
    return <p className="text-muted-foreground p-6">Pipeline nao configurado.</p>;
  }

  const stages = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color || "#6366f1",
    deals: stage.deals.map((deal) => ({
      id: deal.id,
      title: deal.title,
      value: deal.value,
      createdAt: deal.createdAt.toISOString(),
      formStatus: deal.form?.status || null,
      hasContract: deal.contracts.length > 0,
    })),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pipeline de Vendas</h1>
      </div>
      <KanbanBoard stages={stages} />
    </div>
  );
}
