import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * O que importa aqui é o que o script `scripts/verify-ocr.sh` afirma:
 * a rota nega sem secret, devolve o modelo EFETIVO (não o default do código),
 * e marca presença de chave sem nunca devolver o valor dela.
 */

const groupBy = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: { aIUsage: { groupBy: (...a: unknown[]) => groupBy(...a) } },
}));

const ORIG = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  groupBy.mockReset();
  groupBy.mockResolvedValue([]);
  process.env.CRON_SECRET = "segredo-de-teste";
  delete process.env.GEMINI_OCR_MODEL;
  delete process.env.OCR_STRUCTURED_OUTPUT;
  delete process.env.OCR_SHADOW_MODEL;
  delete process.env.OPENAI_API_KEY;
  process.env.GEMINI_API_KEY = "chave-gemini-de-teste";
});

afterEach(() => {
  process.env = { ...ORIG };
});

const chamar = async (headers: Record<string, string> = {}) => {
  const { GET } = await import("../ocr-verify/route");
  return GET(new Request("https://exemplo.test/api/admin/ocr-verify", { headers }));
};

describe("GET /api/admin/ocr-verify", () => {
  it("401 sem header — é isso que prova ao script que a rota EXISTE no build", async () => {
    const res = await chamar();
    expect(res.status).toBe(401);
  });

  it("401 com secret errado", async () => {
    const res = await chamar({ authorization: "Bearer errado" });
    expect(res.status).toBe(401);
  });

  it("503 quando CRON_SECRET não está no ambiente — fail-closed, nunca aberto", async () => {
    delete process.env.CRON_SECRET;
    const res = await chamar({ authorization: "Bearer qualquer" });
    expect(res.status).toBe(503);
  });

  it("devolve o modelo da env, não o default do código", async () => {
    process.env.GEMINI_OCR_MODEL = "gemini-3.5-flash-lite";
    process.env.OCR_STRUCTURED_OUTPUT = "true";
    process.env.OCR_SHADOW_MODEL = "gemini-2.5-flash";

    const res = await chamar({ authorization: "Bearer segredo-de-teste" });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ocr.effectiveModel).toBe("gemini-3.5-flash-lite");
    expect(body.ocr.structuredOutput).toBe(true);
    expect(body.ocr.shadowModel).toBe("gemini-2.5-flash");
    expect(body.ocr.provider).toBe("gemini");
  });

  it("sem env nenhuma, reporta o default e o shadow desligado", async () => {
    const res = await chamar({ authorization: "Bearer segredo-de-teste" });
    const body = await res.json();
    expect(body.ocr.effectiveModel).toBe("gemini-2.5-flash");
    expect(body.ocr.structuredOutput).toBe(false);
    expect(body.ocr.shadowModel).toBeNull();
  });

  it("modelo gpt-* sem OPENAI_API_KEY: sinaliza o apagão que não cai em fallback", async () => {
    process.env.GEMINI_OCR_MODEL = "gpt-5.6-luna";
    const res = await chamar({ authorization: "Bearer segredo-de-teste" });
    const body = await res.json();
    expect(body.ocr.provider).toBe("openai");
    expect(body.ocr.providerKeyPresent).toBe(false);
  });

  it("nunca devolve o valor de chave nenhuma", async () => {
    process.env.OPENAI_API_KEY = "sk-valor-secreto-que-nao-pode-vazar";
    const res = await chamar({ authorization: "Bearer segredo-de-teste" });
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain("sk-valor-secreto-que-nao-pode-vazar");
    expect(texto).not.toContain("chave-gemini-de-teste");
    expect(texto).not.toContain("segredo-de-teste");
  });

  it("banco fora não derruba a verificação de config", async () => {
    const err = Object.assign(new Error("Can't reach database server"), { code: "P1001" });
    groupBy.mockRejectedValue(err);
    const res = await chamar({ authorization: "Bearer segredo-de-teste" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ocr.effectiveModel).toBeTruthy();
    expect(body.runtime.dbError).toBe("P1001");
  });

  /**
   * O teste de sigilo acima roda com o banco OK, então nunca exercita
   * `dbError` — que era o único campo de string não-controlada do payload.
   * `P1001` do Prisma é "Can't reach database server at ep-xxx…:5432", e erro
   * de datasource pode ecoar pedaço da connection string.
   */
  it("erro de banco não vaza host nem connection string", async () => {
    groupBy.mockRejectedValue(
      Object.assign(
        new Error(
          "Can't reach database server at ep-bitter-wildflower.neon.tech:5432 " +
            "(postgresql://usuario:senha-secreta@ep-bitter-wildflower.neon.tech/db)"
        ),
        { code: "P1001" }
      )
    );
    const res = await chamar({ authorization: "Bearer segredo-de-teste" });
    const texto = JSON.stringify(await res.json());

    expect(texto).not.toContain("senha-secreta");
    expect(texto).not.toContain("postgresql://");
    expect(texto).not.toContain("ep-bitter-wildflower");
    expect(texto).not.toContain("5432");
    expect(texto).toContain("P1001");
  });

  it("erro sem código Prisma vira 'unknown', não a mensagem", async () => {
    groupBy.mockRejectedValue(new Error("host interno-123.local recusou conexão"));
    const res = await chamar({ authorization: "Bearer segredo-de-teste" });
    const body = await res.json();
    expect(body.runtime.dbError).toBe("unknown");
    expect(JSON.stringify(body)).not.toContain("interno-123.local");
  });

  /**
   * `modelsSeen` é o campo que o passo V7 do `verify-ocr.sh` usa para afirmar
   * que a extração mais recente rodou no modelo esperado. Sem dado real aqui,
   * trocar `_count._all` por outra coisa, ou inverter o sort, passaria batido —
   * e o script continuaria "verde" olhando para a linha errada.
   */
  it("modelsSeen mapeia os campos do groupBy e ordena do mais recente pro mais antigo", async () => {
    groupBy.mockResolvedValue([
      {
        operation: "ocr_shadow",
        model: "gemini-2.5-flash",
        _count: { _all: 3 },
        _max: { createdAt: new Date("2026-08-25T10:00:00Z") },
      },
      {
        operation: "ocr_form",
        model: "gemini-3.5-flash-lite",
        _count: { _all: 7 },
        _max: { createdAt: new Date("2026-08-25T16:13:42Z") },
      },
    ]);

    const res = await chamar({ authorization: "Bearer segredo-de-teste" });
    const body = await res.json();
    const vistos = body.runtime.modelsSeen;

    // Mais recente primeiro — o script lê a PRIMEIRA linha `ocr_form`.
    expect(vistos[0].operation).toBe("ocr_form");
    expect(vistos[0].model).toBe("gemini-3.5-flash-lite");
    expect(vistos[0].calls).toBe(7);
    expect(vistos[0].lastAt).toBe("2026-08-25T16:13:42.000Z");
    expect(vistos[1].operation).toBe("ocr_shadow");
    expect(vistos[1].calls).toBe(3);
  });

  it("days inválido cai no default em vez de virar NaN", async () => {
    const { GET } = await import("../ocr-verify/route");
    const res = await GET(
      new Request("https://exemplo.test/api/admin/ocr-verify?days=abc", {
        headers: { authorization: "Bearer segredo-de-teste" },
      })
    );
    const body = await res.json();
    expect(body.runtime.windowDays).toBe(7);
  });

  it("days fora da faixa é limitado, não rejeitado", async () => {
    const { GET } = await import("../ocr-verify/route");
    const alto = await GET(
      new Request("https://exemplo.test/api/admin/ocr-verify?days=9999", {
        headers: { authorization: "Bearer segredo-de-teste" },
      })
    );
    expect((await alto.json()).runtime.windowDays).toBe(90);
  });

  it("OPS_VERIFY_SECRET vence CRON_SECRET quando os dois existem", async () => {
    process.env.OPS_VERIFY_SECRET = "secret-de-ops";
    const comOps = await chamar({ authorization: "Bearer secret-de-ops" });
    expect(comOps.status).toBe(200);
    // O de cron deixa de valer — é essa separação que tira a chave que move
    // dinheiro do shell de quem só verifica deploy.
    const comCron = await chamar({ authorization: "Bearer segredo-de-teste" });
    expect(comCron.status).toBe(401);
  });
});
