import { formatMoneyBR } from "@/lib/format/money";
import { GARANTIA_LABELS, type GarantiaTipo } from "@/lib/contracts/template-category";

/**
 * Resumo leve do dataJson da proposta (proponente + imóvel + valor) sem expor o
 * JSON inteiro. Compartilhado entre a listagem (/pipeline/propostas) e o modo
 * `eligible` de GET /api/proposals (picker de conversão) — os dois precisam do
 * MESMO resumo, senão a mesma proposta aparece com rótulos diferentes.
 *
 * Client-safe (sem prisma), mas hoje só roda no servidor: `formatMoneyBR` é
 * determinístico (sem ICU) justamente pra sair pronto do server component.
 */
export function summarizeProposalData(
  dataJson: unknown,
  kind?: string
): {
  proponente: string | null;
  imovel: string | null;
  valorLabel: string | null;
  negocio: string | null;
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
  const loc = d.locacao as
    | { valor_aluguel?: number; prazo_meses?: number; garantia?: string }
    | undefined;
  const valor = pag?.valor_total ?? loc?.valor_aluguel ?? null;

  // Chip de negócio por tipo (só com `kind`): venda = modalidade; locação =
  // garantia + prazo. O aluguel já é a coluna Valor.
  let negocio: string | null = null;
  if (kind === "venda") {
    const modalidade = d.modalidade;
    negocio =
      modalidade === "financiamento"
        ? "Financiamento"
        : modalidade === "a_vista"
          ? "À vista"
          : null;
  } else if (kind === "locacao") {
    const garantiaObj = d.garantia as { tipo?: string } | undefined;
    const garantiaLabel =
      loc?.garantia ??
      (garantiaObj?.tipo
        ? GARANTIA_LABELS[garantiaObj.tipo as GarantiaTipo] ?? garantiaObj.tipo
        : null);
    const prazo =
      typeof loc?.prazo_meses === "number" && loc.prazo_meses > 0
        ? `${loc.prazo_meses}m`
        : null;
    negocio = [garantiaLabel, prazo].filter(Boolean).join(" · ") || null;
  }

  return {
    proponente,
    imovel,
    valorLabel: typeof valor === "number" ? formatMoneyBR(valor, { decimals: 0 }) : null,
    negocio,
  };
}
