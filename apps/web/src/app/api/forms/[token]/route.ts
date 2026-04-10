import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

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

  const updated = await prisma.salesForm.update({
    where: { token: params.token },
    data: {
      dataJson: mergedData,
      title: body.title ?? form.title,
      status: body.status ?? form.status,
    },
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    updatedAt: updated.updatedAt,
  });
}
