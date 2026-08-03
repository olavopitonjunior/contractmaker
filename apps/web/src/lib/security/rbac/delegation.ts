import { PermissionMap } from "./permissions";
import { EffectivePermissions } from "./check";

/**
 * Trava de escalada na delegação Bearer (`X-Act-As-User`).
 *
 * A validação anterior parava em "o alvo é membro da org do dono do token", o
 * que responde ONDE a delegação vale, e não QUEM ela pode virar. Com o escopo
 * `users:delegate`, um token de serviço podia apontar para o `owner` do tenant
 * e agir com o poder dele — e o token de serviço existe justamente para ter
 * MENOS poder que gente.
 *
 * **Por que contenção de permissões e não uma tabela de ranking.** Os papéis do
 * repo não formam uma ordem total: `gestor_locacao`, `finance` e `gerente` são
 * laterais entre si, e `custom` é definido por org. Qualquer número que eu
 * atribuísse a eles seria invenção minha, e a primeira dúvida real ("gestor de
 * locação é acima ou abaixo do financeiro?") não tem resposta certa. Contenção
 * não precisa dessa resposta: a pergunta vira "o alvo pode alguma coisa que o
 * dono do token não pode?", que é decidível olhando os dois mapas.
 *
 * O que isto NÃO cobre, e é bom estar escrito: `scopeRestrictions` (por
 * exemplo, gerente que só vê os próprios deals) não aparece no `PermissionMap`.
 * Dois usuários com o mesmo preset e escopos diferentes passam nesta trava —
 * a delegação continua limitada ao que a rota checar depois. Isto fecha a
 * escalada de PAPEL, não a de escopo.
 */

export type DelegationVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; escalatedPermissions: string[] };

/**
 * Permissões que o alvo tem e o dono do token não. Vazio = sem escalada.
 *
 * Só `=== true` conta como ter: `false` e ausente são a mesma coisa no
 * `PermissionMap`, e tratá-los diferente inventaria escalada onde não há.
 */
function excedentes(alvo: PermissionMap, dono: PermissionMap): string[] {
  return Object.keys(alvo).filter(
    (k) => alvo[k as keyof PermissionMap] === true && dono[k as keyof PermissionMap] !== true
  );
}

/**
 * @param tokenOwner permissões efetivas do DONO do token, na org validada
 * @param target permissões efetivas do alvo da delegação, na MESMA org
 */
export function checkDelegationTarget(
  tokenOwner: EffectivePermissions | null,
  target: EffectivePermissions | null
): DelegationVerdict {
  // Fail-closed nos dois lados. Sem membership não há permissão a comparar, e
  // deixar passar aqui seria pior que um 403: delegaria sem nenhuma checagem.
  if (!tokenOwner) {
    return {
      allowed: false,
      reason: "token owner has no effective permissions in org",
      escalatedPermissions: [],
    };
  }
  if (!target) {
    return {
      allowed: false,
      reason: "delegate target has no effective permissions in org",
      escalatedPermissions: [],
    };
  }

  // `owner` é o único papel tratado por nome, e de propósito: ele carrega
  // bypasses que não estão no mapa de permissões (transferência de propriedade,
  // por exemplo). Comparar mapas não o pegaria.
  if (target.role === "owner" && tokenOwner.role !== "owner") {
    return {
      allowed: false,
      reason: "cannot delegate to org owner",
      escalatedPermissions: ["<owner bypass>"],
    };
  }

  const escalated = excedentes(target.permissions, tokenOwner.permissions);
  if (escalated.length > 0) {
    return {
      allowed: false,
      reason: "delegate target has permissions the token owner lacks",
      // Truncado: a lista inteira pode ter dezenas de chaves e vai para o
      // audit; o que interessa é identificar a classe da escalada.
      escalatedPermissions: escalated.slice(0, 10),
    };
  }

  return { allowed: true };
}
