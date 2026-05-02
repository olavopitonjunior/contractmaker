/**
 * Achata `dataJson` em um dicionário flat `{ [key]: string }` usado como
 * substituições do `replaceAllText` da Docs API. Para campos numéricos
 * conhecidos (valores em R$, datas), gera variantes formatadas — equivalente
 * ao que os helpers Handlebars (`{{moeda x}}`, `{{dataExtenso x}}`) fazem
 * em tempo de render no pipeline atual.
 *
 * Convenção dos templates Google Docs:
 *   - {{vendedor1.nome}}, {{vendedor1.cpf_fmt}}, {{vendedor1.cpf_raw}}
 *   - {{pagamento.valor_total_moeda}}, {{pagamento.valor_total_extenso}}
 *   - {{contrato.data_extenso}}
 *
 * Helpers Handlebars condicionais (`{{#if}}`, `{{#each}}`) não têm equivalente
 * direto no `replaceAllText`. Templates que precisam de loops devem usar
 * blocos pré-renderizados em servidor (gerar texto dos N vendedores e injetar
 * via `vendedores.bloco`) ou separar em sub-docs com Docs API `insertText`.
 */
export function flattenForGoogleDoc(
  data: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  flatten(data, "", out);
  return out;
}

function flatten(value: unknown, prefix: string, out: Record<string, string>) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      flatten(item, `${prefix}${idx + 1}`, out);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      flatten(v, key, out);
    }
    return;
  }
  // primitive
  if (typeof value === "string") {
    out[prefix] = value;
    if (looksLikeCpf(value)) out[`${prefix}_fmt`] = formatCpf(value);
    else if (looksLikeCnpj(value)) out[`${prefix}_fmt`] = formatCnpj(value);
    else if (looksLikeCep(value)) out[`${prefix}_fmt`] = formatCep(value);
    else if (looksLikeIsoDate(value)) {
      out[`${prefix}_extenso`] = formatDateExtenso(value);
    }
  } else if (typeof value === "number") {
    out[prefix] = String(value);
    out[`${prefix}_moeda`] = formatMoeda(value);
    out[`${prefix}_extenso`] = valorPorExtenso(value);
  } else if (typeof value === "boolean") {
    out[prefix] = value ? "Sim" : "Não";
  } else {
    out[prefix] = String(value);
  }
}

function looksLikeCpf(s: string) {
  return /^\d{11}$|^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(s);
}
function looksLikeCnpj(s: string) {
  return /^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(s);
}
function looksLikeCep(s: string) {
  return /^\d{8}$|^\d{5}-\d{3}$/.test(s);
}
function looksLikeIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}

function formatCpf(s: string) {
  const d = s.replace(/\D/g, "");
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}
function formatCnpj(s: string) {
  const d = s.replace(/\D/g, "");
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}
function formatCep(s: string) {
  const d = s.replace(/\D/g, "");
  return d.replace(/(\d{5})(\d{3})/, "$1-$2");
}
function formatMoeda(v: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}
function formatDateExtenso(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

// Espelho minimalista do `valorPorExtenso` em handlebars.ts. Mantido aqui
// para não criar dependência cruzada (handlebars.ts registra side-effects).
function valorPorExtenso(valor: number): string {
  if (Number.isNaN(valor)) return "";
  if (valor === 0) return "zero reais";
  const unidades = [
    "",
    "um",
    "dois",
    "três",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
    "dez",
    "onze",
    "doze",
    "treze",
    "quatorze",
    "quinze",
    "dezesseis",
    "dezessete",
    "dezoito",
    "dezenove",
  ];
  const dezenas = [
    "",
    "",
    "vinte",
    "trinta",
    "quarenta",
    "cinquenta",
    "sessenta",
    "setenta",
    "oitenta",
    "noventa",
  ];
  const centenas = [
    "",
    "cento",
    "duzentos",
    "trezentos",
    "quatrocentos",
    "quinhentos",
    "seiscentos",
    "setecentos",
    "oitocentos",
    "novecentos",
  ];
  function grupo(n: number): string {
    if (n === 0) return "";
    if (n === 100) return "cem";
    const c = Math.floor(n / 100);
    const r = n % 100;
    const d = Math.floor(r / 10);
    const u = r % 10;
    const partes: string[] = [];
    if (c > 0) partes.push(centenas[c]);
    if (r > 0 && r < 20) partes.push(unidades[r]);
    else if (r >= 20) {
      partes.push(dezenas[d]);
      if (u > 0) partes.push(unidades[u]);
    }
    return partes.join(" e ");
  }
  const inteiro = Math.floor(Math.abs(valor));
  const centavos = Math.round((Math.abs(valor) - inteiro) * 100);
  const escalas = [
    { div: 1_000_000_000, sing: "bilhão", plur: "bilhões" },
    { div: 1_000_000, sing: "milhão", plur: "milhões" },
    { div: 1_000, sing: "mil", plur: "mil" },
    { div: 1, sing: "", plur: "" },
  ];
  const partes: string[] = [];
  let resto = inteiro;
  for (const e of escalas) {
    const qtd = Math.floor(resto / e.div);
    resto = resto % e.div;
    if (qtd > 0) {
      const g = grupo(qtd);
      if (e.div === 1) partes.push(g);
      else if (qtd === 1) partes.push(e.div === 1000 ? "mil" : `${g} ${e.sing}`);
      else partes.push(`${g} ${e.plur}`);
    }
  }
  let r = partes.join(", ");
  const lc = r.lastIndexOf(", ");
  if (lc > 0) {
    const after = r.slice(lc + 2);
    if (!after.includes(" mil") && !after.includes(" milh") && !after.includes(" bilh")) {
      r = r.slice(0, lc) + " e " + after;
    }
  }
  if (inteiro === 1) r += " real";
  else if (inteiro > 0) r += " reais";
  if (centavos > 0) {
    const cExt = grupo(centavos);
    if (inteiro > 0) r += " e ";
    r += `${cExt} ${centavos === 1 ? "centavo" : "centavos"}`;
  }
  return r;
}
