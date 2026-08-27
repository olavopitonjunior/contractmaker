"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  CircleAlert,
  Eye,
  Sparkles,
  Star,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  CoverageReport,
  CoverageRow,
  GarantiaBoardRow,
  GarantiaCoverageCell,
} from "@/lib/templates/coverage";
import type { GarantiaTipo } from "@/lib/contracts/template-category";
import { TemplatePreview } from "@/components/templates/TemplatePreview";

/** O que o diálogo de preview precisa saber do template da linha. */
interface PreviewTarget {
  id: string;
  name: string;
  modalidade: string | null;
  engine: string;
}

/**
 * Aba "Tipos de contrato" — a tela principal de /templates.
 *
 * Taxonomia do dono (28/08): em locação, cada TIPO DE GARANTIA é um tipo de
 * contrato de primeira classe — a seção de locação lista as 7 garantias como
 * linhas, cada uma com seu template físico. Vendas divide por forma de
 * pagamento (com × sem financiamento imobiliário). Administração e propostas
 * são linha única.
 *
 * Estados por linha de garantia:
 *   atribuído   — template ativo com `matchCriteria.garantia` deste tipo;
 *                 ★ quando ele é o padrão da modalidade.
 *   em revisão  — só rascunho (veio da ingestão, falta ativar) → Conferir.
 *   faltante    — sem modelo próprio; âmbar quando a geração cai no modelo
 *                 genérico/padrão (nome exibido), vermelho quando a modalidade
 *                 não tem NENHUM ativo (a geração morre).
 *
 * Ofertantes (Loft, Pottencial, Tokio…) NÃO são templates: são cláusulas do
 * acervo injetadas no slot — por isso aparecem como sublinha informativa, não
 * como linha.
 *
 * Incluir/gerenciar modelos NÃO acontece aqui — é papel da aba Modelos.
 */
export function ContractTypesPanel({
  report,
  board,
  providersByGarantia,
}: {
  report: CoverageReport;
  board: GarantiaBoardRow[];
  /** Seguradoras com cláusula própria no acervo, por tipo de garantia. */
  providersByGarantia: Partial<Record<GarantiaTipo, string[]>>;
}) {
  const byModalidade = new Map(report.rows.map((r) => [r.modalidade as string, r]));
  const boardByModalidade = new Map(board.map((b) => [b.modalidade, b]));
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  // Rótulos de venda na linguagem do dono — locais do painel, de propósito:
  // o resto da UI segue MODALIDADE_LABELS.
  const vendas = [
    { modalidade: "a_vista", label: "Venda sem financiamento imobiliário" },
    { modalidade: "financiamento", label: "Venda com financiamento imobiliário" },
    { modalidade: "proposta_venda", label: "Proposta de compra" },
  ].flatMap((v) => {
    const row = byModalidade.get(v.modalidade);
    return row ? [{ row, label: v.label }] : [];
  });

  const locacoes = ["locacao", "locacao_comercial"].flatMap((m) => {
    const row = byModalidade.get(m);
    const b = boardByModalidade.get(m);
    return row && b ? [{ row, board: b }] : [];
  });

  const administracao = byModalidade.get("administracao_locacao");
  const propostas = [
    "proposta_locacao_residencial",
    "proposta_locacao_comercial",
  ].flatMap((m) => {
    const row = byModalidade.get(m);
    return row ? [row] : [];
  });

  return (
    <section className="rounded-lg border">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Tipos de contrato</h2>
        <span
          className={
            report.kitComplete
              ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300"
          }
        >
          {report.requiredDone} de {report.requiredTotal} essenciais
        </span>
        <p className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">
          Cada tipo usa o modelo marcado como padrão. Para trocar ou incluir
          modelos, use a aba Modelos.
        </p>
      </header>

      {vendas.length > 0 && (
        <>
          <SectionStrip title="Vendas" />
          <div className="divide-y">
            {vendas.map(({ row, label }) => (
              <TypeLine
                key={row.modalidade}
                row={row}
                labelOverride={label}
                onPreview={setPreview}
              />
            ))}
          </div>
        </>
      )}

      {locacoes.map(({ row, board: b }) => (
        <LocacaoSection
          key={row.modalidade}
          row={row}
          board={b}
          providersByGarantia={providersByGarantia}
          onPreview={setPreview}
        />
      ))}

      {administracao && (
        <>
          <SectionStrip
            title="Administração de locação"
            optional={!administracao.required}
          />
          <div className="divide-y">
            <TypeLine row={administracao} onPreview={setPreview} />
          </div>
        </>
      )}

      {propostas.length > 0 && (
        <>
          <SectionStrip title="Propostas de locação" />
          <div className="divide-y">
            {propostas.map((row) => (
              <TypeLine key={row.modalidade} row={row} onPreview={setPreview} />
            ))}
          </div>
        </>
      )}

      {preview && (
        <TemplatePreview
          templateId={preview.id}
          templateName={preview.name}
          templateModalidade={preview.modalidade}
          templateEngine={preview.engine}
          open
          onOpenChange={(open) => !open && setPreview(null)}
        />
      )}
    </section>
  );
}

