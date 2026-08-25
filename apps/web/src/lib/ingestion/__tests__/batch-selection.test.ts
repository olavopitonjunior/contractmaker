import { describe, it, expect } from "vitest";
import {
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
  addFilesToBatch,
  batchItemKey,
  batchTotalBytes,
  collectDroppedFiles,
  describeAddOutcome,
  formatFileSize,
  hasAcceptedExtension,
  removeBatchItem,
  type BatchItem,
  type DataTransferItemLike,
  type FileSystemEntryLike,
  type SelectableFile,
} from "@/lib/ingestion/batch-selection";

function file(name: string, size = 1024, lastModified = 1_700_000_000_000): SelectableFile {
  return { name, size, lastModified };
}

function names(items: ReadonlyArray<BatchItem<SelectableFile>>): string[] {
  return items.map((item) => item.file.name);
}

describe("hasAcceptedExtension", () => {
  it("aceita docx e pdf em qualquer caixa", () => {
    expect(hasAcceptedExtension("Contrato.docx")).toBe(true);
    expect(hasAcceptedExtension("contrato.DOCX")).toBe(true);
    expect(hasAcceptedExtension("laudo.Pdf")).toBe(true);
  });

  it("recusa o resto", () => {
    expect(hasAcceptedExtension("planilha.xlsx")).toBe(false);
    expect(hasAcceptedExtension("foto.jpg")).toBe(false);
    expect(hasAcceptedExtension("contrato.docx.bak")).toBe(false);
    expect(hasAcceptedExtension("README")).toBe(false);
  });
});

describe("addFilesToBatch", () => {
  it("acumula seleções de pastas diferentes", () => {
    const residencial = addFilesToBatch([], [file("res-1.docx"), file("res-2.docx")]);
    const comercial = addFilesToBatch(residencial.items, [file("com-1.pdf")]);

    expect(residencial.added).toBe(2);
    expect(comercial.added).toBe(1);
    expect(names(comercial.items)).toEqual(["res-1.docx", "res-2.docx", "com-1.pdf"]);
  });

  it("não duplica o mesmo arquivo escolhido duas vezes", () => {
    const first = addFilesToBatch([], [file("contrato.docx", 2048, 111)]);
    const again = addFilesToBatch(first.items, [
      file("contrato.docx", 2048, 111),
      file("outro.docx", 4096, 222),
    ]);

    expect(again.duplicates).toBe(1);
    expect(again.added).toBe(1);
    expect(names(again.items)).toEqual(["contrato.docx", "outro.docx"]);
  });

  it("separa homônimos com tamanho ou data diferentes", () => {
    const outcome = addFilesToBatch(
      [],
      [file("contrato.docx", 2048, 111), file("contrato.docx", 9999, 111), file("contrato.docx", 2048, 222)]
    );

    expect(outcome.added).toBe(3);
    expect(outcome.duplicates).toBe(0);
    expect(new Set(outcome.items.map((item) => item.key)).size).toBe(3);
  });

  it("dedup dentro da MESMA seleção", () => {
    const outcome = addFilesToBatch([], [file("a.docx", 10, 1), file("a.docx", 10, 1)]);
    expect(outcome.added).toBe(1);
    expect(outcome.duplicates).toBe(1);
  });

  it("filtra o que não é docx/pdf e conta os ignorados", () => {
    const outcome = addFilesToBatch(
      [],
      [file("contrato.docx"), file("planilha.xlsx"), file("logo.png"), file("laudo.pdf")]
    );

    expect(names(outcome.items)).toEqual(["contrato.docx", "laudo.pdf"]);
    expect(outcome.ignoredExtension).toBe(2);
    expect(outcome.added).toBe(2);
  });

  it("recusa arquivo acima do teto no momento em que ele entra", () => {
    const outcome = addFilesToBatch(
      [],
      [file("gigante.pdf", MAX_FILE_BYTES + 1), file("ok.docx", MAX_FILE_BYTES)]
    );

    expect(outcome.tooLarge).toEqual(["gigante.pdf"]);
    expect(names(outcome.items)).toEqual(["ok.docx"]);
  });

  it("para no limite de arquivos e reporta o excedente", () => {
    const many = Array.from({ length: MAX_BATCH_FILES + 3 }, (_, i) => file(`doc-${i}.docx`, 10, i));
    const outcome = addFilesToBatch([], many);

    expect(outcome.items).toHaveLength(MAX_BATCH_FILES);
    expect(outcome.added).toBe(MAX_BATCH_FILES);
    expect(outcome.overflow).toBe(3);
  });

  it("não altera a lista recebida", () => {
    const current = addFilesToBatch([], [file("a.docx")]).items;
    addFilesToBatch(current, [file("b.docx", 20, 2)]);
    expect(current).toHaveLength(1);
  });
});

