"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, EyeOff, Loader2, Pencil } from "lucide-react";
import {
  collectExtractionIssues,
  documentLabel,
  type ExtractionIssue,
  type ExtractionIssueReason,
} from "@/lib/forms/extracted-to-form";
import { ocrFieldLabel } from "@/lib/forms/ocr-field-labels";
import { describeFormPath } from "@/lib/forms/field-labels";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  category: string | null;
  fields: Record<string, unknown> | null;
  confidence: number | null;
  /**
   * O que o "Aplicar aos campos" escreveria, por path do formulário. Vem do
   * `computeDocWrites`, que roda o mapper contra uma sonda em vez do form real.
   * `null` quando o caller não consegue calcular (ex.: doc ainda sem destino).
   */
  writePreview?: WritePreviewEntry[] | null;
  /**
   * Grava as correções do usuário nos campos extraídos. Ausente = dialog
   * somente-leitura (modo readOnly e telas que só exibem).
   *
   * Existe porque a alternativa era o que a corretora fez na sessão de
   * 2026-08-25: ver o CPF errado no card, não poder corrigir ali, e redigitar
   * tudo à mão nos campos do formulário.
   */
  onSaveFields?: (fields: Record<string, string>) => Promise<void> | void;
}

export interface WritePreviewEntry {
  path: string;
  value: unknown;
  /**
   * O campo JÁ tem valor no formulário e o "Aplicar" NÃO vai sobrescrever.
   *
   * `computeDocWrites` roda com `skipIfDirty: false` (é o contrato dele, usado
   * também pela limpeza D7), mas os dois caminhos reais de aplicação usam
   * `true`. Sem esta distinção o preview prometeria escrever justamente onde
   * a diferença importa: o operador digitou o CPF à mão, o dialog anuncia o CPF
   * do OCR, e o "Aplicar" não troca nada.
   */
  jaPreenchido: boolean;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return `${v.length} item(ns)`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const MOTIVO_LABEL: Record<ExtractionIssueReason, string> = {
  ausente: "não foi lido no documento",
  formato: "formato inaproveitável — será descartado",
  cpf_invalido: "CPF não confere (dígito verificador)",
};

/**
 * `cpf_invalido` é o único que NÃO é descartado: passa no filtro de
 * comprimento, é gravado no formulário, e só quebra na certidão, na ClickSign
 * ou no DIMOB. É o que mais precisa de olho humano, então vem em destaque.
 */
function isCritico(reason: ExtractionIssueReason): boolean {
  return reason === "cpf_invalido";
}

export function ExtractedDataDialog({
  open,
  onOpenChange,
  filename,
  category,
  fields,
  confidence,
  writePreview,
  onSaveFields,
}: Props) {
  const entries = useMemo(
    () =>
      fields
        ? Object.entries(fields).filter(([, v]) => v !== null && v !== "")
        : [],
    [fields]
  );
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  // Fechar descarta a edição: reabrir não pode ressuscitar rascunho cancelado.
  useEffect(() => {
    if (!open) {
      setEditando(false);
      setSalvando(false);
    }
  }, [open]);

  const comecarEdicao = () => {
    setRascunho(Object.fromEntries(entries.map(([k, v]) => [k, formatValue(v)])));
    setEditando(true);
  };

  const salvar = async () => {
    if (!onSaveFields) return;
    // Só o que mudou — assim o servidor não reescreve campo que ninguém tocou.
    const alterados: Record<string, string> = {};
    for (const [k, v] of entries) {
      const novo = rascunho[k] ?? "";
      if (novo !== formatValue(v)) alterados[k] = novo;
    }
    setSalvando(true);
    try {
      if (Object.keys(alterados).length > 0) await onSaveFields(alterados);
      setEditando(false);
    } finally {
      setSalvando(false);
    }
  };
  const issues: ExtractionIssue[] = collectExtractionIssues(fields);
  const issuesByKey = new Map(issues.map((i) => [i.ocrKey, i]));
  const criticos = issues.filter((i) => isCritico(i.reason));
  const pct = confidence !== null ? Math.round(confidence * 100) : null;
  const isFichaResumo = category === "ficha_resumo";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `max-h` + `overflow-y-auto` no PRÓPRIO DialogContent é a convenção do
          repo (ver SendAttachmentEnvelopeDialog). Um `ScrollArea` com `max-h`
          aqui NÃO rola: o Root do Radix só recebe `position: relative`, e o
          Viewport é `size-full` dentro de um pai de altura automática — nunca
          transborda, então nenhuma barra aparece e o conteúdo simplesmente
          vaza para fora da caixa. Numa matrícula com ~20 campos isso esconderia
          justamente o que este dialog existe para mostrar. */}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate pr-6" title={filename}>
            {filename}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary">{documentLabel(category, fields ?? {})}</Badge>
          {pct !== null && (
            <span className="text-muted-foreground">{pct}% de confiança</span>
          )}
          <span className="text-muted-foreground">
            {entries.length} campo(s) extraído(s)
          </span>
        </div>

