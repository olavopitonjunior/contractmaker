import type { AuthMethod, SignerInput, SourceKind } from "./types";

interface Conjuge {
  nome?: string;
  cpf?: string;
  email?: string;
  telefone?: string;
  mobile_phone?: string;
  incluir_como_signatario?: boolean;
}

interface Procurador {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
  incluir_como_signatario?: boolean;
}

interface Representante {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
}

interface Parte {
  tipo_pessoa?: "fisica" | "juridica";
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  telefone?: string;
  mobile_phone?: string;
  conjuge?: Conjuge;
  procurador?: Procurador;
  representante?: Representante;
}

interface Testemunha {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
  incluir_como_signatario?: boolean;
}

interface Comissionado {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  tipo_pessoa?: "fisica" | "juridica";
  email?: string;
  mobile_phone?: string;
  incluir_como_signatario?: boolean;
}

interface Corretora {
  corretora_tipo_pessoa?: "fisica" | "juridica";
  imobiliaria_nome?: string;
  imobiliaria_cnpj?: string;
  imobiliaria_email?: string;
  incluir_como_signatario?: boolean;
  /** Fonte canônica produzida pelo extractor Gemini. Quando presente com
   *  >=1 item, prevalece sobre os campos legados acima. */
  comissionados?: Comissionado[];
}

interface DealLikeData {
  vendedores?: Parte[];
  compradores?: Parte[];
  testemunhas?: Testemunha[];
  comissao?: Corretora;
}

export interface MappedSigner {
  signer: SignerInput;
}

export interface MissingEmailEntry {
  sourceKind: SourceKind;
  sourceIndex: number;
  name: string;
}

export interface MappingResult {
  signers: SignerInput[];
  missing: MissingEmailEntry[];
}

const onlyDigits = (s: string | undefined | null): string | undefined => {
  if (!s) return undefined;
  const cleaned = s.replace(/\D+/g, "");
  return cleaned.length ? cleaned : undefined;
};

const partyName = (p: Parte): string => {
  return (p.nome ?? p.razao_social ?? "").trim();
};

const partyDoc = (p: Parte): string | undefined => {
  if (p.tipo_pessoa === "juridica") return onlyDigits(p.cnpj);
  return onlyDigits(p.cpf);
};

