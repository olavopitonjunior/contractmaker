import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  extractFromVoice,
  SUPPORTED_VOICE_MIMES,
} from "@/lib/ai/voice-extract";
import { formClosedResponse } from "@/lib/forms/form-gate";
import { resolveParticipantToken } from "@/lib/forms/participant-token";
import { ROLE_PATHS } from "@/lib/forms/role-paths";
import { RateLimits } from "@/lib/security/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/forms/participant/[subtoken]/voice-extract
 *
 * Variante do voice-extract pra subtoken por parte (PR 4). Filtra `pathScope`
 * pelos paths permitidos do role server-side, ignorando o que o cliente
 * mandar (defesa em profundidade — se UI mandar errado, server filtra).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { subtoken: string } },
) {
  const resolved = await resolveParticipantToken(params.subtoken);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 401 });
  }

  const participant = await prisma.salesFormParticipant.findUniqueOrThrow({
    where: { id: resolved.participant.id },
    include: {
      form: {
        select: { orgId: true, status: true, completedAt: true, reopenedAt: true },
      },
    },
  });
  const closed = await formClosedResponse(participant.form);
  if (closed) return closed;

  const rl = await RateLimits.voiceExtractPerForm(params.subtoken);
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
      { error: `Mime ${file.type} não suportado.` },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Áudio maior que ${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }

  const role = participant.role as keyof typeof ROLE_PATHS;
  const pathScope = ROLE_PATHS[role];

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await extractFromVoice(
    buffer,
    file.type,
    stepIndex,
    { orgId: participant.form.orgId },
    pathScope,
  );

  return NextResponse.json({
    fields: result.fields,
    rateLimit: { remaining: rl.remaining, reset: rl.reset },
  });
}
