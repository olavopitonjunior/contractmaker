import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { planCertidoesForDeal } from "@/lib/certidoes/planner";
import { getMonthlySpend } from "@/lib/certidoes/executor";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: { form: { select: { orgId: true, dataJson: true } } },
  });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.form && deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dealData =
    (deal.form?.dataJson as Record<string, unknown> | null) ||
    (deal.dataJson as Record<string, unknown> | null);
  const plan = planCertidoesForDeal(dealData as any);
  const spend = await getMonthlySpend();

  return NextResponse.json({ plan, spend });
}
