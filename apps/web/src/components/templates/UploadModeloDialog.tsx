"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check, CopyCheck, FileUp, Loader2, X } from "lucide-react";
import {
  UPLOAD_MODALIDADES,
  modalidadeLabel,
} from "@/lib/contracts/template-category";

const MODALIDADES = UPLOAD_MODALIDADES.map((value) => ({
  value,
  label: modalidadeLabel(value),
}));

type ItemState =
  | "aguardando"
  | "enviando"
  | "convertendo"
  | "ok"
  | "duplicado"
  | "erro";

type ExistingTemplate = {
  id: string;
  name: string;
  status: string;
  modalidade: string | null;
};

type QueueItem = {
  file: File;
  state: ItemState;
  templateId?: string;
  templateName?: string;
  existing?: ExistingTemplate;
  error?: string;
};

const STATE_LABEL: Record<ItemState, string> = {
  aguardando: "Na fila",
  enviando: "Enviando…",
  convertendo: "Convertendo e mapeando campos…",
  ok: "Importado",
  duplicado: "Já importado antes",
  erro: "Falhou",
};

/**
 * "Novo do modelo da imobiliária (DOCX)": sobe os documentos timbrados da
 * imobiliária, a IA insere os {{placeholders}} e o operador revisa antes de
 * ativar. O contrato gerado fica idêntico ao modelo (engine google_docs).
 *
 * Lote: a fila é SEQUENCIAL (1 request por vez) — o pipeline Drive + IA é
 * pesado e a rota aceita um arquivo por request. Arquivo já importado antes
 * volta 409 DUPLICATE_TEMPLATE e o operador escolhe pular ou forçar.
 */
