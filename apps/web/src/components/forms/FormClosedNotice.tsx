import { CheckCircle2 } from "lucide-react";

/**
 * Tela mostrada quando alguém sem sessão abre o link de um formulário que já
 * foi enviado. Não renderiza NENHUM dado do form — é justamente o ponto: o
 * link deixa de servir PII depois do envio.
 *
 * Tom deliberado: confirma o envio (o cliente que reabre o próprio link quer
 * saber que deu certo) sem revelar nada sobre o negócio, e sem prometer
 * edição. Quem precisa corrigir fala com a imobiliária, que reabre o form pelo
 * painel autenticado.
 */
export function FormClosedNotice() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-4 py-16">
      <div className="w-full max-w-md rounded-lg border bg-background p-8 text-center shadow-xs">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
          <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
        </div>
        <h1 className="font-display mb-2 text-xl font-semibold tracking-tight text-foreground">
          Formulário já enviado
        </h1>
        <p className="text-sm text-muted-foreground">
          Este formulário foi concluído e o link não está mais disponível para
          consulta. Se precisar corrigir alguma informação, fale com a
          imobiliária responsável pelo seu negócio.
        </p>
      </div>
    </main>
  );
}
