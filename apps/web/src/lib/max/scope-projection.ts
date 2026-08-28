/**
 * Projeção por tipo de sujeito — regra 5 da governança do Max (`CLAUDE.md`):
 * "Toda leitura tem projeção declarada por tipo de sujeito. O que o corretor
 * comissionado (`SplitRecipient`, sem RBAC) recebe é decidido NO SERVIDOR — o
 * que o modelo nunca recebe, ele não pode vazar."
 *
 * ── Por que esta camada existe, e por que ela é no servidor ────────────────
 *
 * O corretor comissionado é o caso que obriga. Ele **não tem `User`**, logo não
 * tem `EffectivePermissions`, logo **não passa por `dealScopeWhere`**. Para ele,
 * `brokerDefault` + `byRecipient` da `MaxCapabilityPolicy` é o ÚNICO freio — e
 * `byRecipient.allow` SOMA ao default, sendo a única porta de alargamento do
 * sistema, aplicada justamente a quem não tem segunda trava. A projeção é o que
 * cerca isso.
 *
 * Cercar no prompt não serve: instrução é sugestão, e um modelo que recebeu o
 * endereço pode repeti-lo por engano, por injeção ou por paráfrase. Aqui o dado
 * não chega.
 *
 * ── A decisão de desenho que sustenta o teste ──────────────────────────────
 *
 * **A projeção CONSTRÓI o objeto de saída campo a campo; ela nunca APAGA campos
 * de um objeto pronto.** A diferença decide o comportamento no dia em que
 * alguém acrescentar uma coluna:
 *
 * - Apagando ("tire `cliente` e `valor`"), o campo novo **passa** — fail-open,
 *   em silêncio, e o vazamento estreia junto com a feature que o criou.
 * - Construindo ("devolva `id`, `etapa`, …"), o campo novo **não aparece** até
 *   alguém escrevê-lo aqui — fail-closed, e o pior caso é um dado faltando.
 *
 * É pelo mesmo motivo que o teste afirma a **AUSÊNCIA** dos campos proibidos e
 * não a presença dos permitidos: um teste de presença continua verde quando o
 * campo novo vaza.
 */

/** O sujeito da leitura. O corretor comissionado não é `User`. */
export type SubjectKind = "user" | "broker";

/**
 * Os campos que o `broker` NUNCA recebe, nomeados para o teste iterar.
 *
 * Esta lista é documentação executável, não implementação: a projeção não a
 * consulta (ela constrói). Se algum dia alguém trocar a construção por deleção,
 * é este vetor que segura — por isso ele mora aqui, e não dentro do teste.
 *
 * `titulo` entra porque **carrega endereço** ("Apto Rua X, 123"). É o campo que
 * mais parece inofensivo e mais vaza.
 */
export const CAMPOS_PROIBIDOS_AO_BROKER = [
  "titulo",
  "cliente",
  "valor",
  "clientName",
  "title",
  "value",
  "email",
  "telefone",
  "phone",
  "cpf",
  "cpfCnpj",
  "dataJson",
] as const;

export interface DealParaProjecao {
  id: string;
  title: string;
  clientName: string | null;
  value: number | null;
  updatedAt: Date;
  stage: { name: string } | null;
  pendencias: string[];
}

/**
 * ⚠️ A ordem dos campos aqui espelha a ordem em que `projetarDeal` os MONTA, e
 * não é decorativa: o teste de paridade compara o corpo HTTP byte a byte, e o
 * corpo preserva ordem de chave. Declarar numa ordem e montar noutra convida o
 * próximo leitor a "alinhar" o builder à interface e quebrar o vetor sem
 * entender por quê.
 */
export interface DealProjetadoUser {
  id: string;
  etapa: string | null;
  pendencias: string[];
  atualizadoEm: string;
  titulo: string;
  cliente: string | null;
  valor: number | null;
}

/** Mesma regra de ordem do `DealProjetadoUser` acima. */
export interface DealProjetadoBroker {
  id: string;
  etapa: string | null;
  pendencias: string[];
  atualizadoEm: string;
  referencia: string;
}

export type DealProjetado = DealProjetadoUser | DealProjetadoBroker;

/**
 * `referencia` existe porque o corretor precisa de um jeito de dizer DE QUAL
 * negócio ele fala sem que a plataforma lhe entregue o endereço.
 *
 * Derivada do `id` (cuid) e não de um contador: um número sequencial por org
 * revelaria o VOLUME da imobiliária a quem não é da casa, e exigiria coluna
 * nova só para isto. O sufixo é estável entre chamadas — é o mesmo `id` —, que
 * é a propriedade de que a conversa precisa.
 */
export function referenciaDoNegocio(id: string): string {
  return `Negócio #${id.slice(-6).toUpperCase()}`;
}

export function projetarDeal(
  deal: DealParaProjecao,
  kind: SubjectKind
): DealProjetado {
  const comum = {
    id: deal.id,
    etapa: deal.stage?.name ?? null,
    pendencias: deal.pendencias,
    atualizadoEm: deal.updatedAt.toISOString(),
  };

  if (kind === "broker") {
    // Construção explícita: o corretor recebe ESTES campos, e nada mais entra
    // aqui por acidente quando o model crescer.
    return { ...comum, referencia: referenciaDoNegocio(deal.id) };
  }

  return {
    ...comum,
    titulo: deal.title,
    cliente: deal.clientName,
    valor: deal.value,
  };
}

export interface PropostaParaProjecao {
  id: string;
  code: string | null;
  title: string;
  status: string;
  updatedAt: Date;
}

export interface PropostaProjetadaUser {
  id: string;
  titulo: string;
  codigo: string | null;
  estado: string;
  atualizadoEm: string;
}

export interface PropostaProjetadaBroker {
  id: string;
  referencia: string;
  estado: string;
  atualizadoEm: string;
}

export type PropostaProjetada =
  | PropostaProjetadaUser
  | PropostaProjetadaBroker;

export function projetarProposta(
  p: PropostaParaProjecao,
  kind: SubjectKind
): PropostaProjetada {
  const comum = {
    id: p.id,
    estado: p.status,
    atualizadoEm: p.updatedAt.toISOString(),
  };

  if (kind === "broker") {
    // `code` é rótulo humano da proposta e NÃO carrega endereço, mas o corretor
    // recebe a mesma `referencia` derivada do id para não depender de um campo
    // que a imobiliária preenche à mão e pode conter qualquer coisa.
    return { ...comum, referencia: referenciaDoNegocio(p.id) };
  }

  return { ...comum, titulo: p.title, codigo: p.code };
}
