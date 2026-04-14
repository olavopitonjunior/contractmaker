/**
 * Cidade (RJ) -> Comarca (TJRJ). Fallback: "Capital" when unknown.
 * Based on the TJRJ portal dropdown values.
 */
const MAP: Record<string, string> = {
  "rio de janeiro": "Capital",
  "niteroi": "Niteroi",
  "sao goncalo": "Sao Goncalo",
  "duque de caxias": "Duque de Caxias",
  "nova iguacu": "Nova Iguacu",
  "belford roxo": "Belford Roxo",
  "campos dos goytacazes": "Campos dos Goytacazes",
  "petropolis": "Petropolis",
  "volta redonda": "Volta Redonda",
  "angra dos reis": "Angra dos Reis",
  "macae": "Macae",
  "cabo frio": "Cabo Frio",
  "nova friburgo": "Nova Friburgo",
  "teresopolis": "Teresopolis",
  "itaborai": "Itaborai",
  "mage": "Mage",
  "resende": "Resende",
  "barra mansa": "Barra Mansa",
  "marica": "Marica",
  "itaguai": "Itaguai",
  "queimados": "Queimados",
};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function comarcaForCidade(cidade: string | undefined | null): string {
  if (!cidade) return "Capital";
  return MAP[normalize(cidade)] ?? "Capital";
}