        <div>
          {criticos.length > 0 && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Confira estes campos contra o documento
              </div>
              <ul className="space-y-1 text-[11px] text-foreground">
                {criticos.map((i) => (
                  <li key={i.ocrKey}>
                    <span className="font-medium">{ocrFieldLabel(i.ocrKey)}</span>
                    {": "}
                    <span className="font-mono">{formatValue(i.raw)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      — {MOTIVO_LABEL[i.reason]}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Um CPF com dígito errado é aceito pelo formulário e só falha
                depois, na certidão ou na assinatura.
              </p>
            </div>
          )}

          <section className="mb-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                Dados extraídos
              </h3>
              {onSaveFields && entries.length > 0 && !editando && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={comecarEdicao}
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  Corrigir
                </Button>
              )}
              {editando && (
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setEditando(false)}
                    disabled={salvando}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={salvar}
                    disabled={salvando}
                  >
                    {salvando && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Salvar correções
                  </Button>
                </div>
              )}
            </div>
            {editando && (
              <p className="mb-2 text-[11px] text-muted-foreground">
                Corrija o que o documento realmente diz. Deixe em branco para
                descartar um campo lido errado. Isto não altera o arquivo — só o
                que será aplicado ao formulário.
              </p>
            )}
            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum campo foi extraído deste documento.
              </p>
            ) : (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {entries.map(([k, v]) => {
                  const issue = issuesByKey.get(k);
                  return (
                    <div key={k} className="min-w-0 text-xs">
                      <dt className="text-muted-foreground">{ocrFieldLabel(k)}</dt>
                      {editando ? (
                        <dd>
                          <Input
                            value={rascunho[k] ?? ""}
                            onChange={(e) =>
                              setRascunho((prev) => ({ ...prev, [k]: e.target.value }))
                            }
                            maxLength={500}
                            className={
                              issue && isCritico(issue.reason)
                                ? "h-7 text-xs border-destructive"
                                : "h-7 text-xs"
                            }
                          />
                        </dd>
                      ) : (
                        <>
                      {/* Tachado significa DESCARTADO. `cpf_invalido` não é
                          descartado — é gravado no formulário — então tachá-lo
                          diria ao revisor exatamente o contrário do que este
                          dialog existe para dizer. Ele vai em vermelho, inteiro
                          e legível, porque é o valor que ele precisa conferir
                          contra o documento. */}
                      <dd
                        className={
                          issue && isCritico(issue.reason)
                            ? "truncate font-medium text-destructive"
                            : issue
                              ? "truncate text-muted-foreground line-through"
                              : "truncate text-foreground"
                        }
                        title={formatValue(v)}
                      >
                        {formatValue(v)}
                      </dd>
                      {issue && (
                        <dd
                          className={
                            isCritico(issue.reason)
                              ? "text-[10px] text-destructive"
                              : "text-[10px] text-muted-foreground"
                          }
                        >
                          {MOTIVO_LABEL[issue.reason]}
                        </dd>
                      )}
                        </>
                      )}
                    </div>
                  );
                })}
              </dl>
            )}
          </section>

          {/* Ficha-resumo NÃO passa pelo mapper: ela mantém `assignment.kind =
              "outro"` e é aplicada por um caminho próprio (`adapter.applyFicha`).
              O `computeDocWrites` devolveria vazio, e o dialog diria "nada seria
              preenchido" justamente para o único documento que preenche o
              formulário INTEIRO — mandando o operador reatribuir um doc que já
              está funcionando. */}
          {isFichaResumo ? (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
                Preenchimento
              </h3>
              <p className="text-xs text-muted-foreground">
                Ficha-resumo é aplicada automaticamente a todas as partes e
                imóveis do formulário, sem depender de um destino escolhido.
              </p>
            </section>
          ) : (
            writePreview && (
              <section>
                <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Será preenchido no formulário
                </h3>
                {writePreview.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <EyeOff className="h-3.5 w-3.5 shrink-0" />
                    Nada seria preenchido — confira o destino do documento.
                  </p>
                ) : (
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {writePreview.map((w) => (
                      <div key={w.path} className="min-w-0 text-xs">
                        <dt className="text-muted-foreground">
                          {describeFormPath(w.path)}
                        </dt>
                        <dd
                          className={
                            w.jaPreenchido
                              ? "truncate text-muted-foreground line-through"
                              : "truncate text-foreground"
                          }
                          title={formatValue(w.value)}
                        >
                          {formatValue(w.value)}
                        </dd>
                        {w.jaPreenchido && (
                          <dd className="text-[10px] text-muted-foreground">
                            já preenchido — não será sobrescrito
                          </dd>
                        )}
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
