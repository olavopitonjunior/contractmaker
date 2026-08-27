/**
 * O que ESTE documento pode entregar para ESTE destino do formulário.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 *
 * Medido em 188 anexos de produção: **43,9% de tudo que o OCR lê é descartado**
 * (693 de 1.579 campos com valor). Em documentos de categoria `outro` — as
 * fichas que já trazem os dados prontos — a perda chega a 93%.
 *
 * A causa não é leitura ruim, é tradução. O OCR fala um vocabulário e o
 * formulário fala outro, e entre os dois existe um dicionário manual de 14
 * entradas (`FIELD_MAP_PERSON`). O que não está nele some, mesmo estando certo:
 *
 *     o modelo devolveu     o formulário chama    resultado
 *     telefone              mobile_phone          descartado
 *     titular_cpf           cpf                   descartado
 *     cnpj_numero           cnpj                  descartado
 *     endereco_completo     endereco              descartado
 *
 * Em formato livre o modelo ESCOLHE o nome da chave, então a lista de sinônimos
 * nunca fecha. A saída é inverter: dizer ao modelo quais são os nomes. Se o
 * pedido já vai em `mobile_phone`, não há tradução — logo não há perda nela.
 *
 * ── Por que INTERSEÇÃO, e não a lista inteira do destino ──────────────────
 *
 * Um Vendedor tem 20 campos no formulário; um RG não tem profissão, e-mail nem
 * renda. Mandar a lista inteira é pedir que o modelo ache o que não existe — e
 * isso já foi medido aqui: com schema grande demais, a leitura de CNH caiu de
 * **11 campos para 3** e a acurácia de 78,6% para 53,3% (ver o comentário em
 * `lib/ai/ocr.ts` sobre o superset).
 *
 * Então: campos que o destino precisa ∩ campos que este tipo de documento tem.
 */

import { resolveBasePath, type Assignment } from "./extracted-to-form";
import { describeFormPath } from "./field-labels";

/**
 * Campos do FORMULÁRIO que cada tipo de documento pode conter.
 *
 * Esta tabela é **curada, não derivada** — de propósito. Só quem conhece o
 * documento sabe que um RG traz filiação mas não traz profissão, e que uma
 * matrícula descreve o imóvel mas não tem CEP. Nenhuma estatística substitui
 * isso: `sexo` falta em 50 de 53 CNHs e `cep` em 16 de 17 matrículas — mesma
 * frequência, casos opostos (a CNH TEM sexo impresso; a matrícula NÃO tem CEP).
 *
 * Endereço aparece com os dois nomes (`endereco` para pessoa, `rua` para
 * imóvel) porque a interseção com o destino escolhe o certo sozinha.
 */
const CAMPOS_FORM_POR_CATEGORIA: Record<string, readonly string[]> = {
  rg: [
    "nome", "rg", "cpf", "data_nascimento", "nome_mae", "sexo",
    "nacionalidade", "estado_civil",
  ],
  cpf: ["nome", "cpf", "data_nascimento"],
  cnh: [
    "nome", "cpf", "rg", "data_nascimento", "nome_mae", "sexo", "nacionalidade",
  ],
  certidao_casamento: ["nome", "cpf", "estado_civil"],
  procuracao: ["nome", "cpf", "rg"],
  comprovante_residencia: [
    "nome", "endereco", "rua", "numero", "complemento", "bairro", "cidade",
    "uf", "cep",
  ],
  matricula: [
    "matricula", "cartorio", "rua", "endereco", "numero", "complemento",
    "bairro", "cidade", "uf", "descricao", "nome",
  ],
  iptu: [
    "inscricao_iptu", "inscricao_municipal", "sql", "rua", "endereco",
    "numero", "complemento", "bairro", "cidade", "uf", "cep",
  ],
  escritura: ["nome", "cpf", "matricula", "cartorio", "rua", "endereco"],
};

/**
 * `outro` e `ficha_resumo` ficam FORA de propósito.
 *
 * Os dois rendem mais em formato livre — a ficha entrega 22 campos sem schema
 * contra 7 com schema. A perda de 93% deles não se resolve restringindo o que
 * pedem, e sim traduzindo melhor o que devolvem; é outro problema.
 */
export const CATEGORIAS_SEM_GUIA = new Set(["outro", "ficha_resumo"]);

/** Campos escalares de uma parte (titular), formas PF + PJ. Espelha `presets.ts`. */
const CAMPOS_TITULAR = [
  "nome", "razao_social", "cnpj", "cpf", "rg", "data_nascimento", "nome_mae",
  "sexo", "estado_civil", "profissao", "nacionalidade", "email", "mobile_phone",
  "endereco", "numero", "complemento", "bairro", "cidade", "uf", "cep",
] as const;

