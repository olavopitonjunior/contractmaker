// Especificidade de um VALOR para o reverse-merge — módulo puro.
//
// A regra de unicidade ("só troca se o valor ocorre 1 vez") derruba justamente
// os campos que se repetem: o valor do aluguel está na cláusula do preço, na
// do reajuste e na da multa; a data de início está no preâmbulo e na vigência.
// Foi assim que "10 de agosto de 2021" ficou literal nos modelos da Trio.
//
// Trocar TODAS as ocorrências só é seguro quando o valor é específico o
// bastante para não ser texto fixo do contrato: "R$ 2.500,00" e um CPF com
// dígito verificador válido são de um negócio; "casa" e "10" são de qualquer
// um ("casa de máquinas", "10 dias"). A decisão é do PAR (token, valor):
// o catálogo diz se o token admite `matchPolicy: "all"`; esta função diz se o
// valor merece.
import { isValidCnpjNumber, isValidCpfNumber } from "@/lib/ingestion/pii";

/** Comprimento a partir do qual um texto é específico por si só. */
export const SPECIFIC_MIN_LENGTH = 40;

const BRL_RE = /^R\$\s?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const CEP_RE = /^\d{5}-?\d{3}$/;
const DATE_NUM_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const DATE_EXTENSO_RE =
  /^\d{1,2}º? de (janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de \d{4}$/i;
/**
 * "Cidade/UF, 9 de junho de 2026" — o local+data de assinatura
 * (`dataLocalAssinatura` em placeholder-map). Fica abaixo dos 40 chars e a
 * data ancorada não casa com a cidade na frente.
 */
const DATE_LOCAL_RE = /^[^,]{2,}(?:\/[A-Z]{2})?,\s*\d{1,2}º? de [a-zç]+ de \d{4}$/i;
/**
 * Valor por extenso em reais (`três mil e quinhentos reais`): é o par do valor
 * numérico e vive nas mesmas cláusulas. Texto fixo de contrato não termina em
 * "reais" com número por extenso na frente — e o mínimo de 12 chars deixa
 * "dez reais" de fora.
 */
const EXTENSO_REAIS_RE = /^[a-zçãõáéíóúâêô]+(?:[\s,]+(?:e\s)?[a-zçãõáéíóúâêô]+)*\sreais?$/i;

/**
 * Espaço não separável (U+00A0) e espaço comum contam como o mesmo caractere:
 * o helper `moeda` produz `R$ 3.500,00`, um Doc digitado à mão traz
 * `R$ 3.500,00`. Comparar sem normalizar erra o valor do aluguel em silêncio
 * (issue #503).
 */
export function normalizeSpaces(text: string): string {
  return text.replace(/ /g, " ");
}

export function isSpecificValue(raw: string): boolean {
  const value = normalizeSpaces(raw).trim();
  if (!value) return false;
  // Placeholder de máscara (`000.000.000-00`, `00000-000`): só zeros — nunca é
  // de um negócio, e trocá-lo em todo lugar apagaria o que a máscara protegeu.
  if (/\d/.test(value) && !/[1-9]/.test(value)) return false;
  if (value.length >= SPECIFIC_MIN_LENGTH) return true;
  if (BRL_RE.test(value)) return true;
  if (CEP_RE.test(value)) return true;
  if (DATE_NUM_RE.test(value) || DATE_EXTENSO_RE.test(value) || DATE_LOCAL_RE.test(value)) return true;
  // Número pequeno por extenso ("10 (dez)", "10% (dez por cento)") NÃO é
  // específico: o formato não diz de qual campo o número é, e "10 (dez)" do
  // vencimento também é o "prazo de 10 (dez) dias" da desocupação.
  if (value.length >= 12 && EXTENSO_REAIS_RE.test(value)) return true;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && /^[\d.\-\s]+$/.test(value) && isValidCpfNumber(digits)) return true;
  if (digits.length === 14 && /^[\d.\-\/\s]+$/.test(value) && isValidCnpjNumber(digits)) return true;
  return false;
}
