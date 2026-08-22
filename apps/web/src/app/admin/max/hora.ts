/**
 * Hora em São Paulo, explicitamente — para as telas do Max.
 *
 * Estas telas são server components, e `toLocaleString("pt-BR")` sem `timeZone`
 * formata no fuso do SERVIDOR, que na Vercel é UTC. O sintoma observado em
 * produção em 21/08 foi a tela dizendo, lado a lado, "Janela 7h–22h · Fechada"
 * e "Próxima entrega 10:00" — os dois corretos, e juntos parecendo um defeito,
 * porque 10:00 UTC É 7h em São Paulo.
 *
 * A janela do Max é definida em `America/Sao_Paulo` (é cortesia com o
 * destinatário, não regra de infra), então quem confere a janela precisa ler o
 * mesmo fuso em que ela foi escrita.
 *
 * Mora aqui, e não em `lib/`, porque o alcance é exatamente estas duas telas: o
 * resto do produto formata data no browser, onde o fuso do usuário é o certo. O
 * sufixo `(SP)` fica visível de propósito — "17:32" sem fuso já custou uma
 * investigação.
 */
export function horaSP(valor: string | number | Date): string {
  return `${new Date(valor).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  })} (SP)`;
}
