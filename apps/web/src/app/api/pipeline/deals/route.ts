import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";

const createDealSchema = z.object({
  formId: z.string().optional(),
  title: z.string().min(1),
  value: z.number().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json();
  const parsed = createDealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const idempotencyKey = req.headers.get("x-idempotency-key");

  const result = await withIdempotency({
    userId: auth.actor.effectiveUserId,
    key: idempotencyKey,
    method: "POST",
    path: "/api/pipeline/deals",
    handler: async (): Promise<{ status: number; body: unknown }> => {
      const pipeline = await prisma.pipeline.findFirst({
        where: { orgId: auth.org.id },
        include: { stages: { orderBy: { position: "asc" } } },
      });

      if (!pipeline || pipeline.stages.length === 0) {
        return {
          status: 400,
          body: { error: "No pipeline configured" },
        };
      }

      const firstStage = pipeline.stages[0];

      let dataJson = null;
      if (parsed.data.formId) {
        const form = await prisma.salesForm.findUnique({
          where: { id: parsed.data.formId },
        });
        if (form) {
          dataJson = form.dataJson;
          await prisma.salesForm.update({
            where: { id: form.id },
            data: { status: "vinculado" },
          });
        }
      }

      const dealsInStage = await prisma.deal.count({
        where: { stageId: firstStage.id },
      });

      const deal = await prisma.deal.create({
        data: {
          pipelineId: pipeline.id,
          stageId: firstStage.id,
          userId: auth.actor.effectiveUserId,
          formId: parsed.data.formId || null,
          title: parsed.data.title,
          value: parsed.data.value || null,
          dataJson: dataJson ?? undefined,
          position: dealsInStage,
        },
      });

      await audit(
        extractAuditContextFromRequest(
          req,
          auth.org.id,
          auth.actor.effectiveUserId
        ),
        {
          action: "DEAL_CREATE",
          result: "SUCCESS",
          resource: deal.id,
          resourceType: "Deal",
          metadata: mergeAuditMetadata(
            { title: deal.title, stageId: firstStage.id },
            auth.actor
          ),
        }
      );

      return { status: 201, body: deal };
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: auth.org.id },
  });
  if (!pipeline) return NextResponse.json([]);

  const deals = await prisma.deal.findMany({
    where: { pipelineId: pipeline.id },
    orderBy: { createdAt: "desc" },
    include: {
      stage: true,
      form: { select: { id: true, token: true, status: true } },
      contracts: {
        where: { isLatest: true },
        select: { id: true, version: true, status: true },
      },
    },
  });

  return NextResponse.json(deals);
}
