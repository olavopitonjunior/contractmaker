import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

interface DiffHunk {
  before: string;
  after: string;
  contextBefore?: string;
  contextAfter?: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; sugId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const suggestion = await prisma.templateSuggestion.findFirst({
    where: { id: params.sugId, orgId: org.id, templateId: params.id },
  });
  if (!suggestion) {
    return NextResponse.json({ error: "Sugestão não encontrada" }, { status: 404 });
  }
  return NextResponse.json(suggestion);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; sugId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const action = body.action as "accept" | "reject" | undefined;

  if (action !== "accept" && action !== "reject") {
    return NextResponse.json(
      { error: "action deve ser 'accept' ou 'reject'" },
      { status: 400 }
    );
  }

  const suggestion = await prisma.templateSuggestion.findFirst({
    where: { id: params.sugId, orgId: org.id, templateId: params.id },
  });
  if (!suggestion) {
    return NextResponse.json({ error: "Sugestão não encontrada" }, { status: 404 });
  }
  if (suggestion.status !== "pending") {
    return NextResponse.json(
      { error: `Sugestão já está ${suggestion.status}` },
      { status: 400 }
    );
  }

  if (action === "reject") {
    await prisma.templateSuggestion.update({
      where: { id: params.sugId },
      data: {
        status: "rejected",
        resolvedAt: new Date(),
        resolvedBy: session.user.id,
      },
    });
    return NextResponse.json({ ok: true, action });
  }

  // action === "accept": apply the hunks to the template's handlebarsSource
  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId: org.id },
  });
  if (!template) {
    return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  }

  const hunks = suggestion.diffHunks as unknown as DiffHunk[];
  let newSource = template.handlebarsSource;
  const appliedHunks: number[] = [];
  const failedHunks: number[] = [];

  hunks.forEach((hunk, idx) => {
    if (newSource.includes(hunk.before)) {
      newSource = newSource.replace(hunk.before, hunk.after);
      appliedHunks.push(idx);
    } else {
      failedHunks.push(idx);
    }
  });

  if (appliedHunks.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum hunk pôde ser aplicado — o template mudou desde que a sugestão foi criada. Rejeite e peça à IA para recriar.",
      },
      { status: 409 }
    );
  }

  // Version bump — parse "1.2.3" and increment patch
  const versionParts = template.version.split(".").map((n) => parseInt(n, 10));
  const newVersion =
    versionParts.length === 3 && versionParts.every((n) => !isNaN(n))
      ? `${versionParts[0]}.${versionParts[1]}.${versionParts[2] + 1}`
      : template.version;

  await prisma.contractTemplate.update({
    where: { id: template.id },
    data: {
      handlebarsSource: newSource,
      version: newVersion,
    },
  });

  await prisma.templateSuggestion.update({
    where: { id: params.sugId },
    data: {
      status: "approved",
      resolvedAt: new Date(),
      resolvedBy: session.user.id,
    },
  });

  return NextResponse.json({
    ok: true,
    action,
    newVersion,
    appliedHunks: appliedHunks.length,
    failedHunks: failedHunks.length,
    warning:
      failedHunks.length > 0
        ? `${failedHunks.length} hunks não puderam ser aplicados (template mudou)`
        : undefined,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; sugId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  await prisma.templateSuggestion.deleteMany({
    where: { id: params.sugId, orgId: org.id, templateId: params.id },
  });
  return NextResponse.json({ ok: true });
}
