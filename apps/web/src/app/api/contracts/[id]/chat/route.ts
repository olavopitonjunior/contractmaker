import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { chatSchema } from "@/lib/validation/schemas";
import { runContractAgent } from "@/lib/ai/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
  });
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  if (contract.status === "aprovado") {
    return NextResponse.json(
      {
        message:
          "Este contrato já foi aprovado e não pode ser alterado via chat.",
        htmlContent: null,
      },
      { status: 403 }
    );
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  try {
    const result = await runContractAgent({
      message: parsed.data.message,
      contractId: params.id,
      userId: session.user.id,
      orgId: org.id,
    });

    return NextResponse.json({
      message: result.message,
      htmlContent: result.htmlContent,
      dataJson: result.dataJson,
      toolsUsed: result.changeLogs.map((l) => l.action),
    });
  } catch (error: any) {
    console.error("Agent error:", error);
    return NextResponse.json(
      { error: error.message || "Erro ao processar mensagem" },
      { status: 500 }
    );
  }
}
