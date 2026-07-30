/**
 * Auto-cadastro de corretores no finalize do form (vendas e locação).
 * Para cada `comissao.comissionados[]` (venda) ou `comissao.angariadores[]`
 * (locação) do dataJson sem `splitRecipientId`, faz match-ou-cria no registry
 * (SplitRecipient kind="commissioner") e backfilla o `splitRecipientId` no
 * dataJson do form — assim o wizard de cobrança e o resolvedor de notificações
 * enxergam a linha verde sem re-matching heurístico.
 *
 * As duas listas passam pelo MESMO helper (e pelo mesmo update de dataJson) de
 * propósito: dois writers no mesmo blob correriam entre si. O angariador de
 * locação não tem `papel` próprio no form — entra no registry como `captador`,
 * que é exatamente o que ele é (quem angariou o imóvel).
 *
 * Fire-and-forget (caller usa waitUntil): nunca lança. No-op quando o form não
 * tem nenhuma das duas listas.
 */

import { prisma } from "@/lib/db/prisma";
import { mergeSalesFormDataJson } from "@/lib/forms/atomic-merge";
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
    const asList = (v: unknown): Array<Record<string, unknown>> =>
      Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
    // Venda (`comissionados`) e locação (`angariadores`) na mesma varredura —
    // um form só tem uma das duas.
    const entries: Array<{
      row: Record<string, unknown>;
      defaultPapel: string | null;
    }> = [
      ...asList(comissao?.comissionados).map((row) => ({
        row,
        defaultPapel: null,
      })),
      ...asList(comissao?.angariadores).map((row) => ({
        row,
        defaultPapel: "captador",
      })),
    ];
    if (entries.length === 0) return;

    let changed = false;
    for (const { row: c, defaultPapel } of entries) {
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
        papel: typeof c.papel === "string" ? c.papel : defaultPapel,
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
        // await de propósito: este helper roda dentro de waitUntil e o audit
        // não está encadeado na promise — sem await, teardown pode cortá-lo.
        await audit(
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
      // Merge atômico escopado em `comissao` em vez de regravar o blob inteiro:
      // no finalize o form já está fechado pra escrita pública, mas o operador
      // também dispara este helper ao editar a comissão do deal de locação —
      // aí um autosave concorrente ainda existe, e regravar `data` (lido antes
      // dos upserts) apagaria o que ele gravou nas outras chaves.
      await mergeSalesFormDataJson({
        where: { id: formId },
        incoming: { comissao: data.comissao },
        allowedTopKeys: ["comissao"],
      });
    }
  } catch (err) {
    console.error(
      `[auto-register-commissioners] falha geral (form ${formId}):`,
      err
    );
  }
}
