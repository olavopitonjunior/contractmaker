import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * Paths permitidas no PATCH. Tudo aqui é metadado de signatário usado pela
 * popup de envio ClickSign — nenhum desses campos altera a renderização do
 * contrato (HTML/PDF/GDoc). Por isso é seguro patchar mesmo quando o
 * contrato já está aprovado.
 *
 * - emails das partes (titular + cônjuge)
 * - nome/CPF/CNPJ básicos das partes (quando faltavam no form original)
 * - bloco corretora (incluir flag + email)
 * - testemunhas: substituição do array inteiro
 */
const PATCH_WHITELIST: RegExp[] = [
  /^vendedores\.\d+\.email$/,
  /^vendedores\.\d+\.conjuge\.email$/,
  /^vendedores\.\d+\.(nome|cpf|cnpj|razao_social)$/,
  /^compradores\.\d+\.email$/,
  /^compradores\.\d+\.conjuge\.email$/,
  /^compradores\.\d+\.(nome|cpf|cnpj|razao_social)$/,
  /^comissao\.(imobiliaria_email|imobiliaria_nome|imobiliaria_cnpj|creci|corretora_tipo_pessoa|incluir_como_signatario)$/,
  /^testemunhas$/,
];

const updateSchema = z.object({
  updates: z
    .array(
      z.object({
        path: z.string().min(1).max(200),
        value: z.unknown(),
      })
    )
    .min(1)
    .max(100),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const blocked = parsed.data.updates.filter(
    (u) => !PATCH_WHITELIST.some((rx) => rx.test(u.path))
  );
  if (blocked.length > 0) {
    return NextResponse.json(
      {
        error: "Path não permitido neste endpoint",
        blocked: blocked.map((u) => u.path),
      },
      { status: 400 }
    );
  }

  const contract = await prisma.contract.findFirst({
    where: { id: params.id, deal: { pipeline: { orgId: org.id } } },
    include: {
      deal: {
        include: { form: { select: { id: true, dataJson: true } } },
      },
    },
  });
  if (!contract) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 }
    );
  }

  const dealData =
    (contract.deal.form?.dataJson as Record<string, unknown> | null) ||
    (contract.deal.dataJson as Record<string, unknown> | null) ||
    {};
  const contractData =
    (contract.dataJson as Record<string, unknown> | null) || {};

  const updates = parsed.data.updates.map((u) => ({
    path: u.path,
    value: u.value as unknown,
  }));
  const dealMerged = applyUpdates(structuredClone(dealData), updates);
  const contractMerged = applyUpdates(
    structuredClone(contractData),
    updates
  );

  await prisma.$transaction(async (tx) => {
    await tx.deal.update({
      where: { id: contract.dealId },
      data: { dataJson: dealMerged as object },
    });
    if (contract.deal.form?.id) {
      await tx.salesForm.update({
        where: { id: contract.deal.form.id },
        data: { dataJson: dealMerged as object },
      });
    }
    await tx.contract.update({
      where: { id: contract.id },
      data: { dataJson: contractMerged as object },
    });
  });

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "CONTRACT_SIGNERS_DATA_UPDATE",
    result: "SUCCESS",
    resource: contract.id,
    resourceType: "Contract",
    metadata: {
      paths: parsed.data.updates.map((u) => u.path),
      contractStatus: contract.status,
    },
  });

  return NextResponse.json({ ok: true });
}

function applyUpdates(
  obj: Record<string, unknown>,
  updates: Array<{ path: string; value: unknown }>
): Record<string, unknown> {
  for (const { path, value } of updates) {
    setByPath(obj, path, value);
  }
  return obj;
}

function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split(".");
  let cursor: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextIsArrayIdx = /^\d+$/.test(parts[i + 1]);
    if (cursor[key] == null) {
      cursor[key] = nextIsArrayIdx ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}
