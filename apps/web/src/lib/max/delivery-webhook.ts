import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

/**
 * Recepção do desfecho de entrega vindo do Max — a volta do laço que o
 * `/notify` abre. O `docs/max.md` §8 chamava isso de "ponto cego": depois do
 * 202, falha real (número sem WhatsApp, bloqueio, instância desconectada) só
 * aparecia nos callbacks da Z-API, visíveis apenas dentro do Max.
 *
 * A costura é `(orgId, dedupeKey, channel)` — o `dedupeKey` é a mesma chave
 * que viajou no `/notify` e que os dois logs guardam. O `orgId` é OBRIGATÓRIO
 * no payload: os uniques dos logs são compostos e um `dedupeKey` sozinho pode
 * casar linhas de outra org — um webhook autenticado por secret global
 * escrevendo em tenant que ele não nomeou seria o mesmo defeito que o
 * `/admin/status` do Max acabou de corrigir na direção oposta.
 *
 * O desfecho vai em `detail.maxDelivery` (MERGE, nunca replace — `detail` já
 * carrega motivo de skip/falha dos trilhos). O `status` da linha NÃO muda:
 * naqueles modelos ele significa "processado pelo trilho", não "entregue" —
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

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Progresso monotônico, espelhando o rank do Max: callbacks reentregues ou
 * fora de ordem não regridem (`read` não vira `delivered`), e `unconfirmed` /
 * `failed` são notícia fraca que um `delivered` atrasado corrige. O receptor
 * é idempotente por conta própria — o cliente RETENTA enquanto não carimba
 * `reported_at`, então o mesmo desfecho pode chegar duas vezes.
 */
const RANK: Record<DeliveryOutcome["status"], number> = {
  failed: 1,
  unconfirmed: 1,
  delivered: 2,
  read: 3,
};

interface MaxDeliveryDetail {
  status: string;
  at: string;
  providerMessageId?: string | null;
  receivedAt: string;
}

function shouldApply(existing: unknown, incoming: DeliveryOutcome): boolean {
  const atual = (existing as { maxDelivery?: { status?: string } } | null)
    ?.maxDelivery?.status;
  if (!atual) return true;
  const rankAtual = RANK[atual as DeliveryOutcome["status"]] ?? 0;
  return RANK[incoming.status] > rankAtual;
}

export interface ApplyResult {
  dealLogs: number;
  userDeliveries: number;
}

/**
 * Grava o desfecho nos dois trilhos. `updateMany` não faz merge de Json, então
 * é read-modify-write por linha — o volume por `dedupeKey` é 1..poucas linhas.
 * `dedupeKey` desconhecida devolve zeros e o chamador responde 200 mesmo
 * assim: para quem tem o secret, a contagem não é segredo; para o resto, a
 * rota nem autentica.
 */
export async function applyDeliveryOutcome(
  outcome: DeliveryOutcome
): Promise<ApplyResult> {
  const marca: MaxDeliveryDetail = {
    status: outcome.status,
    at: outcome.at,
    providerMessageId: outcome.providerMessageId ?? null,
    receivedAt: new Date().toISOString(),
  };
  const where = {
    orgId: outcome.orgId,
    dedupeKey: outcome.dedupeKey,
    channel: "whatsapp",
  };
  const result: ApplyResult = { dealLogs: 0, userDeliveries: 0 };

  const dealLogs = await prisma.dealNotificationLog.findMany({ where });
  for (const row of dealLogs) {
    if (!shouldApply(row.detail, outcome)) continue;
    await prisma.dealNotificationLog.update({
      where: { id: row.id },
      data: {
        detail: {
          ...((row.detail as Record<string, unknown> | null) ?? {}),
          maxDelivery: { ...marca },
        },
      },
    });
    result.dealLogs += 1;
  }

  const deliveries = await prisma.userNotificationDelivery.findMany({ where });
  for (const row of deliveries) {
    if (!shouldApply(row.detail, outcome)) continue;
    await prisma.userNotificationDelivery.update({
      where: { id: row.id },
      data: {
        detail: {
          ...((row.detail as Record<string, unknown> | null) ?? {}),
          maxDelivery: { ...marca },
        },
      },
    });
    result.userDeliveries += 1;
  }

  return result;
}
