import { auth } from "@/lib/auth/auth";
import { getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export default async function PipelinePage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-muted-foreground">
          Nenhuma organizacao encontrada. Entre em contato com o administrador.
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
            include: { form: true },
          },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pipeline de Vendas</h1>
      </div>

      {pipeline ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {pipeline.stages.map((stage) => (
            <div
              key={stage.id}
              className="min-w-[300px] rounded-lg border bg-muted/40 p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                {stage.color && (
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                )}
                <h3 className="font-medium">{stage.name}</h3>
                <span className="ml-auto text-sm text-muted-foreground">
                  {stage.deals.length}
                </span>
              </div>

              <div className="space-y-2">
                {stage.deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-md border bg-card p-3 shadow-sm"
                  >
                    <p className="font-medium text-sm">{deal.title}</p>
                    {deal.value && (
                      <p className="text-xs text-muted-foreground mt-1">
                        R${" "}
                        {deal.value.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    )}
                  </div>
                ))}

                {stage.deals.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Nenhum negocio
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">Pipeline nao configurado.</p>
      )}
    </div>
  );
}
