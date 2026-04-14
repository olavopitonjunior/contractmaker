/**
 * Contract memory: post-approval learning loop.
 *
 * When a contract is approved, we snapshot it into ContractMemory:
 *   - a structured fingerprint (modality, civil status, value range, etc.)
 *   - an LLM-generated summary (Haiku, cheap)
 *   - which AI suggestions were accepted vs rejected
 *   - any manual edits the user made over the template-rendered HTML
 *   - a Voyage embedding that lets us answer "how have we handled this before?"
 *
 * This fuels find_similar_contracts and propose_* tools: instead of acting in
 * isolation, the agent can see how the organization has handled similar cases
 * and align with that pattern.
 */

import { Anthropic } from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { embedOne, toPgVector, isEmbeddingsConfigured } from "./embeddings";

interface PersonSnapshot {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  estado_civil?: string;
}

interface PaymentSnapshot {
  valor_total?: number | string;
  sinal_arras?: number | string;
  financiamento?: number | string;
  fgts?: number | string;
}

interface DataSnapshot {
  vendedores?: PersonSnapshot[];
  compradores?: PersonSnapshot[];
  pagamento?: PaymentSnapshot;
  imoveis?: Array<{ cidade?: string; uf?: string }>;
}

export interface ContractFingerprint {
  modality: string | null;
  templateName: string | null;
  valueTotalBucket: string | null; // "under_500k" | "500k_1m" | "1m_2m" | "above_2m"
  hasFgts: boolean;
  hasFinancing: boolean;
  vendedorCivilStatus: string | null;
  vendedorCount: number;
  compradorCount: number;
  cityUf: string | null;
}

/**
 * Extract a structural fingerprint from the contract data.
 * Used to cluster similar contracts even when the exact text differs.
 */
export function extractFingerprint(
  data: unknown,
  templateModalidade: string | null,
  templateName: string | null
): ContractFingerprint {
  const safe = (data && typeof data === "object" ? data : {}) as DataSnapshot;

  const valorTotal = toNumber(safe.pagamento?.valor_total);
  const valueBucket =
    valorTotal < 500_000
      ? "under_500k"
      : valorTotal < 1_000_000
        ? "500k_1m"
        : valorTotal < 2_000_000
          ? "1m_2m"
          : valorTotal >= 2_000_000
            ? "above_2m"
            : null;

  const firstVendedor = (safe.vendedores || [])[0];
  const firstImovel = (safe.imoveis || [])[0];

  return {
    modality: templateModalidade,
    templateName,
    valueTotalBucket: valueBucket,
    hasFgts: toNumber(safe.pagamento?.fgts) > 0,
    hasFinancing: toNumber(safe.pagamento?.financiamento) > 0,
    vendedorCivilStatus: firstVendedor?.estado_civil ?? null,
    vendedorCount: (safe.vendedores || []).length,
    compradorCount: (safe.compradores || []).length,
    cityUf: firstImovel?.cidade && firstImovel?.uf ? `${firstImovel.cidade}/${firstImovel.uf}` : null,
  };
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Uses Haiku to produce a 3-5 sentence summary of the contract covering:
 * - parties (vendor, buyer, marital status)
 * - asset (type, location, price)
 * - payment structure (cash / financing / FGTS / installments)
 * - any unusual clauses or points of attention
 */
async function summarizeContract(htmlContent: string, fingerprint: ContractFingerprint): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return `Contrato ${fingerprint.modality || ""} — ${fingerprint.valueTotalBucket || "valor indefinido"} — ${fingerprint.cityUf || "local indefinido"}`;
  }

  const model = process.env.ANTHROPIC_PASSIVE_MODEL || "claude-haiku-4-5-20251001";
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 400,
      temperature: 0.2,
      system:
        "Você resume contratos imobiliários em 3-5 sentenças objetivas. Liste: partes (vendedor, comprador, estado civil), imóvel (tipo, localização, preço), pagamento (à vista / financiamento / FGTS / parcelas) e qualquer cláusula ou ponto de atenção incomum. Sem markdown, sem introdução.",
      messages: [
        {
          role: "user",
          content: `Resuma este contrato em 3-5 sentenças:\n\n${htmlContent.slice(0, 12000)}`,
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text");
    if (text && text.type === "text") return text.text.trim();
  } catch (err) {
    console.error("[summarizeContract] Haiku failed:", err);
  }
  return `Contrato ${fingerprint.modality || ""} — ${fingerprint.cityUf || ""}`;
}