/** Sub-pessoas (cônjuge, procurador, representante) aceitam menos. */
const CAMPOS_SUB = [
  "nome", "cpf", "rg", "data_nascimento", "nome_mae", "sexo", "email",
  "mobile_phone",
] as const;

const CAMPOS_IMOVEL = [
  "rua", "numero", "complemento", "bairro", "cidade", "uf", "cep",
  "matricula", "cartorio", "inscricao_iptu", "sql", "inscricao_municipal",
  "descricao",
] as const;

const SUB_KINDS = new Set([
  "conjuge_vendedor", "conjuge_comprador",
  "representante_vendedor", "representante_comprador",
  "procurador_vendedor", "procurador_comprador",
]);

/** Campos que o DESTINO aceita, sem olhar o documento. */
function camposDoDestino(kind: string): readonly string[] {
  if (kind === "imovel") return CAMPOS_IMOVEL;
  if (SUB_KINDS.has(kind)) return CAMPOS_SUB;
  if (kind === "vendedor" || kind === "comprador") return CAMPOS_TITULAR;
  return [];
}

export interface CampoEsperado {
  /** Nome do campo COMO O FORMULÁRIO o chama — é isto que vai no pedido. */
  campo: string;
  /** Rótulo humano, usado como descrição do campo no schema. */
  rotulo: string;
}

export interface CamposEsperados {
  campos: CampoEsperado[];
  /** Prefixo do path no dataJson, ex. `vendedores.0`. */
  basePath: string;
  /**
   * `false` quando não dá para guiar — sem destino, destino desconhecido, ou
   * categoria que rende mais livre. O chamador cai no caminho de sempre.
   */
  guiado: boolean;
}

const VAZIO: CamposEsperados = { campos: [], basePath: "", guiado: false };

/**
 * A interseção. Devolve os campos no vocabulário do FORMULÁRIO.
 *
 * Devolve `guiado: false` sempre que não houver base segura para guiar — nunca
 * um palpite. O chamador então usa o caminho atual (chaves de OCR +
 * `FIELD_MAP_PERSON`), que continua valendo para os 188 documentos já extraídos
 * e para quando o corretor ainda não escolheu o destino.
 */
export function expectedFieldsFor(
  assignment: Assignment | null | undefined,
  categoria: string | null | undefined
): CamposEsperados {
  if (!assignment || !categoria) return VAZIO;
  if (CATEGORIAS_SEM_GUIA.has(categoria)) return VAZIO;

  const basePath = resolveBasePath(assignment);
  if (!basePath) return VAZIO;

  const doDocumento = CAMPOS_FORM_POR_CATEGORIA[categoria];
  if (!doDocumento) return VAZIO;

  const doDestino = new Set(camposDoDestino(assignment.kind));
  if (doDestino.size === 0) return VAZIO;

  const campos: CampoEsperado[] = [];
  const vistos = new Set<string>();
  for (const campo of doDocumento) {
    if (!doDestino.has(campo) || vistos.has(campo)) continue;
    vistos.add(campo);
    campos.push({ campo, rotulo: rotuloDe(`${basePath}.${campo}`, campo) });
  }

  // Interseção vazia não é erro — um comprovante de residência mandado para um
  // procurador não tem nada a oferecer. Mas guiar com zero campos produziria um
  // schema vazio, então degrada para o caminho de sempre.
  if (campos.length === 0) return VAZIO;

  return { campos, basePath, guiado: true };
}

/** Rótulo humano do campo; cai no nome cru se o catálogo não conhecer o path. */
function rotuloDe(path: string, fallback: string): string {
  try {
    return describeFormPath(path) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Cobertura: quantos dos campos esperados vieram preenchidos.
 *
 * Este é o número que substitui o "% de confiança" da tela. A diferença é que
 * ele é DERIVADO: hoje o card mostra "100% confiança" porque perguntou ao
 * modelo se ele estava confiante, e o modelo respondeu que sim — enquanto o
 * shadow mode acusa 27% de divergência entre dois modelos nos mesmos campos.
 */
export function calcularCobertura(
  esperados: readonly CampoEsperado[],
  valores: Record<string, unknown>
): { esperados: number; preenchidos: number; faltantes: string[] } {
  const faltantes: string[] = [];
  let preenchidos = 0;
  for (const { campo } of esperados) {
    if (temValor(valores[campo])) preenchidos += 1;
    else faltantes.push(campo);
  }
  return { esperados: esperados.length, preenchidos, faltantes };
}

/** Mesmas sentinelas que `coerce` já filtra na ponte para o formulário. */
const SENTINELAS = new Set(["null", "n/a", "na", "não informado", "nao informado", "-", "--"]);

function temValor(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 && !SENTINELAS.has(t.toLowerCase());
  }
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
