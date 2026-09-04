/**
 * Auto-cadastro dos corretores parceiros da PROPOSTA no registry
 * (SplitRecipient kind="commissioner") — espelho de
 * `lib/forms/auto-register-commissioners.ts`, que faz o mesmo no finalize do
 * formulário.
 *
 * Para cada linha de `corretores_parceiros[]` sem `splitRecipientId`, faz
 * match-ou-cria e backfilla o id no `dataJson` da proposta. É o que dá ao
 * parceiro um cadastro com preferências de notificação (`notifyByEmail`,
 * opt-out) ANTES do primeiro e-mail sair — e o que faz `resolveDealBrokers`
 * casá-lo por id (e não por nome) depois da conversão.
 *
 * O backfill escreve SÓ a chave `corretores_parceiros` via `jsonb_set`, não o
 * blob inteiro: entre a leitura e a escrita o corretor pode ter editado outra
 * parte da proposta (PATCH), e regravar `dataJson` lido antes apagaria isso.
 *
 * Fire-and-forget (caller usa waitUntil): nunca lança. No-op sem lista.
 */

import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import {
  upsertCommissionerFromFormData,
  type CommissionerInput,
} from "@/lib/asaas/commissioner-registry";
import { PARTNER_BROKERS_KEY, PARTNER_BROKER_DEFAULT_PAPEL } from "./partner-brokers";

export async function autoRegisterProposalCommissioners(params: {
  proposalId: string;
  orgId: string;
}): Promise<void> {
  const { proposalId, orgId } = params;
  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, orgId: true, dataJson: true },
    });
    if (!proposal || proposal.orgId !== orgId) return;

    const data = (proposal.dataJson as Record<string, unknown> | null) ?? {};
    const raw = data[PARTNER_BROKERS_KEY];
    const rows = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) return;

    let changed = false;
    for (const c of rows) {
      if (typeof c !== "object" || c === null) continue;
      if (typeof c.splitRecipientId === "string" && c.splitRecipientId) continue;

      const input: CommissionerInput = {
        nome: typeof c.nome === "string" ? c.nome : null,
        cpf: typeof c.cpf === "string" ? c.cpf : null,
        cnpj: typeof c.cnpj === "string" ? c.cnpj : null,
        tipo_pessoa:
          c.tipo_pessoa === "fisica" || c.tipo_pessoa === "juridica" ? c.tipo_pessoa : null,
        email: typeof c.email === "string" ? c.email : null,
        mobile_phone: typeof c.mobile_phone === "string" ? c.mobile_phone : null,
        creci: typeof c.creci === "string" ? c.creci : null,
        papel: typeof c.papel === "string" ? c.papel : PARTNER_BROKER_DEFAULT_PAPEL,
      };

      const result = await upsertCommissionerFromFormData(orgId, input).catch((err) => {
        console.error(
          `[auto-register-proposal-commissioners] upsert falhou (proposta ${proposalId}):`,
          err
        );
        return null;
      });
      if (!result) continue;

      c.splitRecipientId = result.id;
      changed = true;

      if (!result.existed) {
        // await de propósito: roda dentro de waitUntil e o audit não está
        // encadeado na promise — sem await, o teardown pode cortá-lo.
        await audit(
          { orgId, userId: null, ipAddress: null, userAgent: null },
          {
            action: "SPLIT_RECIPIENT_CREATED",
            result: "SUCCESS",
            resourceType: "split_recipient",
            resource: `split_recipient:${result.id}`,
            metadata: {
              source: "proposal_partner_auto",
              proposalId,
              label: input.nome ?? null,
              kind: "commissioner",
            },
          }
        );
      }
    }

    if (changed) {
      // jsonb_set na chave da lista: escrita atômica e escopada. O path é um
      // literal fixo (a chave é constante do módulo) e as linhas entram como
      // parâmetro — nada de input do usuário no SQL.
      await prisma.$executeRaw`
        UPDATE "Proposal"
        SET "dataJson" = jsonb_set(
          COALESCE("dataJson", '{}'::jsonb),
          '{corretores_parceiros}',
          ${JSON.stringify(rows)}::jsonb,
          true
        )
        WHERE "id" = ${proposalId}
      `;
    }
  } catch (err) {
    console.error(
      `[auto-register-proposal-commissioners] falha geral (proposta ${proposalId}):`,
      err
    );
  }
}