/**
 * Seção de um tipo de locação: cabeçalho com o estado da modalidade + as 7
 * linhas de garantia. Quando o padrão da modalidade é um modelo GENÉRICO
 * (nenhuma linha leva a ★), o cabeçalho diz quem ele é — senão o operador não
 * encontra o padrão em lugar nenhum.
 */
function LocacaoSection({
  row,
  board,
  providersByGarantia,
  onPreview,
}: {
  row: CoverageRow;
  board: GarantiaBoardRow;
  providersByGarantia: Partial<Record<GarantiaTipo, string[]>>;
  onPreview: (t: PreviewTarget) => void;
}) {
  const genericDefault =
    row.defaultAssigned && !board.defaultGarantia ? board.fallbackName : null;
  return (
    <>
      <SectionStrip
        title={`${board.label} — por tipo de garantia`}
        optional={!row.required}
      >
        {row.state === "missing" ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
            <CircleAlert className="h-3 w-3" /> nenhum modelo ativo
          </span>
        ) : !row.defaultAssigned ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            <TriangleAlert className="h-3 w-3" /> sem padrão definido
          </span>
        ) : genericDefault ? (
          <span
            className="text-[11px] text-muted-foreground"
            title="O padrão desta modalidade é um modelo genérico, sem tipo de garantia — nenhuma linha abaixo leva a estrela"
          >
            padrão:{" "}
            <span className="font-medium text-foreground">{genericDefault}</span>
          </span>
        ) : null}
        {row.state === "missing" ? (
          <Button size="sm" className="ml-auto" asChild>
            <Link href="/templates?tab=modelos&ingest=1">Enviar modelo</Link>
          </Button>
        ) : !row.defaultAssigned ? (
          <Button size="sm" variant="outline" className="ml-auto" asChild>
            <Link href={`/templates?tab=modelos&modalidade=${row.modalidade}`}>
              Escolher padrão
            </Link>
          </Button>
        ) : null}
      </SectionStrip>
      <div className="divide-y">
        {board.cells.map((cell) => (
          <GarantiaLine
            key={cell.garantia}
            cell={cell}
            board={board}
            providers={providersByGarantia[cell.garantia]}
            onPreview={onPreview}
          />
        ))}
      </div>
    </>
  );
}

/** Linha de UM tipo de garantia dentro da seção de locação. */
function GarantiaLine({
  cell,
  board,
  providers,
  onPreview,
}: {
  cell: GarantiaCoverageCell;
  board: GarantiaBoardRow;
  providers?: string[];
  onPreview: (t: PreviewTarget) => void;
}) {
  const isStar =
    cell.state === "active" && board.defaultGarantia === cell.garantia;
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <GarantiaStateBadge cell={cell} hasFallback={Boolean(board.fallbackName)} />
        <span className="text-sm font-medium">{cell.label}</span>
        {cell.state !== "missing" && cell.templateName && (
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            · <span className="text-foreground">{cell.templateName}</span>
          </span>
        )}
        {isStar && (
          <span
            title="Padrão da modalidade — é este modelo que a geração usa quando o formulário não decide"
            className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          >
            <Star className="h-3 w-3 fill-current" /> padrão da modalidade
          </span>
        )}
        {cell.state === "missing" && board.fallbackName && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            gera com o padrão:{" "}
            <span className="text-foreground">{board.fallbackName}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {cell.state !== "missing" && cell.templateId && (
            <Button
              size="sm"
              variant="ghost"
              title="Ver preview do modelo"
              onClick={() =>
                onPreview({
                  id: cell.templateId!,
                  name: cell.templateName ?? cell.label,
                  modalidade: board.modalidade,
                  engine: cell.templateEngine ?? "handlebars",
                })
              }
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          )}
          {cell.state === "missing" ? (
            <Button size="sm" variant="outline" asChild>
              <Link href="/templates?tab=modelos&ingest=1">Enviar modelo</Link>
            </Button>
          ) : cell.state === "draft" ? (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/templates/${cell.templateId}`}>Conferir</Link>
            </Button>
          ) : (
            cell.templateId && (
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/templates/${cell.templateId}`}>Abrir</Link>
              </Button>
            )
          )}
        </div>
      </div>
      {providers && providers.length > 0 && (
        <p className="mt-1 pl-0.5 text-[11px] text-muted-foreground">
          Seguradoras no acervo: {providers.join(" · ")}
        </p>
      )}
    </div>
  );
}

