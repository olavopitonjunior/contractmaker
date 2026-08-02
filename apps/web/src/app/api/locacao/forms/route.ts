import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import {
  ensureLocacaoApiAccess,
  isRouteError,
  parseJsonBody,
} from "@/lib/locacao/route-helpers";
import { withIdempotency } from "@/lib/api/idempotency";
import { resolveManagerForCreate } from "@/lib/deals/manager";
import { formPublicPath } from "@/lib/forms/form-url";
import {
  LOCACAO_SCHEMA_TYPE,
  LOCACAO_COMERCIAL_SCHEMA_TYPE,
  comissaoLocacaoSchema,
} from "@/lib/forms/validation-locacao";
import { resolveRequiredPresetSnapshot } from "@/lib/forms/required-snapshot";

// Janela do soft-block de título repetido (recriação manual de card).
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;

export const dynamic = "force-dynamic";

// POST /api/locacao/forms — o OPERADOR cria um formulário público de locação.
// Coleta finalidade (residencial|comercial) + config fiscal/comissão (operador-
// only) e cria SalesForm(schemaType locação) + Deal(kind=locacao) no 1º stage do
// pipeline de locação. O cliente preenche partes/imóvel/aluguel/garantia em
// /f/[token]; o finalize gera o contrato (ver [token]/route.ts).
//
// A comissão (corretagem + angariadores) usa o MESMO schema do dataJson
// (`comissaoLocacaoSchema`) — a duplicata inline divergiu quando o angariador
// ganhou qualificação (cpf/cnpj/creci/contato) e derrubava esses campos no 422.
const bodySchema = z.object({
  finalidade: z.enum(["residencial", "comercial"]).default("residencial"),
  title: z.string().optional(),
  // Confirma a criação apesar do soft-block de título repetido (409).
  force: z.boolean().optional(),
  // Gerente responsável (feature Gerente) — opcional aqui; a obrigatoriedade
  // vem da org via resolveManagerForCreate (422).
  managerUserId: z.string().min(1).optional(),
  fiscal: z
    .object({
      taxa_admin_percent: z.number().min(0).max(100).default(10),
      regime_ir: z
        .enum(["nao_retem", "retem_sem_controle", "retem_imobiliaria", "retem_inquilino"])
        .default("nao_retem"),
      regime_cobranca: z.enum(["mes_vencido", "mes_a_vencer"]).default("mes_a_vencer"),
      isencao_multa_meses: z.number().int().min(0).default(0),
      emitir_nfse: z.boolean().default(false),
      repasse_garantido: z.enum(["nao", "alguns_meses", "todo_contrato"]).default("nao"),
      repasse_garantido_meses: z.number().int().min(0).optional(),
    })
    .optional(),
  comissao: comissaoLocacaoSchema.optional(),
});

