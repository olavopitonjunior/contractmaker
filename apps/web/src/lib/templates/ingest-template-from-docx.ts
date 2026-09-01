/**
 * Ingestão "modelo DOCX da imobiliária → template" — o miolo do
 * POST /api/templates/from-docx.
 *
 * Vive fora da rota pelo mesmo motivo de `ingest-clauses.ts`: o executor da
 * ingestão em lote precisa da MESMA semântica sem HTTP self-call. Um self-call
 * carregaria cookie de sessão para dentro de um worker que roda sob cron, e
 * pagaria um cold start por arquivo — num acervo de 60 documentos isso é a
 * diferença entre um lote e uma tarde.
 *
 * A rota fica com o que é de rota (auth, multipart, códigos HTTP); aqui fica o
 * pipeline: claim-row → Drive → slots → IA → declaração.
 *
 * ## A ordem NÃO é arbitrária
 *
 * 1. **Claim-row antes do Drive.** O dedup-check e a criação da row rodam na
 *    MESMA transação, antes do pipeline pesado. Separá-los deixava ~2min entre
 *    o check e o create: duas requests com o mesmo arquivo passavam as duas.
 * 2. **Slots antes da IA.** Com a cláusula variável já trocada pelo token, o
 *    pass de placeholders não gasta esforço num texto que vai deixar de existir.
 * 3. **Declaração do slot DEPOIS da IA, e derivada do estado FINAL do Doc.**
 *    Declarar um slot que não está no documento é a pior falha deste fluxo: na
 *    geração, `replacePlaceholdersInDoc` não acha o token, a cláusula resolvida
 *    é descartada em silêncio e o contrato sai com a garantia HARDCODED da
 *    variante de referência — o cliente escolhe caução no formulário e assina
 *    fiador. Por isso o documento é RELIDO antes de declarar.
 *
 * O que NÃO está aqui, de propósito: `isGoogleDocsFeatureEnabled()`. A rota
 * checa antes de tocar no multipart (503 tem precedência sobre 400 lá) e o
 * executor em lote checa uma vez por run, não uma vez por arquivo.
 */

import { prisma } from "@/lib/db/prisma";
import { uploadFileAsGoogleDoc } from "@/lib/google/upload-file-as-gdoc";
import { insertPlaceholdersWithAI } from "@/lib/templates/ai-placeholder-insertion";
import { schemaTypeForModalidade } from "@/lib/contracts/template-category";
import {
  computeSourceHash,
  findDuplicateTemplate,
  resolveUniqueTemplateName,
  type DuplicateTemplate,
} from "@/lib/templates/upload-dedup";
import { getDocPlainText } from "@/lib/google/docs";
import { auditTemplateText, type TemplatePiiReport } from "@/lib/templates/pii-gate";
import {
  slotDeclarationComment,
  slotToken,
  type ClauseSlotKey,
} from "@/lib/templates/clause-slots";
import {
  applyClauseSlotToDoc,
  type ApplyClauseSlotReport,
} from "@/lib/templates/apply-clause-slot";
import {
  neutralReplacementFor,
  neutralizeProvidersInDoc,
  type NeutralizeProvidersReport,
} from "@/lib/templates/neutralize-provider";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * O "source" de um template engine="google_docs" é só um cabeçalho — o conteúdo
 * real vive no Drive. É logo abaixo dele que a declaração dos slots entra,
 * quando (e só quando) o token de fato foi escrito no documento.
 */
export const GOOGLE_DOCS_SOURCE_HEADER =
  "<!-- engine=google_docs: a fonte é o Google Doc -->";

