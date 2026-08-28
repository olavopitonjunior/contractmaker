import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildConsolidatedFormSummary,
  ENUM_LABELS,
} from "@/lib/forms/form-summary";
import { GARANTIA_LABELS } from "@/lib/contracts/template-category";
import { TIPO_IMOVEL_TEXTO } from "@/lib/locacao/enrich";
import { dadosContratoSchema } from "@/lib/forms/validation";
import {
  dadosLocacaoSchema,
  dadosLocacaoComercialSchema,
} from "@/lib/forms/validation-locacao";

/**
 * Teste-GUARDA de cobertura do resumo consolidado.
 *
 * O resumo (aba Dados do negócio + PDF + e-mail) é montado por listas manuais
 * de `pushIf(rows, "Label", campo)`. Toda vez que o formulário ganhou um campo,
 * a lista ficou para trás em silêncio — foi assim que os encargos detalhados, a
 * administração, as contas de consumo e a etapa inteira de posse sumiram do
 * resumo sem ninguém perceber, até a corretora reclamar.
 *
 * Aqui o schema Zod é percorrido, cada campo folha recebe um SENTINELA único e
 * o teste exige que ele apareça em alguma linha do resumo. Campo novo no
 * schema, sem linha no resumo e sem entrada na allowlist = teste vermelho.
 *
 * Como um formulário não exercita todos os ramos ao mesmo tempo (PF **ou** PJ,
 * fiança **ou** caução, PIX **ou** conta bancária), o resumo é montado em
 * VARIANTES e a cobertura é a UNIÃO delas.
 */

type Leaf = {
  path: string;
  kind: "string" | "number" | "boolean" | "enum";
  values?: string[];
};

