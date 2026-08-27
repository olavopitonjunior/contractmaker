import Link from "next/link";
import { Check, CircleAlert, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  CoverageReport,
  CoverageRow,
  GarantiaCoverageReport,
  GarantiaCoverageRow,
} from "@/lib/templates/coverage";

/**
 * Aba "Tipos de contrato" — a tela principal de /templates.
 *
 * Uma linha por tipo padrão do sistema (as modalidades canônicas dos módulos
 * habilitados). Cada linha responde UMA pergunta: qual modelo é o PADRÃO deste
 * tipo? Três estados:
 *
 *   atribuído   — nome do modelo padrão em destaque + origem (seu modelo ×
 *                 modelo do sistema); ação: Abrir.
 *   sem padrão  — há modelos ativos mas nenhum `isDefault`; ação: Escolher
 *                 padrão (aba Modelos filtrada pelo tipo).
 *   faltando    — nenhum modelo ativo; a geração deste tipo morre; ação:
 *                 Enviar modelo.
 *
 * Incluir/gerenciar modelos NÃO acontece aqui — é papel da aba Modelos. Esta
 * tela substitui o antigo SystemTemplatesPanel, que misturava cobertura com
 * convite de upload em toda linha e não distinguia "sem padrão" de "coberto".
 */
export function ContractTypesPanel({
  report,
  garantias,
}: {
  report: CoverageReport;
  garantias: GarantiaCoverageReport;
}) {
  const required = report.rows.filter((r) => r.required);
  const optional = report.rows.filter((r) => !r.required);
  const garantiaByModalidade = new Map(
    garantias.rows.map((r) => [r.modalidade, r] as const)
  );

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

      <div className="divide-y">
        {required.map((row) => (
          <TypeLine
            key={row.modalidade}
            row={row}
            garantia={garantiaByModalidade.get(row.modalidade)}
          />
        ))}
      </div>

      {optional.length > 0 && (
        <>
          <p className="border-t bg-muted/30 px-4 py-1.5 text-xs font-medium text-muted-foreground">
            Opcionais do seu plano
          </p>
          <div className="divide-y">
            {optional.map((row) => (
              <TypeLine
                key={row.modalidade}
                row={row}
                garantia={garantiaByModalidade.get(row.modalidade)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TypeLine({
  row,
  garantia,
}: {
  row: CoverageRow;
  garantia?: GarantiaCoverageRow;
}) {
  const assigned = row.state !== "missing" && row.defaultAssigned;
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge row={row} />
        <span className="text-sm font-medium">{row.label}</span>
        {assigned && row.templateName && (
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            · <span className="text-foreground">{row.templateName}</span>
          </span>
        )}
        {assigned && (
          <OriginBadge own={row.state === "own"} />
        )}
        <div className="ml-auto flex items-center gap-2">
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
      <GarantiaChips row={garantia} modalidade={row.modalidade} />
    </div>
  );
}

/**
 * Segunda dimensão dos tipos de locação: variantes por garantia. Só aparece
 * quando a org JÁ cobre alguma garantia neste tipo (mesma régua anti-muro dos
 * `gaps` da matriz) — um tenant sem variantes não ganha uma linha de aviso
 * sobre um recurso que nunca usou.
 */
function GarantiaChips({
  row,
  modalidade,
}: {
  row?: GarantiaCoverageRow;
  modalidade: string;
}) {
  if (!row) return null;
  const covered = row.cells.filter((c) => c.state !== "missing");
  if (covered.length === 0) return null;
  const missing = row.cells.filter((c) => c.state === "missing");
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-0.5">
      <span className="text-[11px] text-muted-foreground">Garantias:</span>
      {covered.map((c) => (
        <Link
          key={c.garantia}
          href={`/templates?tab=modelos&modalidade=${modalidade}`}
          title={
            c.state === "draft"
              ? `${c.templateName ?? c.label} — em revisão, falta ativar`
              : c.templateName ?? c.label
          }
          className={
            c.state === "draft"
              ? "rounded-full border border-dashed border-amber-400 px-2 py-px text-[11px] text-amber-700 dark:text-amber-400"
              : "rounded-full border px-2 py-px text-[11px] text-muted-foreground"
          }
        >
          {c.label}
        </Link>
      ))}
      {missing.length > 0 && (
        <span className="text-[11px] text-muted-foreground/70">
          · {missing.length} sem modelo próprio
        </span>
      )}
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
