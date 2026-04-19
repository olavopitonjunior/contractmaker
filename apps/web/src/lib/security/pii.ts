export function maskCpf(cpf: string | null | undefined): string {
  if (!cpf) return "";
  const digits = cpf.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  const last = digits.slice(-4);
  return `***.***.**${last.slice(0, 1)}-${last.slice(1)}`;
}

export function maskCnpj(cnpj: string | null | undefined): string {
  if (!cnpj) return "";
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  const last = digits.slice(-6);
  return `**.***.***/${last.slice(0, 4)}-${last.slice(4)}`;
}

export function maskCpfCnpj(v: string | null | undefined): string {
  if (!v) return "";
  const digits = v.replace(/\D/g, "");
  return digits.length > 11 ? maskCnpj(v) : maskCpf(v);
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const first = local.slice(0, 1);
  return `${first}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-****-${digits.slice(-4)}`;
}

export function maskPii(text: string): string {
  // CPF (11 digits, optionally with dots/dash)
  let out = text.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, (m) =>
    maskCpf(m)
  );
  // CNPJ (14 digits)
  out = out.replace(
    /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
    (m) => maskCnpj(m)
  );
  // Emails
  out = out.replace(/[\w.+-]+@[\w.-]+\.\w+/g, (m) => maskEmail(m));
  return out;
}
