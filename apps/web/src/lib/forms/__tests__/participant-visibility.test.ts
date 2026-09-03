import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  DEFAULT_ROLE_STEPS,
  grantableSteps,
  parseParticipantVisibilityJson,
  resolveRoleVisibility,
  STEP_PATHS,
} from "../participant-visibility";
import { resolveParticipantScope } from "../participant-scope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

describe("parseParticipantVisibilityJson — sanitização", () => {
  it("lixo estrutural vira config vazia", () => {
    expect(parseParticipantVisibilityJson(null)).toEqual({});
    expect(parseParticipantVisibilityJson("x")).toEqual({});
    expect(parseParticipantVisibilityJson([1, 2])).toEqual({});
    expect(parseParticipantVisibilityJson({ venda: "nope" })).toEqual({});
  });

  it("GUARD-RAIL: etapa 6 (Comissão) é descartada mesmo que a config peça", () => {
    const cfg = parseParticipantVisibilityJson({
      venda: { comprador: [0, 2, 6] },
      locacao: { locatario: [0, 2, 6, 99] },
    });
    expect(cfg.venda?.comprador).toEqual([0, 2]);
    expect(cfg.locacao?.locatario).toEqual([0, 2]);
  });

  it("papel da esteira errada é descartado", () => {
    const cfg = parseParticipantVisibilityJson({
      venda: { locatario: [0, 2], comprador: [0, 2] },
    });
    expect(cfg.venda?.locatario).toBeUndefined();
    expect(cfg.venda?.comprador).toEqual([0, 2]);
  });

  it("etapa 0 (Documentos) é sempre garantida e o array sai ordenado/único", () => {
    const cfg = parseParticipantVisibilityJson({
      locacao: { locador: [4, 1, 4, 3] },
    });
    expect(cfg.locacao?.locador).toEqual([0, 1, 3, 4]);
  });
});

describe("resolveRoleVisibility", () => {
  it("defaults 2026-08: comprador ganha Pagamento; locador Aluguel; locatário Garantia", () => {
    expect(DEFAULT_ROLE_STEPS.comprador).toEqual([0, 2, 5]);
    expect(resolveRoleVisibility("comprador", {}).paths).toContain("pagamento");
    expect(resolveRoleVisibility("locador", {}).paths).toContain("aluguel");
    expect(resolveRoleVisibility("locatario", {}).paths).toContain("garantia");
    expect(resolveRoleVisibility("fiador", {}).stepIndexes).toEqual([0, 5]);
  });

  it("config da org restringe (comprador de volta ao histórico [0,2])", () => {
    const cfg = parseParticipantVisibilityJson({ venda: { comprador: [0, 2] } });
    const v = resolveRoleVisibility("comprador", cfg);
    expect(v.stepIndexes).toEqual([0, 2]);
    expect(v.paths).toEqual(["compradores"]);
  });

  it("GUARD-RAIL: nenhuma combinação produz comissao/fiscal/testemunhas/assinatura/config", () => {
    for (const esteira of ["venda", "locacao"] as const) {
      const roles =
        esteira === "venda" ? ["vendedor", "comprador"] : ["locador", "locatario", "fiador"];
      for (const role of roles) {
        const all = grantableSteps(esteira);
        const cfg = parseParticipantVisibilityJson({ [esteira]: { [role]: all } });
        const { paths } = resolveRoleVisibility(role, cfg);
        for (const banned of ["comissao", "fiscal", "testemunhas", "assinatura", "config"]) {
          expect(paths).not.toContain(banned);
        }
      }
    }
  });

  it("papel desconhecido → vazio (falha fechada)", () => {
    expect(resolveRoleVisibility("hacker", {})).toEqual({ stepIndexes: [], paths: [] });
  });
});

describe("resolveParticipantScope — config por org", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    p.orgFormSettings.findUnique = vi.fn().mockResolvedValue(null);
    p.formParticipantCategory = {
      findUnique: vi.fn().mockResolvedValue(null),
    };
  });

  it("sem row usa os defaults", async () => {
    const scope = await resolveParticipantScope("locatario", "org-1");
    // 2026-09-03: locatário é a etapa 1 (era 2). O que importa é o par
    // papel→dado — ver o bloco "escopo de escrita por papel" abaixo.
    expect(scope.stepIndexes).toEqual([0, 1, 5]);
    expect(scope.topKeys).toContain("garantia");
    expect(scope.nested).toBe(false);
  });

  it("row com config aplica o subset da org", async () => {
    p.orgFormSettings.findUnique.mockResolvedValueOnce({
      participantVisibilityJson: { locacao: { locatario: [0, 1] } },
    });
    const scope = await resolveParticipantScope("locatario", "org-1");
    expect(scope.stepIndexes).toEqual([0, 1]);
    expect(scope.topKeys).toEqual(["locatarios"]);
  });

  it("config maliciosa no banco não fura o guard-rail", async () => {
    p.orgFormSettings.findUnique.mockResolvedValueOnce({
      participantVisibilityJson: { locacao: { locatario: [0, 6, 99] } },
    });
    const scope = await resolveParticipantScope("locatario", "org-1");
    expect(scope.stepIndexes).toEqual([0]);
    expect(scope.topKeys).not.toContain("comissao");
  });

  it("terceiro mantém o caminho antigo (path aninhado, sem wizard)", async () => {
    const scope = await resolveParticipantScope("terceiro:despachante", "org-1");
    expect(scope.stepIndexes).toEqual([]);
    expect(scope.paths).toEqual(["terceiros.despachante"]);
    expect(scope.nested).toBe(true);
  });
});

