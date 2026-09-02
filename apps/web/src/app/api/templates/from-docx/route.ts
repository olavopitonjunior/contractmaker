import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import {
  UPLOAD_MODALIDADES,
  matchCriteriaSchema,
} from "@/lib/contracts/template-category";
import { CLAUSE_SLOT_KEYS, type ClauseSlotKey } from "@/lib/templates/clause-slots";
import {
  DuplicateTemplateError,
  TemplateDriveUploadError,
  ingestTemplateFromDocx,
} from "@/lib/templates/ingest-template-from-docx";

export const runtime = "nodejs";
// 300s: Drive (upload + conversão) + slots + passe de IA (até 120k chars de
// entrada, 8192 tokens de saída, não-stream) + releituras do Doc. Com 120s o
// pior caso estourava DEPOIS do passe e ANTES de gravar o relatório — a
// ingestão inteira se perdia sem estado parcial.
export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024;

// Modalidades aceitas na ingestão de modelo. `administracao_locacao` é o
// contrato de administração (imobiliária ↔ proprietário): vira template
// engine="google_docs" igual aos demais; a geração
// (generateAdministracaoContractForDeal) copia o doc e substitui os
// placeholders via buildLocacaoPlaceholderMap (o deal de adm é um deal de
// locação, mesmo shape de dados).
// Além das 5 modalidades históricas do diálogo antigo, a central de ingestão
// também traz PROPOSTAS (proposta de venda e de locação res./comercial) — eram
// o buraco que obrigava a criar template de proposta "do zero".
const MODALIDADES: string[] = [
  ...UPLOAD_MODALIDADES,
  "proposta_venda",
  "proposta_locacao_residencial",
  "proposta_locacao_comercial",
];

/**
 * Blocos de cláusula que a CONSOLIDAÇÃO isolou neste modelo:
 * `{ "garantia": ["parágrafo 1", "parágrafo 2"] }`. Depois do upload, o 1º
 * parágrafo de cada slot vira `{{slot_garantia}}` no Doc e o restante some — o
 * texto passa a viver no acervo, uma cláusula por opção do formulário.
 */
const slotBlocksSchema = z.record(z.enum(CLAUSE_SLOT_KEYS), z.array(z.string()));

/** Lê um campo JSON do multipart. Ausente → undefined; inválido → erro. */
function readJsonField(formData: FormData, field: string): unknown {
  const raw = formData.get(field);
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return JSON.parse(raw);
}

/**
 * POST /api/templates/from-docx (multipart)
 *
 * Casca fina: autentica, valida o multipart e delega pra
 * `ingestTemplateFromDocx` (lib/templates/ingest-template-from-docx.ts), que é
 * onde vive o pipeline — claim-row do `sourceHash`, conversão em Google Doc,
 * abertura dos slots, pass de IA e declaração conferida contra o documento
 * final. O executor da ingestão em lote chama a mesma função direto, sem HTTP
 * self-call.
 *
 * UM arquivo por request — o pipeline Drive + IA é pesado e cabe no
 * maxDuration de 300s.
 *
 * Dedup por conteúdo (SHA-256 do DOCX em `ContractTemplate.sourceHash`):
 * arquivo já ingerido no org (e não arquivado) devolve 409 DUPLICATE_TEMPLATE
 * sem criar nada. `force=true` no formData ignora o dedup — o operador decide.
 * Colisão de NOME não bloqueia: sufixa " (2)", " (3)"… (nome é rótulo, o hash
 * é que é identidade).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  // Id efetivo (owner impersonado sob "testar como"; senão o próprio usuário).
  const effUserId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Apenas owner/admin podem criar templates." },
      { status: 403 }
    );
  }
  if (!isGoogleDocsFeatureEnabled()) {
    return NextResponse.json(
      { error: "Integração Google Docs não está habilitada." },
      { status: 503 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data inválido" }, { status: 400 });
  }

  const file = formData.get("file");
  const modalidade = String(formData.get("modalidade") ?? "");
  const name = (String(formData.get("name") ?? "").trim() || null) ?? null;
  const force = String(formData.get("force") ?? "") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo file ausente" }, { status: 400 });
  }
  if (!MODALIDADES.includes(modalidade)) {
    return NextResponse.json(
      { error: `modalidade inválida (aceitas: ${MODALIDADES.join(", ")})` },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo acima de 20MB" }, { status: 400 });
  }

  // Pareamento objetivo (`matchCriteria`) e slots de cláusula vêm da central de
  // ingestão. Ausentes = comportamento histórico do diálogo antigo.
  let matchCriteria: Record<string, unknown> | null = null;
  let slotBlocks: Partial<Record<ClauseSlotKey, string[]>> = {};
  try {
    const criteriaParsed = matchCriteriaSchema.safeParse(
      readJsonField(formData, "matchCriteria")
    );
    if (!criteriaParsed.success) {
      return NextResponse.json({ error: "matchCriteria inválido" }, { status: 400 });
    }
    matchCriteria = (criteriaParsed.data as Record<string, unknown> | null) ?? null;

    const blocksRaw = readJsonField(formData, "slotBlocks");
    if (blocksRaw !== undefined) {
      const blocksParsed = slotBlocksSchema.safeParse(blocksRaw);
      if (!blocksParsed.success) {
        return NextResponse.json({ error: "slotBlocks inválido" }, { status: 400 });
      }
      slotBlocks = blocksParsed.data;
    }
  } catch {
    return NextResponse.json(
      { error: "matchCriteria/slotBlocks não são JSON válido" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // DOCX é um ZIP — valida o magic header (PK\3\4) contra renomeados.
  const isZip =
    buffer.length > 8 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
  if (!isZip) {
    return NextResponse.json(
      { error: "Arquivo não parece ser um DOCX válido" },
      { status: 422 }
    );
  }

  try {
    const result = await ingestTemplateFromDocx({
      orgId: org.id,
      buffer,
      filename: file.name,
      modalidade,
      name,
      force,
      matchCriteria,
      slotBlocks,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DuplicateTemplateError) {
      return NextResponse.json(
        {
          code: "DUPLICATE_TEMPLATE",
          error: "Este arquivo já foi importado como template.",
          existing: err.existing,
        },
        { status: 409 }
      );
    }
    if (err instanceof TemplateDriveUploadError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