export function dealDataToSigners(
  dataJson: unknown,
  authMethod: AuthMethod = "email"
): MappingResult {
  const data = (dataJson as DealLikeData) || {};
  const signers: SignerInput[] = [];
  const missing: MissingEmailEntry[] = [];

  const collect = (sourceKind: SourceKind, partes: Parte[] | undefined) => {
    (partes ?? []).forEach((p, idx) => {
      if (p.tipo_pessoa === "juridica") {
        // PJ assina pelo REPRESENTANTE legal (PF). A razão social não tem
        // CPF/e-mail próprios pra assinar (CNPJ direto dá 422 na ClickSign);
        // o CNPJ vira fallback de documentação. subKind="representante".
        const rep = p.representante ?? {};
        const repName = (rep.nome ?? "").trim();
        const displayName = repName || partyName(p);
        const repEmail = (rep.email ?? "").trim();
        // PJ sem nome identificável OU sem e-mail do representante NÃO some
        // silenciosa: vai pra `missing` pra o operador completar os dados.
        if (!displayName || !repEmail) {
          missing.push({
            sourceKind,
            sourceIndex: idx,
            name: displayName || `Empresa ${idx + 1}`,
          });
        } else {
          signers.push({
            sourceKind,
            sourceIndex: idx,
            subKind: "representante",
            name: displayName,
            email: repEmail,
            documentation: onlyDigits(rep.cpf) ?? onlyDigits(p.cnpj),
            phone: onlyDigits(rep.mobile_phone),
            authMethod,
          });
        }
        return; // PJ não tem cônjuge/procurador.
      }

      // PF titular.
      const name = partyName(p);
      if (name) {
        const email = (p.email ?? "").trim();
        if (!email) {
          missing.push({ sourceKind, sourceIndex: idx, name });
        } else {
          signers.push({
            sourceKind,
            sourceIndex: idx,
            subKind: "titular",
            name,
            email,
            documentation: partyDoc(p),
            phone: onlyDigits(p.mobile_phone ?? p.telefone),
            authMethod,
          });
        }
      }

      // Cônjuge: OPT-OUT (2026-07-24). Entra sempre que tem nome + e-mail,
      // salvo quando a flag foi explicitamente marcada `false` — que é o que
      // a popup de envio grava ao remover a linha (`unsetRemoved` em
      // SendEnvelopeDialog). Antes era opt-in exigindo `=== true`, mas nenhuma
      // UI do formulário público seta a flag: no caminho derivado (Newton/
      // bearer e preview) o cônjuge tinha linha de assinatura no PDF e sumia
      // do envelope. Mesma regra que `leaseDataToSigners` já usava.
      //
      // Sem e-mail continua fora e SEM entrada em `missing` — `missing`
      // bloqueia o envio inteiro, e a base legada raramente tem esse dado.
      // subKind="conjuge" desambigua o override de papel vindo da UI (mesmo
      // sourceIndex do titular; sem @@unique no schema).
      const conjuge = p.conjuge;
      if (conjuge && conjuge.incluir_como_signatario !== false) {
        const conjugeName = (conjuge.nome ?? "").trim();
        const conjugeEmail = (conjuge.email ?? "").trim();
        if (conjugeName && conjugeEmail) {
          signers.push({
            sourceKind,
            sourceIndex: idx,
            subKind: "conjuge",
            name: conjugeName,
            email: conjugeEmail,
            documentation: onlyDigits(conjuge.cpf),
            phone: onlyDigits(conjuge.mobile_phone ?? conjuge.telefone),
            authMethod,
          });
        }
      }

      // Procurador (PF): signatário adicional, mesmo opt-out do cônjuge.
      const proc = p.procurador;
      if (proc && proc.incluir_como_signatario !== false) {
        const procName = (proc.nome ?? "").trim();
        const procEmail = (proc.email ?? "").trim();
        if (procName && procEmail) {
          signers.push({
            sourceKind,
            sourceIndex: idx,
            subKind: "procurador",
            name: procName,
            email: procEmail,
            documentation: onlyDigits(proc.cpf),
            phone: onlyDigits(proc.mobile_phone),
            authMethod,
          });
        }
      }
    });
  };

  collect("vendedor", data.vendedores);
  collect("comprador", data.compradores);

  // Testemunhas e corretora são opt-in: só viram signers quando o usuário
  // marcou explicitamente "Incluir como signatário" (na popup de envio ou
  // no dataJson). Não geram entrada em `missing` quando faltam dados — é
  // sinal de que o usuário não os quis no envelope.
  (data.testemunhas ?? []).forEach((t, idx) => {
    if (!t.incluir_como_signatario) return;
    const name = (t.nome ?? "").trim();
    const email = (t.email ?? "").trim();
    if (!name || !email) return;
    signers.push({
      sourceKind: "testemunha",
      sourceIndex: idx,
      subKind: "titular",
      name,
      email,
      documentation: onlyDigits(t.cpf),
      phone: onlyDigits(t.mobile_phone),
      authMethod,
    });
  });

  const corretora = data.comissao;
  const comissionados = corretora?.comissionados ?? [];
  if (comissionados.length > 0) {
    // Fonte canônica: array de comissionados (extractor CCV pode trazer N).
    comissionados.forEach((c, idx) => {
      if (!c.incluir_como_signatario) return;
      const name = (c.nome ?? "").trim();
      const email = (c.email ?? "").trim();
      if (!name || !email) return;
      const documentation =
        onlyDigits(c.cnpj) ?? onlyDigits(c.cpf);
      signers.push({
        sourceKind: "corretora",
        sourceIndex: idx,
        subKind: "titular",
        name,
        email,
        documentation,
        phone: onlyDigits(c.mobile_phone),
        authMethod,
      });
    });
  } else if (corretora?.incluir_como_signatario) {
    // Fallback legado: contratos do form Handlebars sem `comissionados[]`.
    const name = (corretora.imobiliaria_nome ?? "").trim();
    const email = (corretora.imobiliaria_email ?? "").trim();
    if (name && email) {
      signers.push({
        sourceKind: "corretora",
        sourceIndex: 0,
        name,
        email,
        documentation: onlyDigits(corretora.imobiliaria_cnpj),
        authMethod,
      });
    }
  }

  return { signers, missing };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================================
// Locação — mapeamento de signatários (locador / locatário / fiador).
//
// Separado de `dealDataToSigners` (venda) de propósito: a estrutura do dataJson
// de locação é diferente (telefone em `mobile_phone`; PJ assina pelo
// `representante`, não pela razão social) e o roteamento é por `pipeline.kind`
// no executor. Ver apps/web/src/lib/forms/validation-locacao.ts.
// ============================================================================

interface LeaseRepresentante {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
}

interface LeaseParte {
  tipo_pessoa?: "fisica" | "juridica";
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  mobile_phone?: string;
  telefone?: string;
  representante?: LeaseRepresentante;
  conjuge?: Conjuge;
  incluir_como_signatario?: boolean;
}

interface LeaseData {
  locadores?: LeaseParte[];
  locatarios?: LeaseParte[];
  garantia?: { tipo?: string; fiador?: LeaseParte };
}

/**
 * Resolve o signatário real de uma parte de locação. Em PJ, quem assina é o
 * representante legal (a PJ titular não tem CPF/e-mail próprios pra assinar),
 * então extraímos nome/e-mail/CPF dele; o CNPJ vira fallback de documentação.
 */
function resolveLeaseSigner(p: LeaseParte): {
  name: string;
  email: string;
  documentation?: string;
  phone?: string;
  subKind: "titular" | "representante";
} {
  if (p.tipo_pessoa === "juridica") {
    const rep = p.representante ?? {};
    return {
      name: (rep.nome ?? "").trim(),
      email: (rep.email ?? "").trim(),
      documentation: onlyDigits(rep.cpf) ?? onlyDigits(p.cnpj),
      phone: onlyDigits(rep.mobile_phone),
      subKind: "representante",
    };
  }
  return {
    name: (p.nome ?? "").trim(),
    email: (p.email ?? "").trim(),
    documentation: onlyDigits(p.cpf),
    phone: onlyDigits(p.mobile_phone ?? p.telefone),
    subKind: "titular",
  };
}

export function leaseDataToSigners(
  dataJson: unknown,
  authMethod: AuthMethod = "email"
): MappingResult {
  const data = (dataJson as LeaseData) || {};
  const signers: SignerInput[] = [];
  const missing: MissingEmailEntry[] = [];

  /**
   * Cônjuge de parte PF casada — outorga uxória. Mesmo `sourceIndex` do
   * titular, desambiguado por `subKind`. Opt-out como o resto de locação:
   * entra com nome + e-mail, salvo flag explicitamente `false`. Sem e-mail
   * fica de fora sem entrar em `missing` (que bloquearia o envelope inteiro).
   */
  const pushConjuge = (
    sourceKind: SourceKind,
    sourceIndex: number,
    p: LeaseParte
  ) => {
    if (p.tipo_pessoa === "juridica") return;
    const conjuge = p.conjuge;
    if (!conjuge || conjuge.incluir_como_signatario === false) return;
    const name = (conjuge.nome ?? "").trim();
    const email = (conjuge.email ?? "").trim();
    if (!name || !email) return;
    signers.push({
      sourceKind,
      sourceIndex,
      subKind: "conjuge",
      name,
      email,
      documentation: onlyDigits(conjuge.cpf),
      phone: onlyDigits(conjuge.mobile_phone ?? conjuge.telefone),
      authMethod,
    });
  };

  const collect = (sourceKind: SourceKind, partes: LeaseParte[] | undefined) => {
    (partes ?? []).forEach((p, idx) => {
      // Locador/locatário entram por default (incluir_como_signatario default
      // `true` no schema); só saem quando explicitamente marcado `false`.
      if (p.incluir_como_signatario === false) return;
      const { name, email, documentation, phone, subKind } = resolveLeaseSigner(p);
      if (!name) return;
      if (!email) {
        missing.push({ sourceKind, sourceIndex: idx, name });
        // Cônjuge não depende do e-mail do titular pra assinar.
        pushConjuge(sourceKind, idx, p);
        return;
      }
      signers.push({
        sourceKind,
        sourceIndex: idx,
        subKind,
        name,
        email,
        documentation,
        phone,
        authMethod,
      });
      pushConjuge(sourceKind, idx, p);
    });
  };

  collect("locador", data.locadores);
  collect("locatario", data.locatarios);

  // Fiador — só quando a garantia escolhida é "fiador". Bloqueia (missing) se
  // não tiver e-mail, já que a garantia exige a assinatura dele.
  const garantia = data.garantia;
  if (garantia?.tipo === "fiador" && garantia.fiador) {
    const f = garantia.fiador;
    if (f.incluir_como_signatario !== false) {
      const { name, email, documentation, phone, subKind } = resolveLeaseSigner(f);
      if (name) {
        if (!email) {
          missing.push({ sourceKind: "fiador", sourceIndex: 0, name });
        } else {
          signers.push({
            sourceKind: "fiador",
            sourceIndex: 0,
            subKind,
            name,
            email,
            documentation,
            phone,
            authMethod,
          });
        }
        // Outorga do cônjuge do fiador — o art. 1.647, III do Código Civil
        // exige a anuência conjugal na fiança, então ela vale ainda mais aqui.
        pushConjuge("fiador", 0, f);
      }
    }
  }

  return { signers, missing };
}
