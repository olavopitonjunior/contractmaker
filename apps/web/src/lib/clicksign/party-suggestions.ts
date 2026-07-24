import { defaultRoleForSourceKind, type ClicksignRole } from "./roles";

/**
 * Sugestões de signatário derivadas das partes do deal (vendedores/compradores),
 * usadas pelos chips de auto-preenchimento do envelope avulso.
 *
 * Existe porque a lógica vivia duplicada e incompleta em dois lugares
 * (DealDetail e SignaturesTab): ambos só listavam o titular, então cônjuge,
 * procurador e representante legal nunca apareciam — e o chip de uma PJ saía
 * sem e-mail nenhum, já que o schema de PJ não tem campo `email` (quem tem é
 * `representante.email`).
 *
 * A árvore de decisão espelha `buildInitialRows` de SendEnvelopeDialog, que é
 * a referência de comportamento da popup de contrato.
 *
 * Módulo puro (sem React, sem prisma) — client-safe e testável.
 */

export type PartySubKind = "titular" | "conjuge" | "procurador" | "representante";

interface SubParte {
  nome?: string;
  cpf?: string;
  email?: string;
  mobile_phone?: string;
}

export interface PartyLike {
  tipo_pessoa?: string;
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  mobile_phone?: string;
  conjuge?: SubParte;
  procurador?: SubParte;
  representante?: SubParte;
}

export interface PartySuggestion {
  sourceKind: "vendedor" | "comprador";
  sourceIndex: number;
  subKind: PartySubKind;
  name: string;
  email: string | null;
  /** Só dígitos (CPF ou CNPJ). */
  documentation: string | null;
  /** Só dígitos. */
  phone: string | null;
  role: ClicksignRole;
  /** Rótulo do chip, ex.: "Maria Silva (cônjuge)". */
  label: string;
  /** "cônjuge" | "procurador" | "representante"; null no titular. */
  subLabel: string | null;
}

const SUB_LABELS: Record<Exclude<PartySubKind, "titular">, string> = {
  conjuge: "cônjuge",
  procurador: "procurador",
  representante: "representante",
};

function onlyDigits(s: string | undefined | null): string | null {
  const cleaned = (s ?? "").replace(/\D/g, "");
  return cleaned.length ? cleaned : null;
}

function trimOrNull(s: string | undefined | null): string | null {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

function labelFor(name: string, subKind: PartySubKind): string {
  return subKind === "titular" ? name : `${name} (${SUB_LABELS[subKind]})`;
}

function partyName(p: PartyLike): string {
  return (p.nome || p.razao_social || "").trim();
}

function subSuggestion(
  sourceKind: "vendedor" | "comprador",
  sourceIndex: number,
  subKind: Exclude<PartySubKind, "titular">,
  sub: SubParte
): PartySuggestion | null {
  const name = (sub.nome ?? "").trim();
  if (!name) return null;
  return {
    sourceKind,
    sourceIndex,
    subKind,
    name,
    email: trimOrNull(sub.email),
    documentation: onlyDigits(sub.cpf),
    phone: onlyDigits(sub.mobile_phone),
    role: defaultRoleForSourceKind(sourceKind, subKind),
    label: labelFor(name, subKind),
    subLabel: SUB_LABELS[subKind],
  };
}

function suggestionsForList(
  sourceKind: "vendedor" | "comprador",
  partes: PartyLike[] | undefined
): PartySuggestion[] {
  const out: PartySuggestion[] = [];
  (partes ?? []).forEach((p, idx) => {
    if (p.tipo_pessoa === "juridica") {
      // PJ assina pelo representante legal (PF com CPF). A razão social não
      // tem e-mail próprio, e a ClickSign recusa CNPJ como documentation do
      // signatário — CNPJ entra só como fallback. PJ não tem cônjuge nem
      // procurador.
      const rep = p.representante ?? {};
      const name = (rep.nome ?? "").trim() || partyName(p);
      if (!name) return;
      out.push({
        sourceKind,
        sourceIndex: idx,
        subKind: "representante",
        name,
        email: trimOrNull(rep.email),
        documentation: onlyDigits(rep.cpf) ?? onlyDigits(p.cnpj),
        phone: onlyDigits(rep.mobile_phone),
        role: defaultRoleForSourceKind(sourceKind, "representante"),
        label: labelFor(name, "representante"),
        subLabel: SUB_LABELS.representante,
      });
      return;
    }

    const name = partyName(p);
    if (name) {
      out.push({
        sourceKind,
        sourceIndex: idx,
        subKind: "titular",
        name,
        email: trimOrNull(p.email),
        documentation: onlyDigits(p.cpf),
        phone: onlyDigits(p.mobile_phone),
        role: defaultRoleForSourceKind(sourceKind, "titular"),
        label: name,
        subLabel: null,
      });
    }

    const conjuge = p.conjuge
      ? subSuggestion(sourceKind, idx, "conjuge", p.conjuge)
      : null;
    if (conjuge) out.push(conjuge);

    const procurador = p.procurador
      ? subSuggestion(sourceKind, idx, "procurador", p.procurador)
      : null;
    if (procurador) out.push(procurador);
  });
  return out;
}

export function buildPartySuggestions(
  vendedores: PartyLike[] | undefined,
  compradores: PartyLike[] | undefined
): PartySuggestion[] {
  return [
    ...suggestionsForList("vendedor", vendedores),
    ...suggestionsForList("comprador", compradores),
  ];
}
