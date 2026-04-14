import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { generateContractForDeal } from "@/lib/services/contract-generation";

// GET: public - fetch form data by token
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
  });

  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: form.id,
    token: form.token,
    title: form.title,
    schemaType: form.schemaType,
    dataJson: form.dataJson,
    status: form.status,
    updatedAt: form.updatedAt,
  });
}

// PATCH: public - auto-save form data
export async function PATCH(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const body = await req.json();

  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
  });

  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const currentData = (form.dataJson as Record<string, unknown>) || {};
  const mergedData = { ...currentData, ...body.dataJson };

  const previousStatus = form.status;
  const newStatus = body.status ?? form.status;

  const updated = await prisma.salesForm.update({
    where: { token: params.token },
    data: {
      dataJson: mergedData,
      title: body.title ?? form.title,
      status: newStatus,
    },
  });

  // Keep the deal title in sync with the form title when the user renames the form
  if (typeof body.title === "string" && body.title.trim() && body.title !== form.title) {
    await prisma.deal.updateMany({
      where: { formId: form.id },
      data: { title: body.title },
    });
  }

  // Auto-generate contract when form is completed
  let contractId: string | null = null;
  let dealId: string | null = null;
  if (newStatus === "completo" && previousStatus !== "completo") {
    const deal = await prisma.deal.findFirst({
      where: { formId: form.id },
    });

    if (deal) {
      dealId = deal.id;
      try {
        const result = await generateContractForDeal(deal.id, deal.userId, form.orgId);
        contractId = result.contractId;
      } catch (error) {
        console.error("Auto-generate contract failed:", error);
      }

      try {
        const formAttachments = await prisma.formAttachment.findMany({
          where: { formId: form.id },
        });
        if (formAttachments.length > 0) {
          const existing = await prisma.dealAttachment.findMany({
            where: { dealId: deal.id },
            select: { url: true },
          });
          const existingUrls = new Set(existing.map((e) => e.url));
          const newOnes = formAttachments.filter((a) => !existingUrls.has(a.url));
          if (newOnes.length > 0) {
            await prisma.dealAttachment.createMany({
              data: newOnes.map((a) => ({
                dealId: deal.id,
                filename: a.filename,
                mime: a.mime,
                url: a.url,
                category: a.category,
              })),
            });
          }
        }
      } catch (error) {
        console.error("Link form attachments to deal failed:", error);
      }
    }
  }

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    updatedAt: updated.updatedAt,
    contractId,
    dealId,
  });
}
