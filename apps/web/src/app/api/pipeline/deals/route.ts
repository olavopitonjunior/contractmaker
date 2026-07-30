import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import { z } from "zod";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { assertModuleEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { MODULE } from "@/lib/modules/catalog";
import { getEffectivePermissions, dealScopeWhere } from "@/lib/security/rbac/check";
import { resolveManagerForCreate } from "@/lib/deals/manager";

const createDealSchema = z.object({
  formId: z.string().optional(),
  title: z.string().min(1),
  value: z.number().optional(),
  // Gerente responsável (feature Gerente) — opcional; a org decide se é
  // obrigatório (resolveManagerForCreate devolve 422).
  managerUserId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  try {
    await assertModuleEnabled(auth.org.id, MODULE.VENDAS);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }

  const body = await req.json();
  const parsed = createDealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Gerente responsável resolvido antes da criação (fora da idempotência).
  const manager = await resolveManagerForCreate(
    auth.org.id,
    parsed.data.managerUserId
  );
  if (!manager.ok) {
    return NextResponse.json(
      { error: manager.error, message: manager.message },
      { status: manager.status }
    );
  }

  const idempotencyKey = req.headers.get("x-idempotency-key");

  const result = await withIdempotency({
    userId: auth.actor.effectiveUserId,
    key: idempotencyKey,
    method: "POST",
    path: "/api/pipeline/deals",
    handler: async (): Promise<{ status: number; body: unknown }> => {
      const pipeline = await getPipelineByKind(auth.org.id, MODULE.VENDAS, {
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
          managerUserId: manager.managerUserId,
          sourceChannel: DEAL_SOURCE_CHANNEL.MANUAL,
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

  try {
    await assertModuleEnabled(auth.org.id, MODULE.VENDAS);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }

  const pipeline = await getPipelineByKind(auth.org.id, MODULE.VENDAS);
  if (!pipeline) return NextResponse.json([]);

  // Escopo por usuário (feature Gerente). Bearer/Newton: token é da org —
  // sem scoping por usuário (age como serviço).
  let scope = {};
  if (auth.ident.via !== "bearer") {
    const eff = await getEffectivePermissions(
      auth.actor.effectiveUserId,
      auth.org.id
    );
    const s = dealScopeWhere(eff);
    if (s === null) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    scope = s;
  }

  // Oculta arquivados por padrão; ?includeArchived=true inclui.
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "true";

  const deals = await prisma.deal.findMany({
    where: {
      pipelineId: pipeline.id,
      ...(includeArchived ? {} : { archivedAt: null }),
      ...scope,
    },
    orderBy: { createdAt: "desc" },
    include: {
      stage: true,
      form: { select: { id: true, token: true, status: true } },
      contracts: {
        where: { isLatest: true, kind: "contract" },
        select: { id: true, version: true, status: true },
      },
    },
  });

  return NextResponse.json(deals);
}
