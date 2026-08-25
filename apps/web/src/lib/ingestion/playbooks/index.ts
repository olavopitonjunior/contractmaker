/**
 * Registro dos playbooks e a resolução família ← modalidade.
 *
 * O planner recebe o lote INTEIRO, que pode misturar famílias (uma imobiliária
 * manda contrato de locação, CCV e o contrato de administração no mesmo lote).
 * Por isso a resolução devolve uma LISTA: o prompt leva os playbooks de todas
 * as famílias presentes, e só delas — mandar o playbook de venda num lote só de
 * locação gastaria contexto e ofereceria vocabulário que não deveria ser usado.
 */

import { ADMINISTRACAO_LOCACAO_MODALIDADE } from "@/lib/contracts/template-category";
import { ADMINISTRACAO_PLAYBOOK } from "./administracao";
import { LOCACAO_PLAYBOOK } from "./locacao";
import { PROPOSTA_PLAYBOOK } from "./proposta";
import { VENDA_PLAYBOOK } from "./venda";
import { PLAYBOOK_FAMILIES, type IngestionPlaybook, type PlaybookFamily } from "./types";

export { PLAYBOOK_FAMILIES } from "./types";
export type { IngestionPlaybook, PlaybookFamily } from "./types";
export { ADMINISTRACAO_PLAYBOOK, LOCACAO_PLAYBOOK, PROPOSTA_PLAYBOOK, VENDA_PLAYBOOK };

export const PLAYBOOKS: Readonly<Record<PlaybookFamily, IngestionPlaybook>> = {
  locacao: LOCACAO_PLAYBOOK,
  venda: VENDA_PLAYBOOK,
  administracao: ADMINISTRACAO_PLAYBOOK,
  proposta: PROPOSTA_PLAYBOOK,
};

/**
 * Família do playbook a partir da modalidade canônica.
 *
 * `administracao_locacao` é testado ANTES do prefixo "locacao" de propósito: o
 * nome dele não começa com "locacao" justamente para ficar fora daquele
 * fallback (ver `template-category.ts`), mas deixar a ordem implícita aqui
 * transformaria uma renomeação futura num bug silencioso.
 */
export function playbookFamilyForModalidade(
  modalidade: string | null | undefined
): PlaybookFamily | null {
  const m = (modalidade ?? "").trim();
  if (!m) return null;
  if (m === ADMINISTRACAO_LOCACAO_MODALIDADE) return "administracao";
  if (m.startsWith("proposta_")) return "proposta";
  for (const family of PLAYBOOK_FAMILIES) {
    if (PLAYBOOKS[family].modalidades.includes(m)) return family;
  }
  return null;
}

export function playbookFor(family: PlaybookFamily): IngestionPlaybook {
  return PLAYBOOKS[family];
}

/**
 * Playbooks das famílias presentes no lote, na ordem canônica (estável entre
 * runs — o prefixo do prompt é cacheado e ordem instável o invalidaria).
 * Lote sem modalidade reconhecida recebe TODOS: sem playbook o modelo não tem
 * regra nenhuma, que é pior que ter regra demais.
 */
export function playbooksForModalidades(
  modalidades: ReadonlyArray<string | null | undefined>
): IngestionPlaybook[] {
  const families = new Set<PlaybookFamily>();
  for (const m of modalidades) {
    const family = playbookFamilyForModalidade(m);
    if (family) families.add(family);
  }
  const chosen = families.size > 0 ? families : new Set(PLAYBOOK_FAMILIES);
  return PLAYBOOK_FAMILIES.filter((f) => chosen.has(f)).map((f) => PLAYBOOKS[f]);
}
