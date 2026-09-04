import type { TargetKind } from "./types";

/**
 * Esteira do negócio para o motor de certidões. `venda` é o shape histórico
 * (`vendedores[]`, `compradores[]`, `imoveis[]`); `locacao` é o do formulário
 * de locação (`locatarios[]`, `locadores[]`, `garantia.fiador` objeto,
 * `imovel` singular).
 */
export type CertidoesEsteira = "venda" | "locacao";

export function esteiraForDealKind(kind: string | null | undefined): CertidoesEsteira {
  return kind === "locacao" ? "locacao" : "venda";
}

/**
 * Caminho no `dataJson` onde vivem os dados de um alvo. É o prefixo dos
 * `missingFields.path` dos skips ("Corrigir dados" grava neles) e do
 * `EditPartyDialog`. Módulo puro, sem dependência de planner/executor.
 *
 * Antes o fallback era `${kind}es.${index}` — servia para vendedor/comprador e
 * produzia `locatarioes.0`/`fiadores.0` para a locação (o fiador não é array:
 * vive em `garantia.fiador`).
 */
export function basePathForTarget(
  kind: TargetKind,
  index: number,
  esteira: CertidoesEsteira = "venda"
): string {
  switch (kind) {
    case "imovel":
      return esteira === "locacao" ? "imovel" : `imoveis.${index}`;
    case "diligenciado":
      return `diligenciados.${index}`;
    case "vendedor":
      return `vendedores.${index}`;
    case "comprador":
      return `compradores.${index}`;
    case "conjuge_vendedor":
      return `vendedores.${index}.conjuge`;
    case "procurador_vendedor":
      return `vendedores.${index}.procurador`;
    case "representante_vendedor":
      return `vendedores.${index}.representante`;
    case "locatario":
      return `locatarios.${index}`;
    case "locador":
      return `locadores.${index}`;
    case "fiador":
      return "garantia.fiador";
    case "conjuge_fiador":
      return "garantia.fiador.conjuge";
    case "conjuge_locatario":
      return `locatarios.${index}.conjuge`;
  }
}

/** Rótulo PT-BR do alvo (seções do dialog, grupos da aba, relatório). */
export const TARGET_KIND_LABELS: Record<TargetKind, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  imovel: "Imóvel",
  diligenciado: "Pessoa adicional",
  conjuge_vendedor: "Cônjuge do vendedor",
  procurador_vendedor: "Procurador do vendedor",
  representante_vendedor: "Representante do vendedor",
  locatario: "Locatário",
  fiador: "Fiador",
  conjuge_fiador: "Cônjuge do fiador",
  locador: "Locador",
  conjuge_locatario: "Cônjuge do locatário",
};
