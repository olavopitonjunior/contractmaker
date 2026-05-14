import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ShareByPartyClient } from "./ShareByPartyClient";

export default async function ShareFormByPartyPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/login");

  const form = await prisma.salesForm.findFirst({
    where: { id: params.id, orgId: org.id },
    include: {
      participants: { orderBy: [{ role: "asc" }, { partyIndex: "asc" }] },
    },
  });
  if (!form) return notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link href="/forms">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar aos formulários
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Compartilhar por parte</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gere links isolados pra vendedor e comprador preencherem só os
          próprios dados. Cada parte recebe um link distinto e não acessa
          informações da outra. Token expira em 7 dias — regenere quando
          necessário.
        </p>
      </div>

      <ShareByPartyClient
        formToken={form.token}
        mainFormUrl={`/f/${form.token}`}
        initialParticipants={form.participants.map((p) => ({
          id: p.id,
          role: p.role,
          partyIndex: p.partyIndex,
          token: p.token,
          tokenExp: p.tokenExp.toISOString(),
          completedAt: p.completedAt?.toISOString() ?? null,
          lastAccessAt: p.lastAccessAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
