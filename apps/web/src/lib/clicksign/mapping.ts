import type { AuthMethod, SignerInput, SourceKind } from "./types";

interface Conjuge {
  nome?: string;
  cpf?: string;
  email?: string;
  telefone?: string;
  incluir_como_signatario?: boolean;
}

interface Parte {
  tipo_pessoa?: "fisica" | "juridica";
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  telefone?: string;
  conjuge?: Conjuge;
}

interface Testemunha {
  nome?: string;
  cpf?: string;
  email?: string;
  incluir_como_signatario?: boolean;
}

interface Comissionado {
  nome?: string;
  cpf?: string;
  cnpj?: string;
  tipo_pessoa?: "fisica" | "juridica";
  email?: string;
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
      const name = partyName(p);
      if (name) {
        const email = (p.email ?? "").trim();
        if (!email) {
          missing.push({ sourceKind, sourceIndex: idx, name });
        } else {
          signers.push({
            sourceKind,
            sourceIndex: idx,
            name,
            email,
            documentation: partyDoc(p),
            phone: onlyDigits(p.telefone),
            authMethod,
          });
        }
      }

      // Cônjuge: opt-in via flag incluir_como_signatario. Não gera entrada
      // em `missing` quando dados faltam — sinal de que não foi escolhido
      // pra assinar. SourceIndex deslocado em +1000 pra evitar colisão
      // com partes titulares dentro do mesmo envelope (nenhum schema usa
      // unique em (sourceKind, sourceIndex), mas mantém leitura clara).
      const conjuge = p.conjuge;
      if (!conjuge?.incluir_como_signatario) return;
      const conjugeName = (conjuge.nome ?? "").trim();
      const conjugeEmail = (conjuge.email ?? "").trim();
      if (!conjugeName || !conjugeEmail) return;
      signers.push({
        sourceKind,
        sourceIndex: idx + 1000,
        name: conjugeName,
        email: conjugeEmail,
        documentation: onlyDigits(conjuge.cpf),
        phone: onlyDigits(conjuge.telefone),
        authMethod,
      });
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
      name,
      email,
      documentation: onlyDigits(t.cpf),
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
        name,
        email,
        documentation,
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
} {
  if (p.tipo_pessoa === "juridica") {
    const rep = p.representante ?? {};
    return {
      name: (rep.nome ?? "").trim(),
      email: (rep.email ?? "").trim(),
      documentation: onlyDigits(rep.cpf) ?? onlyDigits(p.cnpj),
      phone: onlyDigits(rep.mobile_phone),
    };
  }
  return {
    name: (p.nome ?? "").trim(),
    email: (p.email ?? "").trim(),
    documentation: onlyDigits(p.cpf),
    phone: onlyDigits(p.mobile_phone ?? p.telefone),
  };
}

export function leaseDataToSigners(
  dataJson: unknown,
  authMethod: AuthMethod = "email"
): MappingResult {
  const data = (dataJson as LeaseData) || {};
  const signers: SignerInput[] = [];
  const missing: MissingEmailEntry[] = [];

  const collect = (sourceKind: SourceKind, partes: LeaseParte[] | undefined) => {
    (partes ?? []).forEach((p, idx) => {
      // Locador/locatário entram por default (incluir_como_signatario default
      // `true` no schema); só saem quando explicitamente marcado `false`.
      if (p.incluir_como_signatario === false) return;
      const { name, email, documentation, phone } = resolveLeaseSigner(p);
      if (!name) return;
      if (!email) {
        missing.push({ sourceKind, sourceIndex: idx, name });
        return;
      }
      signers.push({
        sourceKind,
        sourceIndex: idx,
        name,
        email,
        documentation,
        phone,
        authMethod,
      });
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
      const { name, email, documentation, phone } = resolveLeaseSigner(f);
      if (name) {
        if (!email) {
          missing.push({ sourceKind: "fiador", sourceIndex: 0, name });
        } else {
          signers.push({
            sourceKind: "fiador",
            sourceIndex: 0,
            name,
            email,
            documentation,
            phone,
            authMethod,
          });
        }
      }
    }
  }

  return { signers, missing };
}
