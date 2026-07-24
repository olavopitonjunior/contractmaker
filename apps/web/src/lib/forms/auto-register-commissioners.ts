/**
 * Auto-cadastro de corretores no finalize do form (vendas e locação).
 * Para cada `comissao.comissionados[]` do dataJson sem `splitRecipientId`,
 * faz match-ou-cria no registry (SplitRecipient kind="commissioner") e
 * backfilla o `splitRecipientId` no dataJson do form — assim o wizard de
 * cobrança e o resolvedor de notificações enxergam a linha verde sem
 * re-matching heurístico.
 *
 * Fire-and-forget (caller usa waitUntil): nunca lança. No-op quando o form
 * não tem comissionados (ex.: locação sem seção de comissão).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import {
  upsertCommissionerFromFormData,
  type CommissionerInput,
} from "@/lib/asaas/commissioner-registry";

export async function autoRegisterFormCommissioners(params: {
  formId: string;
  orgId: string;
}): Promise<void> {
  const { formId, orgId } = params;
  try {
    const form = await prisma.salesForm.findUnique({
      where: { id: formId },
      select: { id: true, orgId: true, dataJson: true },
    });
    if (!form || form.orgId !== orgId) return;

    const data = (form.dataJson as Record<string, unknown> | null) ?? {};
    const comissao = data.comissao as Record<string, unknown> | undefined;
    const comissionados = Array.isArray(comissao?.comissionados)
      ? (comissao!.comissionados as Array<Record<string, unknown>>)
      : [];
    if (comissionados.length === 0) return;

    let changed = false;
    for (const c of comissionados) {
      if (typeof c !== "object" || c === null) continue;
      if (typeof c.splitRecipientId === "string" && c.splitRecipientId) continue;

      const input: CommissionerInput = {
        nome: typeof c.nome === "string" ? c.nome : null,
        cpf: typeof c.cpf === "string" ? c.cpf : null,
        cnpj: typeof c.cnpj === "string" ? c.cnpj : null,
        tipo_pessoa:
          c.tipo_pessoa === "fisica" || c.tipo_pessoa === "juridica"
            ? c.tipo_pessoa
            : null,
        email: typeof c.email === "string" ? c.email : null,
        mobile_phone: typeof c.mobile_phone === "string" ? c.mobile_phone : null,
        creci: typeof c.creci === "string" ? c.creci : null,
        papel: typeof c.papel === "string" ? c.papel : null,
      };

      const result = await upsertCommissionerFromFormData(orgId, input).catch(
        (err) => {
          console.error(
            `[auto-register-commissioners] upsert falhou (form ${formId}):`,
            err
          );
          return null;
        }
      );
      if (!result) continue;

      c.splitRecipientId = result.id;
      changed = true;

      if (!result.existed) {
        audit(
          { orgId, userId: null, ipAddress: null, userAgent: null },
          {
            action: "SPLIT_RECIPIENT_CREATED",
            result: "SUCCESS",
            resourceType: "split_recipient",
            resource: `split_recipient:${result.id}`,
            metadata: {
              source: "form_finalize_auto",
              formId,
              label: input.nome ?? null,
              kind: "commissioner",
            },
          }
        );
      }
    }

    if (changed) {
      // Form está finalizado (fechado pra escrita pública) — corrida com
      // autosave é negligível; update direto do blob já mutado in-place.
      await prisma.salesForm.update({
        where: { id: formId },
        data: { dataJson: data as Prisma.InputJsonValue },
      });
    }
  } catch (err) {
    console.error(
      `[auto-register-commissioners] falha geral (form ${formId}):`,
      err
    );
  }
}
