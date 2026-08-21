"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect, type SelectGroup } from "@/components/forms/NativeSelect";
import { mapExtractedToForm } from "@/lib/forms/extracted-to-form";
import {
  ACCEPTED_MIMES,
  rejectFileReason,
  uploadFormAttachment,
} from "@/lib/forms/attachment-upload";

/**
 * Anexo do formulário, no shape que o `GET /api/forms/[token]/attachments`
 * devolve (só os campos que este bloco precisa).
 */
export interface MatriculaAttachmentOption {
  id: string;
  filename: string;
  category: string | null;
  /** `{ fields, confidence }` gravado pelo OCR — null enquanto não extraído. */
  extractedData: {
    fields?: Record<string, unknown> | null;
    confidence?: number | null;
    /** Shapes legados gravavam a categoria dentro do payload. */
    category?: string | null;
    tipo?: string | null;
  } | null;
  status: string | null;
}

/**
 * A categoria canônica mora na COLUNA `category` do anexo, mas payloads antigos
 * (e o retorno de rotas de extração) carregavam `tipo`/`category` dentro do
 * `extractedData`. Ler os três evita que um anexo de matrícula legado apareça
 * com o botão de aplicar desabilitado sem explicação.
 */
function resolveCategory(att: MatriculaAttachmentOption): string | null {
  return att.category ?? att.extractedData?.category ?? att.extractedData?.tipo ?? null;
}

/** `true` quando o anexo tem OCR de matrícula pronto pra aplicar no imóvel. */
function hasMatriculaExtraction(att: MatriculaAttachmentOption | null): boolean {
  if (!att) return false;
  const fields = att.extractedData?.fields;
  if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) {
    return false;
  }
  return resolveCategory(att) === "matricula";
}

interface MatriculaSituacaoFieldProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  /** Índice do imóvel no field array — vira `imoveis.${index}.*`. */
  index: number;
  /**
   * Anexos já carregados pelo pai. `null` = ainda buscando (ou nunca buscado);
   * `[]` = o formulário não tem nenhum anexo.
   */
  attachments: MatriculaAttachmentOption[] | null;
  /**
   * Raiz dos anexos do formulário (`/api/forms/<token>/attachments`).
   * `undefined` no subtoken por parte, que não tem rota de anexos: sem ela
   * escondemos select e upload e só orientamos a anexar pelo link principal.
   */
  attachmentsEndpoint?: string;
  /**
   * Pede ao pai um refetch da lista e devolve o resultado. `force` pula a
   * deduplicação de chamadas — é o que o polling do upload precisa para não
   * receber de volta a lista anterior à criação do anexo.
   */
  onRequestAttachments: (
    force?: boolean
  ) => Promise<MatriculaAttachmentOption[] | null>;
}

/** Intervalo e teto do polling de extração (60s no total). */
const POLL_MS = 3000;
const POLL_TRIES = 20;

/**
 * Bloco "situação da matrícula" do imóvel: o radio que decide se a matrícula
 * atualizada já existe ou ainda precisa ser pedida no cartório.
 *
 * Existe como componente próprio (e não inline no ImovelStep) porque cada
 * imóvel precisa dos próprios hooks — `form.watch` do radio e o efeito que
 * dispara o refetch de anexos —, e o ImovelStep renderiza os imóveis dentro de
 * um `.map`, onde hooks não podem viver.
 */
