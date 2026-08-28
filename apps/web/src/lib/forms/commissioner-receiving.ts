/**
 * Dados de recebimento do corretor: o shape, o critério de "preenchido" e o
 * gate opcional da etapa Comissão (`OrgFormSettings.requireCommissionerReceiving`).
 *
 * Onde o dado vive: no `SplitRecipient` (cadastro reutilizável da imobiliária)
 * **e** no `dataJson` do formulário, sob `recebimento`, no mesmo shape que as
 * PARTES de venda já usam. Ficar nos dois é pedido de produto — o corretor
 * reabre o formulário e encontra o que preencheu.
 *
 * O que isso obriga: `recebimento` é PII bancária dentro de um `dataJson` que o
 * GET público devolve a qualquer portador do link. A redação por leitor mora em
 * `lib/forms/redact-datajson.ts` e é aplicada em TODA superfície de leitura; o
 * resumo (tela, PDF, e-mail e o texto que vai ao LLM de revisão) nunca o inclui,
 * e o `form-summary-coverage.test.ts` registra a omissão com motivo.
 *
 * Puro: sem DB e sem rede — roda no wizard (client) e no finalize (server).
 */

import { z } from "zod";

/**
 * Sub-objeto `recebimento` no `dataJson`, compartilhado pelas duas esteiras
 * (`comissao.comissionados[]` em venda, `comissao.angariadores[]` em locação).
 *
 * Mesmos nomes de campo que o `recebimento` das PARTES de venda
 * (`validation.ts`) — havia precedente de shape, e inventar um segundo faria o
 * resumo e o OCR precisarem conhecer dois vocabulários para a mesma coisa. É um
 * objeto Zod PRÓPRIO, e não o das partes reaproveitado, porque aquele dá
 * `.default("")` às strings: herdá-lo faria toda linha de comissionado nascer
 * com um `recebimento` de campos vazios no dataJson, indistinguível de um
 * preenchimento de verdade.
 *
 * Tudo opcional: a exigência é da ORG (`requireCommissionerReceiving`), não do
 * schema. O schema recusando bloquearia até quem não liga a exigência.
 */
export const comissionadoRecebimentoSchema = z.object({
  pix_chave: z.string().max(200).optional(),
  pix_tipo_chave: z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"]).optional(),
  banco: z.string().max(80).optional(),
  agencia: z.string().max(20).optional(),
  conta: z.string().max(30).optional(),
  tipo_conta: z.enum(["corrente", "poupanca"]).optional(),
  // As partes não têm titular separado (a conta é sempre delas); o corretor
  // tem, porque a comissão da PJ costuma cair na conta de um sócio.
  titular_nome: z.string().max(200).optional(),
  titular_doc: z.string().max(18).optional(),
});

/** Sub-objeto `recebimento` de um comissionado/angariador no `dataJson`. */
export interface RecebimentoData {
  pix_chave?: string | null;
  pix_tipo_chave?: string | null;
  banco?: string | null;
  agencia?: string | null;
  conta?: string | null;
  tipo_conta?: string | null;
  titular_nome?: string | null;
  titular_doc?: string | null;
}

/** Colunas do `SplitRecipient` que compõem o `recebimento`. */
export const RECEBIMENTO_SELECT = {
  pixAddressKey: true,
  pixKeyType: true,
  bankName: true,
  bankBranch: true,
  bankAccount: true,
  bankAccountType: true,
  bankHolderName: true,
  bankHolderDoc: true,
} as const;

type RecipientColumns = {
  [K in keyof typeof RECEBIMENTO_SELECT]?: string | null;
};

/** Cadastro → shape do formulário. Só para leitor que é membro da org. */
export function recebimentoFromRecipient(r: RecipientColumns): RecebimentoData {
  return {
    pix_chave: r.pixAddressKey ?? null,
    pix_tipo_chave: r.pixKeyType ?? null,
    banco: r.bankName ?? null,
    agencia: r.bankBranch ?? null,
    conta: r.bankAccount ?? null,
    tipo_conta: r.bankAccountType ?? null,
    titular_nome: r.bankHolderName ?? null,
    titular_doc: r.bankHolderDoc ?? null,
  };
}

const nonEmpty = (v: unknown): boolean =>
  typeof v === "string" && v.trim().length > 0;

/** Conta bancária serve para TED se os quatro campos estiverem lá. */
export function temContaCompleta(r: RecebimentoData | undefined | null): boolean {
  if (!r) return false;
  return (
    nonEmpty(r.banco) &&
    nonEmpty(r.agencia) &&
    nonEmpty(r.conta) &&
    nonEmpty(r.tipo_conta)
  );
}

/**
 * O critério da exigência: **chave PIX OU conta completa**.
 *
 * Antes era só chave PIX, herdado de `SplitRecipient.pendingFields` — que é o
 * critério de PAGABILIDADE da esteira de repasse, não de "a imobiliária tem
 * como pagar este corretor". Quem digitava banco, agência e conta ficava
 * travado tendo informado tudo o que a exigência pede.
 *
 * `pendingFields` continua como está, de propósito: conta bancária é TED manual
 * e `composeSplits`/`splitDispatcher` só conhecem wallet e PIX. Os dois
 * conceitos passam a ser distintos em vez de um posar pelo outro.
 */
