import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  resendSignerAction,
  updateSignerAction,
  removeSignerAction,
} from "@/lib/clicksign/signer-actions";
import { CLICKSIGN_ROLES } from "@/lib/clicksign/roles";
import { CLICKSIGN_AUTH_METHODS } from "@/lib/clicksign/types";

export const runtime = "nodejs";

async function loadSigner(
  envelopeId: string,
  signerId: string,
  orgId: string,
  contractId: string
) {
  const signer = await prisma.envelopeSigner.findFirst({
    where: { id: signerId, envelopeId },
    include: { envelope: true },
  });
  if (!signer || signer.envelope.orgId !== orgId) return null;
  if (signer.envelope.contractId !== contractId) return null;
  return signer;
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resend") }),
  z.object({
    action: z.literal("update"),
    name: z.string().min(2).max(120).optional(),
    email: z.string().email().optional(),
    documentation: z
      .string()
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => v === "" || v.length === 11 || v.length === 14, {
        message: "CPF deve ter 11 dígitos ou CNPJ 14",
      })
      .optional(),
    phone: z.string().max(20).optional(),
    role: z.enum(CLICKSIGN_ROLES).optional(),
    authMethod: z.enum(CLICKSIGN_AUTH_METHODS).optional(),
  }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string; signerId: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const signer = await loadSigner(
    params.envelopeId,
    params.signerId,
    ctx.orgId,
    params.id
  );
  if (!signer) {
    return NextResponse.json({ error: "Signatário não encontrado" }, { status: 404 });
  }

  const result =
    parsed.data.action === "resend"
      ? await resendSignerAction(signer)
      : await updateSignerAction(signer, parsed.data);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ signer: result.data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string; signerId: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const signer = await loadSigner(
    params.envelopeId,
    params.signerId,
    ctx.orgId,
    params.id
  );
  if (!signer) {
    return NextResponse.json({ error: "Signatário não encontrado" }, { status: 404 });
  }

  const result = await removeSignerAction(signer);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