describe("STEP_PATHS — canário de deriva do catálogo", () => {
  // Chave que um step component escreve e NÃO está aqui é descartada em
  // silêncio pelo pathScope do auto-save (sem erro, sem audit). Se um step
  // ganhar campo top-level novo, este teste é o lembrete de atualizar o
  // catálogo (achado do review 2026-08-18: 4 chaves do StatusDebitosStep e
  // `observacoes` da etapa Garantia estavam fora).
  it("venda etapa 4 cobre todas as chaves do StatusDebitosStep", () => {
    for (const key of [
      "status_propriedade", "saldo_devedor", "tem_debitos", "debitos",
      "ocupacao", "locacao", "entrega_posse",
      "vicios", "debitos_assumidos", "regularizacoes", "titulo_definitivo",
    ]) {
      expect(STEP_PATHS.venda[4]).toContain(key);
    }
  });

  it("venda etapa 5 cobre as chaves do PagamentoStep", () => {
    for (const key of ["modalidade", "pagamento", "incluso_no_preco"]) {
      expect(STEP_PATHS.venda[5]).toContain(key);
    }
  });

  it("locação etapa 5 cobre garantia + observacoes; config fica fora por design", () => {
    expect(STEP_PATHS.locacao[5]).toContain("garantia");
    expect(STEP_PATHS.locacao[5]).toContain("observacoes");
    expect(STEP_PATHS.locacao[5]).not.toContain("config");
  });
});

// ---------------------------------------------------------------------------
// Escopo de ESCRITA por papel — a asserção que sobrevive a uma renumeração.
//
// `STEP_PATHS` e `DEFAULT_ROLE_STEPS` se referenciam por ÍNDICE. Trocar uma sem
// a outra dá ao link público de um papel escopo de escrita sobre os dados do
// outro, em toda org que nunca configurou visibilidade (a coluna é nullable e
// só persiste o que diverge do default) — sem erro e sem log, porque o
// `pathScope` do auto-save apenas aceita o path errado.
//
// Por isso estes testes afirmam o par papel→DATA-PATH e nunca o número da
// etapa: `expect(DEFAULT_ROLE_STEPS.locador).toEqual([0, 2, 3, 4])` passaria
// com as duas tabelas trocadas, que é exatamente o bug que não pode passar.
// ---------------------------------------------------------------------------
describe("escopo de escrita por papel (invariante da renumeração)", () => {
  it("locador escreve os PRÓPRIOS dados, nunca os do locatário", () => {
    const paths = resolveRoleVisibility("locador", {}).paths;
    expect(paths).toContain("locadores");
    expect(paths).not.toContain("locatarios");
  });

  it("locatário escreve os PRÓPRIOS dados, nunca os do locador", () => {
    const paths = resolveRoleVisibility("locatario", {}).paths;
    expect(paths).toContain("locatarios");
    expect(paths).not.toContain("locadores");
  });

  it("fiador não escreve dados de nenhuma das duas partes", () => {
    const paths = resolveRoleVisibility("fiador", {}).paths;
    expect(paths).not.toContain("locadores");
    expect(paths).not.toContain("locatarios");
  });

  it("vendedor e comprador seguem separados (venda não foi renumerada)", () => {
    const v = resolveRoleVisibility("vendedor", {}).paths;
    const c = resolveRoleVisibility("comprador", {}).paths;
    expect(v).toContain("vendedores");
    expect(v).not.toContain("compradores");
    expect(c).toContain("compradores");
    expect(c).not.toContain("vendedores");
  });

  it("nenhum papel de locação recebe a etapa da Comissão", () => {
    for (const papel of ["locador", "locatario", "fiador"] as const) {
      expect(resolveRoleVisibility(papel, {}).paths).not.toContain("comissao");
    }
  });

  // Controle anti-vacuidade: se `resolveRoleVisibility` passasse a devolver
  // sempre [], todo `not.toContain` acima ficaria verde sem provar nada.
  it("CONTROLE: os papéis de locação devolvem escopo não-vazio", () => {
    for (const papel of ["locador", "locatario", "fiador"] as const) {
      expect(resolveRoleVisibility(papel, {}).paths.length).toBeGreaterThan(0);
    }
  });
});

describe("ordem das etapas de locação (2026-09-03)", () => {
  it("a etapa 1 é a do locatário e a 2 a do locador", () => {
    expect(STEP_PATHS.locacao[1]).toEqual(["locatarios"]);
    expect(STEP_PATHS.locacao[2]).toEqual(["locadores"]);
  });

  it("as duas tabelas concordam: o papel vê a etapa que carrega o dado dele", () => {
    // Deriva o índice a partir de STEP_PATHS em vez de escrevê-lo à mão — é o
    // que impede este teste de virar cópia da tabela que ele deveria checar.
    const etapaDe = (topKey: string): number =>
      Number(
        Object.entries(STEP_PATHS.locacao).find(([, keys]) =>
          keys.includes(topKey),
        )?.[0],
      );
    expect(DEFAULT_ROLE_STEPS.locador).toContain(etapaDe("locadores"));
    expect(DEFAULT_ROLE_STEPS.locador).not.toContain(etapaDe("locatarios"));
    expect(DEFAULT_ROLE_STEPS.locatario).toContain(etapaDe("locatarios"));
    expect(DEFAULT_ROLE_STEPS.locatario).not.toContain(etapaDe("locadores"));
  });
});
