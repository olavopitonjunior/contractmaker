import type { AuthMethod, SignerInput, SourceKind } from "./types";

interface Parte {
  tipo_pessoa?: "fisica" | "juridica";
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  telefone?: string;
}

interface Testemunha {
  nome?: string;
  cpf?: string;
  email?: string;
  incluir_como_signatario?: boolean;
}

interface Corretora {
  corretora_tipo_pessoa?: "fisica" | "juridica";
  imobiliaria_nome?: string;
  imobiliaria_cnpj?: string;
  imobiliaria_email?: string;
  incluir_como_signatario?: boolean;
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
      if (!name) return;
      const email = (p.email ?? "").trim();
      if (!email) {
        missing.push({ sourceKind, sourceIndex: idx, name });
        return;
      }
      signers.push({
        sourceKind,
        sourceIndex: idx,
        name,
        email,
        documentation: partyDoc(p),
        phone: onlyDigits(p.telefone),
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
  if (corretora?.incluir_como_signatario) {
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