describe("removeBatchItem / batchTotalBytes", () => {
  it("remove item a item pela chave", () => {
    const { items } = addFilesToBatch(
      [],
      [file("a.docx", 10, 1), file("b.docx", 20, 2), file("c.pdf", 30, 3)]
    );
    const left = removeBatchItem(items, batchItemKey(file("b.docx", 20, 2)));

    expect(names(left)).toEqual(["a.docx", "c.pdf"]);
    expect(items).toHaveLength(3);
  });

  it("soma o tamanho total", () => {
    const { items } = addFilesToBatch([], [file("a.docx", 10, 1), file("b.docx", 20, 2)]);
    expect(batchTotalBytes(items)).toBe(30);
    expect(batchTotalBytes([])).toBe(0);
  });

  it("readicionar depois de remover volta a funcionar", () => {
    const first = addFilesToBatch([], [file("a.docx", 10, 1)]);
    const left = removeBatchItem(first.items, first.items[0].key);
    const again = addFilesToBatch(left, [file("a.docx", 10, 1)]);

    expect(again.added).toBe(1);
    expect(again.duplicates).toBe(0);
  });
});

describe("formatFileSize", () => {
  it("usa KB abaixo de 1MB e MB acima, com vírgula decimal", () => {
    expect(formatFileSize(0)).toBe("0 KB");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1,0 MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });

  it("arquivo minúsculo não vira 0 KB", () => {
    expect(formatFileSize(12)).toBe("1 KB");
  });
});

