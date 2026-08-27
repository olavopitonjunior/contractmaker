/**
 * Composição do lote de ingestão — a lista que o operador monta ANTES de enviar.
 *
 * Por que a lista existe em vez de disparar na seleção: o pipeline decide
 * olhando o CONJUNTO (é o agrupamento por família, em `lib/ingestion/grouping.ts`,
 * que separa modelo de cláusula), e o seletor de arquivos do navegador só abre
 * UMA pasta por vez. Quem guarda o acervo espalhado em LOCAÇÃO/, VENDA/… mandava
 * um pedaço e recebia um plano pior sem ter como perceber. Aqui as seleções se
 * acumulam — arquivo a arquivo, pasta inteira ou arrastando — e o run só começa
 * quando o operador diz que a lista está completa.
 *
 * Módulo puro: nada de React e nada de DOM concreto. O que vem do navegador
 * entra por tipos estruturais, então o teste passa objetos simples.
 */

/** Mesmo teto do intake (`POST /api/templates/ingest/runs`). */
export const MAX_BATCH_FILES = 200;

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** O que a extração sabe ler; uma pasta do Drive sempre vem com outras coisas. */
export const ACCEPTED_EXTENSIONS = [".docx", ".pdf"] as const;

const ACCEPTED_EXTENSION_RE = /\.(docx|pdf)$/i;

/** Profundidade máxima ao percorrer pastas arrastadas — corta link circular. */
const MAX_DIRECTORY_DEPTH = 12;

/** O mínimo de um `File` que a composição do lote usa. */
export interface SelectableFile {
  name: string;
  size: number;
  lastModified: number;
}

export interface BatchItem<TFile extends SelectableFile = SelectableFile> {
  key: string;
  file: TFile;
}

/** Resultado de uma seleção: o que entrou e por que o resto ficou de fora. */
export interface AddOutcome<TFile extends SelectableFile = SelectableFile> {
  items: BatchItem<TFile>[];
  added: number;
  /** Já estava na lista (mesmo nome, tamanho e data). */
  duplicates: number;
  /** Não é .docx nem .pdf. */
  ignoredExtension: number;
  /** Nomes dos arquivos acima de `MAX_FILE_BYTES`. */
  tooLarge: string[];
  /** Recusados porque a lista bateu em `MAX_BATCH_FILES`. */
  overflow: number;
}

export function hasAcceptedExtension(filename: string): boolean {
  return ACCEPTED_EXTENSION_RE.test(filename);
}

/**
 * Identidade do item na lista. Nome + tamanho + data de modificação é tudo que
 * o navegador entrega de graça (ler os bytes para hashear na hora de escolher
 * travaria a tela num acervo inteiro). Duplicata de verdade — mesmo conteúdo com
 * outro nome — continua sendo problema do servidor, que hasheia os bytes.
 */
export function batchItemKey(file: SelectableFile): string {
  return `${file.size}:${file.lastModified}:${file.name}`;
}

/**
 * Soma uma seleção à lista já montada, aplicando os limites NA HORA — avisar
 * quando o arquivo entra é melhor que descobrir no fim do upload.
 */
export function addFilesToBatch<TFile extends SelectableFile>(
  current: readonly BatchItem<TFile>[],
  incoming: readonly TFile[]
): AddOutcome<TFile> {
  const items = [...current];
  const seen = new Set(items.map((item) => item.key));
  const outcome: AddOutcome<TFile> = {
    items,
    added: 0,
    duplicates: 0,
    ignoredExtension: 0,
    tooLarge: [],
    overflow: 0,
  };

  for (const file of incoming) {
    if (!hasAcceptedExtension(file.name)) {
      outcome.ignoredExtension += 1;
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      outcome.tooLarge.push(file.name);
      continue;
    }
    const key = batchItemKey(file);
    if (seen.has(key)) {
      outcome.duplicates += 1;
      continue;
    }
    if (items.length >= MAX_BATCH_FILES) {
      outcome.overflow += 1;
      continue;
    }
    seen.add(key);
    items.push({ key, file });
    outcome.added += 1;
  }

  return outcome;
}

export function removeBatchItem<TFile extends SelectableFile>(
  items: readonly BatchItem<TFile>[],
  key: string
): BatchItem<TFile>[] {
  return items.filter((item) => item.key !== key);
}

export function batchTotalBytes(items: readonly BatchItem[]): number {
  return items.reduce((total, item) => total + item.file.size, 0);
}

