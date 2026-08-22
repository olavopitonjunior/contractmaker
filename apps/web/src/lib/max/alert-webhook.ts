import { z } from "zod";
import { sendEmail } from "@/lib/email/client";
import { alertRecipients, reportPlatformAlert } from "@/lib/alerts/platform-alerts";

/**
 * Alerta operacional do Max — hoje, a queda e a volta da instância Z-API.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 *
 * Em 2026-08-04 quatro mensagens reais se perderam porque a instância caiu e
 * ninguém soube. A causa técnica já está corrigida — `send-text` numa
 * instância desemparelhada responde 200 com um `messageId` que não chega a
 * lugar nenhum, então o outbox e o inbound do Max checam a conexão ANTES de
 * tentar, represam a fila e param de mentir "enviado". O que faltava era o
 * AVISO: a fila não se perde, mas fica parada em silêncio até alguém abrir o
 * painel.
 *
 * ── Por que a rota mora em `/api/webhooks/max/*`, e não em `/api/agents/*` ─
 *
 * A spec previa `/api/agents/alert`. Aquela família inteira é autenticada por
 * `requireApiAuth` — Bearer de token POR ORG. Este evento é da INSTÂNCIA (uma
 * só, compartilhada pelos três tenants RE/MAX): não existe org natural de onde
 * tirar o token, e escolher uma arbitrariamente seria mentir sobre o escopo.
 * `/api/webhooks/max` já é a direção Max→plataforma autenticada por HMAC de
 * SERVIÇO (`MAX_WEBHOOK_SECRET`), que é exatamente o que este alerta é — daí
 * ele reusar `verifyMaxWebhook` sem uma linha nova de criptografia.
 */

const alertSchema = z.discriminatedUnion("evento", [
  z.object({
    evento: z.literal("zapi_desconectada"),
    at: z.string().datetime({ offset: true }),
    /**
     * Quantas mensagens estão esperando na fila AGORA. É o número que decide a
     * urgência de quem lê o e-mail às 3 da manhã — vem primeiro no corpo por
     * isso. Zero é resposta legítima e não silencia o alerta: a queda também
     * derruba o inbound, e quem escrever para o Max fica sem resposta.
     */
    represadas: z.number().int().min(0).max(1_000_000),
  }),
  z.object({
    evento: z.literal("zapi_reconectada"),
    at: z.string().datetime({ offset: true }),
    /**
     * Quanto tempo ficou fora, em ms. Número, e não a string "2h13m" já
     * pronta: um formato humano atravessando o contrato criaria um segundo
     * formatador para divergir do primeiro. Quem renderiza é quem exibe.
     */
    foraPorMs: z.number().int().min(0),
  }),
]);

export type MaxAlert = z.infer<typeof alertSchema>;

export function parseMaxAlert(payload: unknown): MaxAlert | null {
  const r = alertSchema.safeParse(payload);
  return r.success ? r.data : null;
}