export function MatriculaSituacaoField({
  form,
  index,
  attachments,
  attachmentsEndpoint,
  onRequestAttachments,
}: MatriculaSituacaoFieldProps) {
  const canListAttachments = !!attachmentsEndpoint;
  const prefix = `imoveis.${index}`;
  const situacao: string = form.watch(`${prefix}.matricula_situacao`) ?? "";
  const attachmentId: string = form.watch(`${prefix}.matricula_attachment_id`) ?? "";
  const attachmentFilename: string =
    form.watch(`${prefix}.matricula_attachment_filename`) ?? "";

  // Só buscamos a lista quando ela vai de fato ser mostrada. O pai deduplica
  // chamadas concorrentes, então o efeito pode disparar junto com o de montagem
  // sem virar dois GETs.
  useEffect(() => {
    if (situacao === "possui" && canListAttachments) onRequestAttachments();
  }, [situacao, canListAttachments, onRequestAttachments]);

  const setSituacao = (value: string) => {
    form.setValue(`${prefix}.matricula_situacao`, value, { shouldDirty: true });
  };

  const selected =
    attachments?.find((a) => a.id === attachmentId) ?? null;
  // Anexo apagado depois de escolhido: o id continua no dataJson mas sumiu do
  // GET. Em vez de deixar o `<select>` cair calado na primeira opção (o que
  // mentiria sobre qual documento está vinculado), mantemos o id como opção
  // rotulada — o operador vê que precisa escolher outro.
  const selectionMissing =
    attachments !== null && attachmentId !== "" && selected === null;

  const groups: SelectGroup[] = [];
  if (selectionMissing) {
    groups.push({
      label: "Seleção anterior",
      options: [
        {
          value: attachmentId,
          label: attachmentFilename
            ? `${attachmentFilename} — anexo removido, selecione outro`
            : "Anexo removido — selecione outro",
        },
      ],
    });
  }
  const matriculas = (attachments ?? []).filter(
    (a) => resolveCategory(a) === "matricula"
  );
  const outros = (attachments ?? []).filter(
    (a) => resolveCategory(a) !== "matricula"
  );
  if (matriculas.length > 0) {
    groups.push({
      label: "Matrículas identificadas",
      options: matriculas.map((a) => ({ value: a.id, label: a.filename })),
    });
  }
  if (outros.length > 0) {
    groups.push({
      label: "Outros anexos",
      options: outros.map((a) => ({ value: a.id, label: a.filename })),
    });
  }

  const select = useCallback(
    (id: string, filename: string) => {
      form.setValue(`${prefix}.matricula_attachment_id`, id, { shouldDirty: true });
      form.setValue(`${prefix}.matricula_attachment_filename`, filename, {
        shouldDirty: true,
      });
    },
    [form, prefix]
  );

  const handleSelect = (value: string) => {
    const att = attachments?.find((a) => a.id === value) ?? null;
    // O filename anda junto pra que o card do negócio e o PDF de resumo não
    // precisem resolver o id contra a tabela de anexos.
    select(value, att?.filename ?? "");
  };

  // ---------------------------------------------------------------- upload
  // "Já tenho o arquivo aqui" é o caminho mais curto, e mandar o operador até a
  // etapa Documentos só pra voltar e vincular é justamente o vaivém que o
  // pedido quis matar. O anexo criado aqui é o mesmo FormAttachment da outra
  // etapa — só a origem do clique muda.
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Desmontar o step (trocar de etapa, remover o imóvel) tem que parar o
  // polling: sem isso o timer sobrevive ao componente e chama setState em algo
  // que já morreu.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const handleUpload = async (file: File) => {
    const reason = rejectFileReason(file);
    if (reason) {
      toast.error(reason);
      return;
    }
    if (!attachmentsEndpoint) return;

    setUploading(true);
    let created: { id: string; filename: string } | null = null;
    try {
      const att = await uploadFormAttachment(attachmentsEndpoint, file);
      created = { id: att.id, filename: att.filename };
      // Vincula na hora: se o OCR falhar depois, o documento certo já está
      // apontado e o operador só digita os campos à mão.
      select(att.id, att.filename);
      await onRequestAttachments(true);

      if (att.cached) {
        // Mesmo conteúdo já OCRado nesta org — a extração veio no finalize.
        toast.success("Matrícula anexada e já processada");
        return;
      }
      toast.success("Matrícula anexada — extraindo dados…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no upload");
      return;
    } finally {
      setUploading(false);
    }

    // O finalize NÃO enfileira OCR (custo de tokens é sob demanda). Aqui o
    // pedido é explícito: o operador escolheu "possui" e subiu a matrícula
    // justamente pra que os campos venham preenchidos.
    setExtracting(true);
    try {
      const res = await fetch(`${attachmentsEndpoint}/${created.id}/retry`, {
        method: "POST",
      });
      if (!res.ok) {
        toast.error("Não foi possível extrair os dados — preencha manualmente");
        return;
      }
      for (let i = 0; i < POLL_TRIES; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!aliveRef.current) return;
        const list = await onRequestAttachments(true);
        const mine = list?.find((a) => a.id === created!.id);
        if (!mine) continue;
        if (mine.status === "ready") {
          toast.success(
            hasMatriculaExtraction(mine)
              ? "Dados extraídos — use “Aplicar dados extraídos”"
              : "Documento processado, mas sem dados de matrícula reconhecidos"
          );
          return;
        }
        if (mine.status === "failed") {
          toast.error("A extração falhou — preencha os campos manualmente");
          return;
        }
      }
      // Estourou o teto: o anexo continua vinculado e o worker pode terminar
      // depois; avisamos em vez de girar pra sempre.
      toast.info("A extração está demorando — os dados aparecem ao recarregar");
    } catch {
      toast.error("Não foi possível extrair os dados — preencha manualmente");
    } finally {
      if (aliveRef.current) setExtracting(false);
    }
  };

  const canApply = hasMatriculaExtraction(selected);

  const handleApply = () => {
    if (!selected) return;
    const filled = mapExtractedToForm(
      {
        category: "matricula",
        fields: selected.extractedData?.fields ?? {},
        confidence: selected.extractedData?.confidence ?? undefined,
      },
      { kind: "imovel", index },
      form as UseFormReturn<Record<string, unknown>>,
      { skipIfDirty: true }
    );
    if (filled > 0) {
      toast.success(`${filled} campos preenchidos`);
    } else {
      // skipIfDirty preserva o que já foi digitado — zero aplicado quase sempre
      // significa "os campos da matrícula já estavam preenchidos".
      toast.info("Nada novo para preencher — os campos já estão preenchidos");
    }
  };

  const listLoading = canListAttachments && attachments === null;
  const listEmpty = attachments !== null && attachments.length === 0;

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-muted-foreground">
          Situação da matrícula atualizada
        </legend>
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="h-4 w-4 accent-primary"
              name={`${prefix}.matricula_situacao`}
              value="possui"
              checked={situacao === "possui"}
              onChange={() => setSituacao("possui")}
            />
            Possui matrícula atualizada
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="h-4 w-4 accent-primary"
              name={`${prefix}.matricula_situacao`}
              value="solicitar"
              checked={situacao === "solicitar"}
              onChange={() => setSituacao("solicitar")}
            />
            Matrícula atualizada deverá ser solicitada
          </label>
        </div>
      </fieldset>

      {/* "solicitar" — número e cartório passam a ser obrigatórios (o gate do
          wizard já cuida disso via matriculaConditionalPaths); aqui só
          explicamos POR QUE os asteriscos apareceram logo abaixo. */}
      {situacao === "solicitar" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
          <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
            Para solicitar a matrícula atualizada no cartório é preciso informar
            o número da matrícula e o cartório de registro — por isso os dois
            campos abaixo passam a ser obrigatórios. A pendência continuará
            aparecendo no negócio até a matrícula atualizada ser anexada.
          </p>
        </div>
      )}

      {/* "possui" — vincular o documento já anexado evita que a equipe tenha de
          caçar qual dos anexos é a matrícula. */}
      {situacao === "possui" && (
        <div className="space-y-2">
          {!canListAttachments ? (
            <p className="text-xs text-muted-foreground">
              Anexe a matrícula atualizada na etapa &quot;Documentos&quot; do
              link principal do formulário para vinculá-la a este imóvel.
            </p>
          ) : (
            <>
              {listEmpty ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum documento anexado ainda — envie a matrícula abaixo ou
                  anexe-a na etapa &quot;Documentos&quot;.
                </p>
              ) : (
                <NativeSelect
                  value={attachmentId}
                  onChange={handleSelect}
                  options={groups}
                  placeholder={
                    listLoading
                      ? "Carregando anexos…"
                      : "Selecione o documento da matrícula"
                  }
                  disabled={listLoading}
                  aria-invalid={selectionMissing || undefined}
                />
              )}
              {selectionMissing && (
                <p className="text-xs text-destructive">
                  O anexo vinculado foi removido do formulário. Selecione outro
                  documento.
                </p>
              )}

              {/* Upload no próprio bloco: quem está com o PDF em mãos não
                  precisa ir até a etapa Documentos e voltar pra vincular. */}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={ACCEPTED_MIMES.join(",")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Limpa o input pra que reenviar o MESMO arquivo depois de um
                  // erro ainda dispare o onChange.
                  e.target.value = "";
                  if (file) void handleUpload(file);
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading || extracting}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {uploading ? "Enviando…" : "Enviar matrícula"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canApply || extracting}
                  onClick={handleApply}
                >
                  {extracting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {extracting ? "Extraindo dados…" : "Aplicar dados extraídos"}
                </Button>
                {!canApply && !extracting && !!attachmentId && !selectionMissing && (
                  <span className="text-xs text-muted-foreground">
                    Sem dados de matrícula extraídos deste anexo.
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                PDF, JPG, PNG ou WEBP até 20MB. A leitura por IA preenche
                número, cartório e dados do imóvel — os campos já digitados são
                preservados.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
