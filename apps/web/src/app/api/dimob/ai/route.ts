import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getAnthropicClient, HAIKU_MODEL } from "@/lib/ai/shared/anthropic-client";
import { recordAIUsage, type AIOperation } from "@/lib/ai/usage";
import { parseExtractionJson } from "@/lib/extraction/genai-extract";
import { aggregateSalesForYear } from "@/lib/dimob/aggregate-sales";
import { applyOverrides, type DimobOverrideState } from "@/lib/dimob/apply-overrides";
import { buildReviewRecords, type ReviewRecord } from "@/lib/dimob/build-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["review", "diagnose", "explain"]),
  year: z.number().int().min(2000).max(2100),
  pgdError: z.string().max(4000).optional(),
  recordId: z.string().max(120).optional(),
});

/** Representação compacta dos registros para o prompt (sem bytes reservados). */
function recordsForPrompt(records: ReviewRecord[], onlyId?: string) {
  return records
    .filter((r) => !onlyId || r.recordId === onlyId)
    .map((r) => ({
      recordId: r.recordId,
      registro: r.kind,
      titulo: r.title,
      campos: r.cells
        .filter((c) => c.type !== "reserved" && c.type !== "const")
        .map((c) => `${c.label}: ${c.value || "(vazio)"} [pos ${c.start}-${c.end}, tam ${c.length}]`),
    }));
}

const SYSTEM: Record<"review" | "diagnose" | "explain", string> = {
  review: `Você é auditor da DIMOB (declaração fiscal imobiliária da Receita Federal do Brasil).
Recebe registros já decodificados. Aponte SUSPEITAS que validadores automáticos NÃO pegam:
nome que parece CPF/CNPJ, valor de comissão maior que o valor da venda, data fora do ano-calendário,
CPF/CNPJ possivelmente trocado entre partes, nomes truncados, UF/CEP incoerentes, operações duplicadas.
Não repita erros óbvios de campo vazio (já sinalizados). Seja específico e conciso — no máximo ~15 findings, os mais relevantes.
Responda SOMENTE o JSON, sem markdown nem cercas de código, sem texto antes ou depois.
Se não houver nenhuma suspeita, responda exatamente { "findings": [] }.
Formato: { "findings": [ { "recordId": "...", "field": "...", "severity": "alta"|"media"|"baixa", "message": "...", "suggestion": "..." } ] }`,
  diagnose: `Você é especialista no LEIAUTE do arquivo TXT da DIMOB (programa gerador PGD da Receita).
Recebe (1) a mensagem de erro do PGD e (2) os registros decodificados com posições.
Descubra a que linha/campo o erro se refere e CLASSIFIQUE a causa:
- "dado": o valor está errado/faltando e o usuário deve corrigir o dado.
- "leiaute": a posição/tamanho do campo no arquivo está errada (correção técnica no gerador).
Retorne APENAS um JSON: { "linha": "...", "campo": "...", "classe": "dado"|"leiaute",
"explicacao": "...", "correcao": "...", "layoutSugestao": { "fieldKey": "...", "motivo": "..." } }
(inclua "layoutSugestao" só quando classe = "leiaute").`,
  explain: `Você explica a DIMOB para um leigo. Recebe UM registro decodificado.
Explique em português claro o que cada campo significa e se os valores parecem coerentes.
Retorne APENAS um JSON: { "explicacao": "..." }`,
};

/**
 * Teto de tokens por modo. `review` produz uma LISTA (potencialmente longa) e
 * antes estourava 1500 → JSON truncado → parse falhava e voltava {} (o "Revisar
 * com IA" aparecia como "nenhuma suspeita"). Diagnose/explain são respostas curtas.
 */
const MAX_TOKENS: Record<"review" | "diagnose" | "explain", number> = {
  review: 4096,
  diagnose: 1500,
  explain: 1500,
};

/** Limita quantos registros vão no prompt do review (evita prompt gigante em orgs grandes). */
const REVIEW_RECORD_CAP = 60;

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.REPORT_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { kind, year, pgdError, recordId } = parsed.data;

  if (kind === "diagnose" && !pgdError?.trim()) {
    return NextResponse.json({ error: "Cole a mensagem de erro do PGD." }, { status: 400 });
  }

  // Rebuild server-side (com overrides) — não confia em dados do cliente.
  const agg0 = await aggregateSalesForYear(ctx.orgId, year);
  const ov = await prisma.dimobOverride.findUnique({
    where: { orgId_year: { orgId: ctx.orgId, year } },
  });
  const agg = applyOverrides(agg0, (ov?.state as DimobOverrideState) ?? null);
  const records = buildReviewRecords(agg);

  const truncated = kind === "review" && records.length > REVIEW_RECORD_CAP;
  const promptRecords = truncated ? records.slice(0, REVIEW_RECORD_CAP) : records;
  const payload = recordsForPrompt(promptRecords, kind === "explain" ? recordId : undefined);
  const userContent =
    kind === "diagnose"
      ? `ERRO DO PGD:\n${pgdError}\n\nREGISTROS:\n${JSON.stringify(payload)}`
      : `ANO: ${year}\nREGISTROS:\n${JSON.stringify(payload)}`;

  const operation = `dimob_${kind}` as AIOperation;
  const t0 = Date.now();
  let response;
  try {
    response = await getAnthropicClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: MAX_TOKENS[kind],
      temperature: 0.2,
      system: SYSTEM[kind],
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err) {
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      provider: "anthropic",
      model: HAIKU_MODEL,
      operation,
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Falha ao consultar a IA." }, { status: 502 });
  }

  recordAIUsage({
    orgId: ctx.orgId,
    userId: ctx.userId,
    provider: "anthropic",
    model: HAIKU_MODEL,
    operation,
    promptTokens: response.usage?.input_tokens ?? 0,
    completionTokens: response.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - t0,
    success: true,
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const result = parseExtractionJson(text);
  // A IA respondeu texto mas não deu pra extrair JSON válido (ex.: truncado):
  // sinaliza pro cliente distinguir "falha de parse" de "nenhuma suspeita".
  const parseError = text.trim().length > 0 && Object.keys(result).length === 0;

  return NextResponse.json({ kind, result, parseError, truncated });
}
