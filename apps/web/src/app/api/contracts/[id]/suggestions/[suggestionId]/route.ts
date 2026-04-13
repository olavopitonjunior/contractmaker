import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; suggestionId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, htmlContent } = body;

  if (action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "action deve ser accept ou reject" }, { status: 400 });
  }

  const suggestion = await prisma.contractSuggestion.update({
    where: { id: params.suggestionId },
    data: {
      status: action === "accept" ? "accepted" : "rejected",
      resolvedAt: new Date(),
      resolvedBy: session.user.id,
    },
  });

  // Persist the editor's new HTML so the server copy stays in sync with the visible state
  if (typeof htmlContent === "string") {
    await prisma.contract.update({
      where: { id: params.id },
      data: { htmlContent },
    });
  }

  return NextResponse.json(suggestion);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { suggestionId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.contractSuggestion.delete({ where: { id: params.suggestionId } });
  return NextResponse.json({ ok: true });
}