/** Desembrulha os wrappers do Zod até o tipo efetivo. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s = schema;
  for (let i = 0; i < 20; i++) {
    const def = s._def as {
      typeName?: string;
      innerType?: z.ZodTypeAny;
      schema?: z.ZodTypeAny;
    };
    if (
      def.typeName === "ZodOptional" ||
      def.typeName === "ZodNullable" ||
      def.typeName === "ZodDefault"
    ) {
      s = def.innerType as z.ZodTypeAny;
    } else if (def.typeName === "ZodEffects") {
      s = def.schema as z.ZodTypeAny;
    } else {
      return s;
    }
  }
  return s;
}

/** Enumera os campos folha do schema, com o path pontilhado (índice sempre 0). */
function leaves(schema: z.ZodTypeAny, prefix = "", depth = 0): Leaf[] {
  if (depth > 8) return [];
  const s = unwrap(schema);
  const def = s._def as {
    typeName?: string;
    shape?: () => Record<string, z.ZodTypeAny>;
    type?: z.ZodTypeAny;
    options?: z.ZodTypeAny[] | Map<string, z.ZodTypeAny>;
    values?: string[];
  };

  switch (def.typeName) {
    case "ZodObject": {
      const shape = def.shape!();
      return Object.entries(shape).flatMap(([k, v]) =>
        leaves(v, prefix ? prefix + "." + k : k, depth + 1)
      );
    }
    case "ZodArray":
      return leaves(def.type!, prefix + ".0", depth + 1);
    case "ZodDiscriminatedUnion":
    case "ZodUnion": {
      const opts =
        def.options instanceof Map ? [...def.options.values()] : def.options ?? [];
      return opts.flatMap((o) => leaves(o, prefix, depth + 1));
    }
    case "ZodEnum":
      return [{ path: prefix, kind: "enum", values: def.values ?? [] }];
    case "ZodNumber":
      return [{ path: prefix, kind: "number" }];
    case "ZodBoolean":
      return [{ path: prefix, kind: "boolean" }];
    default:
      return [{ path: prefix, kind: "string" }];
  }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let node: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (node[key] === undefined) node[key] = nextIsIndex ? [] : {};
    node = node[key] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

/**
 * Sentinela textual SEM DÍGITOS. Com dígitos, um sentinela em `cnpj` fazia
 * `onlyDigits(cnpj)` virar verdadeiro e o resumo escolher o ramo errado — o
 * teste acusaria falta de cobertura onde o código está certo.
 */
function sentinelaTexto(i: number): string {
  let n = i;
  let out = "";
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  return "sentinela" + out.toUpperCase();
}

/**
 * Um campo é coberto quando o sentinela aparece em alguma linha — cru ou numa
 * das formatações que o resumo aplica (moeda, data BR, rótulo de enum).
 */
function representations(leaf: Leaf, value: unknown): string[] {
  if (leaf.kind === "number") {
    const n = value as number;
    return [
      String(n),
      n.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
      n.toLocaleString("pt-BR"),
    ];
  }
  if (leaf.kind === "boolean") return ["Sim", "Não"];
  if (leaf.kind === "enum") {
    const raw = String(value);
    const deEnumLabels = Object.values(ENUM_LABELS)
      .map((m) => m[raw])
      .filter(Boolean) as string[];
    const tipoImovel = TIPO_IMOVEL_TEXTO[raw];
    return [
      raw,
      raw.replace(/_/g, " "),
      ...deEnumLabels,
      (GARANTIA_LABELS as Record<string, string>)[raw] ?? "",
      tipoImovel ?? "",
      tipoImovel ? tipoImovel.charAt(0).toUpperCase() + tipoImovel.slice(1) : "",
      // modalidade (venda) — rótulo em negotiation-summary
      raw === "a_vista" ? "À vista" : "",
      raw === "financiamento" ? "Financiamento" : "",
    ].filter(Boolean);
  }
  const raw = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) return [raw, m[3] + "/" + m[2] + "/" + m[1]];
  // CPF/CNPJ/CEP saem mascarados.
  const d = raw.replace(/\D/g, "");
  const mascaras: string[] = [];
  if (d.length === 11) {
    mascaras.push(
      d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9)
    );
  }
  if (d.length === 14) {
    mascaras.push(
      d.slice(0, 2) +
        "." +
        d.slice(2, 5) +
        "." +
        d.slice(5, 8) +
        "/" +
        d.slice(8, 12) +
        "-" +
        d.slice(12)
    );
  }
  if (d.length === 8) mascaras.push(d.slice(0, 5) + "-" + d.slice(5));
  return [raw, ...mascaras];
}

/**
 * Campos deliberadamente FORA do resumo. Cada linha carrega o motivo — é o que
 * separa "decidimos não mostrar" de "esquecemos de mostrar". A chave pode ser o
 * path completo ou só o nome do campo (quando ele se repete em várias partes).
 */
