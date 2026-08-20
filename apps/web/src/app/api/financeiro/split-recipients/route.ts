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
import { detectPixKeyType } from "@/lib/asaas/pix";
import { findCommissionerMatch } from "@/lib/asaas/commissioner-registry";
import {
  isValidCpfCnpj,
  isValidCreci,
  normalizeEmail,
  normalizePhoneForStorage,
} from "@/lib/validators/corretor";

const baseSchema = z.object({
  label: z.string().trim().min(1).max(120),
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
  // Pagadoria v2 — rascunho. Quando não-vazio, força active:false e
  // permite campos críticos (pixAddressKey/walletId) virem vazios.
  pendingFields: z.array(z.string()).max(10).optional(),
  // Cadastro reutilizável de comissionado (2026-05-16). Aditivo.
  kind: z.enum(["commissioner", "other"]).optional(),
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

const walletSchema = baseSchema.extend({
  recipientType: z.literal("asaas_wallet").default("asaas_wallet"),
  walletId: z.string().trim().max(200).optional().default(""),
});

const pixSchema = baseSchema.extend({
  recipientType: z.literal("pix_external"),
  pixAddressKey: z.string().trim().max(200).optional().default(""),
  ownerName: z.string().trim().min(1).max(200),
  ownerCpfCnpj: z.string().trim().min(11).max(18),
});

const createSchema = z.discriminatedUnion("recipientType", [walletSchema, pixSchema]);

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.SPLIT_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  // Filtros opcionais: ?kind=commissioner (tela /corretores e autocompletes
  // autenticados) e ?q= busca por nome/doc/CRECI.
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const q = (searchParams.get("q") ?? "").trim();
  const where: Prisma.SplitRecipientWhereInput = { orgId: ctx.orgId };
  if (kind === "commissioner" || kind === "other") where.kind = kind;
  if (q) {
    where.OR = [
      { label: { contains: q, mode: "insensitive" } },
      { cpfCnpj: { contains: q.replace(/\D/g, "") } },
      { ownerCpfCnpj: { contains: q.replace(/\D/g, "") } },
      { creci: { contains: q, mode: "insensitive" } },
    ];
  }

  const recipients = await prisma.splitRecipient.findMany({
    where,
    orderBy: [{ active: "desc" }, { label: "asc" }],
  });

  return NextResponse.json({ recipients });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

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
  // Default recipientType pra asaas_wallet quando ausente (back-compat com clients antigos)
  if (!raw.recipientType) raw.recipientType = "asaas_wallet";
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const isPix = data.recipientType === "pix_external";
  const pendingFields = data.pendingFields ?? [];
  const isDraft = pendingFields.length > 0;

  // Dígito verificador: o Zod acima só valida tamanho — sem isto, doc lixo
  // entra e o dedupe por documento deixa de proteger. (O form público NÃO tem
  // esta checagem de propósito: origem anônima grava soft e o admin corrige.)
  if (data.cpfCnpj && !isValidCpfCnpj(data.cpfCnpj)) {
    return NextResponse.json(
      { error: "CPF/CNPJ inválido (dígito verificador não confere)" },
      { status: 422 }
    );
  }
  if (data.creci && !isValidCreci(data.creci)) {
    return NextResponse.json(
      { error: "CRECI inválido — use o número, com UF/sufixo opcionais (ex.: 12345-F ou SP-12345)" },
      { status: 422 }
    );
  }
  // Telefone: grava E.164 (+55…) — formato que o Max/notify comparam na leitura.
  const phoneNorm = normalizePhoneForStorage(data.phone);
  if (phoneNorm.invalid) {
    return NextResponse.json(
      { error: "Telefone inválido — use DDD + número (ex.: (11) 98765-4321)" },
      { status: 422 }
    );
  }

  // Validações relaxadas para rascunho (campos críticos podem vir vazios)
  if (!isDraft) {
    if (isPix && (!data.pixAddressKey || data.pixAddressKey.trim() === "")) {
      return NextResponse.json(
        { error: "Chave PIX obrigatória (ou marque pendingFields=['pixAddressKey'] para rascunho)" },
        { status: 400 }
      );
    }
    if (!isPix && (!data.walletId || data.walletId.trim() === "")) {
      return NextResponse.json(
        { error: "walletId obrigatório (ou marque pendingFields=['walletId'] para rascunho)" },
        { status: 400 }
      );
    }
  }

  // Dedupe de corretor por CPF/CNPJ: o partial unique do banco só cobre
  // commissioners ATIVOS — rascunhos (pendingFields) dependem deste pre-check.
  // Só doc (nome homônimo é plausível entre pessoas distintas). Inclui
  // inativos de propósito: recriar um desativado deve virar reativação.
  if ((data.kind ?? "commissioner") === "commissioner" && data.cpfCnpj) {
    const dup = await findCommissionerMatch(ctx.orgId, {
      nome: null,
      cpf: data.tipoPessoa === "juridica" ? null : data.cpfCnpj,
      cnpj: data.tipoPessoa === "juridica" ? data.cpfCnpj : null,
    });
    if (dup) {
      return NextResponse.json(
        {
          error: `Já existe um corretor cadastrado com este CPF/CNPJ ("${dup.label}"${dup.active ? "" : ", inativo — reative-o"})`,
          existingId: dup.id,
        },
        { status: 409 }
      );
    }
  }

  // Para PIX, detectar tipo da chave automaticamente (apenas quando preenchida)
  let pixKeyType: string | null = null;
  if (isPix && data.pixAddressKey && data.pixAddressKey.trim() !== "") {
    pixKeyType = detectPixKeyType(data.pixAddressKey);
    if (!pixKeyType) {
      return NextResponse.json(
        { error: "Chave PIX inválida — formato não reconhecido (use CPF, CNPJ, email, telefone ou EVP)" },
        { status: 400 }
      );
    }
  }

  try {
    const created = await prisma.splitRecipient.create({
      data: {
        orgId: ctx.orgId,
        label: data.label,
        recipientType: data.recipientType,
        walletId: isPix ? null : (data.walletId && data.walletId.trim() !== "" ? data.walletId : null),
        pixAddressKey: isPix && data.pixAddressKey && data.pixAddressKey.trim() !== "" ? data.pixAddressKey : null,
        pixKeyType: pixKeyType,
        ownerName: isPix ? data.ownerName : null,
        ownerCpfCnpj: isPix ? data.ownerCpfCnpj : null,
        // Digits-only: o partial unique de commissioner compara normalizado.
        cpfCnpj: data.cpfCnpj ? data.cpfCnpj.replace(/\D/g, "") || null : null,
        description: data.description ?? null,
        email: normalizeEmail(data.email),
        pendingFields,
        // Rascunho não pode ser usado em cobranças até completar
        active: !isDraft,
        // Aditivos 2026-05-16 — cadastro reutilizável de comissionado.
        kind: data.kind ?? undefined,
        tipoPessoa: data.tipoPessoa ?? undefined,
        creci: data.creci ?? undefined,
        papel: data.papel ?? undefined,
        phone: data.phone === undefined ? undefined : phoneNorm.value,
        bankName: data.bankName ?? undefined,
        bankBranch: data.bankBranch ?? undefined,
        bankAccount: data.bankAccount ?? undefined,
        bankAccountType: data.bankAccountType ?? undefined,
        bankHolderName: data.bankHolderName ?? undefined,
        bankHolderDoc: data.bankHolderDoc ?? undefined,
        notifyByEmail: data.notifyByEmail ?? undefined,
        notifyByWhatsapp: data.notifyByWhatsapp ?? undefined,
        notifyOptOut: data.notifyOptOut ?? undefined,
        maxEnabled: data.maxEnabled ?? undefined,
      },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "SPLIT_RECIPIENT_CREATED",
        result: "SUCCESS",
        resourceType: "split_recipient",
        resource: `split_recipient:${created.id}`,
        metadata: {
          label: created.label,
          recipientType: created.recipientType,
          walletId: created.walletId ?? undefined,
          pixKeyType: created.pixKeyType ?? undefined,
        },
      }
    );

    return NextResponse.json({ recipient: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[] | string | undefined) ?? [];
      const targetStr = Array.isArray(target) ? target.join(",") : String(target);
      const dupField = targetStr.includes("pixAddressKey")
        ? "Chave PIX"
        : targetStr.includes("cpf") || targetStr.includes("commissioner")
          ? "CPF/CNPJ (corretor)"
          : "Wallet ID";
      return NextResponse.json(
        { error: `${dupField} já cadastrado nesta organização` },
        { status: 409 }
      );
    }
    throw err;
  }
}
