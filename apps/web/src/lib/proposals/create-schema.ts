import { z } from "zod";

/**
 * Contrato de entrada do `POST /api/proposals`.
 *
 * Vive aqui — e não inline na rota — porque é a FONTE DA VERDADE de dois
 * consumidores que não se enxergam: a rota Next e a tool MCP `create_proposal`
 * (apps/mcp-server), consumida pelo Newton no WhatsApp. Em 2026-08-04 os dois
 * divergiram em silêncio (a tool declarava signatários como
 * `{name,email,phone?,documentation?}`, sem `role`, que aqui é obrigatório) e
 * TODA criação de proposta pelo agente voltava 400. Com o schema exportado, o
 * teste de paridade em `__tests__/mcp-tool-parity.test.ts` compara os dois e a
 * divergência passa a quebrar o build em vez de quebrar o usuário.
 */

export const SCHEMA_TYPES = [
  "compra_venda_v1",
  "locacao_residencial_v1",
  "locacao_comercial_v1",
] as const;

export type ProposalSchemaType = (typeof SCHEMA_TYPES)[number];

export const SIGNER_ROLES = [
  "proponente",
  "vendedor",
  "conjuge",
  "testemunha",
] as const;

export const NOTIFY_CHANNELS = ["email", "whatsapp", "sms"] as const;

export function kindForSchema(schemaType: string): "venda" | "locacao" {
  return schemaType === "compra_venda_v1" ? "venda" : "locacao";
}

export const signerSchema = z.object({
  role: z.enum(SIGNER_ROLES),
  name: z.string().min(1),
  email: z.string().optional().nullable(),
  cpf: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  notifyChannel: z.enum(NOTIFY_CHANNELS).optional(),
  signingGroup: z.number().int().optional(),
});

export const createSchema = z.object({
  title: z.string().min(1),
  schemaType: z.enum(SCHEMA_TYPES),
  dataJson: z.record(z.unknown()).default({}),
  propertyId: z.string().optional(),
  leaseClientId: z.string().optional(),
  tenantId: z.string().optional(),
  validUntil: z.string().datetime().optional(),
  comissaoIncluida: z.boolean().optional(),
  hiddenPaths: z.array(z.string()).optional(),
  signers: z.array(signerSchema).optional(),
  // Responsável comercial já na criação (admin cria e atribui num passo só).
  // Mutuamente exclusivos, como no PATCH /assignee: usuário da org OU nome
  // livre de corretor externo. Exigem PROPOSAL_ASSIGN — a rota valida.
  responsibleUserId: z.string().min(1).optional(),
  responsibleName: z.string().min(2).max(120).optional(),
  // Recriação: id da proposta que este rascunho substitui. A rota valida a org
  // do pai, herda round+1 e grava supersededById + eventos de thread no pai.
  parentProposalId: z.string().min(1).optional(),
});

/**
 * Validade padrão quando o criador não informa prazo.
 *
 * Existir um padrão é requisito de correção, não conveniência: proposta com
 * `validUntil = null` não expira em lugar NENHUM — o `where` do cron de expire
 * não casa (`null < now` é NULL no Postgres), a landing `/p/[token]` nunca
 * mostra o banner de vencida, a ClickSign não recebe `deadline_at`, e o guard
 * de caducidade do CC art. 431 em `acceptance-webhook.ts` é pulado inteiro
 * (aceite de qualquer data passa a vincular). O caminho do agente, que omite o
 * campo, produzia exatamente isso.
 */
export const DEFAULT_PROPOSAL_VALIDITY_DAYS = 7;

/** Offset fixo de Brasília. O Brasil aboliu o horário de verão — sem DST. */
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Fim do N-ésimo dia em horário de Brasília, como instante absoluto.
 *
 * Ancorado em UTC-3 explícito de propósito. O padrão `new Date(y, m-1, d, 12)`
 * espalhado pelo repo usa o fuso DO PROCESSO, que na Vercel é UTC — lá "meio-dia
 * local" é 09:00 em Brasília, e o prazo venceria no meio da manhã do último dia.
 * Aqui a proposta vale até 23:59:59.999 BRT do 7º dia, que é o que um corretor
 * entende por "vale por uma semana".
 */
export function defaultValidUntil(
  from: Date = new Date(),
  days: number = DEFAULT_PROPOSAL_VALIDITY_DAYS
): Date {
  // Desloca pra "hora de parede" de Brasília, avança os dias no calendário
  // local de lá, fixa o fim do dia, e volta pro instante absoluto.
  const brtWallClock = new Date(from.getTime() - BRT_OFFSET_MS);
  const endOfDayBrtAsUtc = Date.UTC(
    brtWallClock.getUTCFullYear(),
    brtWallClock.getUTCMonth(),
    brtWallClock.getUTCDate() + days,
    23,
    59,
    59,
    999
  );
  return new Date(endOfDayBrtAsUtc + BRT_OFFSET_MS);
}
