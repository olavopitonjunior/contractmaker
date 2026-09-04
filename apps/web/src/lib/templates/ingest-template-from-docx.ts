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
import {
  maskForReport,
  readNotMapped,
  type InsertionReport,
  type UnmappedToken,
} from "@/lib/templates/insertion-report";
import {
  maskReverseMergeReport,
  reverseMergeDocToTemplate,
  type ReverseMergeResult,
} from "@/lib/templates/reverse-merge";
import { enrichLocacaoData } from "@/lib/locacao/enrich";
import { extractLocacaoContractDataJson } from "@/lib/extraction/locacao-extractor";
import { templateFamilyForModalidade } from "@/lib/contracts/template-category";
import { extractPlaceholdersFromText } from "@/lib/google/replace-placeholders";
import { catalogForModalidade, requiredTokens } from "@/lib/templates/placeholder-catalog";
import { schemaTypeForModalidade } from "@/lib/contracts/template-category";
import {
  computeSourceHash,
  findDuplicateTemplate,
  resolveUniqueTemplateName,
  type DuplicateTemplate,
} from "@/lib/templates/upload-dedup";
import { exportDocAsPdf, getDocPlainText } from "@/lib/google/docs";
import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";
import { auditTemplateText, type TemplatePiiReport } from "@/lib/templates/pii-gate";
import {
  persistableSemanticReport,
  runSemanticChecks,
  type SemanticReport,
} from "@/lib/templates/semantic-checks";
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
  /**
   * GABARITO: os valores do documento-fonte no shape do formulário (o que o
   * extrator devolve). Quando presente, o estágio determinístico
   * (`reverseMergeDocToTemplate`) roda DEPOIS do passe de IA e troca cada valor
   * conhecido pelo token — sem interpretar nada. Ausente = fluxo antigo.
   * Não é persistido: contém PII do contrato-fonte.
   */
  sourceValues?: Record<string, unknown> | null;
  /**
   * Extrair o gabarito do PRÓPRIO documento (Gemini, ~US$0,01), em paralelo
   * com os slots/neutralização/passe de IA — não soma latência ao teto da
   * rota. Ignorado quando `sourceValues` já veio. Família locação (locacao,
   * comercial, temporada, administracao_locacao); venda fica para quando
   * houver gabarito de venda. Falha = sem gabarito, fluxo antigo.
   */
  extractGabarito?: { userId?: string | null } | null;
  /**
   * Texto do contrato ORIGINAL, para as checagens semânticas compararem o
   * modelo com o que ele era antes.
   *
   * Opcional, e o que se perde sem ele é pouco: das seis regras, só duas
   * (cláusula colapsada, citação órfã) usam o fonte, e sem ele elas degradam de
   * "erro" para "aviso" em vez de sumir. As que pegaram os defeitos medidos na
   * RE/MAX Trio — lista de rateio item a item, chave da parte errada, dado da
   * própria imobiliária, identificador ao lado da chave — não dependem dele.
   *
   * Quem tem esse texto de graça é o lote (`IngestionItem.text`). O envio
   * avulso não tem, e por isso o campo não é obrigatório: exigir o fonte
   * deixaria o caminho mais comum sem NENHUMA checagem, que é o estado que
   * este campo existe para acabar.
   */
  sourceText?: string | null;
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

  // ─── GABARITO (A8) ────────────────────────────────────────────────────────
  // Começa AQUI (Doc existe e já está gravado na row) e só é aguardado na hora
  // do reverse-merge: roda em paralelo com slots, neutralização e passe de IA,
  // que levam dezenas de segundos. Nasce depois do upload E do update de
  // propósito — qualquer falha antes daqui deixaria a chamada órfã gastando
  // Gemini para ninguém.
  //
  // DOCX → PDF antes de extrair, como contract-import e re-extract: o Gemini
  // lê DOCX cru (inlineData) de forma irregular e costuma devolver `{}` mudo —
  // e `{}` aqui é indistinguível de "sem gabarito". Export falhando cai no
  // buffer original (não pior que antes). O `.catch` devolve null: a extração
  // falhando nunca derruba a ingestão.
  const shouldExtract =
    !input.sourceValues &&
    !!input.extractGabarito &&
    templateFamilyForModalidade(modalidade) === "locacao";
  const gabaritoPromise: Promise<Record<string, unknown> | null> = shouldExtract
    ? (async () => {
        let extractionBuffer: Buffer = buffer;
        let extractionMime: ImportableMime = DOCX_MIME;
        try {
          extractionBuffer = await exportDocAsPdf(uploaded.docId);
          extractionMime = "application/pdf";
        } catch (err) {
          console.warn("[templates/from-docx] export PDF falhou; extraindo do DOCX cru:", err);
        }
        const r = await extractLocacaoContractDataJson(extractionBuffer, extractionMime, {
          orgId,
          userId: input.extractGabarito?.userId ?? null,
          contractId: null,
        });
        return r.dataJson;
      })().catch((err) => {
        console.error("[templates/from-docx] extração do gabarito falhou (segue sem):", err);
        return null;
      })
    : Promise.resolve(null);

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

  // ─── ESTÁGIO DETERMINÍSTICO (gabarito) ────────────────────────────────────
  // DEPOIS do passe de IA, de propósito: os blocos compostos (qualificação,
  // assinaturas) são narrativa que nunca bate byte a byte com o documento —
  // o que bate são os pedaços (CPF, nome). Rodando antes, o preâmbulo viraria
  // chaves soltas e a guarda `already-tokenized` impediria a IA de mapear o
  // bloco; com dois locadores, o segundo sumiria do contrato gerado
  // (`flattenForPlaceholders` só pega o primeiro item). Rodando depois, os
  // valores que a IA já cobriu viram `not-found` sem ruído, e cada valor que
  // sobrou e vira token é PII a menos para o gate abaixo.
  let reverseMerge: ReverseMergeResult | null = null;
  const sourceValues = input.sourceValues ?? (await gabaritoPromise);
  if (sourceValues && Object.keys(sourceValues).length > 0) {
    try {
      const gabarito = gabaritoFromSourceValues(sourceValues, modalidade);
      reverseMerge = await reverseMergeDocToTemplate({
        docId: uploaded.docId,
        dataJson: gabarito,
        modalidade,
      });
    } catch (err) {
      console.error("[templates/from-docx] reverse-merge falhou (segue draft):", err);
    }
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
  // Texto VAZIO também é "não medido" (o slot acima trata igual): afirmar
  // `blocked: false` sobre um export vazio seria a mentira mais barata do fluxo.
  const pii: TemplatePiiReport | null = finalDocText ? auditTemplateText(finalDocText) : null;

  // ─── CHECAGENS SEMÂNTICAS ─────────────────────────────────────────────────
  // Aqui, e não só na revalidação. Este era o buraco estrutural do fluxo: as
  // regras semânticas existiam desde 03/09 e só rodavam quando ALGUÉM abria a
  // tela de revisão e clicava em "Revalidar". Um modelo recém-ingerido nascia
  // com o defeito INVISÍVEL — e foi exatamente assim que os 16 modelos da
  // RE/MAX Trio chegaram a "prontos" com a lista de rateio chaveada item a
  // item: ninguém tinha o que olhar.
  //
  // Este é o melhor momento do sistema para rodá-las, e por dois motivos que
  // não se repetem depois:
  //
  //  - o texto FINAL do Doc já está em mãos (a releitura acima), de graça;
  //  - o texto do contrato ORIGINAL é o input desta função. Na revalidação ele
  //    precisa ser reencontrado por `(sourceHash, run.orgId)`, uma junção sem
  //    FK que falha para modelo enviado fora de um lote. Aqui ele é certo.
  //
  // Best-effort como o gate de PII: nada aqui bloqueia a ingestão. O que muda é
  // que o operador ABRE a tela já sabendo o que está errado, em vez de precisar
  // desconfiar primeiro.
  let semantic: SemanticReport | null = null;
  if (finalDocText) {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: {
          legalName: true,
          cnpj: true,
          creci: true,
          pixAddressKey: true,
          bankBranch: true,
          bankAccount: true,
        },
      });
      semantic = runSemanticChecks({
        docText: finalDocText,
        modalidade,
        org,
        sourceText: input.sourceText ?? null,
      });
    } catch (err) {
      console.error("[templates/from-docx] checagens semânticas falharam:", err);
    }
  }

  // O relatório do passe de IA foi medido ANTES do estágio determinístico:
  // reconciliar com o texto final (token que o reverse-merge pôs deixa de ser
  // "não mapeado") e enriquecer cada faltante com o que o gabarito sabe —
  // valor (mascarado) e ocorrências — para o operador agir sem reabrir o Doc.
  if (report && reverseMerge && finalDocText) {
    report = reconcileReportWithReverseMerge(
      report as InsertionReport,
      reverseMerge,
      finalDocText,
      modalidade
    );
  }
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
  if (report || finalSlotReports.length > 0 || neutralization || reverseMerge || pii || semantic) {
    try {
      await prisma.contractTemplate.update({
        where: { id: template.id },
        data: {
          draftReport: {
            ...((report ?? {}) as object),
            ...(finalSlotReports.length ? { slots: finalSlotReports } : {}),
            ...(neutralization ? { neutralization } : {}),
            ...(reverseMerge ? { reverseMerge: maskReverseMergeReport(reverseMerge) } : {}),
            ...(pii ? { pii } : {}),
            // Forma persistível: excerto mascarado e o conserto reduzido ao
            // verbo. O relatório vai para jsonb e é lido na tela — não guarda
            // frase crua de contrato.
            ...(semantic ? { semantic: persistableSemanticReport(semantic) } : {}),
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

/**
 * Gabarito para o reverse-merge = os valores EXTRAÍDOS, com as pontes de texto
 * do enrich (qualificações, endereço completo, extenso) — e SEM os defaults de
 * fábrica. `enrichLocacaoData` preenche `config.*` ausente com
 * `DEFAULT_LOCACAO_SETTINGS` (multa 10%, juros 1%, rescisória 3 meses): certo
 * para RENDERIZAR um contrato, errado como gabarito — o invariante do
 * reverse-merge é "o valor existe neste documento", e um "10% (dez por cento)"
 * inventado casaria a cláusula de comissão do modelo e a trocaria por
 * `{{multa_atraso_percent}}` como sucesso (achado da revisão do A7). Só entra
 * em `config` o que o gabarito bruto trouxe.
 */
export function gabaritoFromSourceValues(
  sourceValues: Record<string, unknown>,
  modalidade: string
): Record<string, unknown> {
  if (templateFamilyForModalidade(modalidade) !== "locacao") return sourceValues;
  // Chaves ANTES do enrich, e sobre uma cópia: `enrichLocacaoData` faz cópia
  // rasa e escreve os defaults dentro do MESMO objeto `config` da entrada.
  const rawConfig = (sourceValues.config ?? null) as Record<string, unknown> | null;
  const rawKeys = new Set(rawConfig && typeof rawConfig === "object" ? Object.keys(rawConfig) : []);
  const enriched = enrichLocacaoData({ ...sourceValues, config: { ...(rawConfig ?? {}) } });
  const enrichedConfig = (enriched.config ?? {}) as Record<string, unknown>;
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(enrichedConfig)) {
    if (rawKeys.has(k)) config[k] = v;
  }
  return { ...enriched, config };
}

/**
 * `notMapped`/`missingRequired` releem o texto FINAL (pós-reverse-merge), e
 * cada token ainda ausente ganha `sourceValue`/`occurrences`/motivo do
 * reverse-merge quando a IA não tinha proposto nada (`no-mapping`) — o motivo
 * do passe de IA, quando existe, vence: é o que corresponde ao trecho.
 * "Presente" respeita o passe de IA: token que ele marcou `unconfirmed`
 * (over-matched/over-removed) está no texto mas NÃO conta — senão a
 * reconciliação apagaria o motivo que o operador precisa ver.
 */
export function reconcileReportWithReverseMerge(
  report: InsertionReport,
  reverse: ReverseMergeResult,
  finalDocText: string,
  modalidade: string
): InsertionReport {
  const unconfirmed = new Set(report.unconfirmed ?? []);
  const present = new Set(
    extractPlaceholdersFromText(finalDocText).filter((t) => !unconfirmed.has(t))
  );
  const skipByToken = new Map(reverse.skipped.map((s) => [s.token, s]));
  const previous = new Map(readNotMapped(report.notMapped).map((n) => [n.token, n]));
  const notMapped: UnmappedToken[] = catalogForModalidade(modalidade)
    .map((d) => d.token)
    .filter((t) => !present.has(t))
    .map((token) => {
      const prev = previous.get(token) ?? { token, reason: "no-mapping" as const };
      const rm = skipByToken.get(token);
      if (!rm) return prev;
      return {
        ...prev,
        reason: prev.reason === "no-mapping" ? rm.reason : prev.reason,
        sourceValue: maskForReport(rm.value),
        ...(rm.occurrences !== undefined ? { occurrences: rm.occurrences } : {}),
      };
    });
  const missingRequired = requiredTokens(modalidade).filter((t) => !present.has(t));
  return { ...report, notMapped, missingRequired };
}

