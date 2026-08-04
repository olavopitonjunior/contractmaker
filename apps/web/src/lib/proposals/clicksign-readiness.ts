import { isFullName, isValidCPF } from "@/lib/forms/field-formats";
import { onlyDigits } from "@/lib/validators/cpf";
import { suggestEmailDomain } from "@/lib/forms/email-typo";

/**
 * Preflight ClickSign — valida os campos obrigatórios de um signatário ANTES de
 * qualquer chamada à API. Sem isto, o 422 estoura no meio do envio, com o
 * envelope já criado (e o executor deleta o draft remoto = trabalho perdido).
 *
 * Chamado em três pontos: na tela (badge por linha), no POST /send (guard antes
 * de tocar a ClickSign) e no executor de ActionIntent (Max não passa pela UI).
 *
 * Devolve uma LISTA estruturada — nunca uma string — pra UI apontar o campo.
 */

export interface ProposalSignerInput {
  name: string;
  email?: string | null;
  cpf?: string | null;
  phone?: string | null;
  notifyChannel?: string; // email | whatsapp | sms
}

export interface ReadinessIssue {
  /** `-1` = pendência do DOCUMENTO, não de um signatário (ver `checkProposalContent`). */
  signerIndex: number;
  field: "name" | "email" | "cpf" | "phone" | "documento";
  reason: string;
  /** Sugestão de correção (ex.: domínio de e-mail provável). */
  hint?: string;
}

/** Índice sentinela das pendências que não pertencem a nenhum signatário. */
export const DOC_ISSUE_INDEX = -1;

/**
 * Normaliza telefone BR para E.164 (+55DDDNUMERO).
 *
 * NÃO usar `onlyDigits` cru pra mandar à ClickSign: ela precisa do DDI, e
 * `onlyDigits("+55 11 98765-4321")` devolve "5511987654321" sem o "+", enquanto
 * um número digitado sem DDI ("11987654321") ficaria sem o 55. Aqui unificamos:
 * 10/11 dígitos → assume BR e prefixa +55; 12/13 começando com 55 → +55...;
 * qualquer outra coisa → null (inválido).
 */
export function toE164BR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = onlyDigits(raw);
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return `+${d}`;
  return null;
}

export function checkSignerReadiness(
  signer: ProposalSignerInput,
  index: number
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const channel = signer.notifyChannel ?? "email";

  // Nome: a ClickSign exige ao menos DUAS palavras. A validação da UI de
  // contrato checa `name.length < 2` (dois CARACTERES) — "Marcia" passa lá e
  // toma 422 aqui. Este é o furo que o preflight fecha.
  if (!signer.name || !isFullName(signer.name)) {
    issues.push({
      signerIndex: index,
      field: "name",
      reason: "Informe o nome completo (nome e sobrenome).",
    });
  }

  // CPF: se informado, tem que ser válido. Ausente é permitido (o signatário
  // informa na hora de assinar, com has_documentation=false).
  if (signer.cpf && signer.cpf.trim() && !isValidCPF(signer.cpf)) {
    issues.push({
      signerIndex: index,
      field: "cpf",
      reason: "CPF inválido — confira os dígitos.",
    });
  }

  // Canal WhatsApp/SMS exige telefone com DDI válido.
  if (channel === "whatsapp" || channel === "sms") {
    if (!toE164BR(signer.phone)) {
      issues.push({
        signerIndex: index,
        field: "phone",
        reason:
          "Para enviar por WhatsApp, informe um celular válido com DDD (ex.: (11) 98765-4321).",
      });
    }
  }

  // Canal e-mail exige e-mail; e todo e-mail informado é checado por typo.
  if (channel === "email" && !signer.email) {
    issues.push({
      signerIndex: index,
      field: "email",
      reason: "Informe o e-mail (ou troque o canal para WhatsApp).",
    });
  }
  if (signer.email) {
    if (!signer.email.includes("@")) {
      issues.push({
        signerIndex: index,
        field: "email",
        reason: "E-mail inválido.",
      });
    } else {
      const suggestion = suggestEmailDomain(signer.email);
      if (suggestion) {
        issues.push({
          signerIndex: index,
          field: "email",
          reason: "Confira o e-mail — o domínio parece ter um erro de digitação.",
          hint: suggestion,
        });
      }
    }
  }

  return issues;
}

/** Preflight do conjunto de signatários. Retorna todas as pendências. */
export function checkProposalReadiness(
  signers: ProposalSignerInput[]
): ReadinessIssue[] {
  return signers.flatMap((s, i) => checkSignerReadiness(s, i));
}

function primeiroNome(lista: unknown): string {
  if (!Array.isArray(lista)) return "";
  const p = lista[0];
  if (!p || typeof p !== "object") return "";
  const nome = (p as { nome?: unknown }).nome;
  return typeof nome === "string" ? nome.trim() : "";
}

function enderecoDoPrimeiroImovel(lista: unknown): string {
  if (!Array.isArray(lista)) return "";
  const im = lista[0];
  if (!im || typeof im !== "object") return "";
  const e = (im as { endereco?: unknown }).endereco;
  return typeof e === "string" ? e.trim() : "";
}

function numeroPositivo(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * O documento tem conteúdo? — preflight do CORPO, não dos signatários.
 *
 * Existe porque o template lê caminhos FIXOS (`compradores[].nome`,
 * `imoveis[].endereco`, `pagamento.valor_total`) enquanto `dataJson` é forma
 * livre no Zod. Em 2026-08-04 um agente gravou `partes.proponente.nome` e
 * `imovel.endereco.logradouro`: a API aceitou, o envio não olhou o corpo, e duas
 * propostas foram para pessoas reais como um PDF sem proponente, sem imóvel e
 * sem valor. Nada no caminho detectava — este é o detector.
 *
 * Fica no ENVIO (e não só na criação) de propósito: vale para qualquer produtor,
 * inclusive um que ainda não existe, e é o último ponto antes de gastar
 * ClickSign e falar com um terceiro.
 */
export function checkProposalContent(
  schemaType: string,
  dataJson: unknown
): ReadinessIssue[] {
  const d = (dataJson ?? {}) as Record<string, unknown>;
  const issues: ReadinessIssue[] = [];
  const add = (reason: string) =>
    issues.push({ signerIndex: DOC_ISSUE_INDEX, field: "documento", reason });

  const isVenda = schemaType === "compra_venda_v1";
  const parte = isVenda ? "compradores" : "locatarios";

  // Frases secas, uma por pendência: a remediação ("refaça com os dados
  // completos") repetida a cada item vira ruído quando as três faltam juntas —
  // e é justamente o caso comum. Quem monta a resposta ao usuário compõe.
  if (!primeiroNome(d[parte])) {
    add("O documento sairia sem o nome do proponente.");
  }
  if (!enderecoDoPrimeiroImovel(d.imoveis)) {
    add("O documento sairia sem o endereço do imóvel.");
  }

  const valorOk = isVenda
    ? numeroPositivo((d.pagamento as Record<string, unknown> | undefined)?.valor_total)
    : numeroPositivo((d.locacao as Record<string, unknown> | undefined)?.valor_aluguel);
  if (!valorOk) {
    add("O documento sairia sem o valor.");
  }

  return issues;
}
