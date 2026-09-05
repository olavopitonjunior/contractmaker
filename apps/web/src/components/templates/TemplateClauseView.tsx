"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SEMANTIC_CATEGORY_LABEL,
  type SemanticFinding,
} from "@/lib/templates/semantic-checks";
import { alignParagraphs, tokensOf, type AlignedRow } from "@/lib/templates/paragraph-align";

/**
 * Aba "Cláusulas" da revisão: o Doc-modelo (com as chaves marcadas) ao lado do
 * contrato ORIGINAL que ele substituiu, parágrafo a parágrafo.
 *
 * É a visão que faltava. O operador via o relatório ("3 chaves inseridas") e
 * o Doc num iframe, e decidia sem nunca ver o que cada chave substituiu. Aqui
 * o colapso de uma cláusula aparece como um parágrafo do Doc "valendo" por
 * três do fonte; a chave da parte errada aparece com o nome da parte certa a
 * dois centímetros de distância.
 *
 * As ações por linha usam o MESMO caminho das correções do card "Problemas"
 * (`POST doc-edit`): o componente não escreve nada, só devolve a operação ao
 * pai. Selecionar texto numa linha alimenta também o painel de mapeamento
 * manual (mesma seleção, mesmo `mapField`).
 */

export interface ClauseViewCatalogEntry {
  token: string;
  label: string;
  kind: "simple" | "composed";
}

export interface ClauseViewSource {
  /** `error` = a busca falhou (rede, 5xx) — diferente de "não há fonte". */
  status: "loading" | "unavailable" | "error" | "ready";
  paragraphs: string[];
}

export interface TemplateClauseViewProps {
  docParagraphs: string[];
  source: ClauseViewSource;
  findings: SemanticFinding[];
  catalog: ClauseViewCatalogEntry[];
  /** Rascunho e sem outra operação em curso: mostra as ações por linha. */
  editable: boolean;
  busy: boolean;
  /** Achado cuja correção está em curso (desabilita o botão dele). */
  fixingId: string | null;
  onFix: (findingId: string) => void;
  onRekey: (phrase: string, fromToken: string, toToken: string) => void;
  onRemoveLeftover: (phrase: string) => void;
  onRestore: (current: string, source: string) => void;
  onSelectText: (text: string) => void;
  /** Tenta buscar o original de novo (só faz sentido em `status: "error"`). */
  onRetrySource?: () => void;
}

const TOKEN_SPLIT = /(\{\{\s*[a-zA-Z0-9_]+\s*\}\})/g;
const TOKEN_ONLY = /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/;

/**
 * Cor por PREFIXO da chave (a parte: locador_, locatario_, imovel_,
 * corretagem_, imobiliaria_…). É o que faz `{{corretagem_qualificacao}}` no
 * item da imobiliária saltar aos olhos: a cor está "errada" para aquela
 * cláusula antes de o operador ler a chave.
 */
const TOKEN_PALETTE = [
  "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-100",
  "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
  "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100",
  "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-100",
];

export function tokenPrefix(token: string): string {
  const i = token.indexOf("_");
  return i > 0 ? token.slice(0, i) : token;
}

export function tokenColorClass(token: string): string {
  const p = tokenPrefix(token);
  let h = 0;
  for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) >>> 0;
  return TOKEN_PALETTE[h % TOKEN_PALETTE.length];
}

