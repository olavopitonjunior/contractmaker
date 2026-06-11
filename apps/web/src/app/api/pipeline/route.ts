import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { assertModuleEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { MODULE } from "@/lib/modules/catalog";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  try {
    await assertModuleEnabled(org.id, MODULE.VENDAS);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }

  const pipeline = await getPipelineByKind(org.id, MODULE.VENDAS, {
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: {
          deals: {
            orderBy: { position: "asc" },
            include: {
              form: { select: { id: true, status: true, updatedAt: true } },
            },
          },
        },
      },
    },
  });

  return NextResponse.json(pipeline);
}