/**
 * Diff manual edits: compare the template-rendered HTML with the final htmlContent
 * to isolate paragraphs the user manually edited (approximation — block-level).
 */
async function diffManualEdits(
  contractId: string,
  htmlContent: string,
  templateSource: string,
  dataJson: unknown
): Promise<Array<{ before: string; after: string }>> {
  try {
    const rendered = renderContratoHTML(templateSource, dataJson as Record<string, unknown>);
    // Simple block-level diff: split by </p> / </li> and find blocks only present in final
    const blockify = (html: string) =>
      html
        .split(/<\/(?:p|li|h[1-6])>/i)
        .map((b) => b.replace(/<[^>]+>/g, "").trim())
        .filter((b) => b.length > 20);

    const templateBlocks = new Set(blockify(rendered));
    const finalBlocks = blockify(htmlContent);
    const onlyInFinal = finalBlocks.filter((b) => !templateBlocks.has(b));

    // Keep top 10 manual edits to limit memory size
    return onlyInFinal.slice(0, 10).map((b) => ({ before: "", after: b }));
  } catch (err) {
    console.error("[diffManualEdits] failed for", contractId, err);
    return [];
  }
}

/**
 * Main entry point — called from the approval hook.
 * Must never throw (approval flow already committed); log failures and return.
 */
