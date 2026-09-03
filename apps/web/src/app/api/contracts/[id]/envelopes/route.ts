import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CLICKSIGN_ROLES } from "@/lib/clicksign/roles";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  sendEnvelopeForContract,
  MissingEmailsError,
} from "@/lib/clicksign/executor";
import { EnvelopePlanLimitError } from "@/lib/clicksign/quota";
import { ClicksignError } from "@/lib/clicksign/client";
import {
  ClickSignNotConfiguredError,
  AuthMethodNotAllowedError,
} from "@/lib/clicksign/account";
import { buildEnvelopeSendPreview } from "@/lib/clicksign/preview";
import {
  collectInspectionExtraDocuments,
  linkInspectionsToEnvelope,
} from "@/lib/locacao/inspection-signature";
import { requireApproval, approvalResponse } from "@/lib/api/intents";
import { guardContractScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const sendSchema = z.object({
  authMethod: z.enum(["email", "whatsapp", "selfie", "icp_brasil"]).optional(),
  envelopeName: z.string().min(1).max(200).optional(),
  deadlineAt: z.string().datetime().optional(),
  signerRoles: z
    .array(
      z.object({
        sourceKind: z.enum([
          "vendedor",
          "comprador",
          "testemunha",
          "corretora",
          "locador",
          "locatario",
          "fiador",
        ]),
        sourceIndex: z.number().int().nonnegative(),
        subKind: z
          .enum(["titular", "conjuge", "procurador", "representante", "avulso"])
          .optional(),
        // Fonte única: lib/clicksign/roles.ts (antes havia 3 cópias literais
        // desta lista, que divergiam a cada qualificação nova).
        role: z.enum(CLICKSIGN_ROLES),
      })
    )
    .optional(),
  // Lista explícita de signatários (popup de envio). Autoritativa quando
  // presente: o executor usa esta lista no lugar da derivação por dataJson,
  // deixando o operador remover/adicionar quem assina ESTE envelope.
  signers: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        email: z.string().email(),
        // Só dígitos: CPF (11) ou CNPJ (14). Vazio/ausente é aceito.
        documentation: z
          .string()
          .regex(/^(\d{11}|\d{14})$/)
          .optional()
          .nullable(),
        phone: z.string().max(20).optional().nullable(),
        sourceKind: z.string().max(40).optional(),
        sourceIndex: z.number().int().nonnegative().optional(),
        subKind: z
          .enum(["titular", "conjuge", "procurador", "representante", "avulso"])
          .optional(),
        role: z.enum(CLICKSIGN_ROLES).optional(),
        group: z.number().int().positive().optional().nullable(),
      })
    )
    .max(30)
    .optional(),
  // Vistorias cujo laudo vai JUNTO no mesmo envelope (locação). A ClickSign
  // cobra por signatário, não por documento — anexar o laudo aqui evita o 2º
  // envelope (e a 2ª cobrança por assinante) do envio avulso.
  inspectionIds: z.array(z.string().min(1).max(40)).max(5).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuth(req, { scope: "signatures:r" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const contract = await prisma.contract.findFirst({
    where: { id: params.id, deal: { pipeline: { orgId: ctx.orgId } } },
    select: { id: true },
  });
  if (!contract) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 }
    );
  }

  // Escopo do gerente (lista de envelopes = PII dos signatários).
  const denied = await guardContractScope({
    contractId: params.id,
    userId: ctx.userId,
    orgId: ctx.orgId,
    via: ctx.via,
  });
  if (denied) return denied;

  const envelopes = await prisma.envelope.findMany({
    where: { contractId: params.id },
    include: {
      signers: { orderBy: [{ sourceKind: "asc" }, { sourceIndex: "asc" }] },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ envelopes });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuth(req, { scope: "signatures:rw" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => ({}));
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const contract = await prisma.contract.findFirst({
    where: { id: params.id, deal: { pipeline: { orgId: ctx.orgId } } },
    select: { id: true, status: true, dealId: true },
  });
  if (!contract) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 }
    );
  }
  // Escopo do gerente + ENVELOPE_SEND (envio custa dinheiro por signatário).
  const denied = await guardContractScope({
    contractId: params.id,
    userId: ctx.userId,
    orgId: ctx.orgId,
    via: ctx.via,
    permission: PERMISSION.ENVELOPE_SEND,
  });
  if (denied) return denied;

  if (contract.status !== "aprovado") {
    return NextResponse.json(
      { error: "Contrato precisa estar aprovado antes de enviar para assinatura" },
      { status: 400 }
    );
  }

  // Bearer → cria intent. Session → executa direto.
  if (ctx.via === "bearer") {
    const preview = await buildEnvelopeSendPreview({
      contractId: params.id,
      orgId: ctx.orgId,
      authMethod: parsed.data.authMethod,
      envelopeName: parsed.data.envelopeName,
      deadlineAt: parsed.data.deadlineAt ?? null,
    });
    if ("error" in preview) {
      return NextResponse.json(
        { error: preview.error },
        { status: preview.status }
      );
    }

    const idempotencyKey = req.headers.get("x-idempotency-key");
    const result = await requireApproval<unknown>({
      ctx: {
        via: ctx.via,
        userId: ctx.userId,
        orgId: ctx.orgId,
        actor: ctx.actor,
      },
      action: "ENVELOPE_SEND",
      payload: {
        contractId: params.id,
        authMethod: parsed.data.authMethod,
        envelopeName: parsed.data.envelopeName,
        deadlineAt: parsed.data.deadlineAt,
      },
      preview: {
        summary: preview.summary,
        details: preview.details as unknown as Record<string, unknown>,
      },
      req,
      idempotencyKey,
      run: async () => {
        try {
          // Caminho bearer (Newton): NÃO encaminha `signers` explícitos — o
          // preview (HITL) foi montado a partir do dataJson, então o envio tem
          // que derivar dos MESMOS dados pra não divergir do que foi aprovado.
          // A lista explícita de signatários é exclusiva do caminho de sessão
          // (popup de envio), que não passa por preview.
          const envelope = await sendEnvelopeForContract({
            contractId: params.id,
            authMethod: parsed.data.authMethod,
            envelopeName: parsed.data.envelopeName,
            deadlineAt: parsed.data.deadlineAt
              ? new Date(parsed.data.deadlineAt)
              : null,
            signerRoles: parsed.data.signerRoles,
          });
          return { status: 201, body: { envelope } };
        } catch (err) {
          return clicksignErrorToResponse(err);
        }
      },
    });
    return approvalResponse(result);
  }

  // Laudos de vistoria que viajam no MESMO envelope (locação). Resolvidos
  // server-side a partir dos ids: o cliente não escolhe arquivo, só a vistoria —
  // o helper valida org + mesmo deal + laudo pronto. Exclusivo do caminho de
  // sessão: o bearer (Newton) envia o que foi aprovado no preview.
  let extraDocuments;
  let inspectionIds: string[] = [];
  if (parsed.data.inspectionIds && parsed.data.inspectionIds.length > 0) {
    const collected = await collectInspectionExtraDocuments({
      orgId: ctx.orgId,
      dealId: contract.dealId,
      inspectionIds: parsed.data.inspectionIds,
    });
    if (!collected.ok) {
      return NextResponse.json({ error: collected.error }, { status: 422 });
    }
    extraDocuments = collected.documents;
    inspectionIds = collected.inspectionIds;
  }

  // Session: comportamento atual. Passa signerRoles (papéis "Assina como" +
  // ordem escolhidos na popup) — sem isso o executor cairia no default por
  // sourceKind e ignoraria o que o usuário selecionou.
  try {
    const envelope = await sendEnvelopeForContract({
      contractId: params.id,
      authMethod: parsed.data.authMethod,
      envelopeName: parsed.data.envelopeName,
      deadlineAt: parsed.data.deadlineAt
        ? new Date(parsed.data.deadlineAt)
        : null,
      signerRoles: parsed.data.signerRoles,
      signers: parsed.data.signers,
      extraDocuments,
    });
    // Só depois do envelope existir: as vistorias passam a apontar pra ele, e os
    // ganchos de close/cancel (que resolvem por `Inspection.envelopeId`) fecham
    // ou revertem o laudo junto com o contrato.
    await linkInspectionsToEnvelope(inspectionIds, envelope.id);
    return NextResponse.json({ envelope }, { status: 201 });
  } catch (err) {
    if (err instanceof ClickSignNotConfiguredError) {
      return NextResponse.json(
        { error: err.message, code: "CLICKSIGN_NOT_CONFIGURED" },
        { status: 409 }
      );
    }
    if (err instanceof AuthMethodNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof MissingEmailsError) {
      return NextResponse.json(
        {
          error: "Partes sem e-mail",
          missing: err.missing,
        },
        { status: 422 }
      );
    }
    if (err instanceof EnvelopePlanLimitError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 402 }
      );
    }
    if (err instanceof ClicksignError) {
      return NextResponse.json(
        { error: `Clicksign: ${err.message}`, status: err.status },
        { status: 502 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[envelopes POST] erro:", msg);
    return NextResponse.json(
      { error: msg || "Erro interno" },
      { status: 500 }
    );
  }
}

/** Converte erros do executor em RunResult pra reuso no run() de requireApproval. */
function clicksignErrorToResponse(err: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  if (err instanceof ClickSignNotConfiguredError) {
    return {
      status: 409,
      body: { error: err.message, code: "CLICKSIGN_NOT_CONFIGURED" },
    };
  }
  if (err instanceof AuthMethodNotAllowedError) {
    return { status: 422, body: { error: err.message } };
  }
  if (err instanceof MissingEmailsError) {
    return {
      status: 422,
      body: { error: "Partes sem e-mail", missing: err.missing },
    };
  }
  if (err instanceof EnvelopePlanLimitError) {
    return { status: 402, body: { error: err.message, code: err.code } };
  }
  if (err instanceof ClicksignError) {
    return {
      status: 502,
      body: { error: `Clicksign: ${err.message}`, status: err.status },
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[envelopes POST] erro:", msg);
  return { status: 500, body: { error: msg || "Erro interno" } };
}
