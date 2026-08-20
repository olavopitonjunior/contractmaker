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
import {
  isValidCpfCnpj,
  isValidCreci,
  normalizeEmail,
  normalizePhoneForStorage,
} from "@/lib/validators/corretor";

export const runtime = "nodejs";

/**
 * POST /api/financeiro/split-recipients/bulk-import
 *
 * Cria N SplitRecipients em uma transaction. Cada linha pode falhar
 * individualmente (ex: chave PIX inválida ou duplicata) — retornamos
 * `{created, skipped, errors}` ao invés de all-or-nothing.
 *
 * Linha CSV: nome,cpf_cnpj,tipo,wallet_ou_chave,label?,email?,phone?,creci?,papel?,notify_email?,notify_whatsapp?
 * onde tipo = "wallet" | "pix"
 */
const lineSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  cpfCnpj: z.string().trim().min(11).max(18),
  tipo: z.enum(["wallet", "pix"]),
  walletOuChave: z.string().trim().min(1).max(200),
  label: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  // Campos de corretor (2026-08) — o import nascia incompleto sem eles.
  phone: z.string().trim().max(30).optional(),
  creci: z.string().trim().max(50).optional(),
  papel: z
    .enum(["imobiliaria_principal", "captador", "intermediador", "indicador", "outro"])
    .optional(),
  tipoPessoa: z.enum(["fisica", "juridica"]).optional(),
  notifyByEmail: z.boolean().optional(),
  notifyByWhatsapp: z.boolean().optional(),
});

const bodySchema = z.object({
  rows: z.array(lineSchema).min(1).max(100),
});

interface ImportResult {
  created: Array<{ id: string; label: string }>;
  errors: Array<{ row: number; reason: string; rawNome?: string }>;
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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const result: ImportResult = { created: [], errors: [] };

  for (const [i, row] of parsed.data.rows.entries()) {
    try {
      // Mesmas regras do cadastro individual (lib/validators/corretor).
      const doc = row.cpfCnpj.replace(/\D/g, "");
      if (!isValidCpfCnpj(doc)) {
        result.errors.push({ row: i + 1, reason: "CPF/CNPJ inválido (dígito verificador)", rawNome: row.nome });
        continue;
      }
      if (row.creci && !isValidCreci(row.creci)) {
        result.errors.push({ row: i + 1, reason: "CRECI inválido", rawNome: row.nome });
        continue;
      }
      const phoneNorm = normalizePhoneForStorage(row.phone);
      if (phoneNorm.invalid) {
        result.errors.push({ row: i + 1, reason: "Telefone inválido (use DDD + número)", rawNome: row.nome });
        continue;
      }
      const corretorFields = {
        phone: phoneNorm.value,
        creci: row.creci?.trim() || null,
        papel: row.papel ?? null,
        tipoPessoa: row.tipoPessoa ?? (doc.length === 14 ? "juridica" : "fisica"),
        notifyByEmail: row.notifyByEmail ?? undefined,
        notifyByWhatsapp: row.notifyByWhatsapp ?? undefined,
      };
      if (row.tipo === "pix") {
        const pixKeyType = detectPixKeyType(row.walletOuChave);
        if (!pixKeyType) {
          result.errors.push({
            row: i + 1,
            reason: "Chave PIX inválida",
            rawNome: row.nome,
          });
          continue;
        }
        const created = await prisma.splitRecipient.create({
          data: {
            orgId: ctx.orgId,
            label: row.label ?? row.nome,
            recipientType: "pix_external",
            pixAddressKey: row.walletOuChave,
            pixKeyType,
            ownerName: row.nome,
            ownerCpfCnpj: row.cpfCnpj,
            cpfCnpj: doc,
            email: normalizeEmail(row.email),
            ...corretorFields,
          },
        });
        result.created.push({ id: created.id, label: created.label });
      } else {
        const created = await prisma.splitRecipient.create({
          data: {
            orgId: ctx.orgId,
            label: row.label ?? row.nome,
            recipientType: "asaas_wallet",
            walletId: row.walletOuChave,
            cpfCnpj: doc,
            email: normalizeEmail(row.email),
            ...corretorFields,
          },
        });
        result.created.push({ id: created.id, label: created.label });
      }
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        result.errors.push({
          row: i + 1,
          reason: "Já cadastrado (chave duplicada)",
          rawNome: row.nome,
        });
        continue;
      }
      result.errors.push({
        row: i + 1,
        reason: err instanceof Error ? err.message : "Erro desconhecido",
        rawNome: row.nome,
      });
    }
  }

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "SPLIT_RECIPIENT_BULK_IMPORT",
      result: result.created.length > 0 ? "SUCCESS" : "FAILURE",
      resourceType: "split_recipient",
      metadata: {
        attempted: parsed.data.rows.length,
        created: result.created.length,
        errored: result.errors.length,
      },
    }
  );

  return NextResponse.json(result, { status: 200 });
}
