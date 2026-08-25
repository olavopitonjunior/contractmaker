"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { toast } from "sonner";
import { FileText, FileUp, FolderUp, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MAX_BATCH_FILES,
  MAX_FILE_BYTES,
  addFilesToBatch,
  batchTotalBytes,
  collectDroppedFiles,
  describeAddOutcome,
  formatFileSize,
  removeBatchItem,
  type BatchItem,
} from "@/lib/ingestion/batch-selection";

/**
 * Ponto de partida do lote: monta a lista, sobe os arquivos direto pro Blob,
 * abre o `IngestionRun` e leva o operador pra tela de conferência.
 *
 * O lote é COMPOSTO antes de começar porque a análise decide olhando o conjunto
 * (o agrupamento por família é o que separa modelo de cláusula) e o seletor do
 * navegador abre uma pasta por vez: disparar na seleção condenava quem tem o
 * acervo espalhado em várias pastas a mandar só um pedaço. As regras da lista
 * moram em `lib/ingestion/batch-selection.ts`.
 *
 * O upload é client-direct porque o corpo de uma função serverless da Vercel
 * para em ~4.5MB e um acervo são dezenas de DOCX de até 20MB — o handshake em
 * `/runs/blob-upload` só emite o token. Depois disso, quem toca o lote é o
 * servidor: fechar a aba não perde o trabalho, que era exatamente o defeito da
 * orquestração no navegador.
 */
