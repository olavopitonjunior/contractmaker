import Link from "next/link";
import { Check, CircleAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CoverageReport, CoverageRow } from "@/lib/templates/coverage";

/**
 * Painel "Modelos do sistema" — o front ensinando o que o produto espera.
 *
 * Mostra, por módulo habilitado, os modelos que toda imobiliária precisa ter
 * (kit mínimo) e os opcionais, com o estado de cada um:
 *   ✓ seu modelo    — a imobiliária subiu o DOCX timbrado dela
 *   ✓ modelo do sistema — o canônico está ativo e já gera contrato
 *   ✗ faltando      — a geração desta modalidade morre; CTA pra central
 *
 * Sem esta tela o tenant só descobria a falta na hora de gerar o contrato.
 */
export function SystemTemplatesPanel({ report }: { report: CoverageReport }) {
  const required = report.rows.filter((r) => r.required);
  const optional = report.rows.filter((r) => !r.required);

  return (
    <section className="rounded-lg border">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Modelos do sistema</h2>
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
          Este painel mede o kit mínimo da esteira: enquanto faltar um, aquele
          tipo de negócio não gera contrato. Em “Enviar modelo” você manda os
          arquivos de vocês do jeito que estão e nós montamos o que falta.
        </p>
      </header>

      <div className="divide-y">
        {required.map((row) => (
          <CoverageLine key={row.modalidade} row={row} />
        ))}
      </div>

      {optional.length > 0 && (
        <>
          <p className="border-t bg-muted/30 px-4 py-1.5 text-xs font-medium text-muted-foreground">
            Opcionais do seu plano
          </p>
          <div className="divide-y">
            {optional.map((row) => (
              <CoverageLine key={row.modalidade} row={row} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CoverageLine({ row }: { row: CoverageRow }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <StateBadge row={row} />
      <span className="text-sm font-medium">{row.label}</span>
      {row.state !== "missing" && row.templateName && (
        <span className="truncate text-xs text-muted-foreground">
          · {row.templateName}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {row.state === "missing" ? (
          <Button size="sm" asChild>
            <Link href="/templates?ingest=1">Enviar modelo</Link>
          </Button>
        ) : row.state === "canonical" ? (
          <Button size="sm" variant="ghost" asChild>
            <Link href="/templates?ingest=1">Usar o modelo de vocês</Link>
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
  );
}

function StateBadge({ row }: { row: CoverageRow }) {
  if (row.state === "own") {
    return (
      <span
        title="Modelo da sua imobiliária"
        className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      >
        <Check className="h-3 w-3" /> seu modelo
      </span>
    );
  }
  if (row.state === "canonical") {
    return (
      <span
        title="Modelo padrão do sistema — funciona, mas não tem o timbrado de vocês"
        className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300"
      >
        <Sparkles className="h-3 w-3" /> modelo do sistema
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
      <CircleAlert className="h-3 w-3" /> faltando
    </span>
  );
}