function GarantiaStateBadge({
  cell,
  hasFallback,
}: {
  cell: GarantiaCoverageCell;
  hasFallback: boolean;
}) {
  if (cell.state === "active") {
    return (
      <span
        title="Modelo próprio deste tipo de garantia — o formulário o seleciona de forma vinculante"
        className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      >
        <Check className="h-3 w-3" /> atribuído
      </span>
    );
  }
  if (cell.state === "draft") {
    return (
      <span
        title="Veio da ingestão e ainda não foi ativado — a geração não o enxerga"
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-amber-400 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
      >
        <TriangleAlert className="h-3 w-3" /> em revisão
      </span>
    );
  }
  if (hasFallback) {
    return (
      <span
        title="Sem modelo próprio — contratos desta garantia saem com o modelo padrão da modalidade"
        className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300"
      >
        <TriangleAlert className="h-3 w-3" /> faltante
      </span>
    );
  }
  return (
    <span
      title="Sem nenhum modelo ativo nesta modalidade — a geração deste tipo falha"
      className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive"
    >
      <CircleAlert className="h-3 w-3" /> faltante
    </span>
  );
}

function SectionStrip({
  title,
  optional,
  children,
}: {
  title: string;
  optional?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-1.5 first:border-t-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
        {title}
      </span>
      {optional && (
        <span className="rounded-full border px-1.5 py-px text-[10px] text-muted-foreground">
          Opcional
        </span>
      )}
      {children}
    </div>
  );
}

function TypeLine({
  row,
  labelOverride,
  onPreview,
}: {
  row: CoverageRow;
  labelOverride?: string;
  onPreview: (t: PreviewTarget) => void;
}) {
  const assigned = row.state !== "missing" && row.defaultAssigned;
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge row={row} />
        <span className="text-sm font-medium">{labelOverride ?? row.label}</span>
        {assigned && row.templateName && (
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            · <span className="text-foreground">{row.templateName}</span>
          </span>
        )}
        {assigned && <OriginBadge own={row.state === "own"} />}
        <div className="ml-auto flex items-center gap-1">
          {assigned && row.templateId && (
            <Button
              size="sm"
              variant="ghost"
              title="Ver preview do modelo"
              onClick={() =>
                onPreview({
                  id: row.templateId!,
                  name: row.templateName ?? row.label,
                  modalidade: row.modalidade,
                  engine: row.templateEngine ?? "handlebars",
                })
              }
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          )}
          {row.state === "missing" ? (
            <Button size="sm" asChild>
              <Link href="/templates?tab=modelos&ingest=1">Enviar modelo</Link>
            </Button>
          ) : !row.defaultAssigned ? (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/templates?tab=modelos&modalidade=${row.modalidade}`}>
                Escolher padrão
              </Link>
            </Button>
          ) : (
            row.templateId && (
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/templates/${row.templateId}`}>Abrir</Link>
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function StateBadge({ row }: { row: CoverageRow }) {
  if (row.state === "missing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
        <CircleAlert className="h-3 w-3" /> faltando
      </span>
    );
  }
  if (!row.defaultAssigned) {
    return (
      <span
        title="Há modelos ativos deste tipo, mas nenhum marcado como padrão — a geração pode escolher um que você não esperava"
        className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300"
      >
        <TriangleAlert className="h-3 w-3" /> sem padrão
      </span>
    );
  }
  return (
    <span
      title="Padrão atribuído — é este modelo que a geração usa"
      className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
    >
      <Check className="h-3 w-3" /> padrão
    </span>
  );
}

function OriginBadge({ own }: { own: boolean }) {
  if (own) return null;
  return (
    <span
      title="Modelo padrão do sistema — funciona, mas não tem o timbrado de vocês"
      className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300"
    >
      <Sparkles className="h-3 w-3" /> modelo do sistema
    </span>
  );
}
