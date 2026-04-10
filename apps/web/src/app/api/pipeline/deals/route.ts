import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const createDealSchema = z.object({
  formId: z.string().optional(),
  title: z.string().min(1),
  value: z.number().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = createDealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: org.id },
    include: { stages: { orderBy: { position: "asc" } } },
  });

  if (!pipeline || pipeline.stages.length === 0) {
    return NextResponse.json({ error: "No pipeline configured" }, { status: 400 });
  }

  const firstStage = pipeline.stages[0];

  // Get form data if formId provided
  let dataJson = null;
  if (parsed.data.formId) {
    const form = await prisma.salesForm.findUnique({
      where: { id: parsed.data.formId },
    });
    if (form) {
      dataJson = form.dataJson;
      // Mark form as linked
      await prisma.salesForm.update({
        where: { id: form.id },
        data: { status: "vinculado" },
      });
    }
  }

  const dealsInStage = await prisma.deal.count({
    where: { stageId: firstStage.id },
  });

  const deal = await prisma.deal.create({
    data: {
      pipelineId: pipeline.id,
      stageId: firstStage.id,
      userId: session.user.id,
      formId: parsed.data.formId || null,
      title: parsed.data.title,
      value: parsed.data.value || null,
      dataJson: dataJson ?? undefined,
      position: dealsInStage,
    },
  });

  return NextResponse.json(deal, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json([]);

  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: org.id },
  });
  if (!pipeline) return NextResponse.json([]);

  const deals = await prisma.deal.findMany({
    where: { pipelineId: pipeline.id },
    orderBy: { createdAt: "desc" },
    include: {
      stage: true,
      form: { select: { id: true, token: true, status: true } },
      contracts: { where: { isLatest: true }, select: { id: true, version: true, status: true } },
    },
  });

  return NextResponse.json(deals);
}