/** Tamanho legível em PT-BR ("820 KB", "1,4 MB"). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Avisos em PT-BR sobre o que ficou de fora — vazio quando entrou tudo. */
export function describeAddOutcome(outcome: AddOutcome): string[] {
  const messages: string[] = [];

  if (outcome.ignoredExtension > 0) {
    messages.push(
      outcome.ignoredExtension === 1
        ? "1 arquivo foi ignorado: lemos apenas .docx e .pdf."
        : `${outcome.ignoredExtension} arquivos foram ignorados: lemos apenas .docx e .pdf.`
    );
  }

  if (outcome.tooLarge.length === 1) {
    messages.push(`"${outcome.tooLarge[0]}" passa de 20MB e ficou de fora.`);
  } else if (outcome.tooLarge.length > 1) {
    messages.push(`${outcome.tooLarge.length} arquivos passam de 20MB e ficaram de fora.`);
  }

  if (outcome.duplicates > 0) {
    messages.push(
      outcome.duplicates === 1
        ? "1 arquivo já estava na lista."
        : `${outcome.duplicates} arquivos já estavam na lista.`
    );
  }

  if (outcome.overflow > 0) {
    messages.push(
      `A lista chegou no limite de ${MAX_BATCH_FILES} arquivos — ${outcome.overflow} ficaram de fora.`
    );
  }

  return messages;
}

// ────────────────────────────────────────────────────────────────────────────
// Arrastar e soltar (inclusive pastas)
// ────────────────────────────────────────────────────────────────────────────

export interface DirectoryReaderLike<TFile> {
  readEntries: (
    onSuccess: (entries: Array<FileSystemEntryLike<TFile>>) => void,
    onError?: (err: unknown) => void
  ) => void;
}

export interface FileSystemEntryLike<TFile> {
  isFile?: boolean;
  isDirectory?: boolean;
  file?: (onSuccess: (file: TFile) => void, onError?: (err: unknown) => void) => void;
  createReader?: () => DirectoryReaderLike<TFile>;
}

export interface DataTransferItemLike<TFile> {
  webkitGetAsEntry?: () => FileSystemEntryLike<TFile> | null;
}

/**
 * Converte o que foi solto na tela em arquivos, entrando nas pastas.
 *
 * `webkitGetAsEntry` só pode ser chamado ENQUANTO o handler do drop roda — a
 * lista de itens é esvaziada assim que ele devolve, então as entries são colhidas
 * de uma vez, antes de qualquer `await`. Sem a API (ou soltando algo que não é
 * pasta) caímos nos arquivos soltos direto, que é o comportamento antigo.
 */
export async function collectDroppedFiles<TFile>(
  items: ReadonlyArray<DataTransferItemLike<TFile>> | null | undefined,
  droppedFiles: readonly TFile[]
): Promise<TFile[]> {
  const entries: Array<FileSystemEntryLike<TFile>> = [];
  for (const item of items ?? []) {
    if (typeof item?.webkitGetAsEntry !== "function") continue;
    const entry = item.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) return [...droppedFiles];

  const files: TFile[] = [];
  for (const entry of entries) {
    await collectFromEntry(entry, files, 0);
  }
  return files;
}

async function collectFromEntry<TFile>(
  entry: FileSystemEntryLike<TFile>,
  out: TFile[],
  depth: number
): Promise<void> {
  if (entry.isFile && typeof entry.file === "function") {
    const file = await readEntryFile(entry);
    if (file) out.push(file);
    return;
  }
  if (!entry.isDirectory || typeof entry.createReader !== "function") return;
  if (depth >= MAX_DIRECTORY_DEPTH) return;

  const reader = entry.createReader();
  // `readEntries` devolve a pasta em blocos (o Chrome corta em 100) e sinaliza o
  // fim com um bloco vazio — sem o laço, uma pasta grande vem pela metade.
  for (;;) {
    const batch = await readEntryBatch(reader);
    if (batch.length === 0) return;
    for (const child of batch) {
      await collectFromEntry(child, out, depth + 1);
    }
  }
}

function readEntryFile<TFile>(entry: FileSystemEntryLike<TFile>): Promise<TFile | null> {
  return new Promise((resolve) => {
    try {
      entry.file?.(
        (file) => resolve(file),
        () => resolve(null)
      );
    } catch {
      resolve(null);
    }
  });
}

function readEntryBatch<TFile>(
  reader: DirectoryReaderLike<TFile>
): Promise<Array<FileSystemEntryLike<TFile>>> {
  return new Promise((resolve) => {
    try {
      reader.readEntries(
        (entries) => resolve(entries ?? []),
        () => resolve([])
      );
    } catch {
      resolve([]);
    }
  });
}
