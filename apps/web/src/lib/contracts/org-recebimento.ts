import { prisma } from "@/lib/db/prisma";
import {
  RECEBIMENTO_SELECT,
  recebimentoFromRecipient,
  type RecebimentoData,
} from "@/lib/forms/commissioner-receiving";

/**
 * Onde a PRÓPRIA imobiliária recebe a comissão de intermediação (1º aluguel)
 * — `Organization.pixAddressKey`/`pixKeyType`/`bank*`, editado em
 * /settings/perfil. É o que a chave `{{imobiliaria_dados_pagamento}}` imprime
 * na cláusula de corretagem dos contratos de locação.
 *
 * Dado FIXO do cadastro, não padrão por formulário: passou por
 * `contractDefaultsJson.locacao_recebimento` no #518 e o dono corrigiu o lugar
 * (mora ao lado de CNPJ e CRECI). As colunas têm os mesmos nomes e domínios
 * de `SplitRecipient`, então o cadastro→texto é a MESMA tradução do corretor
 * (`recebimentoFromRecipient` → `viaDeRepasse`).
 *
 * NUNCA lança: sem org, sem coluna preenchida ou banco fora, devolve `null` —
 * a chave sai "" e a geração segue. A conta vai só para o Doc do contrato,
 * nunca para `Contract.dataJson` (o call site sobrescreve o mapa).
 */
export async function loadOrgRecebimento(orgId: string): Promise<RecebimentoData | null> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: RECEBIMENTO_SELECT,
    });
    return org ? recebimentoFromRecipient(org) : null;
  } catch (err) {
    console.warn("[org-recebimento] falha ao carregar recebimento da imobiliária:", err);
    return null;
  }
}
