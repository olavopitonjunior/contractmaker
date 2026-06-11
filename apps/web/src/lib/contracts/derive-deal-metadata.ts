/**
 * Deriva título e valor do Deal a partir do `dataJson` extraído do contrato.
 * Compartilhado entre o fluxo Handlebars (`contract-generation.ts`) e o fluxo
 * de import por upload (`contract-import.ts`) — ambos precisam atualizar o
 * Deal com nome legível e valor pra que o card no Kanban faça sentido.
 *
 * Prioridade do título:
 *   1. `formTitle` (passado pelo caller — ex: título personalizado do form)
 *   2. "VendedorNome → CompradorNome" (par de nomes)
 *   3. "Venda para {comprador}"
 *   4. "Imóvel: {rua}, {numero}"
 *   5. fallback fornecido pelo caller (`fallbackTitle`)
 */
export interface DerivedDealMetadata {
  title: string;
  value: number | null;
}

export function deriveDealMetadata(
  dataJson: Record<string, unknown>,
  options: {
    formTitle?: string | null;
    fallbackTitle: string;
  }
): DerivedDealMetadata {
  const compradorNome = (dataJson.compradores as Array<{ nome?: string; razao_social?: string }>)?.[0];
  const vendedorNome = (dataJson.vendedores as Array<{ nome?: string; razao_social?: string }>)?.[0];
  const imovel = (dataJson.imoveis as Array<{ rua?: string; numero?: string; cidade?: string }>)?.[0];
  const pagamento = dataJson.pagamento as { valor_total?: number } | undefined;
  const valorTotal = Number(pagamento?.valor_total || 0);

  const compradorLabel = compradorNome?.nome ?? compradorNome?.razao_social;
  const vendedorLabel = vendedorNome?.nome ?? vendedorNome?.razao_social;

  const formTitle = options.formTitle?.trim();
  const title =
    formTitle ||
    (compradorLabel && vendedorLabel
      ? `${vendedorLabel} → ${compradorLabel}`
      : compradorLabel
      ? `Venda para ${compradorLabel}`
      : imovel?.rua
      ? `Imóvel: ${imovel.rua}${imovel.numero ? `, ${imovel.numero}` : ""}`
      : options.fallbackTitle);

  return {
    title,
    value: valorTotal > 0 ? valorTotal : null,
  };
}

/**
 * Variante de LOCAÇÃO — o dataJson tem outro shape (`locadores`/`locatarios`,
 * `imovel` objeto singular, valor em `aluguel.valor`). Helper separado em vez
 * de sniffing de shape: os call-sites sempre sabem o kind do deal, e um
 * dataJson vazio `{}` tornaria a detecção ambígua.
 *
 * Prioridade do título:
 *   1. `formTitle`
 *   2. "LocadorNome → LocatarioNome"
 *   3. "Locação para {locatario}"
 *   4. "Imóvel: {rua}, {numero}"
 *   5. `fallbackTitle`
 */
export function deriveLocacaoDealMetadata(
  dataJson: Record<string, unknown>,
  options: {
    formTitle?: string | null;
    fallbackTitle: string;
  }
): DerivedDealMetadata {
  const locador = (dataJson.locadores as Array<{ nome?: string; razao_social?: string }>)?.[0];
  const locatario = (dataJson.locatarios as Array<{ nome?: string; razao_social?: string }>)?.[0];
  const imovel = dataJson.imovel as { rua?: string; numero?: string } | undefined;
  const aluguel = dataJson.aluguel as { valor?: number } | undefined;
  const valorAluguel = Number(aluguel?.valor || 0);

  const locadorLabel = locador?.nome ?? locador?.razao_social;
  const locatarioLabel = locatario?.nome ?? locatario?.razao_social;

  const formTitle = options.formTitle?.trim();
  const title =
    formTitle ||
    (locadorLabel && locatarioLabel
      ? `${locadorLabel} → ${locatarioLabel}`
      : locatarioLabel
      ? `Locação para ${locatarioLabel}`
      : imovel?.rua
      ? `Imóvel: ${imovel.rua}${imovel.numero ? `, ${imovel.numero}` : ""}`
      : options.fallbackTitle);

  return {
    title,
    value: valorAluguel > 0 ? valorAluguel : null,
  };
}
