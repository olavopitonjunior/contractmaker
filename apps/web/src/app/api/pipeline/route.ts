import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { assertModuleEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { MODULE } from "@/lib/modules/catalog";
import { getEffectivePermissions, dealScopeWhere } from "@/lib/security/rbac/check";

export async function GET(req: Request) {
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

  // Escopo por usuário (feature Gerente): visão restrita só vê deals onde é
  // gerente atribuído ou criador; demais roles seguem org-wide ({}).
  const eff = await getEffectivePermissions(session.user.id, org.id);
  const scope = dealScopeWhere(eff);
  if (scope === null) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Por padrão o kanban oculta deals arquivados; ?includeArchived=true mostra.
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "true";

  const pipeline = await getPipelineByKind(org.id, MODULE.VENDAS, {
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: {
          deals: {
            where: {
              ...(includeArchived ? {} : { archivedAt: null }),
              ...scope,
            },
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
