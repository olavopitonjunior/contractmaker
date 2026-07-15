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
  signerIndex: number;
  field: "name" | "email" | "cpf" | "phone";
  reason: string;
  /** Sugestão de correção (ex.: domínio de e-mail provável). */
  hint?: string;
}

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
