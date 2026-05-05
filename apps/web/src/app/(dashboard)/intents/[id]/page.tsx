import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IntentDetailClient } from "@/components/intents/IntentDetailClient";

export const dynamic = "force-dynamic";

export default async function IntentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  const intent = await prisma.actionIntent.findUnique({
    where: { id: params.id },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      token: { select: { id: true, name: true } },
    },
  });

  if (!intent || intent.orgId !== org.id) notFound();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Revisar Intent</CardTitle>
        </CardHeader>
        <CardContent>
          <IntentDetailClient
            intent={{
              id: intent.id,
              action: intent.action,
              status: intent.status,
              preview: intent.preview as {
                summary?: string;
                details?: Record<string, unknown>;
              },
              payload: intent.payload as Record<string, unknown>,
              requester: {
                name: intent.requester.name,
                email: intent.requester.email,
              },
              tokenName: intent.token?.name ?? null,
              approverName: intent.approver?.name ?? intent.approver?.email ?? null,
              approvedAt: intent.approvedAt?.toISOString() ?? null,
              executedAt: intent.executedAt?.toISOString() ?? null,
              rejectionReason: intent.rejectionReason,
              expiresAt: intent.expiresAt.toISOString(),
              errorMessage: intent.errorMessage,
              resultJson: intent.resultJson as unknown,
              createdAt: intent.createdAt.toISOString(),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