const OMITIDOS_COM_MOTIVO: Record<string, string> = {
  // --- Identificadores internos: não dizem nada a quem lê o resumo ---
  propertyId: "id interno da Property",
  matricula_attachment_id: "id do anexo; o resumo mostra o filename",
  matricula_attachment_filename: "entra dentro da linha 'Matrícula atualizada'",
  matricula_situacao: "renderizado como 'Matrícula atualizada'",
  party_id: "id interno",
  splitRecipientId: "vínculo interno com o registry de corretores",
  recebimentoPendente:
    "estado do cadastro de recebimento (gate da etapa Comissão), não dado do negócio",
  vistoria_ref: "id da vistoria — exibido, mas só quando preenchido pelo operador",

  // --- Discriminadores e flags de fluxo, não dados do negócio ---
  tipo_pessoa: "discriminador do schema; o resumo mostra PF/PJ pelos campos",
  corretora_tipo_pessoa: "legado de retrocompat; comissionados[] é o canônico",
  incluir_como_signatario: "decisão de envelope, não dado do formulário",
  tem_procurador: "flag; a seção do procurador aparece quando ele existe",
  endereco_igual_ao_titular: "flag; controla se o endereço próprio é exibido",
  forma_taxa_locacao: "escolhe entre % e valor fixo; o resumo imprime o escolhido",
  forma_comissao: "idem, por angariador",

  // --- Booleanos que só ABREM uma linha; o conteúdo dela é que é exibido ---
  tem_debitos: "flag; os débitos aparecem na linha 'Débitos'",
  selecionado: "flag do item de débito; o valor aparece na linha 'Débitos'",
  assume: "flag; a linha 'Débitos assumidos' traz a descrição",
  tem: "flag; a linha 'Regularizações' traz a descrição",
  permite: "flag; vira o texto 'Permitida'/'Não permitida'",

  // --- Cobertos por equivalência: existe um par *_texto que tem precedência ---
  "comissao.quem_paga": "exibido via quem_paga_texto",
  "comissao.quando_paga": "exibido via quando_paga_texto",
  "entrega_posse.momento": "exibido via momento_texto",
  "pagamento.parcelas.0.tipo": "exibido via tipo_texto",
  "aluguel.taxa_admin_percent": "fiscal.taxa_admin_percent tem precedência e é exibido",
  "vicios.opcao": "a linha 'Vícios' traz a descrição quando existe",
  "vicios.descricao_desocultados": "alternativa a descricao_reparar na mesma linha",
  "pagamento.parcelas.0.permuta_descricao":
    "alternativa a tipo_outros_texto na mesma linha",

  // --- Dado exigido só pelo pedido de certidão (TJSP), não pelo contrato ---
  sexo: "usado pelo pedido de certidão; não é dado contratual",

  // --- Sub-campos agregados numa linha só ---
  pix_tipo_chave: "entra dentro da linha 'Recebimento'",
  tipo_chave: "entra dentro da linha da parcela",
  titular_cpf_cnpj: "entra dentro da linha da parcela",
};

function omitido(path: string): boolean {
  if (OMITIDOS_COM_MOTIVO[path]) return true;
  const last = path.split(".").pop() as string;
  return Boolean(OMITIDOS_COM_MOTIVO[last]);
}

/**
 * Variante = um recorte do formulário que exercita um ramo. Overrides são
 * aplicados POR NOME DE CAMPO (último segmento do path), depois dos sentinelas.
 */
type Variante = {
  nome: string;
  tipoPessoa: "fisica" | "juridica";
  overrides: Record<string, unknown>;
};

/**
 * Overrides de documento valem só para a parte RAIZ. Cônjuge, procurador e
 * representante têm CPF próprio — zerá-los junto com o da parte esconderia
 * linhas que o resumo emite de verdade.
 */
const SO_NA_PARTE_RAIZ = new Set(["cpf", "cnpj"]);
const SUB_PESSOAS = [".conjuge.", ".representante.", ".procurador."];

function valorDoCampo(
  path: string,
  variante: Variante,
  sentinelas: Map<string, unknown>
): unknown {
  const nome = path.split(".").pop() as string;
  const temOverride = Object.prototype.hasOwnProperty.call(variante.overrides, nome);
  const ehSubPessoa = SUB_PESSOAS.some((sub) => path.includes(sub));
  if (temOverride && !(SO_NA_PARTE_RAIZ.has(nome) && ehSubPessoa)) {
    return variante.overrides[nome];
  }
  return sentinelas.get(path);
}

const VARIANTES: Variante[] = [
  {
    nome: "PF · fiança · PIX · cônjuge com endereço próprio",
    tipoPessoa: "fisica",
    overrides: {
      // O endereço próprio do cônjuge só é exibido quando ele declara NÃO morar
      // com o titular — com o default `true`, os 7 campos ficam sem exercício.
      endereco_igual_ao_titular: false,
      cnpj: "",
    },
  },
  {
    nome: "PJ · caução · conta bancária · encargos no condomínio",
    tipoPessoa: "juridica",
    overrides: {
      // Ramos alternativos que a variante A não alcança.
      tipo: "caucao",
      endereco_igual_ao_titular: false,
      contas_consumo_individualizadas: false,
      repasse_garantido: "alguns_meses",
      forma_taxa_locacao: "valor_fixo",
      forma_comissao: "valor_fixo",
      // Parcela sem PIX cai no bloco de dados bancários.
      chave: "",
      // O resumo escolhe PJ×PF por `onlyDigits(cnpj)` — um sentinela textual
      // cairia sempre no ramo do CPF.
      cnpj: "12345678000199",
      cpf: "",
    },
  },
];