export interface IngestTemplateFromDocxInput {
  orgId: string;
  /** Bytes do DOCX. O caller já validou o magic header (PK\3\4). */
  buffer: Buffer;
  /** Nome do arquivo original — base do nome do template quando `name` é null. */
  filename: string;
  modalidade: string;
  /** Nome escolhido pelo operador; null usa o default derivado do arquivo. */
  name?: string | null;
  /** Ignora o dedup por `sourceHash`. O operador decide. */
  force?: boolean;
  matchCriteria?: Record<string, unknown> | null;
  /** Blocos que a consolidação isolou: `{ garantia: ["parágrafo 1", …] }`. */
  slotBlocks?: Partial<Record<ClauseSlotKey, string[]>>;
  /**
   * Rótulos de fornecedores conhecidos a NEUTRALIZAR no corpo (fora do slot).
   * Vazio/ausente pula o passo — comportamento dos chamadores antigos.
   */
  neutralizeProviders?: readonly string[];
}

export interface IngestTemplateFromDocxResult {
  templateId: string;
  name: string;
  docId: string;
  webViewLink: string;
  embedLink: string;
  /** Relatório do pass de IA; null quando ele falhou (não bloqueia). */
  report: unknown;
  /** Um relatório por slot PEDIDO — inclusive os que não sobreviveram. */
  slots: ApplyClauseSlotReport[];
  /** Neutralização de fornecedor no corpo; null quando o passo não rodou. */
  neutralization: NeutralizeProvidersReport | null;
}

/** O arquivo já virou template nesta org. A rota devolve 409 DUPLICATE_TEMPLATE. */
export class DuplicateTemplateError extends Error {
  readonly code = "DUPLICATE_TEMPLATE" as const;
  readonly status = 409 as const;
  constructor(readonly existing: DuplicateTemplate) {
    super("DUPLICATE_TEMPLATE");
    this.name = "DuplicateTemplateError";
  }
}

/** O Drive recusou converter o DOCX. A rota devolve 502; nada foi criado. */
export class TemplateDriveUploadError extends Error {
  readonly status = 502 as const;
  constructor(message: string) {
    super(message);
    this.name = "TemplateDriveUploadError";
  }
}

/**
 * Remove a claim-row quando o pipeline falha. Best-effort: um erro aqui só
 * significa que o hash segue ocupado por um draft — o operador reingere com
 * `force=true`.
 */
async function dropClaimRow(id: string): Promise<void> {
  await prisma.contractTemplate.delete({ where: { id } }).catch((err) => {
    console.error("[templates/from-docx] falha ao limpar a claim-row:", err);
  });
}

/** Sinaliza o 409 de dentro da transação do claim (aborta e faz rollback). */
class ClaimDuplicate extends Error {
  constructor(readonly existing: DuplicateTemplate) {
    super("DUPLICATE_TEMPLATE");
  }
}

