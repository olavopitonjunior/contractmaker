/**
 * A PRÓPRIA imobiliária como intermediadora da locação — as duas chaves
 * compostas que a cláusula de corretagem usa para nomeá-la e para dizer onde
 * ela recebe a comissão do 1º aluguel:
 *
 *   {{imobiliaria_qualificacao}}    — razão social, CNPJ, CRECI e sede
 *   {{imobiliaria_dados_pagamento}} — chave PIX ou banco/agência/conta
 *
 * Irmãs de `corretagem_qualificacao` / `corretagem_dados_pagamento`
 * (`./corretagem`), com o mesmo contrato:
 *
 * - A qualificação sai do `dataJson` enriquecido (`config.imobiliaria_*`, que
 *   o `enrichLocacaoData` injeta a partir do perfil da org SEM depender de
 *   `aluguel.adm_imobiliaria` — a intermediação existe mesmo quando a org não
 *   administra o imóvel). Sem razão social, "".
 * - A via de recebimento NÃO passa pelo dataJson: o call site da geração lê o
 *   padrão da org (`contractDefaultsJson.locacao_recebimento`) e escreve só no
 *   Doc do contrato. O mapa puro emite a chave vazia. É o mesmo desenho do
 *   repasse do corretor — a conta de alguém nunca vira dado do negócio.
 *
 * Uma assimetria que vale saber: na INGESTÃO, o estágio determinístico
 * (`reverse-merge`) monta o gabarito com `enrichLocacaoData` SEM o perfil da
 * org, então `config.imobiliaria_*` nunca existe ali e a via de recebimento é
 * sempre "" — o reverse-merge não troca a conta literal da imobiliária pelo
 * token (troca a do corretor, porque essa vem do formulário do negócio). Quem
 * chaveia o item da imobiliária no envio de modelos é o passe de IA, guiado
 * pela descrição no catálogo. Fonte de dado diferente, caminho diferente.
 *
 * Por que existe: na reingestão da RE/MAX Trio (02/09/2026), 12 dos 16
 * modelos ficaram barrados pelo gate de PII só pela conta da imobiliária,
 * literal no item a) da cláusula 4.2, porque não havia chave para ela.
 */
import type { RecebimentoData } from "@/lib/forms/commissioner-receiving";
import { formatDoc, txt, viaDeRepasse } from "./corretagem";

/**
 * "Imobiliária Exemplo Ltda., inscrita no CNPJ sob nº 12.345.678/0001-90,
 * CRECI nº 12345-J, com sede na Rua das Flores, nº 100". Cada pedaço só entra
 * se existir; sem razão social a chave fica vazia (o modelo não deve sair com
 * ", inscrita no CNPJ…" pendurado em ninguém).
 */
export function imobiliariaQualificacao(data: Record<string, unknown>): string {
  const config = (data?.config ?? {}) as Record<string, unknown>;
  const nome = txt(config.imobiliaria_nome);
  if (!nome) return "";
  const partes = [nome];
  const cnpj = formatDoc(config.imobiliaria_cnpj);
  if (cnpj) partes.push(`inscrita no CNPJ sob nº ${cnpj}`);
  const creci = txt(config.imobiliaria_creci);
  if (creci) partes.push(`CRECI nº ${creci}`);
  const endereco = txt(config.imobiliaria_endereco);
  if (endereco) partes.push(`com sede na ${endereco}`);
  return partes.join(", ");
}

/**
 * Onde a imobiliária recebe — a mesma prosa do corretor ("na chave PIX (CNPJ):
 * …" ou "no Banco X, Agência Y, Conta corrente nº Z"). "" quando o padrão da
 * org está vazio ou a conta está incompleta.
 */
export function imobiliariaDadosPagamento(
  recebimento: RecebimentoData | null | undefined
): string {
  return viaDeRepasse(recebimento);
}
