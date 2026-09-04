"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { modalidadeLabel } from "@/lib/contracts/template-category";
import { SEMANTIC_CATEGORY_LABEL } from "@/lib/templates/semantic-checks";
import { motivoDaRecusa } from "@/lib/templates/doc-edit-reasons";
import type { LibraryReviewResult, LibraryReviewRow } from "@/lib/templates/library-review";
import type { ClauseReviewResult, ClauseReviewRow } from "@/lib/templates/clause-review";

interface Resposta {
  templates: LibraryReviewResult | null;
  clauses: ClauseReviewResult | null;
  templatesIndisponivel?: string;
}

/**
 * Por que a geração descartaria a cláusula, em português de operador.
 *
 * Sem `provider_mismatch`: aquele motivo nasce da ELEIÇÃO entre candidatas de um
 * slot, que esta revisão não faz — ela prova uma linha de cada vez. Deixar a
 * entrada aqui sugeriria que o painel detecta uma coisa que ele não detecta.
 */
const MOTIVO_CLAUSULA: Record<string, string> = {
  render_error: "o texto não compila como Handlebars",
  residual_placeholder: "sobra uma chave depois do preenchimento",
  chunked_content: "a linha está partida em pedaços no acervo",
};

/** "1× trocar a lista inteira por uma chave" — o que o lote fará neste modelo. */
function resumoDosConsertos(row: LibraryReviewRow): string {
  const conta = new Map<string, number>();
  for (const f of row.achados) {
    if (!f.suggestedFix || f.suggestedFix.op === "manual") continue;
    const rotulo = FIX_LABEL[f.suggestedFix.op] ?? f.suggestedFix.op;
    conta.set(rotulo, (conta.get(rotulo) ?? 0) + 1);
  }
  return [...conta].map(([rotulo, n]) => `${n}× ${rotulo}`).join("; ");
}

const FIX_LABEL: Record<string, string> = {
  rekey: "trocar a chave",
  "remove-leftover": "remover o trecho",
  "restore-paragraph": "restaurar o parágrafo",
  "replace-block": "trocar o bloco inteiro por uma chave",
};

