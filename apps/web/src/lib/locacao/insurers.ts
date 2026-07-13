// Roster canônico de seguradoras de fiança locatícia que a imobiliária trabalha.
// Client-safe (sem prisma/zod) — usado pela listagem de clientes e pelo card de
// fiança. A análise de cada cliente é acompanhada POR seguradora (todas as 6),
// não só as adicionadas. Ver project_locacao_clientes.

export const LEASE_INSURERS = [
  { key: "porto", label: "Porto" },
  { key: "tokio", label: "Tokio" },
  { key: "pottencial", label: "Pottencial" },
  { key: "too", label: "Too" },
  { key: "credaluga", label: "CredAluga" },
  { key: "upestate", label: "UpEstate" },
] as const;

export type InsurerKey = (typeof LEASE_INSURERS)[number]["key"];

/** Normaliza pra casar nomes livres ("Porto Seguro") com a chave do roster. */
export function normalizeInsurer(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Retorna a chave do roster que casa com um nome de seguradora livre, ou null. */
export function matchInsurerKey(seguradora: string): InsurerKey | null {
  const n = normalizeInsurer(seguradora);
  if (!n) return null;
  const hit = LEASE_INSURERS.find(
    (i) => n.startsWith(i.key) || i.key.startsWith(n) || n.includes(i.key)
  );
  return hit?.key ?? null;
}

export const INSURER_STATUSES = [
  "pendente",
  "enviado",
  "em_analise",
  "aprovado",
  "aprovado_com_restricao",
  "recusado",
] as const;

export type InsurerStatus = (typeof INSURER_STATUSES)[number];

export const INSURER_STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  enviado: "Enviado",
  em_analise: "Em análise",
  aprovado: "Aprovado",
  aprovado_com_restricao: "Aprovado c/ restrição",
  recusado: "Recusado",
};

/** Rótulo curto pra badge na listagem. */
export const INSURER_STATUS_SHORT: Record<string, string> = {
  pendente: "pendente",
  enviado: "enviado",
  em_analise: "em análise",
  aprovado: "aprovado",
  aprovado_com_restricao: "aprov. c/ rest.",
  recusado: "recusado",
};

export type InsurerTone = "default" | "secondary" | "outline" | "destructive";

export const INSURER_STATUS_TONE: Record<string, InsurerTone> = {
  aprovado: "default",
  aprovado_com_restricao: "outline",
  em_analise: "secondary",
  enviado: "secondary",
  pendente: "outline",
  recusado: "destructive",
};
