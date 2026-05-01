import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { addRequirement, addSigner } from "@/lib/clicksign/envelopes";
import { ClicksignError } from "@/lib/clicksign/client";
import { isValidEmail } from "@/lib/clicksign/mapping";
import type { AuthMethod, SourceKind } from "@/lib/clicksign/types";

export const runtime = "nodejs";

const addSchema = z.object({
  name: z.string().min(2),
  email: z.string().refine((v) => isValidEmail(v), "E-mail inválido"),
  documentation: z.string().optional(),
  phone: z.string().optional(),
  sourceKind: z.enum(["vendedor", "comprador"]),
  sourceIndex: z.number().int().min(0),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; envelopeId: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => ({}));
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: params.envelopeId, orgId: ctx.orgId },
  });
  if (!envelope || envelope.contractId !== params.id) {
    return NextResponse.json({ error: "Envelope não encontrado" }, { status: 404 });
  }
  if (envelope.status !== "draft" && envelope.status !== "running") {
    return NextResponse.json(
      { error: "Envelope não permite adicionar signatários neste estado" },
      { status: 400 }
    );
  }

  const authMethod = (envelope.authMethod as AuthMethod) ?? "email";
  const documentation = parsed.data.documentation
    ? parsed.data.documentation.replace(/\D+/g, "")
    : undefined;
  const phone = parsed.data.phone
    ? parsed.data.phone.replace(/\D+/g, "")
    : undefined;

  const localSigner = await prisma.envelopeSigner.create({
    data: {
      envelopeId: envelope.id,
      sourceKind: parsed.data.sourceKind as SourceKind,
      sourceIndex: parsed.data.sourceIndex,
      name: parsed.data.name,
      email: parsed.data.email,
      documentation,
      phone,
      authMethod,
      status: "pending",
    },
  });

  if (envelope.clicksignId && envelope.documentClicksignId) {
    try {
      const signerResp = await addSigner({
        envelopeId: envelope.clicksignId,
        name: parsed.data.name,
        email: parsed.data.email,
        documentation,
        phoneNumber: phone,
        hasDocumentation: Boolean(documentation),
        communicateBy: authMethod === "whatsapp" ? "whatsapp" : "email",
      });
      const signerId = pickId(signerResp);
      if (!signerId) throw new Error("Resposta sem id de signer");

      const authReq = await addRequirement({
        envelopeId: envelope.clicksignId,
        documentClicksignId: envelope.documentClicksignId,
        signerClicksignId: signerId,
        action: "provide_evidence",
        auth: authMethod,
      });
      const signReq = await addRequirement({
        envelopeId: envelope.clicksignId,
        documentClicksignId: envelope.documentClicksignId,
        signerClicksignId: signerId,
        action: "qualify",
        role: "sign",
      });
      const reqIds = [pickId(authReq), pickId(signReq)].filter(Boolean) as string[];

      await prisma.envelopeSigner.update({
        where: { id: localSigner.id },
        data: {
          clicksignId: signerId,
          requirementIds: reqIds,
          status: envelope.status === "running" ? "notified" : "pending",
          notifiedAt: envelope.status === "running" ? new Date() : null,
        },
      });
    } catch (err) {
      // Cleanup local row se falhou na Clicksign
      await prisma.envelopeSigner.delete({ where: { id: localSigner.id } });
      if (err instanceof ClicksignError) {
        return NextResponse.json(
          { error: `Clicksign: ${err.message}` },
          { status: 502 }
        );
      }
      throw err;
    }
  }

  const fresh = await prisma.envelopeSigner.findUnique({
    where: { id: localSigner.id },
  });
  return NextResponse.json({ signer: fresh }, { status: 201 });
}

function pickId(resp: unknown): string | null {
  if (!resp || typeof resp !== "object") return null;
  const data = (resp as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return (data[0] as { id?: string } | undefined)?.id ?? null;
  }
  return (data as { id?: string } | undefined)?.id ?? null;
}