/** "2h13m", "47s", "3d 4h" — só as duas maiores unidades, que é o que se lê. */
export function formatDuracao(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Destinatários do alerta.
 *
 * `MAX_ALERT_EMAIL` (lista separada por vírgula) é a configuração pedida — para
 * o endereço não virar constante no código. **Ausente cai nos `super_admin` do
 * banco** (`alertRecipients`), e não em lista vazia: um env esquecido na Vercel
 * transformaria este trabalho inteiro em alerta descartado em silêncio, que é
 * precisamente a falha que ele existe para matar.
 */
export async function maxAlertRecipients(): Promise<string[]> {
  const configurado = (process.env.MAX_ALERT_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (configurado.length > 0) return configurado;

  console.warn(
    "[webhook/max-alert] MAX_ALERT_EMAIL ausente — caindo nos super_admins do banco"
  );
  return alertRecipients();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * O e-mail. HTML montado à mão (como `platform-alerts`) em vez de template
 * React: é alerta de plataforma, não peça de marca — não leva logo de
 * imobiliária nem passa por `orgId`, porque a instância não é de nenhuma.
 */
export function renderMaxAlert(alert: MaxAlert): { subject: string; html: string } {
  const quando = new Date(alert.at).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  if (alert.evento === "zapi_reconectada") {
    const fora = formatDuracao(alert.foraPorMs);
    return {
      subject: `[imobpro] ✅ Max: WhatsApp reconectado (ficou fora por ${fora})`,
      html: [
        `<p><strong>A instância Z-API do Max voltou.</strong></p>`,
        `<p>Ficou fora por <strong>${escapeHtml(fora)}</strong>. Reconectou em ${escapeHtml(quando)}.</p>`,
        `<p>A fila represada volta a sair sozinha — o cron do outbox despacha a cada minuto, respeitando a janela 7h–22h.</p>`,
        `<p style="color:#888">Conferir em /admin/max.</p>`,
      ].join("\n"),
    };
  }

  const n = alert.represadas;
  const fila =
    n === 0
      ? "Nenhuma notificação está represada no momento."
      : `<strong>${n} mensagem(ns) represada(s)</strong> esperando na fila.`;

  return {
    subject:
      n === 0
        ? `[imobpro] 🔴 Max: WhatsApp desconectado`
        : `[imobpro] 🔴 Max: WhatsApp desconectado — ${n} mensagem(ns) represada(s)`,
    html: [
      `<p><strong>A instância Z-API do Max caiu.</strong></p>`,
      `<p>${fila}</p>`,
      `<p><strong>Nada se perde.</strong> O outbox represa e volta a despachar na reconexão. O que para de verdade é a conversa: quem escrever para o Max agora não recebe resposta.</p>`,
      `<p>Detectado em ${escapeHtml(quando)}.</p>`,
      `<p><strong>O que fazer:</strong> abrir o painel da Z-API e repárear a instância pelo QR code. Um novo e-mail sai automaticamente quando ela voltar, com o tempo que ficou fora.</p>`,
      `<p style="color:#888">Estado ao vivo em /admin/max. Histórico em /admin/metrics → Auditoria.</p>`,
    ].join("\n"),
  };
}

/**
 * Manda o e-mail e deixa o rastro.
 *
 * **Os dois caminhos são separados de propósito.** `reportPlatformAlert` tem
 * re-arm de 24 h e teto horário de imediatos — anti-spam certo para tempestade
 * de erro de integração, errado aqui: quem decide se este alerta se repete é a
 * tabela `connection_state` do OUTRO lado (transição, com debounce de 1 h), e
 * um segundo incidente no mesmo dia seria engolido pelo re-arm. Então o e-mail
 * sai direto por `sendEmail`, e o motor de alertas é chamado em modo
 * `"digest"` — que registra em `PlatformAlertEvent` (aparece em
 * `/admin/metrics → Auditoria`) sem e-mailar de novo.
 *
 * Devolve `false` quando o e-mail NÃO saiu. A rota transforma isso em 500, e o
 * Max retenta na passada seguinte — o carimbo dele só acontece no sucesso, e é
 * daí que sai o retry sem fila nova.
 */
export async function deliverMaxAlert(alert: MaxAlert): Promise<boolean> {
  const to = await maxAlertRecipients();
  if (to.length === 0) {
    console.error("[webhook/max-alert] nenhum destinatário — alerta não enviado");
    return false;
  }

  const { subject, html } = renderMaxAlert(alert);
  const caiu = alert.evento === "zapi_desconectada";

  // Registro primeiro: se o provedor de e-mail estiver fora, o incidente ainda
  // fica gravado em algum lugar. Fire-and-forget, nunca lança.
  reportPlatformAlert({
    kind: "agent_channel_down",
    // Assinatura fixa: é uma instância só. O motor INCREMENTA `count` em vez de
    // criar linha, então o histórico vira "quantas vezes o canal do Max caiu".
    signature: `max:zapi:${alert.evento}`,
    severity: caiu ? "critical" : "info",
    title: subject.replace(/^\[imobpro\] [^ ]+ /, ""),
    payload: caiu
      ? { at: alert.at, represadas: alert.represadas }
      : { at: alert.at, foraPor: formatDuracao(alert.foraPorMs) },
    notify: "digest",
  });

  // `sendEmail` NÃO lança — devolve `{ok:false}`. Ler o `ok` é obrigatório:
  // um try/catch sozinho não vê a recusa do provedor.
  const result = await sendEmail({ to, subject, html });
  if (!result.ok) {
    console.error(`[webhook/max-alert] e-mail recusado: ${result.error ?? "sem detalhe"}`);
    return false;
  }
  return true;
}
