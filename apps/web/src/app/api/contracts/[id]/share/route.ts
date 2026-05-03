import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  addDocPermission,
  listDocPermissions,
  removeDocPermission,
} from "@/lib/google/docs";

/**
 * Compartilhamento do Google Doc do contrato com terceiros via Drive
 * permissions API. Só funciona em contratos com `googleDocId` setado;
 * contratos legacy TipTap retornam 400.
 */

const shareSchema = z.object({
  email: z.string().email("E-mail inválido"),
  role: z.enum(["writer", "commenter", "reader"]).default("reader"),
  message: z.string().max(500).optional(),
});

async function loadContractWithDocId(contractId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { googleDocId: true, status: true },
  });
  return contract;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const contract = await loadContractWithDocId(params.id);
  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  if (!contract.googleDocId) {
    return NextResponse.json({ permissions: [], googleDocsBacked: false });
  }
  try {
    const permissions = await listDocPermissions(contract.googleDocId);
    return NextResponse.json({ permissions, googleDocsBacked: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[share GET] Drive error:", msg);
    return NextResponse.json(
      { error: `Falha ao listar permissões: ${msg.slice(0, 200)}` },
      { status: 502 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const contract = await loadContractWithDocId(params.id);
  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  if (!contract.googleDocId) {
    return NextResponse.json(
      { error: "Compartilhamento via Drive só funciona em contratos com Google Doc." },
      { status: 400 }
    );
  }
  if (contract.status === "aprovado") {
    return NextResponse.json(
      { error: "Contrato aprovado não aceita novas permissões — só leitura existente." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = shareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Payload inválido" },
      { status: 400 }
    );
  }

  try {
    const permission = await addDocPermission(
      contract.googleDocId,
      parsed.data.email,
      parsed.data.role,
      { sendNotification: true, message: parsed.data.message }
    );
    return NextResponse.json({ permission }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[share POST] Drive error:", msg);
    return NextResponse.json(
      { error: `Falha ao compartilhar: ${msg.slice(0, 200)}` },
      { status: 502 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const contract = await loadContractWithDocId(params.id);
  if (!contract?.googleDocId) {
    return NextResponse.json({ error: "Contrato não encontrado ou sem Google Doc" }, { status: 404 });
  }
  const permissionId = new URL(req.url).searchParams.get("permissionId");
  if (!permissionId) {
    return NextResponse.json({ error: "permissionId é obrigatório" }, { status: 400 });
  }
  try {
    await removeDocPermission(contract.googleDocId, permissionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[share DELETE] Drive error:", msg);
    return NextResponse.json(
      { error: `Falha ao remover permissão: ${msg.slice(0, 200)}` },
      { status: 502 }
    );
  }
}
