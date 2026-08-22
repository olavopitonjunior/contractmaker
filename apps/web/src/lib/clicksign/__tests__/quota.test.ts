import { describe, it, expect } from "vitest";
import { ClicksignError } from "../client";
import { EnvelopePlanLimitError, isPlanQuotaError } from "../quota";

/** Erro no formato JSON:API que a ClickSign devolve. */
function csError(status: number, errors?: Array<Record<string, string>>) {
  const body = errors ? { errors } : null;
  const msg = errors
    ? errors.map((e) => e.detail || e.title).filter(Boolean).join("; ")
    : `HTTP ${status}`;
  return new ClicksignError(`Clicksign: ${msg}`, status, body);
}

describe("isPlanQuotaError", () => {
  it("402 conta sozinho, sem depender do texto", () => {
    expect(isPlanQuotaError(csError(402))).toBe(true);
    expect(isPlanQuotaError(csError(402, [{ detail: "qualquer coisa" }]))).toBe(true);
  });

  // 403/422 exigem o VERBO ("acabou") E o OBJETO ("o quê").
  it("422/403 contam quando o texto traz esgotamento E o objeto certo", () => {
    expect(
      isPlanQuotaError(
        csError(422, [{ detail: "Limite de documentos do plano atingido" }])
      )
    ).toBe(true);
    expect(
      isPlanQuotaError(csError(403, [{ title: "Envelope quota exceeded" }]))
    ).toBe(true);
    expect(
      isPlanQuotaError(csError(422, [{ code: "insufficient_balance" }]))
    ).toBe(true);
  });

  // O ponto que não pode regredir: 422 é o status de validação comum da
  // ClickSign. Classificar 422 largo reintroduziria o bug — mandaria o corretor
  // conferir um plano intacto.
  it("422 de validação comum NÃO vira limite de plano", () => {
    expect(
      isPlanQuotaError(csError(422, [{ detail: "E-mail do signatário é inválido" }]))
    ).toBe(false);
    expect(isPlanQuotaError(csError(422))).toBe(false);
  });

  // Caso REAL do fluxo de envio: o passo de requirements pede `auth: selfie` e
  // a ClickSign recusa 422 porque o método não está habilitado na conta. Tem a
  // palavra "plano" e não é cota nenhuma — casar isso devolveria "sem envelopes
  // disponíveis" para um problema de configuração de método.
  it("método de auth indisponível 'no seu plano' NÃO vira limite de plano", () => {
    expect(
      isPlanQuotaError(
        csError(422, [
          { detail: "Autenticação por selfie não está disponível no seu plano" },
        ])
      )
    ).toBe(false);
  });

  // "excede o LIMITE de 90 dias" no deadline: tem o verbo, não tem o objeto.
  it("estouro de prazo do envelope NÃO vira limite de plano", () => {
    expect(
      isPlanQuotaError(
        csError(422, [{ detail: "deadline_at excede o limite de 90 dias" }])
      )
    ).toBe(false);
  });

  it("outros status e erros não-Clicksign ficam de fora", () => {
    expect(isPlanQuotaError(csError(500, [{ detail: "limite" }]))).toBe(false);
    expect(isPlanQuotaError(csError(404))).toBe(false);
    expect(isPlanQuotaError(new Error("limite do plano"))).toBe(false);
    expect(isPlanQuotaError(null)).toBe(false);
  });
});

describe("EnvelopePlanLimitError", () => {
  it("carrega code estável e mensagem sem valores em R$", () => {
    const err = new EnvelopePlanLimitError(402);
    expect(err.code).toBe("CLICKSIGN_PLAN_LIMIT");
    expect(err.clicksignStatus).toBe(402);
    // A regressão que este PR corrige: nada de "R$ 93 de R$ 100" na tela.
    expect(err.message).not.toMatch(/R\$|\d+,\d{2}|orçamento/i);
    expect(err.message).toMatch(/plano/i);
  });
});
