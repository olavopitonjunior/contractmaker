import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { assertFeatureEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { FEATURE, MODULE } from "@/lib/modules/catalog";

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, { scope: "documents:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  // Este endpoint cria SalesForm de vendas (schemaType compra_venda_v1).
  // Gate por sub-função Vendas → Formulário público.
  try {
    await assertFeatureEnabled(auth.org.id, FEATURE.VENDAS_FORM_PUBLICO);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }

  const body = await request.json().catch(() => ({}));
  const idempotencyKey = request.headers.get("x-idempotency-key");

  const result = await withIdempotency({
    userId: auth.actor.effectiveUserId,
    key: idempotencyKey,
    method: "POST",
    path: "/api/forms",
    handler: async (): Promise<{ status: number; body: unknown }> => {
      const form = await prisma.salesForm.create({
        data: {
          orgId: auth.org.id,
          title: body.title || null,
          schemaType: "compra_venda_v1",
          dataJson: {},
          status: "rascunho",
        },
      });

      let dealId: string | null = null;
      // Form de vendas → pipeline de vendas (kind="venda"). getPipelineByKind
      // evita pegar o pipeline de locação em orgs com os dois módulos.
      const pipeline = await getPipelineByKind(auth.org.id, MODULE.VENDAS, {
        include: { stages: { orderBy: { position: "asc" } } },
      });

      if (pipeline && pipeline.stages.length > 0) {
        const formularioStage =
          pipeline.stages.find((s) => s.name === "Formulário") ??
          pipeline.stages[0];
        const dealsInStage = await prisma.deal.count({
          where: { stageId: formularioStage.id },
        });

        const deal = await prisma.deal.create({
          data: {
            pipelineId: pipeline.id,
            stageId: formularioStage.id,
            userId: auth.actor.effectiveUserId,
            formId: form.id,
            sourceChannel: DEAL_SOURCE_CHANNEL.FORM_PUBLICO,
            title:
              body.title || `Negocio - ${form.token.slice(0, 8)}`,
            position: dealsInStage,
          },
        });
        dealId = deal.id;
      }

      await audit(
        extractAuditContextFromRequest(
          request,
          auth.org.id,
          auth.actor.effectiveUserId
        ),
        {
          action: "FORM_CREATE",
          result: "SUCCESS",
          resource: form.id,
          resourceType: "SalesForm",
          metadata: mergeAuditMetadata(
            { token: form.token, dealId },
            auth.actor
          ),
        }
      );

      return {
        status: 201,
        body: {
          id: form.id,
          token: form.token,
          url: `/f/${form.token}`,
          dealId,
        },
      };
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth(request, { scope: "documents:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const forms = await prisma.salesForm.findMany({
    where: { orgId: auth.org.id },
    orderBy: { createdAt: "desc" },
    include: { deal: { select: { id: true, title: true } } },
  });

  return NextResponse.json(forms);
}
