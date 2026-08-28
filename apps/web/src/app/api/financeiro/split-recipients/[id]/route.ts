import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import {
  isValidCpfCnpj,
  isValidCreci,
  normalizeEmail,
  normalizePhoneForStorage,
} from "@/lib/validators/corretor";

const patchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  cpfCnpj: z.string().trim().min(11).max(18).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  email: z
    .string()
    .trim()
    .email("Email inválido")
    .max(200)
    .nullable()
    .optional()
    .or(z.literal("")),
  active: z.boolean().optional(),
  // Aditivos 2026-05-16 — cadastro reutilizável de comissionado.
  kind: z.enum(["commissioner", "other"]).nullable().optional(),
  tipoPessoa: z.enum(["fisica", "juridica"]).nullable().optional(),
  creci: z.string().trim().max(50).nullable().optional(),
  papel: z
    .enum([
      "imobiliaria_principal",
      "captador",
      "intermediador",
      "indicador",
      "outro",
    ])
    .nullable()
    .optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  bankName: z.string().trim().max(80).nullable().optional(),
  bankBranch: z.string().trim().max(20).nullable().optional(),
  bankAccount: z.string().trim().max(30).nullable().optional(),
  bankAccountType: z.enum(["corrente", "poupanca"]).nullable().optional(),
  bankHolderName: z.string().trim().max(200).nullable().optional(),
  bankHolderDoc: z.string().trim().max(18).nullable().optional(),
  // Preferências de notificação do corretor (2026-07). Aditivo.
  notifyByEmail: z.boolean().optional(),
  notifyByWhatsapp: z.boolean().optional(),
  notifyOptOut: z.boolean().optional(),
  // Atribuição da imobiliária ao agente Max: "este corretor é da minha casa".
  // Aditivo e independente das preferências de notificação acima — ver o
  // comentário do campo em schema.prisma.
  maxEnabled: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.SPLIT_CONFIGURE,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const existing = await prisma.splitRecipient.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Recipient não encontrado" }, { status: 404 });
  }

  const patchData = { ...parsed.data };
  // Validação estrita SÓ no que mudou: o form público grava soft (telefone cru,
  // CRECI verbatim) e o sheet reenvia todos os campos — validar valor idêntico
  // ao já gravado tornaria registros legados ineditáveis (422 num campo que o
  // admin nem tocou).
  if (typeof patchData.cpfCnpj === "string") {
    // Digits-only: o partial unique de commissioner compara normalizado.
    patchData.cpfCnpj = patchData.cpfCnpj.replace(/\D/g, "") || null;
    if (
      patchData.cpfCnpj &&
      patchData.cpfCnpj !== existing.cpfCnpj &&
      !isValidCpfCnpj(patchData.cpfCnpj)
    ) {
      return NextResponse.json(
        { error: "CPF/CNPJ inválido (dígito verificador não confere)" },
        { status: 422 }
      );
    }
  }
  if (
    typeof patchData.creci === "string" &&
    patchData.creci &&
    patchData.creci !== existing.creci &&
    !isValidCreci(patchData.creci)
  ) {
    return NextResponse.json(
      { error: "CRECI inválido — use o número, com UF/sufixo opcionais (ex.: 12345-F ou SP-12345)" },
      { status: 422 }
    );
  }
  if (typeof patchData.phone === "string" && patchData.phone !== existing.phone) {
    const phoneNorm = normalizePhoneForStorage(patchData.phone);
    if (phoneNorm.invalid) {
      return NextResponse.json(
        { error: "Telefone inválido — use DDD + número (ex.: (11) 98765-4321)" },
        { status: 422 }
      );
    }
    patchData.phone = phoneNorm.value;
  }
  if (typeof patchData.email === "string") {
    patchData.email = normalizeEmail(patchData.email);
  }
  // Reativar desarquiva. Sem isto, "Reativar" na tela devolvia `active: true` e
  // o cadastro continuava sumido do picker do formulário, que agora filtra por
  // `archivedAt` — o admin veria o corretor reativado e o corretor seguiria
  // invisível, que é a mesma queixa por outro caminho.
  if (patchData.active === true) {
    (patchData as { archivedAt?: Date | null }).archivedAt = null;
  }

  // Dedupe no PATCH: o partial unique do banco só cobre commissioners ATIVOS —
  // editar um RASCUNHO pro CPF/CNPJ de um corretor existente criava duplicata
  // silenciosa (o POST tem este pre-check desde sempre; o PATCH não tinha).
  const nextDoc = typeof patchData.cpfCnpj === "string" ? patchData.cpfCnpj : undefined;
  const nextKind = patchData.kind === undefined ? existing.kind : patchData.kind;
  if (nextDoc && nextDoc !== existing.cpfCnpj && nextKind === "commissioner") {
    const dup = await prisma.splitRecipient.findFirst({
      where: { orgId: ctx.orgId, kind: "commissioner", cpfCnpj: nextDoc, id: { not: id } },
      select: { id: true, label: true, active: true },
    });
    if (dup) {
      return NextResponse.json(
        {
          error: `Já existe um corretor cadastrado com este CPF/CNPJ ("${dup.label}"${dup.active ? "" : ", inativo"})`,
          existingId: dup.id,
        },
        { status: 409 }
      );
    }
  }

  let updated;
  try {
    updated = await prisma.splitRecipient.update({
      where: { id },
      data: patchData,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Reativar/editar colidiu com outro commissioner ativo de mesmo CPF/CNPJ
      // (partial unique) ou com walletId/pixAddressKey existente.
      return NextResponse.json(
        { error: "Já existe um cadastro ativo com este CPF/CNPJ, wallet ou chave PIX" },
        { status: 409 }
      );
    }
    throw err;
  }

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "SPLIT_RECIPIENT_UPDATED",
      result: "SUCCESS",
      resourceType: "split_recipient",
      resource: `split_recipient:${updated.id}`,
      metadata: parsed.data,
    }
  );

  return NextResponse.json({ recipient: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.SPLIT_CONFIGURE,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const existing = await prisma.splitRecipient.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Recipient não encontrado" }, { status: 404 });
  }

  // Soft delete — preserva histórico de splits que já referenciam esse walletId.
  // `archivedAt` é o que marca a EXCLUSÃO; `active: false` continua sendo
  // gravado porque é o critério de pagabilidade que o splitDispatcher lê. Antes
  // só havia o booleano, e ele ficava indistinguível do rascunho que nasce
  // inativo por falta de meio de repasse — foi assim que o picker do formulário
  // escondeu 40 dos 42 corretores da org.
  const updated = await prisma.splitRecipient.update({
    where: { id },
    data: { active: false, archivedAt: new Date() },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "SPLIT_RECIPIENT_DELETED",
      result: "SUCCESS",
      resourceType: "split_recipient",
      resource: `split_recipient:${updated.id}`,
    }
  );

  return NextResponse.json({ recipient: updated });
}