export function temRecebimento(r: RecebimentoData | undefined | null): boolean {
  if (!r) return false;
  return nonEmpty(r.pix_chave) || temContaCompleta(r);
}

/**
 * "Este cadastro tem como receber?" — para os rótulos que a UI mostra sobre um
 * CADASTRO (o selo do combobox, a linha do diálogo de duplicidade).
 *
 * NÃO é `receivingPending`. Aquele booleano deriva de
 * `SplitRecipient.pendingFields`, que é PAGABILIDADE da esteira de repasse: um
 * cadastro com banco, agência e conta completos, mas sem chave PIX, continua
 * "pendente" ali de propósito — conta bancária é TED manual. Usá-lo como rótulo
 * fazia a tela dizer "sem dados bancários" para um corretor cuja conta acabara
 * de ser preenchida. Achado no smoke de staging em 28/08.
 *
 * Quando o leitor é membro da org, o servidor manda o `recebimento` e a
 * resposta é exata. Para anônimo, que não recebe esses campos, sobra o
 * booleano — que ali é o melhor sinal disponível.
 */
export function cadastroSemDadosBancarios(o: {
  recebimento?: RecebimentoData | null;
  receivingPending?: boolean;
}): boolean {
  if (o.recebimento) return !temRecebimento(o.recebimento);
  return o.receivingPending === true;
}

export interface ComissionadoRecebimento {
  nome?: string;
  splitRecipientId?: string;
  recebimentoPendente?: boolean;
  recebimento?: RecebimentoData | null;
}

export interface RecebimentoPendencia {
  /** Índice na lista de comissionados/angariadores. */
  index: number;
  nome: string;
  /** `sem_dados`: nem PIX nem conta completa, e o cadastro também não supre. */
  motivo: "sem_dados";
}

/**
 * A linha satisfaz a exigência?
 *
 * Duas fontes, nesta ordem:
 *  1. o `recebimento` do próprio formulário — o caminho novo, e o único que o
 *     usuário consegue preencher na tela;
 *  2. o CADASTRO vinculado, quando ele já era pagável (`splitRecipientId` com
 *     `recebimentoPendente` diferente de `true`).
 *
 * A fonte 2 existe pelos formulários EM CIRCULAÇÃO: até 08/2026 os dados
 * bancários viviam só no `SplitRecipient` e o `dataJson` guardava apenas o
 * booleano. Sem ela, todo formulário aberto antes desta mudança passaria a
 * acusar pendência num dado que de fato existe — travando negócio em andamento
 * por causa do formato novo. `recebimentoPendente` ausente também conta como
 * suprido: a flag só passou a ser gravada em 2026-08.
 */
function linhaSatisfeita(c: ComissionadoRecebimento | undefined): boolean {
  if (temRecebimento(c?.recebimento)) return true;
  return !!c?.splitRecipientId && c.recebimentoPendente !== true;
}

/**
 * Linhas que ainda não satisfazem a exigência.
 *
 * `enabled` combina a flag da org com `viewerIsMember`: o formulário público é
 * ANÔNIMO e o cliente não vê nem pode enviar esses campos (o servidor os
 * redige na leitura e os rejeita na escrita). Bloqueá-lo seria um beco sem
 * saída — daí a exigência valer só para quem preenche pela imobiliária.
 *
 * "Não clicou em salvar" deixou de ser pendência: a criação do cadastro virou
 * automática, então esse estado não existe mais. O que se cobra é o DADO — que
 * é o que a imobiliária precisa para pagar — venha ele do formulário ou de um
 * cadastro que já era pagável (ver `linhaSatisfeita`).
 */
export function pendenciasDeRecebimento(
  comissionados: readonly ComissionadoRecebimento[] | undefined,
  enabled: boolean
): RecebimentoPendencia[] {
  if (!enabled || !comissionados?.length) return [];
  const out: RecebimentoPendencia[] = [];
  comissionados.forEach((c, index) => {
    const nome = (c?.nome ?? "").trim();
    // Linha ainda em branco não é pendência de recebimento — é linha vazia, e
    // quem cuida disso é a validação de nome do próprio schema.
    if (!nome) return;
    if (!linhaSatisfeita(c)) {
      out.push({ index, nome, motivo: "sem_dados" });
    }
  });
  return out;
}

/** Mensagem única para o toast das duas esteiras. */
export function mensagemDePendencia(
  pendencias: readonly RecebimentoPendencia[]
): string {
  if (pendencias.length === 0) return "";
  const nomes = pendencias.map((p) => p.nome).join(", ");
  return `Informe a chave PIX ou os dados da conta bancária (banco, agência, conta e tipo) de: ${nomes}.`;
}
