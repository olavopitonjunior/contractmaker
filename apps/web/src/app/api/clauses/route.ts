import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json([]);

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const search = searchParams.get("q");

  const where: Record<string, unknown> = { orgId: org.id, status: "approved" };
  if (category) where.category = category;

  const clauses = await prisma.clause.findMany({
    where: {
      ...where,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { content: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ category: "asc" }, { usageCount: "desc" }],
  });

  return NextResponse.json(clauses);
}

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

  const clause = await prisma.clause.create({
    data: {
      orgId: org.id,
      authorId: session.user.id,
      category: body.category || "customizada",
      subcategory: body.subcategory || null,
      title: body.title,
      content: body.content,
      description: body.description || null,
      tags: body.tags || [],
      source: body.source || "manual",
      status: body.source === "ai-generated" ? "pending" : "approved",
    },
  });

  return NextResponse.json(clause, { status: 201 });
}