describe("describeAddOutcome", () => {
  it("não avisa nada quando entrou tudo", () => {
    const outcome = addFilesToBatch([], [file("a.docx")]);
    expect(describeAddOutcome(outcome)).toEqual([]);
  });

  it("conta ignorados por extensão no singular e no plural", () => {
    const um = addFilesToBatch([], [file("x.png")]);
    expect(describeAddOutcome(um)[0]).toBe("1 arquivo foi ignorado: lemos apenas .docx e .pdf.");

    const varios = addFilesToBatch([], [file("x.png"), file("y.xlsx")]);
    expect(describeAddOutcome(varios)[0]).toBe(
      "2 arquivos foram ignorados: lemos apenas .docx e .pdf."
    );
  });

  it("nomeia o arquivo grande demais quando é só um", () => {
    const outcome = addFilesToBatch([], [file("gigante.pdf", MAX_FILE_BYTES + 1)]);
    expect(describeAddOutcome(outcome)).toContain('"gigante.pdf" passa de 20MB e ficou de fora.');
  });

  it("avisa duplicata e estouro de limite", () => {
    const cheio = addFilesToBatch(
      [],
      Array.from({ length: MAX_BATCH_FILES }, (_, i) => file(`d-${i}.docx`, 10, i))
    );
    const outcome = addFilesToBatch(cheio.items, [file("d-0.docx", 10, 0), file("novo.docx", 10, -1)]);
    const messages = describeAddOutcome(outcome);

    expect(messages).toContain("1 arquivo já estava na lista.");
    expect(messages).toContain(
      `A lista chegou no limite de ${MAX_BATCH_FILES} arquivos — 1 ficaram de fora.`
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Arrastar e soltar
// ────────────────────────────────────────────────────────────────────────────

type FakeFile = { name: string };

function fileEntry(name: string): FileSystemEntryLike<FakeFile> {
  return {
    isFile: true,
    isDirectory: false,
    file: (onSuccess) => onSuccess({ name }),
  };
}

/** Diretório que devolve as entries em blocos, como o Chrome faz. */
function dirEntry(
  children: Array<FileSystemEntryLike<FakeFile>>,
  chunk = 2
): FileSystemEntryLike<FakeFile> {
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let cursor = 0;
      return {
        readEntries: (onSuccess) => {
          const batch = children.slice(cursor, cursor + chunk);
          cursor += batch.length;
          onSuccess(batch);
        },
      };
    },
  };
}

function item(entry: FileSystemEntryLike<FakeFile> | null): DataTransferItemLike<FakeFile> {
  return { webkitGetAsEntry: () => entry };
}

describe("collectDroppedFiles", () => {
  it("percorre pastas e subpastas recursivamente", async () => {
    const acervo = dirEntry([
      dirEntry([fileEntry("res-1.docx"), fileEntry("res-2.docx"), fileEntry("res-3.docx")]),
      dirEntry([fileEntry("com-1.docx")]),
      fileEntry("leia-me.txt"),
    ]);

    const files = await collectDroppedFiles([item(acervo)], []);

    expect(files.map((f) => f.name)).toEqual([
      "res-1.docx",
      "res-2.docx",
      "res-3.docx",
      "com-1.docx",
      "leia-me.txt",
    ]);
  });

  it("lê a pasta até o bloco vazio, sem parar no primeiro lote", async () => {
    const children = Array.from({ length: 7 }, (_, i) => fileEntry(`doc-${i}.docx`));
    const files = await collectDroppedFiles([item(dirEntry(children, 2))], []);
    expect(files).toHaveLength(7);
  });

  it("mistura arquivo solto com pasta na mesma soltada", async () => {
    const files = await collectDroppedFiles(
      [item(fileEntry("avulso.pdf")), item(dirEntry([fileEntry("dentro.docx")]))],
      []
    );
    expect(files.map((f) => f.name)).toEqual(["avulso.pdf", "dentro.docx"]);
  });

  it("degrada para os arquivos soltos quando não há webkitGetAsEntry", async () => {
    const files = await collectDroppedFiles<FakeFile>([{}], [{ name: "solto.docx" }]);
    expect(files.map((f) => f.name)).toEqual(["solto.docx"]);
  });

  it("degrada quando o DataTransfer não traz itens", async () => {
    const files = await collectDroppedFiles<FakeFile>(null, [{ name: "solto.docx" }]);
    expect(files.map((f) => f.name)).toEqual(["solto.docx"]);
  });

  it("ignora item sem entry (soltar texto junto)", async () => {
    const files = await collectDroppedFiles([item(null), item(fileEntry("bom.docx"))], []);
    expect(files.map((f) => f.name)).toEqual(["bom.docx"]);
  });

  it("não trava se a leitura da pasta falhar", async () => {
    const quebrado: FileSystemEntryLike<FakeFile> = {
      isDirectory: true,
      createReader: () => ({
        readEntries: (_onSuccess, onError) => onError?.(new Error("permissão negada")),
      }),
    };
    await expect(collectDroppedFiles([item(quebrado)], [])).resolves.toEqual([]);
  });

  it("o que sai do drop passa pelo mesmo filtro da lista", async () => {
    const dropped = await collectDroppedFiles(
      [item(dirEntry([fileEntry("contrato.docx"), fileEntry("leia-me.txt")]))],
      []
    );
    const outcome = addFilesToBatch(
      [],
      dropped.map((f) => ({ name: f.name, size: 10, lastModified: 1 }))
    );

    expect(names(outcome.items)).toEqual(["contrato.docx"]);
    expect(outcome.ignoredExtension).toBe(1);
  });
});
