import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { TERMINAL_STATUSES } from "@/lib/proposals/status-sets";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { esteiraForDealKind } from "@/lib/certidoes/target-paths";
import {
  applyPartyFields,
  basePathForTarget,
  getAtPath,
  isPartyTargetAllowed,
  PARTY_IDENTITY_FIELDS,
  SPOUSE_TARGETS,
  validatePartyFields,
} from "@/lib/proposals/party-fields";

export const runtime = "nodejs";

const bodySchema = z.object({
  target: z.object({ kind: z.string().min(1).max(40), index: z.number().int().min(0).max(50) }),
  fields: z.record(z.unknown()),
});

/**
 * PATCH /api/proposals/[id]/partes — edita os dados de UMA parte da proposta
 * (nascimento, nome da mãe, renda e origem, endereço, `residir`…): o que a
 * análise de crédito (Ficha Certa) e as certidões precisam e o formulário da
 * proposta não pedia.
 *
 * Rota SEPARADA do PATCH /api/proposals/[id] de propósito (mesma razão do
 * `/title`): aquele para em `EDITABLE_STATUSES` porque troca o conteúdo do
 * documento; estes campos NÃO entram no documento enviado — são insumo da
 * análise, que acontece justamente depois do envio. O corte fica nos
 * TERMINAIS. `sentSnapshotHtml`/`hiddenPaths` não são tocados.
 *
 * O que NÃO pode: chave fora da allowlist (`party-fields.ts`), alvo fora da
 * esteira, e trocar identidade (`nome`/`cpf`/`cnpj`/`razao_social`) já
 * preenchida — corrigir CPF de proponente enviado é outra proposta.
 * Cônjuges (`conjuge_*`) podem nascer aqui, sob a parte-pai existente.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_CREATE) && !can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;
  if (TERMINAL_STATUSES.has(proposal.status)) {
    return NextResponse.json({ error: "Proposta encerrada não pode ser editada." }, { status: 409 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad Request", details: parsed.error.flatten() }, { status: 400 });
  }
  const esteira = esteiraForDealKind(proposal.kind);
  const { kind, index } = parsed.data.target;
  if (!isPartyTargetAllowed(kind, esteira)) {
    return NextResponse.json({ error: "Alvo inválido para esta proposta" }, { status: 400 });
  }
  const validated = validatePartyFields(parsed.data.fields);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const dataJson = (proposal.dataJson && typeof proposal.dataJson === "object" ? proposal.dataJson : {}) as Record<
    string,
    unknown
  >;
  const path = basePathForTarget(kind, index, esteira);
  const existing = getAtPath(dataJson, path);
  if (!existing || typeof existing !== "object") {
    // Cônjuge nasce sob o pai; qualquer outro alvo tem que existir.
    if (!SPOUSE_TARGETS.has(kind)) {
      return NextResponse.json({ error: "Parte não encontrada nesta proposta" }, { status: 404 });
    }
    const parentPath = path.replace(/\.conjuge$/, "");
    const parent = getAtPath(dataJson, parentPath);
    if (!parent || typeof parent !== "object") {
      return NextResponse.json({ error: "Parte não encontrada nesta proposta" }, { status: 404 });
    }
  }

  // Identidade só quando vazia.
  const current = (existing && typeof existing === "object" ? existing : {}) as Record<string, unknown>;
  const fields = { ...validated.fields };
  for (const key of Object.keys(fields)) {
    if (!PARTY_IDENTITY_FIELDS.has(key)) continue;
    const cur = typeof current[key] === "string" ? (current[key] as string).trim() : "";
    if (cur && cur !== fields[key]) {
      return NextResponse.json(
        { error: `${key} já preenchido não pode ser alterado por aqui` },
        { status: 409 }
      );
    }
  }

  const merged = applyPartyFields(dataJson, path, fields);

  // Guard atômico contra virar terminal entre o check e a escrita.
  const claimed = await prisma.proposal.updateMany({
    where: { id: proposal.id, status: { notIn: [...TERMINAL_STATUSES] } },
    data: { dataJson: merged as Prisma.InputJsonValue },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Proposta encerrada não pode ser editada." }, { status: 409 });
  }

  const keys = Object.keys(fields);
  await prisma.proposalEvent
    .create({
      data: {
        proposalId: proposal.id,
        eventName: "credit_data_updated",
        source: "system",
        payload: { target: { kind, index }, fields: keys },
      },
    })
    .catch(() => {});
  await audit(extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId), {
    action: "PROPOSAL_PARTY_DATA_UPDATE",
    result: "SUCCESS",
    resource: proposal.id,
    resourceType: "Proposal",
    metadata: { target: { kind, index }, path, fields: keys },
  }).catch(() => {});

  return NextResponse.json({ ok: true, path, party: getAtPath(merged, path) });
}
