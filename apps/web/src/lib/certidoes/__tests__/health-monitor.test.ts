import { describe, it, expect } from "vitest";
import {
  classifyJobBucket,
  buildHealthReport,
  missingFieldHint,
  type HealthJobLike,
} from "../health-monitor";

const job = (over: Partial<HealthJobLike> = {}): HealthJobLike => ({
  status: "success",
  resultCode: 200,
  errorMessage: null,
  resultData: null,
  retryCount: 0,
  ...over,
});

describe("classifyJobBucket", () => {
  it("success/informativo/skipped/replaced → ok", () => {
    for (const s of ["success", "informativo", "skipped", "replaced"]) {
      expect(classifyJobBucket(job({ status: s }))).toBe("ok");
    }
  });

  it("transitórios em voo → em_voo (poll-portal cuida)", () => {
    for (const s of ["pending", "fetching", "api_error", "portal_unavailable", "rate_limited", "awaiting_portal"]) {
      expect(classifyJobBucket(job({ status: s }))).toBe("em_voo");
    }
  });

  it("data_missing/data_invalid → dado_faltante", () => {
    expect(classifyJobBucket(job({ status: "data_missing", resultCode: 608 }))).toBe("dado_faltante");
    expect(classifyJobBucket(job({ status: "data_invalid", resultCode: 614 }))).toBe("dado_faltante");
  });

  it("failed por timeout/portal → failed_retryable (gap que poll-portal NÃO cobre)", () => {
    expect(
      classifyJobBucket(job({ status: "failed", resultCode: null, resultData: { failureCategory: "provider_timeout" } }))
    ).toBe("failed_retryable");
    expect(
      classifyJobBucket(job({ status: "failed", resultData: { failureCategory: "portal_unavailable" } }))
    ).toBe("failed_retryable");
  });

  it("failed por integration_error → codigo_suspeito", () => {
    expect(
      classifyJobBucket(job({ status: "failed", resultData: { failureCategory: "integration_error" } }))
    ).toBe("codigo_suspeito");
  });

  it("failed_permanent 603 sem saldo → credito; 603 não-habilitada → config_endpoint", () => {
    expect(
      classifyJobBucket(job({ status: "failed_permanent", resultCode: 603, errorMessage: "A conta está sem saldo." }))
    ).toBe("credito");
    expect(
      classifyJobBucket(
        job({
          status: "failed_permanent",
          resultCode: 603,
          errorMessage: "Consulta 'X' não habilitada para a sua conta. Acesse /habilitar/",
        })
      )
    ).toBe("config_endpoint");
  });

  it("failed_permanent com código de dado (606/608/612) → dado_faltante", () => {
    expect(
      classifyJobBucket(job({ status: "failed_permanent", resultCode: 606, errorMessage: "Parâmetros obrigatórios" }))
    ).toBe("dado_faltante");
  });

  it("failed_permanent 604 throttle esgotado → indisponivel (não vira credito)", () => {
    expect(
      classifyJobBucket(
        job({
          status: "failed_permanent",
          resultCode: 604,
          errorMessage: "Não é possível utilizar o mesmo email múltiplas vezes num intervalo curto.",
        })
      )
    ).toBe("indisponivel");
  });
});

describe("missingFieldHint", () => {
  it("usa missingFields quando presente", () => {
    expect(missingFieldHint({ ...job(), missingFields: ["nome_mae", "data_nascimento"] })).toBe(
      "nome_mae, data_nascimento"
    );
  });
  it("infere da mensagem quando não há missingFields", () => {
    expect(missingFieldHint({ ...job(), errorMessage: "nome da mãe não confere" })).toBe("nome da mãe");
    expect(missingFieldHint({ ...job(), errorMessage: "genero deve ser M ou F" })).toBe("sexo");
  });
});

describe("buildHealthReport", () => {
  it("agrega contagens por bucket + acionáveis", () => {
    const jobs: HealthJobLike[] = [
      job({ status: "success" }),
      job({ status: "success" }),
      job({ status: "data_missing", resultCode: 608 }),
      job({ status: "failed", resultData: { failureCategory: "provider_timeout" } }),
      job({ status: "failed", resultData: { failureCategory: "integration_error" } }),
      job({ status: "rate_limited" }),
    ];
    const r = buildHealthReport(jobs);
    expect(r.total).toBe(6);
    expect(r.actionable).toEqual({ retryable: 1, dataMissing: 1, codeSuspect: 1 });
    const ok = r.byBucket.find((b) => b.bucket === "ok");
    expect(ok?.count).toBe(2);
  });
});
