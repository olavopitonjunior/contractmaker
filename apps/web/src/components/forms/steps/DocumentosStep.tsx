"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Upload, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentCard, type DocumentCardData } from "@/components/forms/DocumentCard";
import type { SelectGroup } from "@/components/forms/NativeSelect";
import {
  mapExtractedToForm,
  suggestAssignment,
  type DocumentKind,
  type ProcessedDocHint,
} from "@/lib/forms/extracted-to-form";

interface DocumentosStepProps {
  form: UseFormReturn<any>;
  token: string;
}

const MAX_FILES = 15;
const MAX_BYTES = 10 * 1024 * 1024;
const RESIZE_MAX_SIDE = 1500; // F5: was 2000 — reduce payload ~40%
const IMAGE_JPEG_QUALITY = 0.8; // F5: was 0.85
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ACCEPTED_MIMES = [...IMAGE_MIMES, "application/pdf"];
// Upload has a wide pool (4 concurrent fetches) — it's just HTTP to our own
// Blob/S3 storage and doesn't hit Gemini.
const UPLOAD_CONCURRENCY = 4;
// OCR batch window: once the first doc is queued for OCR, wait up to
// BATCH_WINDOW_MS for more docs to arrive, then flush the batch (up to
// BATCH_MAX_SIZE per request). Amortizes Gemini latency by sending multiple
// docs in 1 call. Server enforces max 4 per batch.
const BATCH_WINDOW_MS = 1500;
const BATCH_MAX_SIZE = 3;
// How many parallel batch requests can fly at once. Each carries up to 3 docs
// so effective OCR concurrency is ~6 — but as 2 batches (not 6 individual RPM).
const BATCH_CONCURRENCY = 2;

/**
 * Tiny inline pLimit — runs at most `concurrency` async tasks at the same time.
 * Used to parallelize multi-file upload + OCR without overwhelming Gemini or
 * exhausting the browser's per-origin fetch budget.
 */
