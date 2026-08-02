/**
 * Saneamento de texto não-confiável que sai da plataforma pra um canal externo.
 *
 * Título de deal, nome de parte e corpo de notificação podem vir do FORM PÚBLICO
 * ANÔNIMO — são DADO, nunca instrução (mesma ameaça da regra 19 do agente de
 * contrato / `<observacoes_form>`). Remove quebras, controles e aspas/ângulos, e
 * trunca no limite do campo.
 *
 * Vive aqui, e não sob `lib/newton/`, porque os DOIS agentes de WhatsApp
 * consomem: o Newton cerca o resultado num bloco `<conteudo>` dentro de um turn
 * em linguagem natural; o Max manda os campos já separados no corpo do `/notify`
 * (sem prompt no meio, então sem cerca a montar). O tratamento do texto é o
 * mesmo nos dois — o que muda é o transporte.
 *
 * Nota sobre as aspas: elas caem por causa do turn do Newton, onde uma aspa
 * solta fecharia o bloco. No Max seriam inofensivas, mas manter uma única
 * função evita que "sanitizado" signifique coisas diferentes em dois lugares.
 */
export function sanitizeUntrusted(raw: string, max: number): string {
  return (
    raw
      .replace(/[\r\n\t]+/g, " ")
      // `\p{Cc}` = categoria Unicode "Control": cobre C0 (0x00–0x1F) e C1
      // (0x7F–0x9F) sem escapes numéricos no fonte. As quebras já viraram espaço
      // na linha acima; aqui morre o resto.
      .replace(/\p{Cc}/gu, "")
      .replace(/["'`<>]/g, "")
      .trim()
      .slice(0, max)
  );
}
