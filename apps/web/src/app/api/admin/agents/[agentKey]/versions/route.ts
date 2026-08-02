import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { requirePlatform } from "@/lib/admin/gate";
import { prisma } from "@/lib/db/prisma";
import { isAgentKey } from "@/lib/ai/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/agents/[agentKey]/versions?orgId=
 *
 * Histórico do perfil no escopo pedido, mais novo primeiro. Gate
 * `super_admin` — o snapshot carrega `instructions` (inclusive as de
 * plataforma), o mesmo material que a rota de prompt protege com este gate.
 * O diff é responsabilidade da tela: snapshot[n] × snapshot[n+1], em memória.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { agentKey: string } }
) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  if (!isAgentKey(params.agentKey)) {
    return NextResponse.json({ error: "Agente desconhecido" }, { status: 404 });
  }
  const orgId = req.nextUrl.searchParams.get("orgId") || null;

  const versions = await prisma.agentProfileVersion.findMany({
    where: { orgId, agentKey: params.agentKey },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Autores num lote — mesmo padrão do updatedByName do console.
  const editorIds = [
    ...new Set(versions.map((v) => v.updatedBy).filter((v): v is string => !!v)),
  ];
  const editors = editorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: editorIds } },
        select: { id: true, name: true },
      })
    : [];
  const nome = new Map(editors.map((u) => [u.id, u.name || u.id]));

  return NextResponse.json({
    scope: orgId ? { type: "org", orgId } : { type: "platform" },
    versions: versions.map((v) => ({
      id: v.id,
      snapshot: v.snapshot,
      updatedByName: v.updatedBy ? nome.get(v.updatedBy) ?? v.updatedBy : null,
      createdAt: v.createdAt.toISOString(),
    })),
  });
}