export function LibraryReviewClient() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [corrigindo, setCorrigindo] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<LibraryReviewRow | null>(null);
  const [confirmarLote, setConfirmarLote] = useState(false);
  /** Andamento do lote — sem isto a tela fica muda por minutos. */
  const [progresso, setProgresso] = useState<{
    atual: number;
    total: number;
    nome: string;
  } | null>(null);

  const revisar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch("/api/templates/library-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Falha ao revisar a biblioteca.");
      setDados(json as Resposta);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  // A página INTEIRA é a ação: quem a abre já pediu a revisão. Esperar um
  // segundo clique deixaria a tela vazia exatamente no momento em que ela
  // deveria responder "como está minha biblioteca?".
  useEffect(() => {
    void revisar();
  }, [revisar]);

  /**
   * Aplica os consertos automáticos de UM modelo, um por vez.
   *
   * Sequencial de propósito: cada chamada RECALCULA as checagens no servidor e
   * resolve o achado pelo id (`findingId`), então um conserto muda o documento
   * sob os seguintes. Disparar em paralelo faria os outros baterem em
   * `FINDING_STALE` — ou, pior, casarem uma frase que o primeiro já mexeu.
   */
  /**
   * Aplica os consertos de UM modelo e devolve a conta. NÃO revalida.
   *
   * Quem revalida é o chamador, e isso não é detalhe: revalidar custa uma
   * leitura de CADA modelo da biblioteca no Drive. Fazer isso depois de cada
   * modelo — como esta função fazia — transforma um lote de 14 em 14 varreduras
   * completas, e foi exatamente o que saturou a rota em produção em 04/09.
   * Uma revalidação no fim diz a mesma coisa.
   */
  async function aplicarConsertos(row: LibraryReviewRow) {
    const alvos = row.achados.filter((f) => f.suggestedFix && f.suggestedFix.op !== "manual");
    let feitos = 0;
    const falhas: string[] = [];
    for (const achado of alvos) {
      try {
        const res = await fetch(`/api/templates/${row.templateId}/doc-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ findingId: achado.id }),
        });
        const json = await res.json();
        if (res.ok && json?.ok) feitos += 1;
        else falhas.push(json?.error || motivoDaRecusa(json));
      } catch (e) {
        falhas.push(e instanceof Error ? e.message : String(e));
      }
    }
    return { feitos, falhas };
  }

  async function corrigirModelo(row: LibraryReviewRow) {
    setConfirmar(null);
    setCorrigindo(row.templateId);
    const { feitos, falhas } = await aplicarConsertos(row);
    setCorrigindo(null);
    if (feitos) toast.success(`${feitos} conserto(s) aplicado(s) em "${row.name}".`);
    // A CONTA das falhas, não só a primeira: com 4 de 6 falhando, mostrar uma
    // deixaria o operador achando que as outras 3 passaram.
    if (falhas.length) {
      toast.error(
        falhas.length === 1
          ? falhas[0]!
          : `${falhas.length} consertos não foram aplicados. O primeiro: ${falhas[0]}`
      );
    }
    await revisar();
  }

  /**
   * Corrige TODOS os modelos que têm conserto automático, em ordem.
   *
   * Existe porque clicar modelo a modelo é trabalho de máquina: os 16 modelos
   * da RE/MAX Trio tinham o MESMO defeito, e a alternativa era catorze vezes a
   * mesma sequência de dois cliques. Um lote com o total declarado antes e o
   * resultado declarado depois é a mesma decisão, tomada uma vez.
   *
   * Sequencial, nunca em paralelo: cada conserto é recalculado no servidor
   * contra o Doc de agora, e a revalidação (cara) acontece UMA vez, no fim.
   */
  async function corrigirTudo() {
    setConfirmarLote(false);
    // MESMA lista que o botão contou: se o filtro divergisse, o total prometido
    // no diálogo não seria o que o lote faz.
    const alvos = alvosLote;
    let feitos = 0;
    const falhas: string[] = [];
    const modelosComFalha: string[] = [];
    for (let i = 0; i < alvos.length; i += 1) {
      const row = alvos[i]!;
      setProgresso({ atual: i + 1, total: alvos.length, nome: row.name });
      const r = await aplicarConsertos(row);
      feitos += r.feitos;
      if (r.falhas.length) {
        falhas.push(...r.falhas);
        modelosComFalha.push(row.name);
      }
    }
    setProgresso(null);
    if (feitos) toast.success(`${feitos} conserto(s) aplicado(s) em ${alvos.length} modelo(s).`);
    if (falhas.length) {
      toast.error(
        `${falhas.length} conserto(s) não aplicado(s) em ${modelosComFalha.length} modelo(s). ` +
          `O primeiro: ${falhas[0]}`
      );
    }
    await revisar();
  }

  const modelos = dados?.templates?.rows ?? [];
  const clausulas = dados?.clauses?.rows ?? [];
  const modelosOk = modelos.filter((m) => m.pronto && !m.erro).length;
  const clausulasOk = clausulas.filter((c) => c.ok).length;
  // Modelo ATIVO fica de fora da conta: a rota recusa editá-lo (409), então
  // incluí-lo no total prometeria um conserto que não vai acontecer.
  const alvosLote = modelos.filter(
    (m) => m.consertaveis > 0 && m.status !== "active" && !m.erro
  );
  const totalConsertaveis = alvosLote.reduce((a, m) => a + m.consertaveis, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Revisão da biblioteca</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Confere de uma vez todos os modelos e todas as cláusulas: se as
            chaves foram aplicadas nos lugares certos, o que falta para ativar e
            o que a geração descartaria em silêncio.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {totalConsertaveis > 0 && (
            <Button
              onClick={() => setConfirmarLote(true)}
              disabled={carregando || !!corrigindo || !!progresso}
            >
              {progresso ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              Corrigir tudo ({totalConsertaveis})
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => void revisar()}
            disabled={carregando || !!progresso}
          >
            {carregando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Conferir de novo
          </Button>
        </div>
      </div>

      {erro && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 text-sm">{erro}</CardContent>
        </Card>
      )}

      {carregando && !dados && (
        <p className="text-sm text-muted-foreground">
          Lendo cada modelo no Google Docs e provando cada cláusula — leva alguns
          segundos.
        </p>
      )}

      {/*
        Andamento do lote. Sem isto a tela fica muda enquanto 14 documentos são
        editados um a um, e "parado" é indistinguível de "travado".
      */}
      {progresso && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>
              Corrigindo {progresso.atual} de {progresso.total}:{" "}
              <span className="font-medium">{progresso.nome}</span>
            </span>
          </CardContent>
        </Card>
      )}

      {dados && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Resumo
            titulo="Modelos"
            ok={modelosOk}
            total={modelos.length}
            indisponivel={dados.templatesIndisponivel}
          />
          <Resumo titulo="Cláusulas" ok={clausulasOk} total={clausulas.length} />
        </div>
      )}

      {dados?.templates && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Modelos</h2>
          {dados.templates.truncado && (
            <p className="text-xs text-muted-foreground">
              Mostrando os primeiros {modelos.length} modelos.
            </p>
          )}
          {modelos.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum modelo Google Docs nesta organização.
            </p>
          )}
          {modelos.map((m) => (
            <ModeloCard
              key={m.templateId}
              row={m}
              corrigindo={corrigindo === m.templateId}
              travado={!!corrigindo}
              onCorrigir={() => setConfirmar(m)}
            />
          ))}
        </section>
      )}

      {dados?.clauses && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Base de cláusulas</h2>
          {clausulas.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma cláusula aprovada nesta organização.
            </p>
          )}
          {clausulas.filter((c) => !c.ok || c.chavesVazias.length || c.temPii).length === 0 &&
            clausulas.length > 0 && (
              <p className="text-sm text-muted-foreground">
                As {clausulas.length} cláusulas compilam e preenchem sem sobrar
                chave.
              </p>
            )}
          {clausulas
            .filter((c) => !c.ok || c.chavesVazias.length > 0 || c.temPii)
            .map((c) => (
              <ClausulaCard key={c.clauseId} row={c} />
            ))}
        </section>
      )}

      <AlertDialog open={confirmarLote} onOpenChange={(o) => !o && setConfirmarLote(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Corrigir {totalConsertaveis} problema(s) em {alvosLote.length} modelo(s)?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Vou aplicar, um modelo por vez, nos Google Docs destes modelos:</p>
                <ul className="max-h-52 list-disc space-y-1 overflow-y-auto pl-5">
                  {alvosLote.map((m) => (
                    <li key={m.templateId}>
                      {m.name}{" "}
                      <span className="text-muted-foreground">
                        — {resumoDosConsertos(m)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground">
                  Cada conserto é recalculado no servidor no momento de aplicar. Modelos
                  ativos ficam de fora (não aceitam edição), e o que não tiver conserto
                  automático continua na lista.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void corrigirTudo()}>
              Corrigir tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Corrigir &quot;{confirmar?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Vou aplicar estes consertos no Google Doc do modelo:</p>
                <ul className="list-disc space-y-1 pl-5">
                  {(confirmar?.achados ?? [])
                    .filter((f) => f.suggestedFix && f.suggestedFix.op !== "manual")
                    .map((f) => (
                      <li key={f.id}>
                        <span className="font-medium">
                          {FIX_LABEL[f.suggestedFix!.op] ?? f.suggestedFix!.op}
                        </span>{" "}
                        — {SEMANTIC_CATEGORY_LABEL[f.category] ?? f.category}, parágrafo{" "}
                        {f.paragraphIndex + 1}
                      </li>
                    ))}
                </ul>
                <p className="text-muted-foreground">
                  Cada conserto é recalculado no servidor no momento de aplicar. O
                  que não tiver conserto automático continua na lista.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmar && void corrigirModelo(confirmar)}>
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Resumo({
  titulo,
  ok,
  total,
  indisponivel,
}: {
  titulo: string;
  ok: number;
  total: number;
  indisponivel?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        {indisponivel ? (
          <p className="text-sm text-muted-foreground">{indisponivel}</p>
        ) : (
          <p className="text-2xl font-semibold tabular-nums">
            {ok}
            <span className="text-base font-normal text-muted-foreground"> de {total} sem pendência</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ModeloCard({
  row,
  corrigindo,
  travado,
  onCorrigir,
}: {
  row: LibraryReviewRow;
  corrigindo: boolean;
  travado: boolean;
  onCorrigir: () => void;
}) {
  const erros = row.achados.filter((f) => f.severity === "error").length;
  const avisos = row.achados.length - erros;
  // Modelo ativo é imutável no Doc — a rota de edição devolve 409. Mostrar um
  // botão que só pode falhar seria pior que explicar o caminho.
  const ativo = row.status === "active";

  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {row.erro ? (
            <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
          ) : row.pronto ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" />
          )}
          <Link
            href={`/templates/${row.templateId}/review`}
            className="font-medium hover:underline"
          >
            {row.name}
          </Link>
          {row.modalidade && (
            <Badge variant="outline">{modalidadeLabel(row.modalidade)}</Badge>
          )}
          <Badge variant={ativo ? "default" : "secondary"}>
            {ativo ? "Ativo" : "Rascunho"}
          </Badge>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {row.chaves.presentes}/{row.chaves.total} chaves
          </span>
        </div>

        {row.erro ? (
          <p className="text-sm text-destructive">
            Não consegui ler o documento: {row.erro}
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {row.faltamObrigatorias.length > 0 && (
              <span>
                faltam obrigatórias:{" "}
                <span className="font-mono text-xs">
                  {row.faltamObrigatorias.join(", ")}
                </span>
              </span>
            )}
            {row.desconhecidas.length > 0 && (
              <span>
                chaves fora do catálogo:{" "}
                <span className="font-mono text-xs">{row.desconhecidas.join(", ")}</span>
              </span>
            )}
            {row.piiBloqueia && <span className="text-destructive">dado pessoal literal</span>}
            {erros > 0 && <span>{erros} erro(s) de chaveamento</span>}
            {avisos > 0 && <span>{avisos} aviso(s)</span>}
            {row.pronto && row.achados.length === 0 && <span>sem pendências</span>}
          </div>
        )}

        {row.achados.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {row.achados.slice(0, 4).map((f) => (
              <li key={f.id}>
                · {SEMANTIC_CATEGORY_LABEL[f.category] ?? f.category} (parágrafo{" "}
                {f.paragraphIndex + 1})
              </li>
            ))}
            {row.achados.length > 4 && <li>· e mais {row.achados.length - 4}</li>}
          </ul>
        )}

        {row.consertaveis > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              disabled={travado || ativo}
              onClick={onCorrigir}
            >
              {corrigindo ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-3.5 w-3.5" />
              )}
              Corrigir {row.consertaveis} automaticamente
            </Button>
            {ativo && (
              <span className="text-xs text-muted-foreground">
                volte o modelo para rascunho para editar o documento
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClausulaCard({ row }: { row: ClauseReviewRow }) {
  return (
    <Card className={row.ok ? undefined : "border-destructive/40"}>
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {row.ok ? (
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" />
          ) : (
            <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
          )}
          <Link href="/clauses" className="font-medium hover:underline">
            {row.title}
          </Link>
          <Badge variant="outline">{row.esteira ?? "não classificada"}</Badge>
          {row.slot && <Badge variant="secondary">espaço: {row.slot}</Badge>}
        </div>

        {row.problemas.map((p, i) => (
          <p key={i} className="text-sm text-destructive">
            Em {p.esteira}: {MOTIVO_CLAUSULA[p.reason] ?? p.reason} — a geração usaria o
            texto padrão no lugar desta cláusula.{" "}
            <span className="text-muted-foreground">{p.message}</span>
          </p>
        ))}

        {row.chavesVazias.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Chaves que saem vazias nos dados de exemplo:{" "}
            <span className="font-mono text-xs">{row.chavesVazias.join(", ")}</span>
          </p>
        )}

        {row.temPii && (
          <p className="text-sm text-muted-foreground">
            Há dado pessoal literal no texto da cláusula.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
