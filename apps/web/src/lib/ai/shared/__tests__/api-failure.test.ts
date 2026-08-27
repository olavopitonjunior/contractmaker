import { describe, it, expect } from "vitest";
import { describeApiFailure, formatApiFailure } from "@/lib/ai/shared/api-failure";

/** Um erro como o SDK 0.30 o entrega: `status`, `error`, `request_id`. */
function apiError(
  status: number | undefined,
  errorType: string | null,
  message = "boom"
): Error {
  const err = new Error(message) as Error & Record<string, unknown>;
  err.status = status;
  err.request_id = "req_123";
  if (errorType) err.error = { type: "error", error: { type: errorType, message } };
  return err;
}

describe("describeApiFailure — permanente", () => {
  it("o 400 de schema inválido é bug nosso", () => {
    const failure = describeApiFailure(
      apiError(
        400,
        "invalid_request_error",
        "output_config.format.schema: Invalid schema: Enum value 'fiador' does not match declared type"
      )
    );
    expect(failure.permanent).toBe(true);
    expect(failure.status).toBe(400);
    expect(failure.errorType).toBe("invalid_request_error");
    expect(failure.requestId).toBe("req_123");
  });

  it.each([
    [401, "authentication_error"],
    [403, "permission_error"],
    [404, "not_found_error"],
    [422, null],
    [413, null],
  ])("%i é permanente", (status, type) => {
    expect(describeApiFailure(apiError(status, type)).permanent).toBe(true);
  });

  it("o tipo declarado manda mesmo sem status", () => {
    expect(
      describeApiFailure(apiError(undefined, "invalid_request_error")).permanent
    ).toBe(true);
  });
});

describe("describeApiFailure — transitório", () => {
  it.each([
    [429, "rate_limit_error"],
    [500, "api_error"],
    [503, "overloaded_error"],
    [408, null],
    [409, null],
  ])("%i cai no fallback", (status, type) => {
    expect(describeApiFailure(apiError(status, type)).permanent).toBe(false);
  });

  it("erro de rede, sem status nem tipo, é transitório por default", () => {
    const failure = describeApiFailure(new Error("fetch failed"));
    expect(failure.permanent).toBe(false);
    expect(failure.status).toBeNull();
    expect(failure.errorType).toBeNull();
  });

  it("valor lançado que nem é Error não quebra a classificação", () => {
    const failure = describeApiFailure("caiu");
    expect(failure.permanent).toBe(false);
    expect(failure.message).toBe("caiu");
  });
});

describe("formatApiFailure", () => {
  it("leva status, tipo e request_id — o suficiente para depurar", () => {
    const line = formatApiFailure(
      describeApiFailure(apiError(400, "invalid_request_error", "Invalid schema"))
    );
    expect(line).toContain("status=400");
    expect(line).toContain("type=invalid_request_error");
    expect(line).toContain("request_id=req_123");
    expect(line).toContain("Invalid schema");
  });

  it("campo ausente vira travessão, não 'undefined'", () => {
    expect(formatApiFailure(describeApiFailure(new Error("x")))).toBe(
      "status=- type=- request_id=- — x"
    );
  });
});
