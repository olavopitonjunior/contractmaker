import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { signMaxRequest } from "./hmac";
import { timingSafeEqualStr } from "@/lib/security/crypto";

/**
 * Recepção do desfecho de entrega vindo do Max — a volta do laço que o
 * `/notify` abre. O `docs/max.md` §8 chamava isso de "ponto cego": depois do
 * 202, falha real (número sem WhatsApp, bloqueio, instância desconectada) só
 * aparecia nos callbacks da Z-API, visíveis apenas dentro do Max.
 *
 * A costura: o `dedupeKey` que viajou no `/notify` (e voltou aqui) é o **ID
 * da linha de log** — os call-sites mandam `dedupeKey: logId` /
 * `dedupeKey: deliveryId` de propósito ("a linha de log é o chokepoint
 * atômico de idempotência; reusá-la como dedupeKey estende a garantia até
 * dentro do Max"). Por isso o match é por `id`, NUNCA pela coluna
 * `dedupeKey` dos modelos (que guarda a chave de EVENTO — stageId+dia etc. —
 * e casaria zero linhas). O `orgId` é OBRIGATÓRIO como cerca: um webhook
 * autenticado por secret global não pode escrever em linha de tenant que ele
 * não nomeou — o mesmo defeito que o `/admin/status` do Max corrigiu na
 * direção oposta.
 *
 * O desfecho vai na coluna PRÓPRIA `maxDeliveryJson` — não numa chave de
 * `detail`: os settles dos trilhos substituem `detail` inteiro a cada
 * tentativa (sweep/retry) e apagariam a marca (achado de code review). Só o
 * webhook escreve nesta coluna. O `status` da linha NÃO muda: naqueles
 * modelos ele significa "processado pelo trilho", não "entregue" —
 * sobrescrevê-lo quebraria claim/sweep.
 */

/** Espelho do vocabulário de `max-agent/src/lib/delivery.ts`. */
const outcomeSchema = z.object({
  orgId: z.string().min(1),
  dedupeKey: z.string().min(1),
  status: z.enum(["delivered", "read", "unconfirmed", "failed"]),
  at: z.string().datetime({ offset: true }),
  providerMessageId: z.string().nullable().optional(),
});

export type DeliveryOutcome = z.infer<typeof outcomeSchema>;

export function parseDeliveryOutcome(payload: unknown): DeliveryOutcome | null {
  const r = outcomeSchema.safeParse(payload);
  return r.success ? r.data : null;
}

/**
 * Mesma janela do lado do Max (`MAX_SKEW_MS`): requisição capturada expira
 * junto com a tolerância de relógio.
 */
const SKEW_MS = 5 * 60_000;

/**
 * Verificação do HMAC do webhook — `${timestamp}.${rawBody}`, o MESMO formato
 * do `/notify` (travado por vetor fixo nos dois repos), mas com secret
 * PRÓPRIO (`MAX_WEBHOOK_SECRET`): o `MAX_NOTIFY_SECRET` autentica este repo
 * falando com o Max; este autentica o Max falando com este repo. Compartilhar
 * o valor deixaria qualquer um dos lados forjar o outro.
 */
export function verifyMaxWebhook(params: {
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  secret: string;
  now?: number;
}): boolean {
  const { timestamp, signature, rawBody, secret } = params;
  if (!timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = params.now ?? Date.now();
  if (Math.abs(now - ts) > SKEW_MS) return false;

  // O MESMO `signMaxRequest` do /notify — o doc de hmac.ts proíbe duplicar
  // justamente porque o formato é contrato de dois repos: divergir uma cópia
  // faria todo webhook 401 em silêncio. Comparação pelo helper da casa.
  return timingSafeEqualStr(signMaxRequest(timestamp, rawBody, secret), signature);
}

/**
 * Progresso monotônico, espelhando o rank do Max: callbacks reentregues ou
 * fora de ordem não regridem (`read` não vira `delivered`), e `unconfirmed` /
 * `failed` são notícia fraca que um `delivered` atrasado corrige. O receptor
 * é idempotente por conta própria — o cliente RETENTA enquanto não carimba
 * `reported_at`, então o mesmo desfecho pode chegar duas vezes.
 */
const RANK: Record<DeliveryOutcome["status"], number> = {
  // failed e unconfirmed empatam DE PROPÓSITO: no remetente eles nascem de
  // estados mutuamente exclusivos (failed = envio nunca aceito, sem provider
  // id; unconfirmed = aceito e sem notícia) — a sequência unconfirmed→failed
  // é inalcançável, e desempatar quebraria delivered-depois-de-failed.
  failed: 1,
  unconfirmed: 1,
  delivered: 2,
  read: 3,
};

/**
 * O CASE do SQL é DERIVADO do mapa — mesma regra do lado do Max: duas cópias
 * sincronizadas à mão de um ranking é corrupção silenciosa esperando drift.
 * Exportado para o teste travar o formato.
 */
export function rankCaseSql(): string {
  const whens = Object.entries(RANK)
    .map(([status, rank]) => `WHEN '${status}' THEN ${rank}`)
    .join(" ");
  return `CASE "maxDeliveryJson"->>'status' ${whens} ELSE 0 END`;
}

interface MaxDeliveryDetail {
  status: string;
  at: string;
  providerMessageId: string | null;
  receivedAt: string;
}

export interface ApplyResult {
  dealLogs: number;
  userDeliveries: number;
}

/**
 * Grava o desfecho no trilho dono da linha. O id (`dedupeKey` do payload) é
 * PK numa das duas tabelas — no máximo UMA linha no total; o Max não sabe de
 * qual trilho a notificação nasceu, então tenta as duas.
 *
 * UM UPDATE atômico por tabela, com a guarda de rank no próprio WHERE — não
 * é read-modify-write em código de app de propósito (achado do code review):
 * duas requisições concorrentes (cron sobreposto do Max, retentativa lenta)
 * liam o mesmo pré-estado e a última escrita vencia, regredindo read →
 * delivered para sempre. É a mesma defesa que o REMETENTE usa (rank no WHERE
 * do reported_at). Id desconhecido devolve zeros e o chamador responde 200
 * mesmo assim.
 */
export async function applyDeliveryOutcome(
  outcome: DeliveryOutcome
): Promise<ApplyResult> {
  const mark: MaxDeliveryDetail = {
    status: outcome.status,
    at: outcome.at,
    providerMessageId: outcome.providerMessageId ?? null,
    receivedAt: new Date().toISOString(),
  };
  const markJson = JSON.stringify(mark);
  const rank = RANK[outcome.status];
  const rankGuard = Prisma.raw(rankCaseSql());

  // Independentes (o id é PK em no máximo UMA das tabelas) — em paralelo.
  const [dealLogs, userDeliveries] = await Promise.all([
    prisma.$executeRaw`
      UPDATE "DealNotificationLog"
         SET "maxDeliveryJson" = ${markJson}::jsonb
       WHERE id = ${outcome.dedupeKey}
         AND "orgId" = ${outcome.orgId}
         AND channel = 'whatsapp'
         AND (${rankGuard}) < ${rank}`,
    prisma.$executeRaw`
      UPDATE "UserNotificationDelivery"
         SET "maxDeliveryJson" = ${markJson}::jsonb
       WHERE id = ${outcome.dedupeKey}
         AND "orgId" = ${outcome.orgId}
         AND channel = 'whatsapp'
         AND (${rankGuard}) < ${rank}`,
  ]);

  return { dealLogs, userDeliveries };
}