export async function POST(req: NextRequest) {
  // `ensureLocacaoApiAccess` (e não `ensureLocacaoAccess`) porque esta rota
  // entra na allowlist M2M: o Max cria formulário de locação por conversa no
  // WhatsApp, como o de vendas já permitia via `POST /api/forms`. Mantém o RBAC
  // e o gate de módulo; muda só quem consegue chegar aqui — Bearer com escopo
  // `locacao:rw`, além da sessão. O caminho de máquina usa sempre o dono do
  // token (`X-Act-As-User` é ignorado neste helper).
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.LEASE_CREATE, {
    scope: "locacao:rw",
  });
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const schemaType =
    d.finalidade === "comercial" ? LOCACAO_COMERCIAL_SCHEMA_TYPE : LOCACAO_SCHEMA_TYPE;

  // Gerente responsável validado ANTES da transação (e da idempotência): 422 se
  // a org exige e o campo veio vazio, 400 se o id não é membro.
  const manager = await resolveManagerForCreate(ctx.orgId, d.managerUserId);
  if (!manager.ok) {
    return NextResponse.json(
      { error: manager.error, message: manager.message },
      { status: manager.status }
    );
  }

  // Idempotência espelhando POST /api/forms (vendas): key ausente executa
  // sempre; key presente replaya a resposta em duplo-clique/retry de rede.
  const idempotencyKey = req.headers.get("x-idempotency-key");

  const outcome = await withIdempotency({
    userId: ctx.userId,
    key: idempotencyKey,
    method: "POST",
    path: "/api/locacao/forms",
    handler: async (): Promise<{ status: number; body: unknown }> => {
      const pipeline = await prisma.pipeline.findFirst({
        where: { orgId: ctx.orgId, kind: "locacao" },
        include: { stages: { orderBy: { position: "asc" } } },
      });
      if (!pipeline || pipeline.stages.length === 0) {
        return {
          status: 412,
          body: {
            error:
              "Pipeline locação não inicializada. Rode seed-pipeline-locacao.ts --apply.",
          },
        };
      }
      // Deal nasce no stage "Formulário" (link público sendo preenchido). "Em
      // Aprovação" (1º stage) fica como coluna manual pré-formulário. Fallback p/
      // o 1º stage se "Formulário" não existir.
      const firstStage =
        pipeline.stages.find((s) => s.name === "Formulário") ?? pipeline.stages[0];

      // Soft-block anti-duplicação (espelha /api/forms): título repetido em
      // janela curta → 409 pro operador confirmar. Re-POST com force:true e
      // key NOVA (o 409 fica cacheado na key antiga).
      const trimmedTitle = d.title?.trim() ?? "";
      if (trimmedTitle && d.force !== true) {
        const recentDup = await prisma.deal.findFirst({
          where: {
            pipelineId: pipeline.id,
            title: trimmedTitle,
            archivedAt: null,
            createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
          },
          select: { id: true, title: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        });
        if (recentDup) {
          return {
            status: 409,
            body: { error: "duplicate_recent", existing: recentDup },
          };
        }
      }

      // Congela o preset de obrigatoriedade vigente (ver required-snapshot.ts):
      // trocar a config depois não muda as exigências deste link.
      const requiredPreset = await resolveRequiredPresetSnapshot(ctx.orgId, schemaType);

      // Título gravado TRIMADO — o dup-check compara contra o armazenado.
      const result = await prisma.$transaction(async (tx) => {
        const form = await tx.salesForm.create({
          data: {
            orgId: ctx.orgId,
            title: trimmedTitle || null,
            schemaType,
            status: "rascunho",
            requiredPreset,
            // Config fiscal/comissão (operador-only) já pré-gravada — o auto-save do
            // cliente faz deep-merge e não toca essas chaves.
            dataJson: {
              finalidade: d.finalidade,
              ...(d.fiscal ? { fiscal: d.fiscal } : {}),
              ...(d.comissao ? { comissao: d.comissao } : {}),
            } as object,
          },
        });

        const dealsInStage = await tx.deal.count({ where: { stageId: firstStage.id } });
        const deal = await tx.deal.create({
          data: {
            pipelineId: pipeline.id,
            stageId: firstStage.id,
            userId: ctx.userId,
            formId: form.id,
            managerUserId: manager.managerUserId,
            kind: "locacao",
            sourceChannel: DEAL_SOURCE_CHANNEL.FORM_PUBLICO,
            title: trimmedTitle || `Locação - ${form.token.slice(0, 8)}`,
            position: dealsInStage,
          },
        });

        return { form, deal };
      });

      await audit(
        { orgId: ctx.orgId, userId: ctx.userId },
        {
          action: "FORM_CREATE",
          result: "SUCCESS",
          resource: result.form.id,
          resourceType: "SalesForm",
          metadata: {
            kind: "locacao",
            schemaType,
            finalidade: d.finalidade,
            token: result.form.token,
            dealId: result.deal.id,
          },
        }
      );

      return {
        status: 201,
        body: {
          id: result.form.id,
          token: result.form.token,
          url: formPublicPath(result.form.token, result.form.title),
          dealId: result.deal.id,
        },
      };
    },
  });

  return NextResponse.json(outcome.body, { status: outcome.status });
}
