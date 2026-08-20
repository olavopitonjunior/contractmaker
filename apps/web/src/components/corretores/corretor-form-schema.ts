/**
 * Schema client-side do Sheet de criar/editar corretor. Espelha as
 * validações do server (POST/PATCH /api/financeiro/split-recipients em
 * src/app/api/financeiro/split-recipients/route.ts e [id]/route.ts) pra dar
 * erro inline antes do submit — não substitui a validação do server.
 */
import { z } from "zod";
import { isValidCpfCnpj, isValidCreci } from "@/lib/validators/corretor";
import { normalizeBrPhone } from "@/lib/validators/phone-br";

export const PAPEL_OPTIONS = [
  { value: "imobiliaria_principal", label: "Imobiliária principal" },
  { value: "captador", label: "Captador" },
  { value: "intermediador", label: "Intermediador" },
  { value: "indicador", label: "Indicador" },
  { value: "outro", label: "Outro" },
] as const;

export const PAPEL_LABEL: Record<string, string> = Object.fromEntries(
  PAPEL_OPTIONS.map((o) => [o.value, o.label])
);

const PAPEL_VALUES = PAPEL_OPTIONS.map((o) => o.value) as [string, ...string[]];

const baseShape = {
  label: z.string().trim().min(1, "Nome é obrigatório").max(120),
  tipoPessoa: z.enum(["fisica", "juridica"]),
  cpfCnpj: z.string().trim().max(18),
  creci: z.string().trim().max(50),
  papel: z.enum(PAPEL_VALUES),
  email: z.string().trim().max(200),
  phone: z.string().trim().max(30),
  pixAddressKey: z.string().trim().max(200),
  bankName: z.string().trim().max(80),
  bankBranch: z.string().trim().max(20),
  bankAccount: z.string().trim().max(30),
  bankAccountType: z.enum(["corrente", "poupanca"]),
  bankHolderName: z.string().trim().max(200),
  bankHolderDoc: z.string().trim().max(18),
  notifyByEmail: z.boolean(),
  notifyByWhatsapp: z.boolean(),
  notifyOptOut: z.boolean(),
  maxEnabled: z.boolean(),
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valores iniciais de um registro em EDIÇÃO — campo idêntico ao já gravado
 *  NÃO é revalidado (espelha o bypass do PATCH no server): o form público
 *  grava soft (telefone cru, CRECI verbatim) e travar o sheet num campo que o
 *  admin nem tocou tornaria registros legados ineditáveis. */
export interface CorretorFormInitial {
  cpfCnpj?: string | null;
  creci?: string | null;
  phone?: string | null;
}

/**
 * `requireDoc`: CPF/CNPJ só é obrigatório no CADASTRO — no PATCH o server
 * aceita null (mesma regra do `save()` original do CorretoresClient).
 */
export function buildCorretorFormSchema(requireDoc: boolean, initial?: CorretorFormInitial) {
  const unchanged = (value: string, stored: string | null | undefined) =>
    Boolean(stored) && value.trim() === String(stored).trim();

  return z.object(baseShape).superRefine((data, ctx) => {
    const doc = data.cpfCnpj.trim();
    if (requireDoc && doc.replace(/\D/g, "").length < 11) {
      ctx.addIssue({
        path: ["cpfCnpj"],
        code: z.ZodIssueCode.custom,
        message: "CPF/CNPJ é obrigatório no cadastro",
      });
    } else if (doc && !unchanged(doc, initial?.cpfCnpj) && !isValidCpfCnpj(doc)) {
      ctx.addIssue({
        path: ["cpfCnpj"],
        code: z.ZodIssueCode.custom,
        message: "CPF/CNPJ inválido (dígito verificador não confere)",
      });
    }

    const creci = data.creci.trim();
    if (creci && !unchanged(creci, initial?.creci) && !isValidCreci(creci)) {
      ctx.addIssue({
        path: ["creci"],
        code: z.ZodIssueCode.custom,
        message:
          "CRECI inválido — use o número, com UF/sufixo opcionais (ex.: 12345-F ou SP-12345)",
      });
    }

    if (data.email.trim() && !EMAIL_RE.test(data.email.trim())) {
      ctx.addIssue({
        path: ["email"],
        code: z.ZodIssueCode.custom,
        message: "Email inválido",
      });
    }

    const phone = data.phone.trim();
    if (phone && !unchanged(phone, initial?.phone) && !normalizeBrPhone(phone)) {
      ctx.addIssue({
        path: ["phone"],
        code: z.ZodIssueCode.custom,
        message: "Telefone inválido — use DDD + número (ex.: (11) 98765-4321)",
      });
    }
  });
}

export type CorretorFormValues = z.infer<ReturnType<typeof buildCorretorFormSchema>>;

export const EMPTY_CORRETOR_FORM: CorretorFormValues = {
  label: "",
  tipoPessoa: "fisica",
  cpfCnpj: "",
  creci: "",
  papel: "captador",
  email: "",
  phone: "",
  pixAddressKey: "",
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  bankAccountType: "corrente",
  bankHolderName: "",
  bankHolderDoc: "",
  notifyByEmail: true,
  notifyByWhatsapp: false,
  notifyOptOut: false,
  maxEnabled: false,
};
