import { prisma } from "@/lib/db/prisma";
import { computeDedupeKey } from "./signer-dedupe";
import { toE164BR } from "./clicksign-readiness";

/**
 * Materializa as testemunhas padrão do cadastro (scope "proposta", isDefault)
 * como linhas `ProposalSigner` da proposta, ANTES do envio. É o equivalente
 * headless do picker dos contratos: propostas não têm UI de seleção de
 * testemunhas (o envio costuma ser automático — Newton/WhatsApp), então a
 * "padronização" da imobiliária entra por aqui.
 *
 * Idempotente: usa `createMany({ skipDuplicates })` contra o
 * `@@unique([proposalId, dedupeKey])`, então re-enviar (retry) ou já ter a
 * mesma pessoa como proponente/vendedor NÃO duplica. Só materializa quando a
 * org marcou testemunhas como padrão pra propostas — sem isso, no-op (proposta
 * segue sem testemunhas, retrocompat).
 *
 * Testemunha sem e-mail é ignorada (o canal default é e-mail; sem e-mail o
 * preflight bloquearia o envio inteiro).
 */
export async function ensureProposalDefaultWitnesses(
  proposalId: string
): Promise<number> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { orgId: true },
  });
  if (!proposal) return 0;

  const defaults = await prisma.defaultWitness.findMany({
    where: { orgId: proposal.orgId, isDefault: true, scope: "proposta" },
  });
  if (defaults.length === 0) return 0;

  const rows = defaults
    .filter((w) => w.email && w.email.includes("@"))
    .map((w) => {
      const cpf = w.cpf ? w.cpf.replace(/\D/g, "") || null : null;
      const phone = toE164BR(w.mobilePhone);
      return {
        proposalId,
        role: "testemunha",
        name: w.nome,
        email: w.email,
        cpf,
        phone,
        // Testemunhas assinam junto com os proprietários (grupo 2), após o
        // proponente (grupo 1).
        signingGroup: 2,
        notifyChannel: "email",
        dedupeKey: computeDedupeKey({
          name: w.nome,
          email: w.email,
          cpf,
          phone,
        }),
      };
    });
  if (rows.length === 0) return 0;

  const res = await prisma.proposalSigner.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return res.count;
}
