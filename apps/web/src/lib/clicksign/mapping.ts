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

interface DealLikeData {
  vendedores?: Parte[];
  compradores?: Parte[];
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

  return { signers, missing };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