export function UploadModeloDialog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [modalidade, setModalidade] = useState("locacao");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [done, setDone] = useState(false);

  function patchItem(index: number, patch: Partial<QueueItem>) {
    setQueue((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  }

  /** Um request. Devolve o item resolvido pra fila (ok | duplicado | erro). */
  async function uploadOne(
    file: File,
    index: number,
    opts: { force?: boolean; useName: boolean }
  ): Promise<Partial<QueueItem>> {
    patchItem(index, { state: "enviando", error: undefined, existing: undefined });
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("modalidade", modalidade);
      if (opts.useName && name.trim()) fd.append("name", name.trim());
      if (opts.force) fd.append("force", "true");
      patchItem(index, { state: "convertendo" });
      const res = await fetch("/api/templates/from-docx", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.code === "DUPLICATE_TEMPLATE") {
        return { state: "duplicado", existing: data.existing as ExistingTemplate };
      }
      if (!res.ok) throw new Error(data?.error ?? "Falha no upload");
      return {
        state: "ok",
        templateId: data.templateId as string,
        templateName: (data.name as string) ?? file.name,
      };
    } catch (err) {
      return {
        state: "erro",
        error: err instanceof Error ? err.message : "Falha no upload",
      };
    }
  }

  async function submit() {
    const files = Array.from(fileRef.current?.files ?? []);
    if (files.length === 0) {
      toast.error("Selecione ao menos um DOCX de modelo.");
      return;
    }
    // Nome manual só faz sentido com 1 arquivo — no lote cada um usa o nome
    // derivado do próprio arquivo (a API sufixa " (2)" em colisão).
    const useName = files.length === 1;
    const initial: QueueItem[] = files.map((file) => ({
      file,
      state: "aguardando" as ItemState,
    }));
    setQueue(initial);
    setDone(false);
    setBusy(true);

    const results: Partial<QueueItem>[] = [];
    for (let i = 0; i < files.length; i++) {
      const result = await uploadOne(files[i], i, { useName });
      patchItem(i, result);
      results.push(result);
    }
    setBusy(false);
    setDone(true);
    finish(results);
  }

  /** Fecha/redireciona conforme o resultado do lote. */
  function finish(results: Partial<QueueItem>[]) {
    const ok = results.filter((r) => r.state === "ok");
    const dup = results.filter((r) => r.state === "duplicado").length;
    const err = results.filter((r) => r.state === "erro").length;

    if (results.length === 1 && ok.length === 1) {
      toast.success("Modelo importado — revise os placeholders antes de ativar.");
      setOpen(false);
      router.push(`/templates/${ok[0].templateId}/review`);
      return;
    }
    if (ok.length > 0) {
      toast.success(
        `${ok.length} modelo(s) importado(s)` +
          (dup ? ` · ${dup} já existia(m)` : "") +
          (err ? ` · ${err} com erro` : "")
      );
      router.refresh();
      return;
    }
    if (dup > 0 && err === 0) {
      toast.info(`Nenhum modelo novo — ${dup} já estava(m) importado(s).`);
      return;
    }
    toast.error(`Nenhum modelo importado — ${err} falha(s).`);
  }

  /** "Enviar mesmo assim" no card de duplicata: refaz o item com force. */
  async function forceItem(index: number) {
    const item = queue[index];
    if (!item) return;
    setBusy(true);
    const result = await uploadOne(item.file, index, {
      force: true,
      useName: queue.length === 1,
    });
    patchItem(index, result);
    setBusy(false);
    if (result.state === "ok") {
      toast.success(`"${item.file.name}" importado.`);
      router.refresh();
    } else if (result.state === "erro") {
      toast.error(result.error ?? "Falha no upload");
    }
  }

  /** "Pular": marca a duplicata como resolvida sem criar nada. */
  function skipItem(index: number) {
    patchItem(index, { state: "duplicado", existing: undefined });
  }

  function reset() {
    setQueue([]);
    setDone(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const okCount = queue.filter((q) => q.state === "ok").length;
  const processed = queue.filter(
    (q) => q.state === "ok" || q.state === "duplicado" || q.state === "erro"
  ).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <FileUp className="mr-1.5 h-4 w-4" />
          Importar modelos da imobiliária (.docx)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modelos da imobiliária → templates</DialogTitle>
          <DialogDescription>
            Suba um ou vários DOCX timbrados. O layout (logo, fontes) é
            preservado; a IA insere os campos variáveis e você revisa antes de
            ativar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Arquivos (DOCX, até 20MB cada)</Label>
            <Input ref={fileRef} type="file" accept=".docx" multiple />
            <p className="text-xs text-muted-foreground">
              Vários arquivos são enviados em fila, um de cada vez.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Modalidade</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={modalidade}
              onChange={(e) => setModalidade(e.target.value)}
              disabled={busy}
            >
              {MODALIDADES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Vale para todos os arquivos do lote. Para modalidades diferentes,
              faça um envio por modalidade.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Nome do template (opcional)</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Locação residencial — padrão da casa"
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Só é usado quando você envia um único arquivo. No lote, o nome sai
              do nome de cada arquivo.
            </p>
          </div>

          {queue.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {processed} de {queue.length} processado(s)
                </span>
                {busy && <span>Não feche esta janela</span>}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${queue.length ? (processed / queue.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {queue.map((item, i) => (
                  <li
                    key={`${item.file.name}-${i}`}
                    className="rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="flex items-start gap-2">
                      <StateIcon state={item.state} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.state === "erro"
                            ? item.error
                            : STATE_LABEL[item.state]}
                        </p>
                      </div>
                      {item.state === "ok" && item.templateId && (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/templates/${item.templateId}/review`}>
                            Revisar
                          </Link>
                        </Button>
                      )}
                    </div>
                    {item.existing && (
                      <div className="mt-2 rounded-md bg-muted/60 px-2.5 py-2">
                        <p className="text-xs">
                          Já existe:{" "}
                          <Link
                            href={`/templates/${item.existing.id}/review`}
                            className="font-medium underline"
                          >
                            {item.existing.name}
                          </Link>{" "}
                          <span className="text-muted-foreground">
                            ({item.existing.status}
                            {item.existing.modalidade
                              ? ` · ${modalidadeLabel(item.existing.modalidade)}`
                              : ""}
                            )
                          </span>
                        </p>
                        <div className="mt-1.5 flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => skipItem(i)}
                          >
                            Pular
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => forceItem(i)}
                          >
                            Enviar mesmo assim
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {done && !busy ? (
            <div className="flex gap-2">
              <Button className="flex-1" variant="outline" onClick={reset}>
                Enviar outros
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setOpen(false);
                  reset();
                  if (okCount > 0) router.push("/templates");
                }}
              >
                Concluir
              </Button>
            </div>
          ) : (
            <Button className="w-full" onClick={submit} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Convertendo e mapeando campos…
                </>
              ) : (
                "Importar modelos"
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StateIcon({ state }: { state: ItemState }) {
  if (state === "ok")
    return <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />;
  if (state === "duplicado")
    return <CopyCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />;
  if (state === "erro")
    return <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
  if (state === "aguardando")
    return (
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
    );
  return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />;
}