/** Parágrafo do Doc com cada `{{chave}}` marcada na cor do seu prefixo. */
function MarkedParagraph({ text }: { text: string }) {
  const parts = text.split(TOKEN_SPLIT);
  return (
    <>
      {parts.map((p, i) => {
        const m = TOKEN_ONLY.exec(p);
        return m ? (
          <mark
            key={i}
            data-token={m[1]}
            className={`rounded px-1 font-mono text-[11px] ${tokenColorClass(m[1])}`}
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </>
  );
}

const KIND_LABEL: Record<AlignedRow["kind"], string | null> = {
  same: null,
  tokenized: "chave no lugar do dado",
  changed: "texto diferente do original",
  "missing-in-doc": "sumiu do modelo",
  "added-in-doc": "não existe no original",
};

const KIND_STYLE: Record<AlignedRow["kind"], string> = {
  same: "",
  tokenized: "",
  changed: "border-l-2 border-l-warning",
  "missing-in-doc": "border-l-2 border-l-destructive bg-destructive/5",
  "added-in-doc": "border-l-2 border-l-muted-foreground/40",
};

const SEVERITY_BADGE: Record<SemanticFinding["severity"], string> = {
  error: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning-foreground",
  info: "bg-muted text-muted-foreground",
};

/** Verbo do conserto → o que o botão diz que vai fazer. */
const FIX_LABEL: Record<string, string> = {
  rekey: "Corrigir a chave",
  "remove-leftover": "Remover o trecho",
  "restore-paragraph": "Restaurar o parágrafo",
  "replace-block": "Trocar o bloco pela chave",
};

export function TemplateClauseView(props: TemplateClauseViewProps) {
  const {
    docParagraphs,
    source,
    findings,
    catalog,
    editable,
    busy,
    fixingId,
    onFix,
    onRekey,
    onRemoveLeftover,
    onRestore,
    onSelectText,
    onRetrySource,
  } = props;
  const [soComChaves, setSoComChaves] = useState(false);
  const [soComProblemas, setSoComProblemas] = useState(false);
  /** Seleção de texto dentro de UMA linha (para "Remover trecho"). */
  const [sel, setSel] = useState<{ docIndex: number; text: string } | null>(null);
  /** Linha com o seletor "Trocar chave" aberto e a chave escolhida. */
  const [rekey, setRekey] = useState<{ docIndex: number; toToken: string } | null>(null);

  const sourceReady = source.status === "ready";
  const { rows, capped } = useMemo(
    () =>
      sourceReady
        ? alignParagraphs(docParagraphs, source.paragraphs)
        : {
            rows: docParagraphs.map<AlignedRow>((p, i) => ({
              docIndex: i,
              srcIndex: null,
              kind: "same",
              tokens: tokensOf(p),
            })),
            capped: false,
          },
    [docParagraphs, source.paragraphs, sourceReady]
  );

  const findingsByParagraph = useMemo(() => {
    const map = new Map<number, SemanticFinding[]>();
    for (const f of findings) {
      const list = map.get(f.paragraphIndex);
      if (list) list.push(f);
      else map.set(f.paragraphIndex, [f]);
    }
    return map;
  }, [findings]);

  const kindByToken = useMemo(
    () => new Map(catalog.map((c) => [c.token, c.kind] as const)),
    [catalog]
  );
  const simpleTokens = useMemo(() => catalog.filter((c) => c.kind === "simple"), [catalog]);

  const visiveis = rows.filter((r) => {
    if (soComChaves && r.tokens.length === 0) return false;
    if (soComProblemas) {
      const temAchado = r.docIndex !== null && (findingsByParagraph.get(r.docIndex)?.length ?? 0) > 0;
      const temDiff = r.kind === "changed" || r.kind === "missing-in-doc";
      if (!temAchado && !temDiff) return false;
    }
    return true;
  });

  const comChaves = rows.filter((r) => r.tokens.length > 0).length;
  const comProblemas = rows.filter(
    (r) =>
      (r.docIndex !== null && (findingsByParagraph.get(r.docIndex)?.length ?? 0) > 0) ||
      r.kind === "changed" ||
      r.kind === "missing-in-doc"
  ).length;

  /**
   * Só vale a seleção contida na PRÓPRIA linha: uma seleção que atravessa
   * para o parágrafo vizinho produziria um "trecho" que não existe no Doc
   * (o `doc-edit` recusaria como `not-found`, mas o botão confundiria).
   */
  function capturarSelecao(docIndex: number, el: HTMLElement) {
    const selection = window.getSelection?.();
    const dentro =
      !!selection &&
      selection.rangeCount > 0 &&
      el.contains(selection.anchorNode) &&
      el.contains(selection.focusNode);
    const text = dentro ? selection.toString().trim() : "";
    setSel(text ? { docIndex, text } : null);
    onSelectText(text);
  }

  return (
    <div className="min-h-[64vh] rounded-lg border" data-testid="clause-view">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={soComChaves}
            onChange={(e) => setSoComChaves(e.target.checked)}
          />
          Só com chaves ({comChaves})
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={soComProblemas}
            onChange={(e) => setSoComProblemas(e.target.checked)}
          />
          Só com problemas ({comProblemas})
        </label>
        <span className="ml-auto text-muted-foreground">
          {source.status === "loading" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Buscando o arquivo original…
            </span>
          ) : source.status === "unavailable" ? (
            "Sem arquivo original para comparar (modelo criado do zero ou enviado sem lote)."
          ) : source.status === "error" ? (
            <span className="inline-flex items-center gap-2">
              Não consegui buscar o arquivo original.
              {onRetrySource && (
                <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={onRetrySource}>
                  Tentar de novo
                </Button>
              )}
            </span>
          ) : capped ? (
            "Documento grande: alinhamento aproximado, por posição."
          ) : (
            "Esquerda: o modelo. Direita: o contrato original que ele substituiu."
          )}
        </span>
      </div>

      {docParagraphs.length === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">Carregando o texto do modelo…</p>
      ) : visiveis.length === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">Nenhum parágrafo com esse filtro.</p>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto">
          {visiveis.map((row) => {
            const key = `${row.docIndex ?? "x"}-${row.srcIndex ?? "x"}`;
            const docText = row.docIndex !== null ? docParagraphs[row.docIndex] : null;
            const srcText = row.srcIndex !== null ? source.paragraphs[row.srcIndex] : null;
            const achados = row.docIndex !== null ? findingsByParagraph.get(row.docIndex) ?? [] : [];
            const kindLabel = KIND_LABEL[row.kind];
            const podeTrocarChave =
              editable &&
              row.tokens.length === 1 &&
              kindByToken.get(row.tokens[0]) === "simple";
            // Restaurar substitui o parágrafo inteiro: só onde há fonte pareado
            // E o Doc não carrega chave NENHUMA — "CEP {{imovel_cep}}" alinhado
            // como `changed` restaurado apagaria a chave e devolveria o CEP
            // literal ao modelo. O colapso puro tem o seu próprio conserto
            // (achado das checagens, pelo `onFix`). O `doc-edit` guarda o mesmo.
            const podeRestaurar =
              editable &&
              row.kind === "changed" &&
              docText !== null &&
              srcText !== null &&
              row.tokens.length === 0;
            const selecaoDaLinha =
              editable && sel && sel.docIndex === row.docIndex && !sel.text.includes("{{")
                ? sel.text
                : null;
            const rekeyDaLinha = rekey && rekey.docIndex === row.docIndex ? rekey : null;

            return (
              <div
                key={key}
                data-testid="clause-row"
                data-kind={row.kind}
                className={`grid gap-3 border-b px-3 py-2 text-sm leading-relaxed last:border-b-0 ${
                  sourceReady ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
                } ${KIND_STYLE[row.kind]}`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{row.docIndex !== null ? `¶ ${row.docIndex + 1}` : "—"}</span>
                    {kindLabel && (
                      <span className="rounded bg-muted px-1.5 py-0.5">{kindLabel}</span>
                    )}
                    {row.ambiguous && (
                      <span
                        className="rounded bg-warning/15 px-1.5 py-0.5 text-warning-foreground"
                        title="Mais de um parágrafo do original casava com este; a ordem decidiu."
                      >
                        correspondência aproximada
                      </span>
                    )}
                    {achados.map((f) => (
                      <span
                        key={f.id}
                        className={`rounded px-1.5 py-0.5 ${SEVERITY_BADGE[f.severity]}`}
                        title={f.message}
                      >
                        {SEMANTIC_CATEGORY_LABEL[f.category] ?? f.category}
                      </span>
                    ))}
                  </div>
                  {docText !== null ? (
                    <p
                      className="whitespace-pre-wrap"
                      onMouseUp={(e) =>
                        row.docIndex !== null && capturarSelecao(row.docIndex, e.currentTarget)
                      }
                    >
                      <MarkedParagraph text={docText} />
                    </p>
                  ) : (
                    <p className="italic text-muted-foreground">(sem parágrafo no modelo)</p>
                  )}

                  {(achados.some((f) => f.suggestedFix && f.suggestedFix.op !== "manual") ||
                    podeTrocarChave ||
                    podeRestaurar ||
                    selecaoDaLinha) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {editable &&
                        achados
                          .filter((f) => f.suggestedFix && f.suggestedFix.op !== "manual")
                          .map((f) => (
                            <Button
                              key={f.id}
                              size="sm"
                              variant="outline"
                              className="h-6 text-[11px]"
                              disabled={busy}
                              onClick={() => onFix(f.id)}
                            >
                              {fixingId === f.id ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : null}
                              {FIX_LABEL[f.suggestedFix!.op] ?? "Corrigir"}
                            </Button>
                          ))}
                      {podeTrocarChave && !rekeyDaLinha && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px]"
                          disabled={busy}
                          onClick={() => setRekey({ docIndex: row.docIndex!, toToken: "" })}
                        >
                          Trocar chave…
                        </Button>
                      )}
                      {podeTrocarChave && rekeyDaLinha && (
                        <span className="inline-flex items-center gap-1">
                          <select
                            aria-label="Nova chave"
                            className="h-6 rounded border bg-background px-1 text-[11px]"
                            value={rekeyDaLinha.toToken}
                            onChange={(e) =>
                              setRekey({ docIndex: row.docIndex!, toToken: e.target.value })
                            }
                          >
                            <option value="">Trocar {`{{${row.tokens[0]}}}`} por…</option>
                            {simpleTokens
                              .filter((c) => c.token !== row.tokens[0])
                              .map((c) => (
                                <option key={c.token} value={c.token}>
                                  {`{{${c.token}}}`} — {c.label}
                                </option>
                              ))}
                          </select>
                          <Button
                            size="sm"
                            className="h-6 text-[11px]"
                            disabled={busy || !rekeyDaLinha.toToken}
                            onClick={() => {
                              onRekey(docText!, row.tokens[0], rekeyDaLinha.toToken);
                              setRekey(null);
                            }}
                          >
                            Trocar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[11px]"
                            onClick={() => setRekey(null)}
                          >
                            Cancelar
                          </Button>
                        </span>
                      )}
                      {podeRestaurar && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px]"
                          disabled={busy}
                          onClick={() => onRestore(docText!, srcText!)}
                        >
                          Restaurar do original
                        </Button>
                      )}
                      {selecaoDaLinha && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px]"
                          disabled={busy}
                          onClick={() => {
                            onRemoveLeftover(selecaoDaLinha);
                            setSel(null);
                          }}
                        >
                          Remover “{selecaoDaLinha.length > 40 ? `${selecaoDaLinha.slice(0, 40)}…` : selecaoDaLinha}”
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {sourceReady && (
                  <div className="space-y-1 text-muted-foreground">
                    <div className="text-[11px]">
                      {row.srcIndex !== null ? `original ¶ ${row.srcIndex + 1}` : "—"}
                    </div>
                    {srcText !== null ? (
                      <p className="whitespace-pre-wrap">{srcText}</p>
                    ) : (
                      <p className="italic">(sem correspondente no original)</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