export async function ingestTemplateFromDocx(
  input: IngestTemplateFromDocxInput
): Promise<IngestTemplateFromDocxResult> {
  const { orgId, buffer, filename, modalidade } = input;
  const slotBlocks = input.slotBlocks ?? {};
  const matchCriteria = input.matchCriteria ?? null;

  // O que o cliente PEDIU. O que será DECLARADO no template depende do
  // resultado real de `applyClauseSlotToDoc` (ver mais abaixo).
  const requestedSlots = (Object.keys(slotBlocks) as ClauseSlotKey[]).filter(
    (s) => (slotBlocks[s] ?? []).length > 0
  );

  const sourceHash = computeSourceHash(buffer);
  const baseName =
    (input.name ?? null) ??
    `Modelo da imobiliária — ${filename.replace(/\.docx$/i, "")}`;

  // ─── CLAIM-ROW ────────────────────────────────────────────────────────────
  // A row nasce sem `googleTemplateDocId` — é um CLAIM do hash. Uma 2ª request
  // concorrente enxerga a claim-row (status "draft" participa do dedup) e leva
  // 409 na hora.
  let template: { id: string; name: string };
  try {
    template = await prisma.$transaction(async (tx) => {
      if (!input.force) {
        const existing = await findDuplicateTemplate(tx, orgId, sourceHash);
        if (existing) throw new ClaimDuplicate(existing);
      }
      const templateName = await resolveUniqueTemplateName(tx, orgId, baseName);
      return tx.contractTemplate.create({
        data: {
          orgId,
          name: templateName,
          description: "Template criado a partir do modelo DOCX da imobiliária.",
          engine: "google_docs",
          status: "draft",
          isDefault: false,
          // Preenchido depois que o Drive converter o DOCX.
          googleTemplateDocId: null,
          modalidade,
          schemaType: schemaTypeForModalidade(modalidade),
          // Nasce SEM declaração de slot — ver o bloco de slots mais abaixo.
          handlebarsSource: GOOGLE_DOCS_SOURCE_HEADER,
          version: "1.0.0",
          sourceHash,
          matchCriteria: (matchCriteria ?? undefined) as object | undefined,
        },
        select: { id: true, name: true },
      });
    });
  } catch (err) {
    if (err instanceof ClaimDuplicate) throw new DuplicateTemplateError(err.existing);
    throw err;
  }

  // Daqui pra frente a claim-row EXISTE. Qualquer falha tem de removê-la: um
  // draft sem `googleTemplateDocId` seria um template quebrado na listagem E
  // ocuparia o hash pra sempre (o operador nunca mais reingeriria o arquivo).
  let uploaded: { docId: string; webViewLink: string; embedLink: string };
  try {
    uploaded = await uploadFileAsGoogleDoc({
      buffer,
      sourceMime: DOCX_MIME,
      name: `[MODELO] ${template.name}`,
      orgId,
    });
  } catch (err) {
    await dropClaimRow(template.id);
    const msg = err instanceof Error ? err.message : String(err);
    throw new TemplateDriveUploadError(
      `Falha ao converter DOCX em Google Doc: ${msg}`
    );
  }

  try {
    await prisma.contractTemplate.update({
      where: { id: template.id },
      data: { googleTemplateDocId: uploaded.docId },
    });
  } catch (err) {
    await dropClaimRow(template.id);
    throw err;
  }

  // Abre os slots ANTES do pass de IA: com a cláusula variável já trocada pelo
  // token, o mapeamento de placeholders não gasta esforço num texto que vai
  // deixar de existir.
  const slotReports: ApplyClauseSlotReport[] = [];
  for (const slot of requestedSlots) {
    slotReports.push(
      await applyClauseSlotToDoc({
        docId: uploaded.docId,
        slot,
        paragraphs: slotBlocks[slot] ?? [],
      })
    );
  }

  // Neutralização de fornecedor no corpo — DEPOIS do slot (o trecho da
  // garantia já saiu; o que restou de menção é fora do slot por construção) e
  // ANTES do pass de IA, que não deve gastar mapeamento em nome que vai sumir.
  // Falha não bloqueia: o template segue com o aviso e inativável, como antes.
  let neutralization: NeutralizeProvidersReport | null = null;
  if ((input.neutralizeProviders?.length ?? 0) > 0) {
    neutralization = await neutralizeProvidersInDoc({
      docId: uploaded.docId,
      providers: input.neutralizeProviders!,
      replacement: neutralReplacementFor(
        (input.matchCriteria?.garantia as string | undefined) ?? null
      ),
    });
  }

  // Pass de IA best-effort: insere {{placeholders}} no doc. Falha não
  // bloqueia — o template fica draft e o operador faz manualmente na revisão.
  // (Não derruba a claim-row: o doc já existe e o template é utilizável.)
  let report: unknown = null;
  try {
    report = await insertPlaceholdersWithAI({
      docId: uploaded.docId,
      modalidade,
      orgId,
    });
  } catch (err) {
    console.error("[templates/from-docx] Pass de IA falhou (segue draft):", err);
  }

  // ─── DECLARAÇÃO DO SLOT ───────────────────────────────────────────────────
  // DEPOIS do pass de IA, e derivada do estado FINAL do documento. Declarar
  // antes da IA abria um buraco: o pass rodava depois e podia reescrever o
  // token, deixando o template declarado-sem-token. A guarda `already-tokenized`
  // em `ai-placeholder-insertion` fecha a causa; reler o doc aqui fecha o efeito,
  // inclusive pra qualquer outra mutação futura entre o apply e a declaração.
  const appliedReports = slotReports.filter((r) => r.applied);
  // Releitura SEMPRE, não só com slot aplicado: o gate de PII (abaixo) mede o
  // texto que sobrou literal depois da IA — e é exatamente o modelo sem slot,
  // com a cláusula chumbada, que mais precisa dessa medida.
  let finalDocText: string | null = null;
  try {
    finalDocText = await getDocPlainText(uploaded.docId);
  } catch (err) {
    console.error(
      "[templates/from-docx] não consegui reler o doc (slots e PII ficam sem verificação):",
      err
    );
  }

  // ─── GATE DE PII DO MODELO ────────────────────────────────────────────────
  // Só mede; quem bloqueia é o PATCH de ativação (ver pii-gate.ts). Doc
  // ilegível → sem relatório, e a revalidação preenche na primeira leitura.
  const pii: TemplatePiiReport | null = finalDocText !== null ? auditTemplateText(finalDocText) : null;
  // Doc ilegível → não declara (fail-closed): melhor um token órfão, que
  // `cleanupOrphanPlaceholders` limpa na geração, do que uma declaração mentindo.
  const survivingSlots = appliedReports
    .filter((r) => (finalDocText ? finalDocText.includes(r.token!) : false))
    .map((r) => r.slot);

  // "Não consegui ler" NÃO é "o token sumiu". `applyClauseSlotToDoc` já releu e
  // confirmou o token; se esta terceira leitura cai num 429/403 transitório,
  // rebaixar o slot como `verify-failed` afirmaria uma coisa que não sabemos.
  const unverified = finalDocText === null;
  const lostSlots = new Set(
    appliedReports.map((r) => r.slot).filter((s) => !survivingSlots.includes(s))
  );
  const finalSlotReports: ApplyClauseSlotReport[] = slotReports.map((r) =>
    lostSlots.has(r.slot) && r.applied
      ? {
          ...r,
          applied: false,
          token: null,
          issues: [
            ...r.issues,
            {
              paragraph: `{{${slotToken(r.slot)}}}`,
              reason: unverified
                ? ("verify-unavailable" as const)
                : ("verify-failed" as const),
            },
          ],
        }
      : r
  );

  if (survivingSlots.length > 0) {
    try {
      await prisma.contractTemplate.update({
        where: { id: template.id },
        data: {
          handlebarsSource: [
            GOOGLE_DOCS_SOURCE_HEADER,
            slotDeclarationComment(survivingSlots),
          ].join("\n"),
        },
      });
    } catch (err) {
      // Sem a declaração o template é um modelo comum com um `{{slot_*}}` órfão
      // — que `cleanupOrphanPlaceholders` remove na geração. Degrada, não quebra.
      console.error("[templates/from-docx] falha ao declarar os slots:", err);
    }
  }

  // O relatório é gravado FORA do try do pass de IA: os avisos de slot precisam
  // chegar à página de revisão mesmo quando a IA falha (antes, um erro na IA
  // engolia junto o motivo de o slot não ter aberto).
  if (report || finalSlotReports.length > 0 || neutralization || pii) {
    try {
      await prisma.contractTemplate.update({
        where: { id: template.id },
        data: {
          draftReport: {
            ...((report ?? {}) as object),
            ...(finalSlotReports.length ? { slots: finalSlotReports } : {}),
            ...(neutralization ? { neutralization } : {}),
            ...(pii ? { pii } : {}),
          } as object,
        },
      });
    } catch (err) {
      console.error("[templates/from-docx] falha ao gravar o draftReport:", err);
    }
  }

  return {
    templateId: template.id,
    name: template.name,
    docId: uploaded.docId,
    webViewLink: uploaded.webViewLink,
    embedLink: uploaded.embedLink,
    report,
    slots: slotReports,
    neutralization,
  };
}
