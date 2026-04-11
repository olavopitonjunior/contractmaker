import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { validateContractData } from "@/lib/ai/validators";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
  });

  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  if (contract.status === "aprovado") {
    return NextResponse.json({ error: "Contrato já está aprovado" }, { status: 400 });
  }

  // Run validation before approval
  const issues = validateContractData(contract.dataJson as Record<string, unknown>);
  const errors = issues.filter((i) => i.severity === "error");

  if (errors.length > 0) {
    return NextResponse.json({
      error: "Contrato possui erros que impedem a aprovação",
      issues: errors,
    }, { status: 422 });
  }

  // Approve
  await prisma.contract.update({
    where: { id: params.id },
    data: { status: "aprovado" },
  });

  // Log approval
  await prisma.contractChangeLog.create({
    data: {
      contractId: params.id,
      userId: session.user.id,
      action: "status_change",
      summary: `Contrato aprovado por ${session.user.name || session.user.email}`,
      details: {
        previousStatus: contract.status,
        newStatus: "aprovado",
        warningsIgnored: issues.filter((i) => i.severity === "warning").length,
      },
      source: "user",
    },
  });

  return NextResponse.json({ status: "aprovado" });
}
