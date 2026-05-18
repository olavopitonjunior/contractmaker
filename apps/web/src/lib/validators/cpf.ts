export function onlyDigits(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

export function isValidCpf(raw: string): boolean {
  const digits = onlyDigits(raw);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const calcCheck = (slice: string, factorStart: number): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += parseInt(slice[i]!, 10) * (factorStart - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const d1 = calcCheck(digits.slice(0, 9), 10);
  if (d1 !== parseInt(digits[9]!, 10)) return false;

  const d2 = calcCheck(digits.slice(0, 10), 11);
  if (d2 !== parseInt(digits[10]!, 10)) return false;

  return true;
}

export function formatCpf(raw: string): string {
  const d = onlyDigits(raw);
  if (d.length !== 11) return raw;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}
