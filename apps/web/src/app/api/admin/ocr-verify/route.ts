/**
 * GET /api/admin/ocr-verify
 *
 * Diz qual modelo de OCR está REALMENTE no ar, para um script poder afirmar
 * isso depois de cada deploy sem abrir navegador.
 *
 * Por que existe: trocar env var no Vercel não garante que o runtime pegou.
 * `vercel redeploy` reaproveita o snapshot de env do deploy anterior — o deploy
 * fica READY servindo o valor VELHO, sem sintoma nenhum. Já aconteceu aqui com
 * `GEMINI_OCR_MODEL`. `/api/health` é público mas não expõe modelo, e
 * `/api/admin/agents` exige cookie de sessão, que script não tem.
 *
 * Auth fail-closed no padrão de `lib/security/cron-auth.ts` (o que os 30+ crons
 * usam): sem secret no ambiente → 503, nunca aberto.
 *
 * Aceita `OPS_VERIFY_SECRET` e cai em `CRON_SECRET` enquanto aquele não existir.
 * A separação importa: `CRON_SECRET` destranca `cron/asaas/transfer-dispatch`
 * (PIX/TED) e `cron/rent/generate`. Este script roda a cada deploy, exportado no
 * shell de quem estiver verificando — que não é necessariamente quem pode mover
 * dinheiro. O que cresce ao compartilhar não é o poder de quem já tem a chave, é
 * a frequência de exposição de uma chave que move dinheiro.
 *
 * **Não devolve segredo.** Chave de API sai só como booleano de presença, e erro
 * de banco sai como código, nunca como mensagem crua — `P1001` do Prisma traz o
 * host, e erro de datasource pode ecoar pedaço de connection string.
 */

import { NextResponse } from "next/server";
import { requireBearerAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { ocrModelFromEnv } from "@/lib/ai/agents/model-provenance";
import { shadowModelFromEnv } from "@/lib/ai/ocr-shadow";
import { isModeloOpenAI } from "@/lib/ai/ocr-openai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `null` = autorizado. Fail-closed: sem secret no ambiente, ninguém entra.
 *
 * Delega para o helper compartilhado de propósito. A versão anterior daqui
 * reimplementava `cron-auth.ts` inteiro por causa de UMA linha (o fallback de
 * env) — e um fix de parsing de header lá nunca chegaria aqui, em silêncio.
 */
const negarAcesso = (req: Request) =>
  requireBearerAuth(
    req,
    ["OPS_VERIFY_SECRET", "CRON_SECRET"],
    "OPS_VERIFY_SECRET/CRON_SECRET não configurado — rota desabilitada"
  );

/** Modelos vistos de verdade, por operação, na janela pedida. */
async function modelosVistos(desde: Date) {
  const grupos = await prisma.aIUsage.groupBy({
    by: ["operation", "model"],
    where: { createdAt: { gte: desde }, operation: { in: ["ocr_form", "ocr_shadow"] } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  return grupos
    .map((g) => ({
      operation: g.operation,
      model: g.model,
      calls: g._count._all,
      lastAt: g._max.createdAt?.toISOString() ?? null,
    }))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

export async function GET(req: Request) {
  const negado = negarAcesso(req);
  if (negado) return negado;

  const url = new URL(req.url);
  // `Number("abc")` é NaN, e o clamp propaga NaN: `new Date(Date.now() - NaN)`
  // vira Invalid Date, o Prisma estoura, o catch engole, e `windowDays` sai
  // como null no JSON — a rota mentiria por omissão justamente onde promete
  // ser prova. Daí o `isFinite` ANTES do clamp.
  const diasBruto = Number(url.searchParams.get("days") ?? 7);
  const dias = Number.isFinite(diasBruto) ? Math.min(Math.max(diasBruto, 1), 90) : 7;
  const desde = new Date(Date.now() - dias * 24 * 60 * 60_000);

  const effectiveModel = ocrModelFromEnv();
  const usaOpenAI = isModeloOpenAI(effectiveModel);

  let vistos: Awaited<ReturnType<typeof modelosVistos>> = [];
  let erroBanco: string | null = null;
  try {
    vistos = await modelosVistos(desde);
  } catch (err) {
    // Banco fora não pode derrubar a verificação de config — o script
    // distingue os dois casos, e config errada é o que urge.
    //
    // Só o CÓDIGO, nunca a mensagem: `P1001` do Prisma é
    // "Can't reach database server at ep-xxx.aws.neon.tech:5432", e erro de
    // datasource pode ecoar pedaço da connection string. Este era o único
    // campo de string não-controlada do payload.
    const code = (err as { code?: unknown })?.code;
    erroBanco = typeof code === "string" && /^P\d{4}$/.test(code) ? code : "unknown";
  }

  return NextResponse.json({
    ocr: {
      effectiveModel,
      structuredOutput: process.env.OCR_STRUCTURED_OUTPUT === "true",
      shadowModel: shadowModelFromEnv(),
      claudeFallbackEnabled: process.env.OCR_CLAUDE_FALLBACK_ENABLED !== "false",
      claudeFallbackModel:
        process.env.OCR_FALLBACK_CLAUDE_MODEL || "claude-haiku-4-5-20251001",
      provider: usaOpenAI ? "openai" : "gemini",
      /**
       * O apagão silencioso: modelo `gpt-*` sem `OPENAI_API_KEY` faz 100% das
       * extrações falharem SEM cair em fallback — o erro "OPENAI_API_KEY nao
       * configurada" não casa nenhum padrão de `shouldTryFallbackModel`.
       */
      providerKeyPresent: usaOpenAI
        ? Boolean(process.env.OPENAI_API_KEY)
        : Boolean(process.env.GEMINI_API_KEY),
    },
    deploy: {
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      stagingMode: process.env.STAGING_MODE === "true",
    },
    runtime: {
      windowDays: dias,
      /** A verdade a posteriori: env declara intenção, isto é prova. */
      modelsSeen: vistos,
      dbError: erroBanco,
    },
  });
}
