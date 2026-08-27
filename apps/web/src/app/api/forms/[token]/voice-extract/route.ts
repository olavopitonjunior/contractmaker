import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { formClosedResponse } from "@/lib/forms/form-gate";
import {
  extractFromVoice,
  SUPPORTED_VOICE_MIMES,
} from "@/lib/ai/voice-extract";
import { RateLimits } from "@/lib/security/ratelimit";
import { isLocacaoSchemaType } from "@/lib/forms/validation-locacao";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024; // 5MB ≈ 5min de webm/opus 64kbps

/**
 * POST /api/forms/[token]/voice-extract
 *
 * Recebe um clipe de áudio gravado pelo VoiceInputButton no step atual
 * e retorna `{ fields: { "vendedores.0.nome": "...", ... } }` pra o
 * cliente aplicar via `form.setValue` path a path.
 *
 * Serve as DUAS esteiras: o token de locação também é um `SalesForm.token`
 * (mesma coisa que as rotas de anexos e de comissionados já fazem). A esteira
 * sai do `schemaType` do próprio form — o cliente não escolhe, senão um link de
 * venda poderia pedir o vocabulário de locação e vice-versa.
 *
 * Público (sem auth) — endpoint do form principal. Rate-limit por token
 * pra evitar abuse e estouro de custo Gemini.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    select: {
      id: true,
      orgId: true,
      schemaType: true,
      status: true,
      completedAt: true,
      reopenedAt: true,
    },
  });
  if (!form) {
    return NextResponse.json({ error: "Form não encontrado" }, { status: 404 });
  }
  // Antes checava `status === "completo"`, que é cego pra "vinculado" (todo
  // form vindo de import/proposta nasce assim e nunca vira "completo").
  // `completedAt` é o discriminador que os dois status setam.
  const closed = await formClosedResponse(form);
  if (closed) return closed;

  const rl = await RateLimits.voiceExtractPerForm(params.token);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Muitas chamadas. Tente novamente em alguns minutos." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)),
        },
      },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "multipart/form-data inválido" },
      { status: 400 },
    );
  }

  const file = formData.get("audio");
  const stepIndexRaw = formData.get("stepIndex");
  const pathScopeRaw = formData.get("pathScope");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Campo 'audio' é obrigatório" },
      { status: 400 },
    );
  }

  const stepIndex = Number(stepIndexRaw);
  if (!Number.isFinite(stepIndex) || stepIndex < 0 || stepIndex > 6) {
    return NextResponse.json(
      { error: "stepIndex inválido (0..6)" },
      { status: 400 },
    );
  }

  if (!SUPPORTED_VOICE_MIMES.has(file.type)) {
    return NextResponse.json(
      {
        error: `Mime ${file.type} não suportado. Use audio/webm, audio/mp4 ou audio/ogg.`,
      },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Áudio maior que ${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }

  let pathScope: string[] | undefined;
  if (typeof pathScopeRaw === "string" && pathScopeRaw.trim()) {
    try {
      const parsed = JSON.parse(pathScopeRaw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        pathScope = parsed;
      }
    } catch {
      // ignora, segue sem filtro
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await extractFromVoice(
    buffer,
    file.type,
    stepIndex,
    { orgId: form.orgId },
    pathScope,
    isLocacaoSchemaType(form.schemaType) ? "locacao" : "venda",
  );

  return NextResponse.json({
    fields: result.fields,
    rateLimit: { remaining: rl.remaining, reset: rl.reset },
  });
}