export function StartIngestionRunButton({
  orgId,
  trigger = "central",
  label = "Envie seus modelos de uma vez",
  variant = "default",
}: {
  /** Prefixo do Blob desta imobiliária — o handshake recusa qualquer outro. */
  orgId: string;
  trigger?: "central" | "onboarding";
  label?: string;
  variant?: "default" | "outline" | "secondary";
}) {
  const router = useRouter();
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Array<BatchItem<File>>>([]);
  // Espelho da lista para o handler do drop: entre colher os arquivos da pasta
  // e somá-los, outra seleção pode ter entrado — o closure ficaria velho.
  const itemsRef = useRef<Array<BatchItem<File>>>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  // `webkitdirectory` não existe na tipagem de `<input>` do React; só dá pra
  // ligar o seletor de pasta pelo DOM.
  useEffect(() => {
    if (!open) return;
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, [open]);

  const updateItems = useCallback((next: Array<BatchItem<File>>) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      const outcome = addFilesToBatch(itemsRef.current, incoming);
      updateItems(outcome.items);
      const warnings = describeAddOutcome(outcome);
      if (warnings.length > 0) toast.warning(warnings.join(" "));
    },
    [updateItems]
  );

  function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    // Zera o input pra escolher a MESMA pasta de novo disparar `change`.
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const transfer = event.dataTransfer;
    // A lista de itens do DataTransfer é esvaziada assim que o handler retorna:
    // `collectDroppedFiles` colhe as entries antes do primeiro await.
    void collectDroppedFiles<File>(
      transfer ? Array.from(transfer.items) : [],
      transfer ? Array.from(transfer.files) : []
    ).then(addFiles);
  }

  async function startRun() {
    const files = items.map((item) => item.file);
    if (files.length === 0) return;
    if (files.length > MAX_BATCH_FILES) {
      toast.error(`Envie no máximo ${MAX_BATCH_FILES} arquivos por lote.`);
      return;
    }
    const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      toast.error(`"${tooBig.name}" passa de 20MB — envie um arquivo menor.`);
      return;
    }

    setBusy(true);
    try {
      const uploaded: Array<{
        filename: string;
        blobUrl: string;
        fileKind: "docx" | "pdf";
        sourceHash: string;
        size: number;
      }> = [];

      for (const [index, file] of files.entries()) {
        setProgress(`Enviando ${index + 1} de ${files.length}…`);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const blob = await upload(`ingestion/${orgId}/${Date.now()}-${safeName}`, file, {
          access: "public",
          handleUploadUrl: "/api/templates/ingest/runs/blob-upload",
          contentType: file.type || "application/octet-stream",
        });
        uploaded.push({
          filename: file.name,
          blobUrl: blob.url,
          fileKind: isPdf(file) ? "pdf" : "docx",
          // O hash sai do navegador (que tem o arquivo em mãos) e governa só o
          // descarte SUGERIDO; a extração recalcula sobre os bytes lidos pelo
          // servidor, e é esse valor que decide duplicata de verdade.
          sourceHash: await sha256Hex(file),
          size: file.size,
        });
      }

      // O run só nasce com o lote inteiro no Blob: desistir no meio do upload
      // não pode deixar um lote pela metade na tela de conferência.
      setProgress("Abrindo o lote…");
      const res = await fetch("/api/templates/ingest/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger, files: uploaded }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Falha ao abrir o lote");

      updateItems([]);
      setOpen(false);
      router.push(`/templates/ingestion/${data.runId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar os arquivos");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const totalBytes = batchTotalBytes(items);

  return (
    <>
      <Button variant={variant} disabled={busy} onClick={() => setOpen(true)}>
        {busy ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <FileUp className="mr-1.5 h-4 w-4" />
        )}
        {progress ?? label}
      </Button>

      <Dialog
        open={open}
        // Fechar no meio do envio deixaria uploads correndo sem tela: enquanto
        // o lote sobe, o diálogo fica.
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Monte o lote antes de enviar</DialogTitle>
            <DialogDescription>
              Junte tudo de uma vez — contratos, propostas e cláusulas, de todas as suas pastas.
              A análise compara os documentos entre si, então um acervo completo dá um resultado
              muito melhor do que enviar aos poucos. Nada começa até você clicar em enviar.
            </DialogDescription>
          </DialogHeader>

          <input
            ref={filesInputRef}
            type="file"
            accept=".docx,.pdf"
            multiple
            className="hidden"
            onChange={handlePick}
          />
          {/* Sem `accept` no seletor de pasta: os navegadores tratam o filtro de
              forma diferente quando ele vem junto com `webkitdirectory`, e o
              descarte do que não é .docx/.pdf já é nosso, na entrada da lista. */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handlePick}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={[
              "rounded-xl border border-dashed p-5 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30",
            ].join(" ")}
          >
            <FolderUp className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">Arraste arquivos ou pastas inteiras aqui</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Aceitamos .docx e .pdf, até 20MB cada. Pode escolher várias vezes: a lista vai
              somando.
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => filesInputRef.current?.click()}
              >
                <FileUp className="mr-1.5 h-4 w-4" />
                Escolher arquivos
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderUp className="mr-1.5 h-4 w-4" />
                Escolher uma pasta
              </Button>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhum arquivo na lista ainda.
            </p>
          ) : (
            <ul className="max-h-64 divide-y overflow-y-auto rounded-xl border">
              {items.map((item) => (
                <li key={item.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate" title={item.file.name}>
                    {item.file.name}
                  </span>
                  <span className="flex-none text-xs text-muted-foreground">
                    {formatFileSize(item.file.size)}
                  </span>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Tirar ${item.file.name} da lista`}
                    onClick={() => updateItems(removeBatchItem(itemsRef.current, item.key))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <DialogFooter className="sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground sm:mr-auto">
              {items.length === 0
                ? `Até ${MAX_BATCH_FILES} arquivos por lote.`
                : `${items.length} ${items.length === 1 ? "arquivo" : "arquivos"} • ${formatFileSize(totalBytes)}`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={busy || items.length === 0}
                onClick={() => updateItems([])}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Limpar tudo
              </Button>
              <Button type="button" disabled={busy || items.length === 0} onClick={() => void startRun()}>
                {busy ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="mr-1.5 h-4 w-4" />
                )}
                {progress ??
                  (items.length === 1 ? "Enviar 1 arquivo" : `Enviar ${items.length} arquivos`)}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** SHA-256 hex do arquivo — mesma identidade de `ContractTemplate.sourceHash`. */
async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
