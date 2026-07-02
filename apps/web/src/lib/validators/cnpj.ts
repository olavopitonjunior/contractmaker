import { isValidCpf, onlyDigits } from "./cpf";

/** Valida CNPJ pelos dígitos verificadores (módulo 11). */
export function isValidCnpj(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calc = (len: number): number => {
    let pos = len - 7;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += parseInt(d[i]!, 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const res = sum % 11;
    return res < 2 ? 0 : 11 - res;
  };

  if (calc(12) !== parseInt(d[12]!, 10)) return false;
  if (calc(13) !== parseInt(d[13]!, 10)) return false;
  return true;
}

/** Aceita CPF (11) ou CNPJ (14) válido. */
export function isValidCpfCnpj(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length === 11) return isValidCpf(d);
  if (d.length === 14) return isValidCnpj(d);
  return false;
}