export async function createContractMemory(contractId: string): Promise<{
  ok: boolean;
  memoryId?: string;
  error?: string;
}> {
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        template: true,
        suggestions: true,
        clauses: { include: { clause: true } },
      },
    });

    if (!contract) {
      return { ok: false, error: "contrato não encontrado" };
    }

    // Get orgId via the template
    const orgId = contract.template.orgId;

    // 1. Fingerprint
    const fingerprint = extractFingerprint(
      contract.dataJson,
      contract.template.modalidade,
      contract.template.name
    );

    // 2. Summary (LLM)
    const htmlContent =
      contract.htmlContent ||
      renderContratoHTML(
        contract.templateOverride || contract.template.handlebarsSource,
        contract.dataJson as Record<string, unknown>
      );
    const summary = await summarizeContract(htmlContent, fingerprint);

    // 3. Accepted / rejected suggestions
    const accepted = contract.suggestions
      .filter((s) => s.status === "accepted")
      .map((s) => ({
        id: s.id,
        type: s.type,
        originalText: s.originalText?.slice(0, 500) || null,
        newText: s.newText?.slice(0, 500) || null,
        reason: s.reason,
      }));
    const rejected = contract.suggestions
      .filter((s) => s.status === "rejected")
      .map((s) => ({
        id: s.id,
        type: s.type,
        newText: s.newText?.slice(0, 500) || null,
        reason: s.reason,
      }));

    // 4. Manual edits
    const manualEdits = await diffManualEdits(
      contract.id,
      htmlContent,
      contract.templateOverride || contract.template.handlebarsSource,
      contract.dataJson
    );

    // 5. Insert memory row
    const memory = await prisma.contractMemory.create({
      data: {
        orgId,
        contractId: contract.id,
        templateId: contract.templateId,
        dataFingerprint: fingerprint as object,
        summary,
        acceptedSuggestions: accepted as object,
        rejectedSuggestions: rejected as object,
        manualEdits: manualEdits as object,
      },
    });

    // 6. Embedding (best-effort; silently skip if Voyage not configured)
    if (isEmbeddingsConfigured()) {
      try {
        const embeddingText = `${summary}\n\nFingerprint: ${JSON.stringify(fingerprint)}`;
        const vec = await embedOne(embeddingText, "document");
        await prisma.$executeRawUnsafe(
          `UPDATE "ContractMemory" SET embedding = $1::vector WHERE id = $2`,
          toPgVector(vec),
          memory.id
        );
      } catch (err) {
        console.error("[createContractMemory] embedding failed:", err);
      }
    }

    // 7. Increment usageCount on clauses that were used in the final contract
    for (const cc of contract.clauses) {
      if (cc.isActive) {
        await prisma.clause
          .update({
            where: { id: cc.clauseId },
            data: { usageCount: { increment: 1 } },
          })
          .catch((err) => {
            // Clause.usageCount may not exist in all schemas — tolerate
            console.error("[createContractMemory] usageCount increment failed:", err);
          });
      }
    }

    return { ok: true, memoryId: memory.id };
  } catch (err) {
    console.error("[createContractMemory] fatal:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Find the top-K most similar approved contracts by embedding cosine distance.
 * Falls back to fingerprint-based filtering if embeddings are not available.
 */
export async function findSimilarContracts(
  orgId: string,
  currentDataJson: unknown,
  currentTemplateModalidade: string | null,
  currentTemplateName: string | null,
  focus: string | undefined,
  topK: number
): Promise<
  Array<{
    id: string;
    contractId: string | null;
    summary: string;
    fingerprint: ContractFingerprint;
    acceptedSuggestions: unknown[];
    rejectedSuggestions: unknown[];
    manualEdits: unknown[];
    similarity: number | null;
  }>
> {
  const currentFingerprint = extractFingerprint(
    currentDataJson,
    currentTemplateModalidade,
    currentTemplateName
  );

  // Fast path: no embeddings → rank by fingerprint match score
  if (!isEmbeddingsConfigured()) {
    const memories = await prisma.contractMemory.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const scored = memories.map((m) => {
      const fp = m.dataFingerprint as unknown as ContractFingerprint;
      let score = 0;
      if (fp.modality === currentFingerprint.modality) score += 3;
      if (fp.valueTotalBucket === currentFingerprint.valueTotalBucket) score += 2;
      if (fp.hasFgts === currentFingerprint.hasFgts) score += 1;
      if (fp.hasFinancing === currentFingerprint.hasFinancing) score += 1;
      if (fp.vendedorCivilStatus === currentFingerprint.vendedorCivilStatus) score += 1;
      if (fp.cityUf === currentFingerprint.cityUf) score += 1;
      return { memory: m, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ memory }) => ({
      id: memory.id,
      contractId: memory.contractId,
      summary: memory.summary,
      fingerprint: memory.dataFingerprint as unknown as ContractFingerprint,
      acceptedSuggestions: (memory.acceptedSuggestions as unknown[]) || [],
      rejectedSuggestions: (memory.rejectedSuggestions as unknown[]) || [],
      manualEdits: (memory.manualEdits as unknown[]) || [],
      similarity: null,
    }));
  }

  // Semantic path: embed the query "fingerprint + focus" and search by cosine
  const queryText = `${focus || "contrato similar"}\n\nFingerprint: ${JSON.stringify(currentFingerprint)}`;
  const queryVec = await embedOne(queryText, "query");

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      contractId: string | null;
      summary: string;
      dataFingerprint: unknown;
      acceptedSuggestions: unknown;
      rejectedSuggestions: unknown;
      manualEdits: unknown;
      similarity: number;
    }>
  >(
    `
    SELECT
      id,
      "contractId",
      summary,
      "dataFingerprint",
      "acceptedSuggestions",
      "rejectedSuggestions",
      "manualEdits",
      1 - (embedding <=> $1::vector) AS similarity
    FROM "ContractMemory"
    WHERE "orgId" = $2
      AND embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT ${Math.max(1, Math.min(topK, 10))}
    `,
    toPgVector(queryVec),
    orgId
  );

  return rows.map((r) => ({
    id: r.id,
    contractId: r.contractId,
    summary: r.summary,
    fingerprint: r.dataFingerprint as ContractFingerprint,
    acceptedSuggestions: (r.acceptedSuggestions as unknown[]) || [],
    rejectedSuggestions: (r.rejectedSuggestions as unknown[]) || [],
    manualEdits: (r.manualEdits as unknown[]) || [],
    similarity: Number((r.similarity as unknown as number)?.toFixed?.(3) ?? r.similarity),
  }));
}