function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active--;
    if (queue.length > 0) {
      const fn = queue.shift();
      fn?.();
    }
  };
  return <T,>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then((v) => {
            resolve(v);
            next();
          })
          .catch((e) => {
            reject(e);
            next();
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

async function resizeImage(file: File, maxSide: number): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    if (longest <= maxSide) return file;
    const ratio = maxSide / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", IMAGE_JPEG_QUALITY)
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

interface FormSlotData {
  vendedores?: any[];
  compradores?: any[];
  imoveis?: any[];
}

function slotName(
  kind: DocumentKind,
  index: number,
  snapshot: FormSlotData,
  docs: DocumentCardData[]
): string | null {
  // 1. Form-typed name takes precedence
  const list =
    kind === "vendedor"
      ? snapshot.vendedores
      : kind === "comprador"
      ? snapshot.compradores
      : kind === "imovel"
      ? snapshot.imoveis
      : null;
  const slot = list?.[index];
  if (slot) {
    if (kind === "imovel") {
      const rua = slot.rua as string | undefined;
      const numero = slot.numero as string | undefined;
      if (rua) return numero ? `${rua}, ${numero}` : rua;
    } else {
      const nome = (slot.nome || slot.razao_social) as string | undefined;
      if (nome && nome.trim()) return nome.trim();
    }
  }
  // 2. Fall back to a doc already assigned to this slot with extracted name
  const docInSlot = docs.find(
    (d) =>
      d.assignment.kind === kind &&
      d.assignment.index === index &&
      d.fields &&
      d.status === "ready"
  );
  if (docInSlot?.fields) {
    if (kind === "imovel") {
      const rua = docInSlot.fields.endereco_completo || docInSlot.fields.endereco;
      if (typeof rua === "string" && rua.trim()) return rua.trim().slice(0, 40);
    } else {
      const nome = docInSlot.fields.nome_completo || docInSlot.fields.titular_nome;
      if (typeof nome === "string" && nome.trim()) return nome.trim();
    }
  }
  return null;
}

function buildAssignmentOptions(
  snapshot: FormSlotData,
  docs: DocumentCardData[]
): SelectGroup[] {
  // Compute the visible count for each kind: max of (form snapshot length,
  // highest index any doc is assigned to + 1, default 1)
  const maxAssigned = (kind: DocumentKind) =>
    docs.reduce(
      (m, d) => (d.assignment.kind === kind ? Math.max(m, d.assignment.index) : m),
      -1
    );
  const vCount = Math.max(
    1,
    snapshot.vendedores?.length ?? 1,
    maxAssigned("vendedor") + 1
  );
  const cCount = Math.max(
    1,
    snapshot.compradores?.length ?? 1,
    maxAssigned("comprador") + 1
  );
  const iCount = Math.max(
    1,
    snapshot.imoveis?.length ?? 1,
    maxAssigned("imovel") + 1
  );

  const buildKindOptions = (
    kind: DocumentKind,
    count: number,
    singularLabel: string
  ) => {
    const opts: Array<{ value: string; label: string }> = [];
    for (let i = 0; i < count; i++) {
      const name = slotName(kind, i, snapshot, docs);
      const ord = `${singularLabel} ${i + 1}`;
      opts.push({
        value: `${kind}:${i}`,
        label: name ? `${ord} — ${name}` : ord,
      });
    }
    opts.push({ value: `${kind}:new`, label: `+ Novo ${singularLabel.toLowerCase()}` });
    return opts;
  };

  return [
    {
      label: "Vendedores",
      options: buildKindOptions("vendedor", vCount, "Vendedor"),
    },
    {
      label: "Compradores",
      options: buildKindOptions("comprador", cCount, "Comprador"),
    },
    {
      label: "Imóveis",
      options: buildKindOptions("imovel", iCount, "Imóvel"),
    },
    {
      label: "Outros",
      options: [{ value: "outro:0", label: "Outros (sem aplicar)" }],
    },
  ];
}

export function DocumentosStep({ form, token }: DocumentosStepProps) {
  const [docs, setDocs] = useState<DocumentCardData[]>([]);
  const [dragging, setDragging] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore previously uploaded attachments. Documents without extractedData
  // are marked as "failed" (instead of the misleading "uploading") so the user
  // can retry or remove them — they have been uploaded but never extracted,
  // which almost always means the last extraction attempt hit a 500/timeout.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/forms/${token}/attachments`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const snapshot = form.getValues();
        const restored: DocumentCardData[] = (data.attachments || []).map((a: any) => {
          const extracted = a.extractedData || {};
          const fields = extracted.fields || null;
          const assignment = suggestAssignment(a.category, fields || {}, snapshot);
          const hasExtraction = !!a.extractedData && !!extracted.fields;
          return {
            id: a.id,
            filename: a.filename,
            mime: a.mime,
            fileUrl: a.fileUrl,
            status: hasExtraction ? "ready" : "failed",
            category: a.category,
            fields,
            confidence: typeof extracted.confidence === "number" ? extracted.confidence : null,
            assignment,
            error: hasExtraction
              ? null
              : "Extração pendente — clique em Tentar novamente ou remova o documento",
          };
        });
        setDocs(restored);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };

  }, [token]);

  const updateDoc = useCallback((id: string, patch: Partial<DocumentCardData>) => {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  // Ensure the form's vendedores/compradores/imoveis array has at least
  // `index + 1` entries. Used by both auto-grow (suggestAssignment putting a
  // doc on a slot that doesn't exist yet) and the manual "+ Novo" action.
  const ensureSlot = useCallback(
    (kind: DocumentKind, index: number) => {
      if (kind === "outro") return;
      const fieldKey =
        kind === "imovel" ? "imoveis" : kind === "vendedor" ? "vendedores" : "compradores";
      const current = (form.getValues(fieldKey) as any[] | undefined) ?? [];
      if (current.length > index) return;
      const next = [...current];
      while (next.length <= index) {
        next.push({ tipo_pessoa: "fisica" });
      }
      form.setValue(fieldKey, next as never, { shouldDirty: true });
    },
    [form]
  );

  // Applies the OCR result for a single attachment to its card. Runs inside
  // a setDocs callback so parallel calls see the freshest state — prevents
  // stale-siblings bugs when multiple docs resolve out of order.
  const applyExtractResult = useCallback(
    (
      attachmentId: string,
      category: string | null,
      fields: Record<string, unknown>,
      confidence: number | null
    ) => {
      setDocs((prev) => {
        const snapshot = form.getValues();
        const siblings: ProcessedDocHint[] = prev
          .filter((d) => d.id !== attachmentId && d.status === "ready" && d.fields)
          .map((d) => ({
            category: d.category,
            fields: d.fields,
            assignment: d.assignment,
          }));
        const assignment = suggestAssignment(
          category,
          fields,
          snapshot,
          siblings
        );
        ensureSlot(assignment.kind, assignment.index);
        return prev.map((d) =>
          d.id === attachmentId
            ? {
                ...d,
                status: "ready",
                category,
                fields,
                confidence,
                assignment,
              }
            : d
        );
      });
    },
    [form, ensureSlot]
  );

  // Single-doc OCR via /extract — used by the manual retry button.
  const runExtract = useCallback(
    async (doc: DocumentCardData) => {
      updateDoc(doc.id, { status: "extracting", error: null });
      try {
        const res = await fetch(`/api/forms/${token}/attachments/${doc.id}/extract`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
          updateDoc(doc.id, {
            status: "failed",
            error: data.error || "Falha na extração",
          });
          return;
        }
        const extracted = data.extractedData || {};
        const fields = extracted.fields || {};
        const confidence =
          typeof extracted.confidence === "number" ? extracted.confidence : null;
        applyExtractResult(doc.id, data.category, fields, confidence);
      } catch (err) {
        updateDoc(doc.id, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [token, updateDoc, applyExtractResult]
  );

  // Multi-doc OCR via /batch-extract — sends up to 3 docs in a single Gemini
  // call. Used by handleFiles during burst uploads. Updates all docs in the
  // batch atomically when results come back.
  const runBatchExtract = useCallback(
    async (attachmentIds: string[]) => {
      attachmentIds.forEach((id) =>
        updateDoc(id, { status: "extracting", error: null })
      );
      try {
        const res = await fetch(
          `/api/forms/${token}/attachments/batch-extract`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attachmentIds }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          attachmentIds.forEach((id) =>
            updateDoc(id, {
              status: "failed",
              error: data.error || "Falha na extração em lote",
            })
          );
          return;
        }
        const results = (data.results ?? []) as Array<{
          attachmentId: string;
          ok: boolean;
          category: string | null;
          extractedData: { fields?: Record<string, unknown>; confidence?: number } | null;
          error: string | null;
        }>;
        for (const r of results) {
          if (!r.ok || !r.extractedData) {
            updateDoc(r.attachmentId, {
              status: "failed",
              error: r.error || "Falha na extração",
            });
            continue;
          }
          const fields = r.extractedData.fields || {};
          const confidence =
            typeof r.extractedData.confidence === "number"
              ? r.extractedData.confidence
              : null;
          applyExtractResult(r.attachmentId, r.category, fields, confidence);
        }
      } catch (err) {
        attachmentIds.forEach((id) =>
          updateDoc(id, {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    },
    [token, updateDoc, applyExtractResult]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      if (docs.length + arr.length > MAX_FILES) {
        toast.error(`Máximo de ${MAX_FILES} documentos por formulário`);
        return;
      }

      // Filter + dedupe + size validation up-front. Each accepted file gets
      // a temporary card and runs its full pipeline (resize → upload → extract)
      // through the pLimit throttle so multiple files run in parallel without
      // blowing up Gemini concurrency or the browser's per-origin fetch limit.
      const validFiles: Array<{ rawFile: File; tempId: string }> = [];
      for (const rawFile of arr) {
        if (!ACCEPTED_MIMES.includes(rawFile.type)) {
          toast.error(`Tipo não suportado: ${rawFile.name}`);
          continue;
        }
        if (rawFile.size > MAX_BYTES) {
          toast.error(`${rawFile.name} excede 10 MB`);
          continue;
        }
        const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const tempDoc: DocumentCardData = {
          id: tempId,
          filename: rawFile.name,
          mime: rawFile.type,
          fileUrl: URL.createObjectURL(rawFile),
          status: "uploading",
          category: null,
          fields: null,
          confidence: null,
          assignment: { kind: "outro", index: 0 },
        };
        setDocs((prev) => [...prev, tempDoc]);
        validFiles.push({ rawFile, tempId });
      }

      if (validFiles.length === 0) return;
      if (validFiles.length > 1) {
        toast.info(`Processando ${validFiles.length} documentos em paralelo…`);
      }

      // F5 strategy:
      //   - Upload pool: 4 parallel fetches to Blob storage (fast, not Gemini)
      //   - OCR batch scheduler: docs queue up as uploads complete; scheduler
      //     flushes every BATCH_WINDOW_MS (1.5s) or when BATCH_MAX_SIZE (3)
      //     docs are queued, whichever first. Each flush sends 1 batch request
      //     that OCRs up to 3 docs in a single Gemini call.
      //   - Batch request pool: BATCH_CONCURRENCY (2) parallel batches → at
      //     most ~6 docs being OCR'd at once, but only 2 concurrent requests
      //     vs Gemini (respects RPM).
      const uploadLimit = pLimit(UPLOAD_CONCURRENCY);
      const batchRequestLimit = pLimit(BATCH_CONCURRENCY);

      // Batch scheduler state (closure-scoped, lives for this handleFiles call)
      type PendingDoc = { id: string; resolve: () => void };
      const pending: PendingDoc[] = [];
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const inflightBatches: Promise<void>[] = [];

      const flushBatch = () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (pending.length === 0) return;
        const slice = pending.splice(0, BATCH_MAX_SIZE);
        const ids = slice.map((p) => p.id);
        inflightBatches.push(
          batchRequestLimit(async () => {
            try {
              await runBatchExtract(ids);
            } finally {
              slice.forEach((p) => p.resolve());
            }
          })
        );
        // If more docs remain, schedule the next flush so the queue drains
        if (pending.length > 0) scheduleFlush();
      };

      const scheduleFlush = () => {
        if (flushTimer) return; // already scheduled
        flushTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
      };

      const enqueueForOcr = (doc: DocumentCardData): Promise<void> =>
        new Promise<void>((resolve) => {
          pending.push({ id: doc.id, resolve });
          if (pending.length >= BATCH_MAX_SIZE) {
            flushBatch();
          } else {
            scheduleFlush();
          }
        });

      type UploadOutcome = { doc: DocumentCardData; cached: boolean } | null;

      const doUpload = async (
        rawFile: File,
        tempId: string
      ): Promise<UploadOutcome> => {
        try {
          const file = IMAGE_MIMES.includes(rawFile.type)
            ? await resizeImage(rawFile, RESIZE_MAX_SIDE)
            : rawFile;

          const body = new FormData();
          body.append("file", file);
          const uploadRes = await fetch(`/api/forms/${token}/attachments`, {
            method: "POST",
            body,
          });
          const uploadData = await uploadRes.json();
          if (!uploadRes.ok) {
            setDocs((prev) =>
              prev.map((d) =>
                d.id === tempId
                  ? { ...d, status: "failed", error: uploadData.error || "Falha no upload" }
                  : d
              )
            );
            return null;
          }

          // Upload route pre-warms the content-hash cache: if the same file
          // content has already been OCRed in this org, the server copies the
          // cached result onto the new attachment and returns { cached: true,
          // category, extractedData }. We can skip the OCR call entirely and
          // apply the result straight to the card.
          if (uploadData.cached && uploadData.extractedData) {
            const fields =
              (uploadData.extractedData.fields as Record<string, unknown>) || {};
            const confidence =
              typeof uploadData.extractedData.confidence === "number"
                ? uploadData.extractedData.confidence
                : null;
            // Swap temp id for persisted id first so applyExtractResult finds it.
            setDocs((prev) =>
              prev.map((d) =>
                d.id === tempId
                  ? {
                      ...d,
                      id: uploadData.id,
                      fileUrl: uploadData.fileUrl,
                    }
                  : d
              )
            );
            applyExtractResult(
              uploadData.id,
              uploadData.category ?? null,
              fields,
              confidence
            );
            return {
              doc: {
                id: uploadData.id,
                filename: rawFile.name,
                mime: rawFile.type,
                fileUrl: uploadData.fileUrl,
                status: "ready",
                category: uploadData.category ?? null,
                fields,
                confidence,
                assignment: { kind: "outro", index: 0 },
              },
              cached: true,
            };
          }

          // Promote temp card to persisted id. Status stays "extracting"
          // visually but the actual OCR call may be waiting in the ocrLimit
          // queue — for the user, both look like "Analisando…".
          setDocs((prev) =>
            prev.map((d) =>
              d.id === tempId
                ? {
                    ...d,
                    id: uploadData.id,
                    fileUrl: uploadData.fileUrl,
                    status: "extracting",
                  }
                : d
            )
          );

          return {
            doc: {
              id: uploadData.id,
              filename: rawFile.name,
              mime: rawFile.type,
              fileUrl: uploadData.fileUrl,
              status: "extracting",
              category: null,
              fields: null,
              confidence: null,
              assignment: { kind: "outro", index: 0 },
            },
            cached: false,
          };
        } catch (err) {
          setDocs((prev) =>
            prev.map((d) =>
              d.id === tempId
                ? {
                    ...d,
                    status: "failed",
                    error: err instanceof Error ? err.message : String(err),
                  }
                : d
            )
          );
          return null;
        }
      };

      const tasks = validFiles.map(({ rawFile, tempId }) =>
        uploadLimit(() => doUpload(rawFile, tempId)).then((outcome) => {
          if (!outcome) return;
          // Cached uploads are already fully resolved — skip the OCR scheduler.
          if (outcome.cached) return;
          // Upload slot is released; doc is enqueued in the OCR batch scheduler
          // which will flush it within BATCH_WINDOW_MS (1500ms) or sooner if
          // BATCH_MAX_SIZE (3) other docs arrive in the meantime.
          return enqueueForOcr(outcome.doc);
        })
      );

      await Promise.allSettled(tasks);
      // Force a final flush — if fewer than BATCH_MAX_SIZE docs are still
      // pending at this point, they'd otherwise wait for the timer.
      flushBatch();
      await Promise.allSettled(inflightBatches);
    },
    [docs.length, token, runBatchExtract]
  );

  const handleAssignmentChange = useCallback(
    (id: string, assignmentValue: string) => {
      const [rawKind, rawIdx] = assignmentValue.split(":");
      const kind = rawKind as DocumentKind;
      let index: number;
      if (rawIdx === "new") {
        // "+ Novo X" — append a fresh slot to the form array and assign here
        const fieldKey =
          kind === "imovel"
            ? "imoveis"
            : kind === "vendedor"
            ? "vendedores"
            : kind === "comprador"
            ? "compradores"
            : null;
        if (!fieldKey) return;
        const current = (form.getValues(fieldKey) as any[] | undefined) ?? [];
        index = current.length;
        ensureSlot(kind, index);
        toast.success(
          `${kind === "imovel" ? "Imóvel" : kind === "vendedor" ? "Vendedor" : "Comprador"} ${index + 1} criado`
        );
      } else {
        index = Number(rawIdx) || 0;
        ensureSlot(kind, index);
      }
      updateDoc(id, { assignment: { kind, index }, applied: false });
    },
    [updateDoc, form, ensureSlot]
  );

  const handleRemove = useCallback(
    async (id: string) => {
      setDocs((prev) => prev.filter((d) => d.id !== id));
      if (!id.startsWith("tmp-")) {
        try {
          await fetch(`/api/forms/${token}/attachments?id=${id}`, { method: "DELETE" });
        } catch {
          /* ignore */
        }
      }
    },
    [token]
  );

  const handleRetry = useCallback(
    (id: string) => {
      const doc = docs.find((d) => d.id === id);
      if (doc) runExtract(doc);
    },
    [docs, runExtract]
  );

  const handleApply = useCallback(async () => {
    const readyDocs = docs.filter(
      (d) => d.status === "ready" && d.fields && d.assignment.kind !== "outro"
    );
    if (readyDocs.length === 0) {
      toast.info("Nenhum documento pronto para aplicar");
      return;
    }
    let totalFields = 0;
    for (const doc of readyDocs) {
      const count = mapExtractedToForm(
        { category: doc.category, fields: doc.fields || {}, confidence: doc.confidence ?? 0 },
        doc.assignment,
        form as UseFormReturn<Record<string, unknown>>,
        { skipIfDirty: true }
      );
      totalFields += count;
      updateDoc(doc.id, { applied: true });

      fetch(`/api/forms/${token}/attachments?id=${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment: doc.assignment }),
      }).catch(() => {
        /* non-blocking */
      });
    }
    toast.success(
      `${readyDocs.length} documento(s) aplicado(s) — ${totalFields} campo(s) preenchido(s)`
    );
  }, [docs, form, token, updateDoc]);

  const snapshot = form.getValues();
  const assignmentOptions = buildAssignmentOptions(snapshot, docs);
  const readyCount = docs.filter((d) => d.status === "ready").length;
  // Only block "Aplicar aos campos" while files are still UPLOADING. Extractions
  // can take up to 60s per file (Gemini) and one failed extraction should not
  // block applying the successful ones.
  const hasUploading = docs.some((d) => d.status === "uploading");
  const hasPending = docs.some((d) => d.status === "uploading" || d.status === "extracting");

  return (
    <div className="space-y-4">
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Anexe os documentos (opcional)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Envie RG, CPF, comprovante de residência, matrícula, IPTU, escritura ou procuração.
            O sistema identifica cada documento e preenche automaticamente os campos do formulário.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Clique ou arraste arquivos aqui
            </p>
            <p className="text-xs text-muted-foreground">
              JPG, PNG, WebP ou PDF — até 10 MB por arquivo
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_MIMES.join(",")}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </CardContent>
      </Card>

      {docs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {docs.length} documento(s) {hasPending && "— processando…"}
            </p>
            <Button
              type="button"
              onClick={handleApply}
              disabled={readyCount === 0 || hasUploading}
              size="sm"
            >
              Aplicar aos campos ({readyCount})
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {docs.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                assignmentOptions={assignmentOptions}
                onAssignmentChange={handleAssignmentChange}
                onRemove={handleRemove}
                onRetry={handleRetry}
              />
            ))}
          </div>
        </div>
      )}

      {hydrated && docs.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          Sem documentos anexados. Você pode pular esta etapa e preencher manualmente.
        </p>
      )}
    </div>
  );
}
