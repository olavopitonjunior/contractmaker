/**
 * O mapa `{{chave}} → texto` que a geração de contrato de LOCAÇÃO escreve num
 * Doc-modelo.
 *
 * Por que existe: o mapa não é só `buildLocacaoPlaceholderMap`. Três chaves são
 * SOBRESCRITAS no call site da geração, porque dependem de dados que o
 * `dataJson` enriquecido não tem de propósito — o bancário do corretor é
 * retirado antes do enrich, e a via de recebimento da própria imobiliária vem
 * do cadastro da org. Enquanto esse arranjo vivia inline em
 * `contract-generation.ts`, qualquer outro consumidor do mesmo mapa (a prévia
 * com dados de exemplo, por exemplo) reproduzia uma parte e divergia na outra —
 * e uma prévia que não é o que a geração faz é pior que nenhuma prévia, porque
 * o operador decide confiando nela.
 *
 * Aqui a montagem é uma função de DADOS: quem chama busca o cadastro de
 * corretores e o Perfil da org (a geração, do banco; a prévia, de fixtures) e
 * passa. Nada de I/O neste módulo.
 */
import type { RecebimentoData } from "@/lib/forms/commissioner-receiving";
import { buildLocacaoPlaceholderMap } from "./placeholder-map";
import { corretagemDadosPagamento, corretoresDe, viaDeRepasse, type RegistroCorretor } from "./corretagem";
import { imobiliariaDadosPagamento } from "./imobiliaria";
import { rateioPrimeiroAluguel } from "./rateio";

export interface LocacaoGoogleDocsMapInput {
  /** `dataJson` JÁ enriquecido (`enrichLocacaoData`). */
  enriched: Record<string, unknown>;
  /**
   * `dataJson` CRU, com o dado bancário. Só as chaves de repasse o usam, e o
   * resultado vai para o Doc do contrato — nunca de volta para o `dataJson`.
   */
  rawDataJson: Record<string, unknown>;
  /** Slots de cláusula já resolvidos (`{{slot_garantia}}` → texto do acervo). */
  slotValues?: Record<string, string>;
  /** Cadastro de corretores da org (`SplitRecipient`), para achar a via de cada um. */
  registro?: RegistroCorretor[];
  /** Onde a PRÓPRIA imobiliária recebe a comissão (Perfil da org). */
  orgRecebimento?: RecebimentoData | null;
  /** Identidade do contrato. Na prévia, valores de exemplo. */
  contrato?: { numero?: string; id?: string; versao?: string };
}

export function buildLocacaoGoogleDocsMap(
  input: LocacaoGoogleDocsMapInput
): Record<string, string> {
  const { enriched, rawDataJson, slotValues, registro = [], orgRecebimento = null, contrato } = input;

  const map = buildLocacaoPlaceholderMap(enriched);

  // Slots resolvidos pelo chamador — `{{slot_garantia}}` no Doc do modelo vira a
  // cláusula do acervo (ou o fallback canônico). Doc sem o token não casa nada
  // no replaceAllText, então isto é inócuo pros modelos antigos.
  if (slotValues) Object.assign(map, slotValues);

  // Repasse da corretagem: a única chave que o mapa não produz sozinho, porque
  // o dado bancário foi retirado do dataJson antes do enrich, de propósito.
  // Resolve aqui (formulário primeiro, cadastro depois) e escreve no Doc do
  // CONTRATO — o modelo guarda o token; a conta de alguém, nunca.
  map.corretagem_dados_pagamento =
    corretoresDe(rawDataJson).length > 0
      ? corretagemDadosPagamento(rawDataJson, registro)
      : "";

  // Idem para a PRÓPRIA imobiliária: a via de recebimento da comissão vem do
  // cadastro da org. Sem cadastro, a chave sai vazia.
  map.imobiliaria_dados_pagamento = imobiliariaDadosPagamento(orgRecebimento);

  // Rateio do 1º aluguel: a lista nomeia beneficiário E via de pagamento, então
  // ela só fica completa aqui, onde as duas fontes de repasse existem.
  map.rateio_primeiro_aluguel = rateioPrimeiroAluguel(rawDataJson, {
    imobiliariaVia: viaDeRepasse(orgRecebimento),
    registro,
  });

  if (contrato?.numero !== undefined) map.contrato_numero = contrato.numero;
  if (contrato?.id !== undefined) map.contrato_id = contrato.id;
  if (contrato?.versao !== undefined) map.contrato_versao = contrato.versao;

  return map;
}
