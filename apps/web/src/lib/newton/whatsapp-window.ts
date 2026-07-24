/**
 * Janela de horário comercial do WhatsApp (7h–22h America/Sao_Paulo).
 *
 * Espelha a regra do sidecar pra mensagens agendadas (cron-window.ts), mas
 * aplicada ao disparo IMEDIATO: automação que casa de madrugada não acorda
 * ninguém — a mensagem espera o cron dentro da janela.
 *
 * Vive aqui (e não em lib/surveys/channels.ts, de onde saiu) porque agora
 * serve os dois canais de WhatsApp: convite de pesquisa ao cliente e
 * notificação de sistema ao usuário da plataforma.
 */
export function isWithinWhatsappWindow(date: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(date)
  );
  return hour >= 7 && hour < 22;
}
