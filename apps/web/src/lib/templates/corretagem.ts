import type { RecebimentoData } from "@/lib/forms/commissioner-receiving";

// ============================================================================
// Blocos de corretagem para templates engine="google_docs".
//
// Por que existem: até 2026-09 a cláusula de corretagem dos modelos da
// imobiliária vinha do contrato-fonte com nome, CPF, chave PIX e conta de UM
// corretor literais no texto. Todo contrato gerado a partir daquele modelo saía
// com o corretor errado — e, desde o gate de PII da ativação
// (`lib/templates/pii-gate.ts`), o modelo nem ativa, porque agência e conta são
// bloqueantes. Estas chaves são a saída: o modelo guarda o token, o contrato
// recebe o corretor DAQUELE negócio.
//
// Puro: sem Prisma e sem rede — `buildLocacaoPlaceholderMap` também é.
//
// ATENÇÃO ao que chega aqui: `contract-generation.ts` roda
// `stripCommissionerReceiving` no dataJson ANTES do enrich, de propósito, para
// que dado bancário de terceiro não fique em `Contract.dataJson` (que alimenta
// o LLM de revisão, o ClickSign e o DIMOB). Logo, no caminho do mapa o
// `recebimento` NÃO existe e `corretagemDadosPagamento` devolve "" — o valor de
// verdade é injetado pelo call site, que resolve o repasse a partir do cadastro
// de corretores e sobrescreve só a chave, sem reintroduzir o dado no dataJson.
// ============================================================================

/** Uma linha de comissionado como o formulário grava (locação e venda). */
export interface CorretorParaBloco {
  nome?: unknown;
  razao_social?: unknown;
  tipo_pessoa?: unknown;
  cpf?: unknown;
  cnpj?: unknown;
  creci?: unknown;
  splitRecipientId?: unknown;
  recebimento?: RecebimentoData | null;
}

/**
 * Uma linha do cadastro de corretores (`SplitRecipient`) já traduzida para o
 * vocabulário do formulário por `recebimentoFromRecipient`. O call site lê;
 * este módulo só casa e escreve texto.
 */
export interface RegistroCorretor {
  id: string;
  cpfCnpj?: string | null;
  recebimento: RecebimentoData;
}

const PIX_TIPO_LABEL: Record<string, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  EMAIL: "e-mail",
  PHONE: "telefone",
  EVP: "aleatória",
};

const TIPO_CONTA_LABEL: Record<string, string> = {
  corrente: "corrente",
  poupanca: "poupança",
};

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/**
 * Máscara de CPF/CNPJ. Cópia local deliberada: o único formatador exportado do
 * repo mora em `lib/clicksign/envelopes.ts`, e puxar um módulo de assinatura
 * para dentro do caminho de render acoplaria as duas coisas por 8 linhas.
 * Documento de tamanho inesperado sai como veio — mascarar por engano seria
 * pior que não mascarar.
 */
function formatDoc(raw: unknown): string {
  const d = txt(raw).replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return txt(raw);
}

/**
 * Os corretores do negócio. Locação grava em `comissao.angariadores`; venda, em
 * `comissao.comissionados`. Aceita as duas porque um contrato de locação
 * IMPORTADO passa pelo extrator de CCV, que fala o vocabulário de venda.
 */
