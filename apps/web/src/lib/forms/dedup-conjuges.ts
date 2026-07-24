/**
 * Dedup de cônjuges duplicados como vendedores/compradores.
 *
 * Bug demo 2026-05-05: Isabel virou comprador 2 mesmo já estando registrada
 * como cônjuge de Luiz Fernando (comprador 1). Resultado no contrato: bloco
 * de qualificação dela renderizava duas vezes — como cônjuge inline e como
 * parte autônoma. Causa: form não tem merge entre `comprador[i].conjuge` e
 * `comprador[j]` quando o usuário cadastra ambos.
 *
 * Esta função roda no finalize do form (PATCH com status=completo) e remove
 * a duplicata da lista, preservando dados úteis no sub-objeto cônjuge.
 *
 * Critério de match (na MESMA lista — não cruza vendedores↔compradores):
 *   1. CPF idêntico (sanitizado, 11 dígitos) entre `parte.conjuge.cpf` e
 *      `outraParte.cpf`. Mais confiável.
 *   2. Nome normalizado idêntico, quando ambos os CPFs estão ausentes.
 *
 * Quando match: remove `outraParte` da lista e copia campos vazios de
 * `parte.conjuge` a partir de `outraParte` (rg, profissao, nacionalidade).
 * Não sobrescreve campo já preenchido em conjuge (preferência ao que o
 * usuário/OCR preencheu primeiro).
 */

import { isMarried } from "@/lib/forms/estado-civil";

type Parte = Record<string, unknown> & {
  tipo_pessoa?: string;
  cpf?: string;
  nome?: string;
  estado_civil?: string;
  conjuge?: Record<string, unknown> & {
    cpf?: string;
    nome?: string;
    rg?: string;
    profissao?: string;
    nacionalidade?: string;
  };
};

function onlyDigits(s: unknown): string {
  return typeof s === "string" ? s.replace(/\D/g, "") : "";
}

function sanitizeCpf(s: unknown): string | null {
  const d = onlyDigits(s);
  return d.length === 11 ? d : null;
}

function normalizeNome(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().toLowerCase();
  if (t.length < 2) return null;
  return t.replace(/\s+/g, " ");
}


function fillEmpty<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    const tv = target[k];
    const sv = source[k];
    if ((tv === undefined || tv === null || tv === "") && sv !== undefined && sv !== null && sv !== "") {
      (target as Record<string, unknown>)[k] = sv;
    }
  }
}

function dedupList(list: Parte[] | undefined): Parte[] | undefined {
  if (!Array.isArray(list) || list.length < 2) return list;

  // Mapeia índices a remover (uma parte pode ser cônjuge de outra; só
  // marcamos o sub-objeto duplicado, não a parte primária).
  const toRemove = new Set<number>();

  for (let i = 0; i < list.length; i++) {
    if (toRemove.has(i)) continue;
    const a = list[i] as Parte;
    if (a?.tipo_pessoa !== "fisica") continue;
    if (!isMarried(a.estado_civil)) continue;
    const conjuge = a.conjuge ?? {};
    const conjugeCpf = sanitizeCpf(conjuge.cpf);
    const conjugeNome = normalizeNome(conjuge.nome);

    for (let j = 0; j < list.length; j++) {
      if (j === i) continue;
      if (toRemove.has(j)) continue;
      const b = list[j] as Parte;
      if (b?.tipo_pessoa !== "fisica") continue;
      const bCpf = sanitizeCpf(b.cpf);
      const bNome = normalizeNome(b.nome);

      const cpfMatch = conjugeCpf && bCpf && conjugeCpf === bCpf;
      const nomeMatch =
        !conjugeCpf && !bCpf && conjugeNome && bNome && conjugeNome === bNome;

      if (cpfMatch || nomeMatch) {
        // Preenche campos vazios do conjuge de A com dados de B (titular).
        // Lista expandida em 2026-05-06 pra cobrir nome_mae, data_nascimento,
        // naturalidade, email e endereço completo — usados por certidões PF e
        // pelo helper getEnderecoEfetivo quando o cônjuge tem endereço próprio.
        const merged = { ...(conjuge as Record<string, unknown>) };
        fillEmpty(merged, b as Record<string, unknown>, [
          "nome",
          "cpf",
          "rg",
          "profissao",
          "nacionalidade",
          "data_nascimento",
          "nome_mae",
          "naturalidade",
          "email",
          "endereco",
          "numero",
          "complemento",
          "bairro",
          "cidade",
          "uf",
          "cep",
        ]);
        a.conjuge = merged as Parte["conjuge"];
        toRemove.add(j);
      }
    }
  }

  if (toRemove.size === 0) return list;
  return list.filter((_, i) => !toRemove.has(i));
}

/**
 * Aplica dedup em vendedores[] e compradores[] do dataJson.
 * Retorna cópia rasa modificada — não muta o input.
 */
export function dedupConjuges(
  dataJson: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...dataJson };
  const vendedores = dataJson.vendedores as Parte[] | undefined;
  const compradores = dataJson.compradores as Parte[] | undefined;

  const newVendedores = dedupList(
    vendedores ? vendedores.map((p) => ({ ...p, conjuge: p.conjuge ? { ...p.conjuge } : p.conjuge })) : undefined
  );
  const newCompradores = dedupList(
    compradores ? compradores.map((p) => ({ ...p, conjuge: p.conjuge ? { ...p.conjuge } : p.conjuge })) : undefined
  );

  if (newVendedores) out.vendedores = newVendedores;
  if (newCompradores) out.compradores = newCompradores;
  return out;
}
