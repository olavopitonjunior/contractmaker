import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";

export const runtime = "nodejs";

export async function POST(
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
    include: { form: true },
  });

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Get form data from deal or form
  const dataJson = deal.form
    ? (deal.form.dataJson as Record<string, unknown>)
    : (deal.dataJson as Record<string, unknown>) || {};

  // Find default template
  const template = await prisma.contractTemplate.findFirst({
    where: { orgId: org.id, isDefault: true, status: "active" },
  });

  if (!template) {
    return NextResponse.json(
      { error: "No default template found" },
      { status: 400 }
    );
  }

  // Render HTML from template + data
  const htmlContent = renderContratoHTML(template.handlebarsSource, dataJson);

  // Check existing contracts for this deal
  const existingCount = await prisma.contract.count({
    where: { dealId: deal.id },
  });

  if (existingCount > 0) {
    // Mark all existing as not latest
    await prisma.contract.updateMany({
      where: { dealId: deal.id, isLatest: true },
      data: { isLatest: false },
    });
  }

  // Create contract
  const contract = await prisma.contract.create({
    data: {
      dealId: deal.id,
      templateId: template.id,
      userId: session.user.id,
      version: existingCount + 1,
      dataJson: dataJson as any,
      htmlContent,
      status: "rascunho",
      isLatest: true,
    },
  });

  // Move deal to "Contrato" stage if exists
  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: org.id },
    include: { stages: { orderBy: { position: "asc" } } },
  });

  if (pipeline) {
    const contratoStage = pipeline.stages.find(
      (s) => s.name === "Contrato"
    );
    if (contratoStage) {
      await prisma.deal.update({
        where: { id: deal.id },
        data: { stageId: contratoStage.id },
      });
    }
  }

  return NextResponse.json(
    { contractId: contract.id, version: contract.version },
    { status: 201 }
  );
}