export function corretoresDe(data: Record<string, unknown>): CorretorParaBloco[] {
  const comissao = (data?.comissao ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(comissao.angariadores)
    ? comissao.angariadores
    : Array.isArray(comissao.comissionados)
      ? comissao.comissionados
      : [];
  return lista.filter((c): c is CorretorParaBloco => !!c && typeof c === "object");
}

/** Nome de exibição conforme PF/PJ, com fallback pro campo que estiver preenchido. */
function nomeDe(c: CorretorParaBloco): string {
  const pj = txt(c.tipo_pessoa) === "juridica";
  return (pj ? txt(c.razao_social) || txt(c.nome) : txt(c.nome) || txt(c.razao_social)).trim();
}

/**
 * Identificação do(s) corretor(es): nome, documento e CRECI. Sem dado bancário
 * — quem imprime repasse é `corretagemDadosPagamento`, e a imobiliária que não
 * quiser conta no contrato usa só esta chave.
 */
export function corretagemQualificacao(data: Record<string, unknown>): string {
  const linhas = corretoresDe(data)
    .map((c) => {
      const nome = nomeDe(c);
      if (!nome) return "";
      const pj = txt(c.tipo_pessoa) === "juridica";
      const doc = formatDoc(pj ? c.cnpj || c.cpf : c.cpf || c.cnpj);
      const creci = txt(c.creci);
      const partes = [nome];
      if (doc) partes.push(`inscrit${pj ? "a" : "o(a)"} no ${pj ? "CNPJ" : "CPF"}/MF sob nº ${doc}`);
      if (creci) partes.push(`CRECI nº ${creci}`);
      return partes.join(", ");
    })
    .filter(Boolean);
  return linhas.join("; ");
}

/** Uma via de repasse em prosa. "" quando o dado não serve para pagar. */
function viaDeRepasse(r: RecebimentoData | null | undefined): string {
  if (!r) return "";
  const chave = txt(r.pix_chave);
  const titularNome = txt(r.titular_nome);
  const titularDoc = formatDoc(r.titular_doc);
  const titular = titularNome
    ? `, de titularidade de ${titularNome}${titularDoc ? ` (${titularDoc})` : ""}`
    : "";
  if (chave) {
    const tipo = PIX_TIPO_LABEL[txt(r.pix_tipo_chave)] ?? "";
    return `na chave PIX${tipo ? ` (${tipo})` : ""}: ${chave}${titular}`;
  }
  // Conta só entra COMPLETA: "no Banco Itaú, Conta nº 123" manda a comissão
  // para lugar nenhum e ainda parece preenchido. Mesmo critério de
  // `temContaCompleta`, replicado aqui porque este módulo é de texto, não de
  // pagabilidade — se um dia divergirem, é o texto que deve ser conservador.
  const banco = txt(r.banco);
  const agencia = txt(r.agencia);
  const conta = txt(r.conta);
  const tipoConta = TIPO_CONTA_LABEL[txt(r.tipo_conta)] ?? "";
  if (!banco || !agencia || !conta || !tipoConta) return "";
  return `no Banco ${banco}, Agência ${agencia}, Conta ${tipoConta} nº ${conta}${titular}`;
}

/**
 * O repasse deste corretor, preferindo o que o formulário trouxe e caindo no
 * cadastro da imobiliária quando o formulário não trouxe nada de útil.
 *
 * A ordem importa: o formulário é o que aquele negócio combinou; o cadastro é o
 * padrão do corretor. Casar por `splitRecipientId` antes do documento porque o
 * id é escolha explícita de quem preencheu — documento é inferência, e dois
 * cadastros podem compartilhá-lo (PF e a PJ dela).
 */
function repasseDe(c: CorretorParaBloco, registro: RegistroCorretor[]): string {
  const doForm = viaDeRepasse(c.recebimento);
  if (doForm) return doForm;
  if (registro.length === 0) return "";
  const id = txt(c.splitRecipientId);
  const porId = id ? registro.find((r) => r.id === id) : undefined;
  if (porId) return viaDeRepasse(porId.recebimento);
  const doc = txt(c.cpf || c.cnpj).replace(/\D/g, "");
  if (doc.length < 11) return "";
  const porDoc = registro.find((r) => txt(r.cpfCnpj).replace(/\D/g, "") === doc);
  return porDoc ? viaDeRepasse(porDoc.recebimento) : "";
}

/**
 * Dados de repasse da comissão. Uma linha por corretor; o nome só prefixa
 * quando há mais de um (com um só, a qualificação logo acima já o nomeou).
 * Devolve "" quando ninguém tem dado de recebimento — o parágrafo do modelo
 * fica vazio em vez de sair com uma frase pela metade.
 *
 * `registro` é opcional porque o caminho puro do mapa não tem banco: sem ele a
 * função devolve "" e o call site sobrescreve com a versão completa.
 */
export function corretagemDadosPagamento(
  data: Record<string, unknown>,
  registro: RegistroCorretor[] = []
): string {
  const corretores = corretoresDe(data);
  const linhas = corretores
    .map((c) => ({ nome: nomeDe(c), via: repasseDe(c, registro) }))
    .filter((x) => x.via);
  if (linhas.length === 0) return "";
  if (linhas.length === 1) return linhas[0]!.via;
  return linhas.map((x) => (x.nome ? `${x.nome}: ${x.via}` : x.via)).join("\n");
}
