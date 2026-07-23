import type { StorageListPage } from "./s3";

/**
 * GC de blobs órfãos no storage. Fecha o resíduo TOCTOU do PR #150: um finalize
 * de form concorrente pode copiar uma blob URL pra um DealAttachment novo bem na
 * janela entre a contagem de referências e o delete inline, deixando um blob que
 * uma row ainda referencia (ou o inverso). O GC não decide no calor da corrida:
 * varre o storage e só apaga blobs que estão órfãos HÁ MAIS que a carência.
 *
 * SEGURANÇA (a razão de o escopo ser conservador):
 *  - **Escopo por prefixo de anexo puro** (GC_ATTACHMENT_PREFIXES): esses blobs
 *    mapeiam SÓ pras colunas escalares de anexo, que o ref-check cobre. EXCLUI
 *    `inspections/` e `contracts/<id>/images/` (referências vivem em JSON/HTML,
 *    não em coluna — um sweep apagaria fotos/imagens vivas) e os derivados
 *    legalmente críticos (`envelopes/`, `proposals/`) por precaução inicial.
 *  - **Ref-check abrangente** (isBlobReferenced, 17 colunas) como defesa extra.
 *  - **Carência** por `uploadedAt` (blob tem que ser mais velho que graceMs) —
 *    protege blob recém-subido cuja row ainda está sendo criada.
 *  - **Match por URL EXATA** contra o banco (nunca reconstrói keys — sufixo
 *    aleatório).
 *  - **Stores SEPARADOS por ambiente** (verificado: prod ≠ staging) é a
 *    INVARIANTE que garante segurança cross-env: cada GC lista só o próprio
 *    store e casa contra o próprio banco. É PRÉ-CONDIÇÃO de BLOB_GC_DELETE=true —
 *    num store COMPARTILHADO entre prod e staging, os blobs de anexo escritos por
 *    `put` direto / client-direct ficam no prefixo BASE (sem `staging/`, pois
 *    bypassam o normalizeKey) e seriam indistinguíveis por prefixo, então o GC
 *    de um ambiente apagaria os blobs vivos do outro. O gate includeStagingLayout
 *    é defesa-em-profundidade PARCIAL (cobre só o subconjunto `staging/`), NÃO a
 *    garantia — não afrouxe assumindo que ele fecha o cross-env sozinho.
 *  - **Dry-run por padrão** (apply=false): só reporta candidatos. Deleção real
 *    exige BLOB_GC_DELETE=true no cron.
 */

// Prefixos de key varridos. Layout base (`<prefix>`); as variantes `staging/`
// (uploads via s3.ts no staging) só são varridas quando includeStagingLayout.
export const GC_ATTACHMENT_PREFIXES = [
  "deal-attachments/",
  "imports/",
  "deal-certidoes/",
  "form-attachments/",
  "client-docs/",
  "client-certidoes/",
] as const;

export interface OrphanGcDeps {
  listStorage: (p: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }) => Promise<StorageListPage>;
  isReferenced: (url: string) => Promise<boolean>;
  deleteBlob: (url: string) => Promise<boolean>;
  now: () => number;
}

export interface OrphanGcOptions {
  prefixes?: readonly string[];
  // Varre também as variantes `staging/<prefix>`? Só o AMBIENTE staging deve
  // (uploads via s3.ts lá ganham `staging/`). Em prod fica false: prod não tem
  // blobs sob `staging/`, e varrê-las contra o DB de prod apagaria blobs de
  // staging caso o token do Blob seja compartilhado (defesa vs cross-env — o GC
  // com BLOB_GC_DELETE exige stores SEPARADOS por ambiente de qualquer forma).
  includeStagingLayout?: boolean;
  // Rotação do prefixo inicial (fairness entre runs, sem estado): sem cursor
  // cross-run, um prefixo grande que esgota o budget faria os seguintes nunca
  // serem varridos. Rodar o início por semana garante que cada prefixo tenha a
  // vez. NÃO resolve um único prefixo maior que o budget (>~4500 blobs vivos) —
  // aí é preciso persistir cursor (TODO de escala; o volume atual varre inteiro).
  startOffset?: number;
  graceMs?: number; // default 48h
  timeBudgetMs?: number; // default 45s
  pageLimit?: number; // itens por página do list
  apply: boolean; // false = dry-run (só reporta)
  maxSampleUrls?: number; // amostra de URLs órfãs no resultado
}

