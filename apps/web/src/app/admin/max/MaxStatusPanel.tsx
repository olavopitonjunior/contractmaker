import type { MaxStatusResult } from "@/lib/max/admin-client";
import { horaSP } from "./hora";

/**
 * Painel de estado do serviço do Max. Server component — o dado é sensível
 * (fila de notificação de tenant) e não deve trafegar pro browser via API
 * pública.
 */


function Card({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  hint?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "bad"
          ? "text-red-600"
          : "text-foreground";
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

export function MaxStatusPanel({ result }: { result: MaxStatusResult }) {
  if (!result.ok) {
    const message =
      result.reason === "not_configured"
        ? "Serviço do Max ainda não configurado — falta MAX_NOTIFY_URL/MAX_NOTIFY_SECRET no ambiente."
        : result.reason === "unauthorized"
          ? "O serviço recusou a assinatura. Os dois lados precisam do MESMO MAX_NOTIFY_SECRET."
          : result.reason === "unreachable"
            ? "Serviço do Max fora do ar ou inacessível."
            : "Não foi possível ler o estado do serviço.";
    return (
      <section className="rounded-lg border border-dashed p-6">
        <h2 className="text-sm font-semibold">Serviço</h2>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        {result.detail ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {result.detail}
          </p>
        ) : null}
      </section>
    );
  }

  const { zapi, window: win, outbox } = result.status;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold">Serviço</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {/*
            O número mais importante da tela: instância desemparelhada aceita o
            envio com HTTP 200 e messageId válido e NÃO entrega. Sem olhar
            aqui, a fila parece saudável enquanto ninguém recebe.
          */}
          <Card
            label="Instância Z-API"
            value={zapi.connected ? "Conectada" : "DESCONECTADA"}
            tone={zapi.connected ? "good" : "bad"}
            hint={
              zapi.connected
                ? undefined
                : "Desemparelhada, o envio responde 200 e não entrega. Repareie por QR."
            }
          />
          <Card
            label="Janela 7h–22h"
            value={win.open ? "Aberta" : "Fechada"}
            tone={win.open ? "good" : "neutral"}
            hint={
              win.open
                ? "Entregando agora"
                : `Próxima entrega ${horaSP(win.nextDelivery)}`
            }
          />
          <Card
            label="Na fila"
            value={String(outbox.pending)}
            tone={outbox.pending > 50 ? "warn" : "neutral"}
            hint="Aguardando a janela ou o próximo cron"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Últimos 7 dias</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card label="Enviadas" value={String(outbox.last7d.sent ?? 0)} />
          <Card
            label="Falhas"
            value={String(outbox.failed)}
            tone={outbox.failed > 0 ? "bad" : "good"}
            hint={
              outbox.failed > 0
                ? "Esgotaram as tentativas — ver motivo abaixo"
                : undefined
            }
          />
          <Card label="Pendentes" value={String(outbox.last7d.pending ?? 0)} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Entregas recentes</h2>
        {outbox.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nada ainda. A primeira notificação aparece aqui assim que um tenant
            roteado gerar um evento.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Quando</th>
                  <th className="py-2 pr-3">Aviso</th>
                  <th className="py-2 pr-3">Público</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {outbox.recent.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                      {horaSP(row.created_at)}
                    </td>
                    <td className="py-2 pr-3">{row.title || "—"}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {row.audience}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          row.status === "sent"
                            ? "text-emerald-600"
                            : row.status === "failed"
                              ? "text-red-600"
                              : "text-amber-600"
                        }
                      >
                        {row.status}
                      </span>
                      {row.attempts > 1 ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({row.attempts}×)
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {row.last_error ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          <strong>Enviada</strong> aqui significa que a Z-API aceitou — não que
          o destinatário recebeu. A reconciliação de entrega de verdade (pelos
          callbacks do provedor) ainda não existe.
        </p>
      </section>
    </div>
  );
}
