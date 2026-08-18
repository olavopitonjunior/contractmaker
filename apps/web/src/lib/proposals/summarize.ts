import { formatMoneyBR } from "@/lib/format/money";

/**
 * Resumo leve do dataJson da proposta (proponente + imóvel + valor) sem expor o
 * JSON inteiro. Compartilhado entre a listagem (/pipeline/propostas) e o modo
 * `eligible` de GET /api/proposals (picker de conversão) — os dois precisam do
 * MESMO resumo, senão a mesma proposta aparece com rótulos diferentes.
 *
 * Client-safe (sem prisma), mas hoje só roda no servidor: `formatMoneyBR` é
 * determinístico (sem ICU) justamente pra sair pronto do server component.
 */
export function summarizeProposalData(dataJson: unknown): {
  proponente: string | null;
  imovel: string | null;
  valorLabel: string | null;
} {
  const d = (dataJson ?? {}) as Record<string, unknown>;
  const imoveis = d.imoveis as Array<{ endereco?: string; numero?: string }> | undefined;
  const im = imoveis?.[0];
  const imovel = im?.endereco
    ? `${im.endereco}${im.numero ? `, ${im.numero}` : ""}`
    : null;
  // Proponente = 1º comprador (venda) ou 1º locatário (locação).
  const partes = (d.compradores ?? d.locatarios) as Array<{ nome?: string }> | undefined;
  const proponente = partes?.[0]?.nome?.trim() || null;
  const pag = d.pagamento as { valor_total?: number } | undefined;
  const loc = d.locacao as { valor_aluguel?: number } | undefined;
  const valor = pag?.valor_total ?? loc?.valor_aluguel ?? null;
  return {
    proponente,
    imovel,
    valorLabel: typeof valor === "number" ? formatMoneyBR(valor, { decimals: 0 }) : null,
  };
}