export interface OrphanGcResult {
  apply: boolean;
  scanned: number;
  tooFresh: number; // pulados pela carência
  referenced: number; // mantidos (ainda referenciados)
  orphans: number; // candidatos (órfãos + velhos que a carência)
  deleted: number; // apagados (0 em dry-run)
  exhausted: boolean; // estourou o time budget — próxima execução continua
  byPrefix: Record<string, { scanned: number; orphans: number; deleted: number }>;
  sampleOrphanUrls: string[];
}

const DEFAULT_GRACE_MS = 48 * 60 * 60 * 1000;
const DEFAULT_TIME_BUDGET_MS = 45_000;
const DEFAULT_PAGE_LIMIT = 1000;
const DEFAULT_SAMPLE = 20;

export async function runOrphanBlobGc(
  deps: OrphanGcDeps,
  opts: OrphanGcOptions
): Promise<OrphanGcResult> {
  const basePrefixes = opts.prefixes ?? GC_ATTACHMENT_PREFIXES;
  const allPrefixes = opts.includeStagingLayout
    ? [...basePrefixes, ...basePrefixes.map((p) => `staging/${p}`)]
    : [...basePrefixes];
  // Rotação stateless do início (fairness — ver OrphanGcOptions.startOffset).
  const off =
    (((opts.startOffset ?? 0) % allPrefixes.length) + allPrefixes.length) %
    allPrefixes.length;
  const prefixes = [...allPrefixes.slice(off), ...allPrefixes.slice(0, off)];
  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  const pageLimit = opts.pageLimit ?? DEFAULT_PAGE_LIMIT;
  const sampleCap = opts.maxSampleUrls ?? DEFAULT_SAMPLE;
  const deadline = deps.now() + (opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const graceCutoff = deps.now() - graceMs;

  const result: OrphanGcResult = {
    apply: opts.apply,
    scanned: 0,
    tooFresh: 0,
    referenced: 0,
    orphans: 0,
    deleted: 0,
    exhausted: false,
    byPrefix: {},
    sampleOrphanUrls: [],
  };

  outer: for (const prefix of prefixes) {
    const bucket = { scanned: 0, orphans: 0, deleted: 0 };
    let cursor: string | undefined;
    do {
      const page = await deps.listStorage({ prefix, cursor, limit: pageLimit });
      for (const item of page.items) {
        // Time budget checado a CADA item (antes de processar) — o custo caro é
        // o isReferenced (até N counts), que roda pra todo item não-recente. Sem
        // isso, um bucket todo-referenciado nunca checaria o deadline e estouraria
        // o teto de 60s serverless. Sem cursor cross-run, a próxima execução
        // re-lista do começo (a rotação de startOffset dá a vez a cada prefixo);
        // no volume atual o bucket inteiro varre numa run só.
        if (deps.now() >= deadline) {
          result.exhausted = true;
          if (bucket.scanned > 0) result.byPrefix[prefix] = bucket;
          break outer;
        }
        result.scanned++;
        bucket.scanned++;
        // Carência: só considera blobs MAIS VELHOS que graceMs (protege o
        // upload-then-create — blob subido mas row ainda em voo). FAIL-SAFE: se
        // uploadedAt for inválido (getTime NaN), NÃO trata como velho — pula (o
        // `!(ts < cutoff)` cobre o NaN, que num `<` também dá false → protegido).
        const ts = item.uploadedAt.getTime();
        if (!(ts < graceCutoff)) {
          result.tooFresh++;
          continue;
        }
        if (await deps.isReferenced(item.url)) {
          result.referenced++;
          continue;
        }
        // Órfão confirmado (0 referências + mais velho que a carência).
        result.orphans++;
        bucket.orphans++;
        if (result.sampleOrphanUrls.length < sampleCap) {
          result.sampleOrphanUrls.push(item.url);
        }
        if (opts.apply) {
          if (await deps.deleteBlob(item.url)) {
            result.deleted++;
            bucket.deleted++;
          }
        }
      }
      cursor = page.hasMore ? page.cursor ?? undefined : undefined;
    } while (cursor);
    if (bucket.scanned > 0) result.byPrefix[prefix] = bucket;
  }

  return result;
}
