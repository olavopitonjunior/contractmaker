import type { ParticipantRole } from "./participant-token";

/**
 * Visibilidade de seções (etapas do wizard) por link de parte, configurável
 * por org em `OrgFormSettings.participantVisibilityJson` — namespaced por
 * esteira, como o `contractDefaultsJson`:
 *
 *   { venda: { comprador: [0,2,5] }, locacao: { locador: [0,1,3,4] } }
 *
 * Client-safe: só tipos, catálogo e funções puras — o load da row fica em
 * `participant-scope.ts`.
 *
 * SEGURANÇA — duas allowlists em código que NENHUMA config atravessa:
 *   1. `GRANTABLE_STEPS`: etapas que PODEM ser dadas a um subtoken. A etapa 6
 *      (Comissão — nas duas esteiras) fica fora: comissão/testemunhas/config
 *      são do token principal, sempre.
 *   2. Os data-paths derivam DAS ETAPAS via `STEP_PATHS` — a config nunca
 *      nomeia paths diretamente, então `comissao`/`fiscal`/`testemunhas`/
 *      `assinatura`/`config` são inalcançáveis por construção.
 */

export type FormEsteira = "venda" | "locacao";

/** Papéis nativos por esteira — a esteira é inferível do próprio papel. */
export const ROLE_ESTEIRA: Record<ParticipantRole, FormEsteira> = {
  vendedor: "venda",
  comprador: "venda",
  locador: "locacao",
  locatario: "locacao",
  fiador: "locacao",
};

/**
 * Etapas que uma org PODE habilitar num subtoken, com os data-paths que cada
 * uma carrega (chaves top-level do dataJson editadas pela etapa). A etapa 0
 * (Documentos) é sempre incluída e não carrega path — o upload é escopado por
 * participantId/assignment-scope, não por dataJson.
 */
export const STEP_PATHS: Record<FormEsteira, Record<number, readonly string[]>> = {
  venda: {
    0: [],
    1: ["vendedores"],
    2: ["compradores"],
    3: ["imoveis"],
    // Posse/Propriedade (Status e Débitos) — TODAS as chaves top-level que o
    // StatusDebitosStep escreve (canário em participant-visibility.test.ts:
    // chave fora daqui é descartada em silêncio pelo pathScope do auto-save).
    4: [
      "status_propriedade",
      "saldo_devedor",
      "tem_debitos",
      "debitos",
      "ocupacao",
      "locacao",
      "entrega_posse",
      "vicios",
      "debitos_assumidos",
      "regularizacoes",
      "titulo_definitivo",
    ],
    5: ["modalidade", "pagamento", "incluso_no_preco"],
  },
  // ATENÇÃO: esta tabela e `DEFAULT_ROLE_STEPS` se referenciam por ÍNDICE e
  // precisam ser trocadas JUNTAS. Como os data-paths de um subtoken derivam das
  // etapas, trocar só uma das duas dá ao link público de um papel escopo de
  // ESCRITA sobre os dados do outro — em toda org que nunca configurou
  // visibilidade, que é a maioria (a coluna é nullable e só persiste o que
  // diverge do default). O `pathScope` do auto-save aceitaria o path errado em
  // silêncio. O teste correspondente afirma o par papel→data-path, nunca o
  // número da etapa: asserção por índice passa com a tabela trocada.
  locacao: {
    0: [],
    // Locatário à frente do locador desde 2026-09-03 (LOCACAO_STEP_LABELS).
    1: ["locatarios"],
    2: ["locadores"],
    3: ["imovel"],
    4: ["aluguel"],
    // `observacoes` acompanha a etapa (o card "Observações Gerais" vive nela);
    // `config` (cláusula rescisória) fica FORA de propósito — o GarantiaStep
    // esconde o card de rescisória quando o pathScope não inclui `config`.
    5: ["garantia", "observacoes"],
  },
};

/** Etapas habilitáveis por esteira (as chaves de STEP_PATHS). */
export function grantableSteps(esteira: FormEsteira): number[] {
  return Object.keys(STEP_PATHS[esteira])
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Defaults quando a org não configurou (pedido de produto 2026-08-18):
 * comprador ganhou Pagamento; locador ganhou Aluguel e Reajuste; locatário
 * ganhou Garantia. Vendedor e fiador mantêm o histórico.
 */
export const DEFAULT_ROLE_STEPS: Record<ParticipantRole, readonly number[]> = {
  vendedor: [0, 1, 3],
  comprador: [0, 2, 5],
  // Locação: locatário é a etapa 1 e locador a 2 desde 2026-09-03. Trocado
  // JUNTO com `STEP_PATHS.locacao` — ver o aviso lá. O locador continua vendo
  // imóvel (3) e aluguel (4); o locatário, a garantia (5).
  locador: [0, 2, 3, 4],
  locatario: [0, 1, 5],
  fiador: [0, 5],
};

export type ParticipantVisibilityConfig = Partial<
  Record<FormEsteira, Partial<Record<string, readonly number[]>>>
>;

/**
 * Sanitiza o Json cru da row: só papéis nativos da esteira certa, só etapas
 * habilitáveis, sempre com a etapa 0, sem duplicatas, ordenado. Qualquer coisa
 * fora disso é descartada em silêncio — a config é preferência de UX, nunca
 * porta pra escopo extra (as allowlists acima são o teto).
 */
export function parseParticipantVisibilityJson(
  raw: unknown
): ParticipantVisibilityConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: ParticipantVisibilityConfig = {};
  for (const esteira of ["venda", "locacao"] as const) {
    const branch = (raw as Record<string, unknown>)[esteira];
    if (typeof branch !== "object" || branch === null || Array.isArray(branch)) continue;
    const allowed = new Set(grantableSteps(esteira));
    const roles: Partial<Record<string, readonly number[]>> = {};
    for (const [role, steps] of Object.entries(branch as Record<string, unknown>)) {
      if (ROLE_ESTEIRA[role as ParticipantRole] !== esteira) continue;
      if (!Array.isArray(steps)) continue;
      const clean = Array.from(
        new Set(
          steps
            .map(Number)
            .filter((s) => Number.isInteger(s) && allowed.has(s))
        )
      ).sort((a, b) => a - b);
      if (!clean.includes(0)) clean.unshift(0);
      roles[role] = clean;
    }
    if (Object.keys(roles).length > 0) out[esteira] = roles;
  }
  return out;
}

export interface RoleVisibility {
  stepIndexes: readonly number[];
  paths: readonly string[];
}

/**
 * Etapas + data-paths efetivos de um papel NATIVO, dada a config (já
 * sanitizada) da org. Papel desconhecido → vazio (falha fechada — terceiro é
 * resolvido fora, em participant-scope).
 */
export function resolveRoleVisibility(
  role: string,
  config: ParticipantVisibilityConfig
): RoleVisibility {
  const esteira = ROLE_ESTEIRA[role as ParticipantRole];
  if (!esteira) return { stepIndexes: [], paths: [] };
  const stepIndexes =
    config[esteira]?.[role] ?? DEFAULT_ROLE_STEPS[role as ParticipantRole];
  const paths: string[] = [];
  for (const step of stepIndexes) {
    for (const p of STEP_PATHS[esteira][step] ?? []) {
      if (!paths.includes(p)) paths.push(p);
    }
  }
  return { stepIndexes, paths };
}
