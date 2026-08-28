"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SummarySection } from "@/lib/forms/negotiation-summary";

/**
 * Render das seções do resumo consolidado do formulário — as MESMAS que vão pro
 * PDF e pro e-mail (`buildConsolidatedFormSummary`).
 *
 * Existe para acabar com a divergência que motivou o pedido: a aba Dados do
 * negócio tinha um mapeamento manual próprio, bem mais pobre que o do PDF, e as
 * duas listas eram mantidas à mão. Agora a tela consome o mesmo builder, então
 * todo campo acrescentado lá aparece nas duas superfícies de uma vez.
 *
 * As seções são calculadas no SERVER (o builder é puro, mas roda ao lado do
 * fetch do deal) e chegam aqui como prop.
 */
export function FormSummarySections({
  sections,
  title = "Todos os dados do formulário",
  description,
}: {
  sections: SummarySection[];
  title?: string;
  description?: string;
}) {
  if (!sections.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {sections.map((sec, i) => (
          <section key={`${sec.title}-${i}`} className="space-y-1.5">
            <h3 className="border-b pb-1 text-sm font-semibold">{sec.title}</h3>
            <dl className="divide-y divide-border/60">
              {sec.rows.map((row, j) => (
                <div
                  key={`${row.label}-${j}`}
                  className="grid grid-cols-1 gap-0.5 py-1.5 sm:grid-cols-[minmax(0,34%)_minmax(0,1fr)] sm:gap-3"
                >
                  <dt className="text-xs font-medium text-muted-foreground sm:text-sm">
                    {row.label}
                  </dt>
                  {/* break-words: chave PIX, endereço longo e observações não
                      podem estourar a coluna nem forçar scroll horizontal. */}
                  <dd className="text-sm break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
