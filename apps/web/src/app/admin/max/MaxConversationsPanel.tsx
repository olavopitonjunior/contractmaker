import type { MaxConversationsResult } from "@/lib/max/admin-client";
import { horaSP } from "./hora";

/**
 * Conversas do Max, por tenant.
 *
 * O `MaxStatusPanel` responde "a fila está saudável?". Este responde a outra
 * pergunta, que até hoje não tinha onde ser feita: **"o que o agente andou
 * dizendo, e quanto isso custou?"**.
 *
 * Ela nasceu de necessidade concreta: os dois primeiros turns reais em
 * produção (21/08) renderam quatro defeitos, e todos foram achados
 * consultando o banco à mão porque não havia tela nenhuma.
 *
 * Server component, como o painel de status — dado de conversa de tenant não
 * trafega pro browser por API pública. O telefone chega **já mascarado do
 * serviço**: a máscara é da origem, não desta tela, então nem um bug de render
 * aqui expõe o número.
 */

function Rotulo({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

export function MaxConversationsPanel({
  result,
  orgName,
  permitido,
}: {
  result: MaxConversationsResult | null;
  orgName?: string;
  permitido: boolean;
}) {
  /**
   * Sem permissão, a seção diz o que é — não some e não finge estar vazia.
   *
   * O gate de verdade está na página, que nem chega a buscar a conversa; isto
   * aqui é só a mensagem. E ela existe porque a alternativa (esconder) faria
   * `support` ver uma tela onde a lista some sem explicação e abrir chamado
   * dizendo que o painel quebrou.
   */
  if (!permitido) {
    return (
      <section className="mt-8">
        <h2 className="mb-2 font-display text-lg font-semibold">Conversas</h2>
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Transcrição de conversa é restrita ao super-admin da plataforma.
        </p>
      </section>
    );
  }

  // Sem tenant escolhido não há o que mostrar — e a rota do serviço exige
  // `orgId` de propósito: uma tela que lê conversa não deve mostrar todos os
  // tenants porque ninguém escolheu nenhum.
  if (!result) {
    return (
      <section className="mt-8">
        <h2 className="mb-2 font-display text-lg font-semibold">Conversas</h2>
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Escolha uma imobiliária acima para ver as conversas dela.
        </p>
      </section>
    );
  }

  if (!result.ok) {
    const texto =
      result.reason === "not_configured"
        ? "O serviço do Max não está configurado (falta MAX_NOTIFY_URL/SECRET)."
        : result.reason === "unauthorized"
          ? "O serviço recusou a assinatura — segredo divergente entre os dois lados."
          : result.reason === "unreachable"
            ? "Serviço fora do ar ou sem resposta."
            : "Não foi possível ler as conversas.";
    return (
      <section className="mt-8">
        <h2 className="mb-2 font-display text-lg font-semibold">Conversas</h2>
        <p className="rounded-lg border p-4 text-sm text-amber-700">
          {texto}
          {result.detail ? (
            <span className="block text-xs text-muted-foreground">{result.detail}</span>
          ) : null}
        </p>
      </section>
    );
  }

  const { turns } = result;

  return (
    <section className="mt-8">
      <h2 className="mb-2 font-display text-lg font-semibold">
        Conversas{orgName ? ` — ${orgName}` : ""}
      </h2>

      {result.degraded ? (
        <p className="mb-3 rounded-lg border p-3 text-xs text-amber-700">
          O serviço subiu antes da migration da auditoria. Estado transitório:
          os turns voltam a aparecer assim que a tabela existir.
        </p>
      ) : null}

      {turns.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Nenhuma conversa registrada para esta imobiliária.
        </p>
      ) : (
        <ul className="space-y-3">
          {turns.map((t) => {
            /**
             * `?? []` mesmo o schema garantindo `NOT NULL DEFAULT '[]'`.
             *
             * A garantia mora no Postgres de OUTRO serviço, e entre ele e esta
             * página não há validação de shape — o `res.json()` vira o tipo por
             * um `as`. Três caracteres compram independência de uma constraint
             * que este repositório não controla e não vê quebrar.
             */
            const usage = t.usage ?? [];
            const tools = t.tools ?? [];
            const tokensIn = usage.reduce((s, u) => s + (u.promptTokens ?? 0), 0);
            const tokensOut = usage.reduce(
              (s, u) => s + (u.completionTokens ?? 0),
              0
            );
            const cache = usage.reduce((s, u) => s + (u.cacheReadTokens ?? 0), 0);
            return (
              <li key={t.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-medium">{t.phone}</div>
                  <div className="text-xs text-muted-foreground">
                    {horaSP(t.createdAt)}
                  </div>
                </div>

                {t.inboundText ? (
                  <p className="mt-2 text-sm">
                    <Rotulo>recebido{t.kind !== "text" ? ` (${t.kind})` : ""}: </Rotulo>
                    {t.inboundText}
                  </p>
                ) : null}

                {t.replyText ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    <Rotulo>respondido: </Rotulo>
                    {t.replyText}
                  </p>
                ) : null}

                {/**
                 * A trilha de ferramenta é o que separa "o agente falou" de "o
                 * agente FEZ". `criado` é escrita real no tenant.
                 */}
                {tools.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tools.map((f, i) => (
                      <span
                        key={i}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          f.outcome === "criado"
                            ? "bg-emerald-100 text-emerald-800"
                            : f.outcome === "falhou"
                              ? "bg-red-100 text-red-800"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {f.name} · {f.outcome}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{usage.length} chamada(s) de modelo</span>
                  <span>
                    {tokensIn} entrada / {tokensOut} saída
                    {cache > 0 ? ` (${cache} de cache)` : ""}
                  </span>
                  {t.latencyMs != null ? <span>{(t.latencyMs / 1000).toFixed(1)} s</span> : null}
                  {t.messageId ? <span>msg {t.messageId.slice(0, 10)}</span> : null}
                </div>

                {/**
                 * Erro classificado, e não só técnico: `desconhecido_apresentado`,
                 * `ambiguo`, `transcricao_falhou_audio` são os turns que nunca
                 * chegaram ao grafo — exatamente os que alguém investiga ao
                 * perguntar "por que fulano não foi atendido?".
                 */}
                {t.error ? (
                  <div className="mt-2 text-xs text-amber-700">{t.error}</div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        O texto das conversas é apagado após 90 dias; as métricas ficam. O
        telefone chega mascarado do serviço. O custo em dólar aparece em
        Configurações → uso de IA, por tenant.
      </p>
    </section>
  );
}
