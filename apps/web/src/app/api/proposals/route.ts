import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { assertModuleEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { moduleForSchemaType } from "@/lib/modules/resolve";
import { getEffectivePermissions, proposalScopeWhere, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { generateProposalToken } from "@/lib/proposals/token";
import { computeDedupeKey } from "@/lib/proposals/signer-dedupe";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";

const SCHEMA_TYPES = [
  "compra_venda_v1",
  "locacao_residencial_v1",
  "locacao_comercial_v1",
] as const;

function kindForSchema(schemaType: string): "venda" | "locacao" {
  return schemaType === "compra_venda_v1" ? "venda" : "locacao";
}

const signerSchema = z.object({
  role: z.enum(["proponente", "vendedor", "conjuge", "testemunha"]),
  name: z.string().min(1),
  email: z.string().optional().nullable(),
  cpf: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  notifyChannel: z.enum(["email", "whatsapp", "sms"]).optional(),
  signingGroup: z.number().int().optional(),
});

const createSchema = z.object({
  title: z.string().min(1),
  schemaType: z.enum(SCHEMA_TYPES),
  dataJson: z.record(z.unknown()).default({}),
  propertyId: z.string().optional(),
  leaseClientId: z.string().optional(),
  tenantId: z.string().optional(),
  validUntil: z.string().datetime().optional(),
  comissaoIncluida: z.boolean().optional(),
  signers: z.array(signerSchema).optional(),
});

async function moduleGuard(orgId: string, schemaType: string) {
  await assertModuleEnabled(orgId, moduleForSchemaType(schemaType));
}

// GET /api/proposals — lista escopada (corretor vê só as dele).
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  const scope = proposalScopeWhere(eff);
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const kind = url.searchParams.get("kind");

  const proposals = await prisma.proposal.findMany({
    where: {
      ...scope,
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ proposals });
}

// POST /api/proposals — cria rascunho.
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "proposals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const eff = await getEffectivePermissions(auth.actor.effectiveUserId, auth.org.id);
  if (!can(eff, PERMISSION.PROPOSAL_CREATE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const input = parsed.data;

  try {
    await moduleGuard(auth.org.id, input.schemaType);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }

  const result = await withIdempotency({
    userId: auth.actor.effectiveUserId,
    key: req.headers.get("x-idempotency-key"),
    method: "POST",
    path: "/api/proposals",
    handler: async () => {
      const proposal = await prisma.proposal.create({
        data: {
          orgId: auth.org.id,
          userId: auth.actor.effectiveUserId,
          schemaType: input.schemaType,
          kind: kindForSchema(input.schemaType),
          title: input.title,
          status: "rascunho",
          token: generateProposalToken(),
          dataJson: input.dataJson as Prisma.InputJsonValue,
          comissaoIncluida: input.comissaoIncluida ?? false,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          propertyId: input.propertyId ?? null,
          leaseClientId: input.leaseClientId ?? null,
          tenantId: input.tenantId ?? null,
          signers: input.signers?.length
            ? {
                create: input.signers.map((s) => ({
                  role: s.role,
                  name: s.name,
                  email: s.email || null,
                  cpf: s.cpf || null,
                  phone: s.phone || null,
                  notifyChannel: s.notifyChannel ?? "email",
                  // Proponente assina primeiro (grupo 1); demais no grupo 2.
                  signingGroup: s.signingGroup ?? (s.role === "proponente" ? 1 : 2),
                  dedupeKey: computeDedupeKey({
                    name: s.name,
                    email: s.email,
                    cpf: s.cpf,
                    phone: s.phone,
                  }),
                })),
              }
            : undefined,
        },
      });
      await audit(
        extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
        {
          action: "PROPOSAL_CREATE",
          result: "SUCCESS",
          resource: proposal.id,
          resourceType: "Proposal",
          metadata: mergeAuditMetadata({ kind: proposal.kind }, auth.actor),
        }
      ).catch(() => {});
      return { status: 201, body: { proposal } };
    },
  });
  return NextResponse.json(result.body, { status: result.status });
}