function textoDoResumo(
  schema: z.ZodTypeAny,
  schemaType: string,
  variante: Variante,
  porPath: Map<string, Leaf>,
  sentinelas: Map<string, unknown>
): string {
  const data: Record<string, unknown> = {};
  for (const path of porPath.keys()) {
    setPath(data, path, valorDoCampo(path, variante, sentinelas));
  }
  for (const lista of ["vendedores", "compradores", "locadores", "locatarios"]) {
    const arr = data[lista] as Record<string, unknown>[] | undefined;
    if (arr && arr[0]) arr[0].tipo_pessoa = variante.tipoPessoa;
  }
  const garantia = data.garantia as Record<string, unknown> | undefined;
  if (garantia && garantia.fiador) {
    (garantia.fiador as Record<string, unknown>).tipo_pessoa = variante.tipoPessoa;
    // A seção do fiador só é montada quando a garantia é fiança.
    if (variante.tipoPessoa === "juridica") garantia.tipo = "caucao";
    else garantia.tipo = "fiador";
  }
  return buildConsolidatedFormSummary(data, { schemaType })
    .flatMap((s) => s.rows.map((r) => r.label + " " + r.value))
    .join("\n");
}

function camposFaltando(schema: z.ZodTypeAny, schemaType: string): string[] {
  // O dataJson montado precisa ser COMPLETO — inclusive com os campos que não
  // são verificados, porque vários deles (forma_taxa_locacao, tipo da garantia)
  // são justamente os que decidem QUAL ramo o resumo exibe.
  const todos = leaves(schema).filter((l) => l.path);
  // Dedupe: a união PF/PJ produz o mesmo path por dois caminhos.
  const porPath = new Map<string, Leaf>();
  for (const l of todos) if (!porPath.has(l.path)) porPath.set(l.path, l);
  const verificaveis = [...porPath.keys()].filter((path) => !omitido(path));

  const sentinelas = new Map<string, unknown>();
  let i = 0;
  for (const [path, leaf] of porPath) {
    i += 1;
    sentinelas.set(
      path,
      leaf.kind === "number"
        ? 1000 + i
        : leaf.kind === "boolean"
          ? true
          : leaf.kind === "enum"
            ? leaf.values?.[0] ?? ""
            : sentinelaTexto(i)
    );
  }

  const textos = VARIANTES.map((v) =>
    textoDoResumo(schema, schemaType, v, porPath, sentinelas)
  );

  const faltando: string[] = [];
  for (const path of verificaveis) {
    const leaf = porPath.get(path) as Leaf;
    const coberto = VARIANTES.some((v, idx) => {
      const valor = valorDoCampo(path, v, sentinelas);
      if (valor === "" || valor === undefined) return false;
      return representations(leaf, valor).some(
        (r) => r && textos[idx].includes(r)
      );
    });
    if (!coberto) faltando.push(path);
  }
  return faltando;
}

describe("cobertura do resumo consolidado", () => {
  it("locação residencial: todo campo do schema aparece no resumo", () => {
    expect(camposFaltando(dadosLocacaoSchema, "locacao_residencial_v1")).toEqual([]);
  });

  it("locação comercial: todo campo do schema aparece no resumo", () => {
    expect(
      camposFaltando(dadosLocacaoComercialSchema, "locacao_comercial_v1")
    ).toEqual([]);
  });

  it("venda: todo campo do schema aparece no resumo", () => {
    expect(camposFaltando(dadosContratoSchema, "compra_venda_v1")).toEqual([]);
  });
});
