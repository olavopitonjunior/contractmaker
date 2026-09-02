/**
 * Invariante que sustenta o teto de papel nas QUATRO rotas que concedem papel
 * (#452, #473, #474, #488) — e que nenhuma delas consegue defender sozinha.
 *
 * `MANAGER_CONFIGURABLE_PERMISSIONS` é a única lista pela qual um override de
 * ORG pode acrescentar permissão a um preset: `resolveTargetPermissions` mescla
 * `OrgManagerSettings.permissionsJson` filtrado por ela quando o alvo é
 * `gerente`. Se algum dia essa lista ganhar uma chave que o `admin` não tem,
 * então numa org que a ligasse o papel `gerente` passaria a exceder o `admin` —
 * e o teto, funcionando exatamente como projetado, começaria a devolver 403
 * para um admin trocando o papel de alguém para gerente, na tela de membros.
 *
 * Além do subconjunto, o arquivo guarda mais duas condições da mesma lista —
 * a chave existe no catálogo e tem rótulo em português —, sugeridas pela sessão
 * que acrescentou `DEAL_CREATE` e `LEASE_CREATE` a ela. A do rótulo não é sobre
 * o teto: `/settings/gerentes` monta um checkbox por chave desta lista e pega o
 * texto em `PERMISSION_LABELS_PT`, então chave sem rótulo é caixa em branco na
 * tela do admin.
 *
 * Hoje o invariante do subconjunto vale por construção, e vale dizer por quê
 * para não superestimar esta parte: `adminAccess()` é `fullAccess()` — o catálogo
 * INTEIRO — menos sete chaves nomeadas. Permissão nova entra em `admin`
 * sozinha. O que o teste pega é o caso estreito e justamente o mais difícil de
 * enxergar: alguém pôr na lista do gerente uma das sete que o `admin` tem
 * negada explicitamente, ou uma chave fora do catálogo (literal digitado
 * errado), ou o dia em que `adminAccess()` deixar de derivar de `fullAccess()`.
 *
 * **Limite deste arquivo, e ele é mais estreito do que o nome sugere:** só o
 * papel `gerente` recebe o merge de `OrgManagerSettings.permissionsJson`. Isso
 * não está escrito como uma lista de "papéis configuráveis por org" — está como
 * `if (role === "gerente")` em `rbac/check.ts:42` e `if (targetRole ===
 * "gerente")` em `auth/invitations.ts:286`, dois `if` literais mantidos em
 * paralelo. Enquanto for assim, cobrir `MANAGER_CONFIGURABLE_PERMISSIONS` cobre
 * tudo o que um tenant consegue acrescentar a um preset. No dia em que alguém
 * quiser um SEGUNDO papel configurável por org, vai duplicar o `if` — e este
 * arquivo passa a defender metade do que defende hoje, sem ficar vermelho e sem
 * nada avisando. Quem fizer isso precisa voltar aqui.
 *
 * O acoplamento é invisível de onde o dano nasce: quem acrescenta a chave mexe
 * em `permissions.ts` e não passa perto de nenhuma rota de membros. Este é o
 * único lugar onde as duas pontas se encontram, e falha no PR de quem
 * acrescentar a chave, não no incidente do cliente.
 *
 * Como consertar quando ficar vermelho: dê a chave nova ao `adminAccess()` (o
 * caso normal — se o gerente pode, o admin também deveria poder), ou tire-a de
 * `MANAGER_CONFIGURABLE_PERMISSIONS`. Não relaxe o teto.
 */
import { describe, it, expect } from "vitest";
import {
  ALL_PERMISSIONS,
  MANAGER_CONFIGURABLE_PERMISSIONS,
  PERMISSION_LABELS_PT,
} from "@/lib/security/rbac/permissions";
import { ROLE_PRESETS } from "@/lib/security/rbac/roles";

describe("teto de papel × overrides de gerente", () => {
  it("toda chave configurável do gerente existe em owner E em admin", () => {
    const owner = ROLE_PRESETS.owner as Record<string, boolean>;
    const admin = ROLE_PRESETS.admin as Record<string, boolean>;

    const foraDoOwner = MANAGER_CONFIGURABLE_PERMISSIONS.filter(
      (k) => owner[k] !== true
    );
    const foraDoAdmin = MANAGER_CONFIGURABLE_PERMISSIONS.filter(
      (k) => admin[k] !== true
    );

    expect(foraDoOwner).toEqual([]);
    expect(foraDoAdmin).toEqual([]);
  });

  /**
   * Separado do teste acima de propósito, e a razão é a mensagem de erro, não a
   * cobertura: um literal digitado errado (`"deal.craete"`) já derruba a
   * asserção de cima, porque `admin[k]` vira `undefined` — mas dizendo "o admin
   * não tem essa chave", que manda a pessoa mexer em `adminAccess()` para
   * consertar um erro de digitação. Aqui a falha diz o que de fato aconteceu.
   */
  it("toda chave configurável existe no catálogo de permissões", () => {
    const foraDoCatalogo = MANAGER_CONFIGURABLE_PERMISSIONS.filter(
      (k) => !(ALL_PERMISSIONS as string[]).includes(k)
    );

    expect(foraDoCatalogo).toEqual([]);
  });

  /**
   * Quebra de UI que nenhum teste de RBAC pega: `/settings/gerentes` renderiza
   * um checkbox por chave desta lista e busca o texto em `PERMISSION_LABELS_PT`.
   * Chave sem rótulo vira caixa em branco — o admin vê algo para ligar e não
   * tem como saber o que é. Chegou perto de acontecer no #508.
   */
  it("toda chave configurável tem rótulo em português", () => {
    const semRotulo = MANAGER_CONFIGURABLE_PERMISSIONS.filter(
      (k) => !PERMISSION_LABELS_PT[k]
    );

    expect(semRotulo).toEqual([]);
  });

  // Controle: sem esta asserção, esvaziar `MANAGER_CONFIGURABLE_PERMISSIONS`
  // faria TODOS os `toEqual([])` acima passarem VACUAMENTE, e o arquivo
  // continuaria verde defendendo coisa nenhuma.
  it("a lista não está vazia — senão os testes acima passam por vacuidade", () => {
    expect(MANAGER_CONFIGURABLE_PERMISSIONS.length).toBeGreaterThan(0);
  });
});
