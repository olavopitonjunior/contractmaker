/**
 * Tipos compartilhados da tela "Corretores" — mesmo shape do
 * SplitRecipient(kind="commissioner") devolvido por
 * /api/financeiro/split-recipients.
 */
export interface Corretor {
  id: string;
  label: string;
  recipientType: "asaas_wallet" | "pix_external";
  walletId: string | null;
  pixAddressKey: string | null;
  pixKeyType: string | null;
  cpfCnpj: string | null;
  tipoPessoa: "fisica" | "juridica" | null;
  creci: string | null;
  papel: string | null;
  email: string | null;
  phone: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
  bankAccountType: string | null;
  bankHolderName: string | null;
  bankHolderDoc: string | null;
  pendingFields: string[];
  /** Pagabilidade da esteira de repasse — NÃO diz se o cadastro existe. */
  active: boolean;
  /** Desativado nesta tela (ou excluído). É o que tira do picker do formulário. */
  archivedAt: string | null;
  notifyByEmail: boolean;
  notifyByWhatsapp: boolean;
  notifyOptOut: boolean;
  maxEnabled: boolean;
}

/** Mascara documento pra exibição — mantém 3 primeiros e 2 últimos dígitos. */
export function maskDoc(doc: string | null): string {
  if (!doc) return "—";
  const d = doc.replace(/\D/g, "");
  if (d.length < 6) return d;
  return `${d.slice(0, 3)}***${d.slice(-2)}`;
}
