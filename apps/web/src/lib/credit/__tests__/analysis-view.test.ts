import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { creditJobView, creditParecerView, listCreditRequests } from "../analysis-view";

const reqFindMany = prisma.creditAnalysisRequest.findMany as unknown as ReturnType<typeof vi.fn>;

const JOB = {
  id: "j1",
  label: "Análise de crédito (Ficha Certa) — Fiador",
  targetKind: "fiador",
  targetIndex: 0,
  status: "success",
  errorMessage: null,
  expectedReadyAt: null,
  createdAt: new Date("2026-09-05T00:00:00Z"),
  resultData: {
    situacao: "com_restricao",
    detalhes: "Score FC 310 · RISCO ALTO",
    raw: { scoreFc: 310, parecer: "RISCO ALTO", recomendacoes: ["exigir garantia adicional"], cpf: "52998224725", nome_mae: "X" },
    pretendente_id: 573,
    numero_pedido: "220",
    updateKey: "220:573:2026",
  },
};

describe("creditJobView — só o que a tela mostra, nunca o resultData cru", () => {
  it("projeta situação/detalhes/score/parecer/recomendações e descarta o resto", () => {
    const v = creditJobView(JOB);
    expect(v).toMatchObject({ situacao: "com_restricao", scoreFc: 310, parecer: "RISCO ALTO", recomendacoes: ["exigir garantia adicional"] });
    const s = JSON.stringify(v);
    expect(s).not.toContain("52998224725");
    expect(s).not.toContain("nome_mae");
    expect(s).not.toContain("updateKey");
    expect(s).not.toContain("pretendente_id");
  });
  it("resultData ausente/lixo → campos nulos, sem lançar", () => {
    expect(creditJobView({ ...JOB, resultData: null })).toMatchObject({ situacao: null, scoreFc: null, recomendacoes: [] });
    expect(creditJobView({ ...JOB, resultData: "x" })).toMatchObject({ situacao: null, parecer: null });
    expect(creditJobView({ ...JOB, resultData: { raw: { scoreFc: "850" } } }).scoreFc).toBeNull();
  });
});

/** `parecer` real da Ficha Certa: a `sintese` traz CPF e nome por pretendente. */
const PARECER_CRU = {
  sintese: [{ cpf: "52998224725", nome: "Maria da Silva", pretendente_id: 572, parecer: "APROVADO" }],
  locacao: {
    parecer_inquilinos: { parecer: "APROVADO", aprovados: [{ cpf: "52998224725", nome: "Maria da Silva" }], nao_aprovados: [] },
    parecer_fiadores: { parecer: "RISCO MÉDIO", aprovados: [], nao_aprovados: [{ cpf: "11144477735" }] },
    risco: "MÉDIO",
  },
};

describe("creditParecerView — parecer do request sem a sintese por pessoa", () => {
  it("mantém só inquilinos/fiadores/risco; CPF, nome e listas de aprovados somem", () => {
    const v = creditParecerView(PARECER_CRU);
    expect(v).toEqual({
      locacao: { parecer_inquilinos: { parecer: "APROVADO" }, parecer_fiadores: { parecer: "RISCO MÉDIO" }, risco: "MÉDIO" },
    });
    const s = JSON.stringify(v);
    expect(s).not.toContain("52998224725");
    expect(s).not.toContain("11144477735");
    expect(s).not.toContain("Maria");
    expect(s).not.toContain("sintese");
    expect(s).not.toContain("aprovados");
  });
  it("sem `locacao` (ou lixo) → null; parecer não-string é descartado", () => {
    expect(creditParecerView(null)).toBeNull();
    expect(creditParecerView({ sintese: [] })).toBeNull();
    expect(creditParecerView("x")).toBeNull();
    expect(creditParecerView({ locacao: { parecer_inquilinos: { parecer: 1 }, risco: 2 } })).toEqual({ locacao: {} });
  });
});

describe("listCreditRequests — por sujeito", () => {
  const ROW = {
    id: "r1", status: "completed", externalId: "220", createdAt: new Date(), submittedAt: null, completedAt: null, lastSyncedAt: null, errorMessage: null, costCents: 1500,
    reportProposalAttachmentId: "pa1", reportDealAttachmentId: "da1", resultJson: PARECER_CRU, jobs: [JOB],
  };
  beforeEach(() => {
    vi.clearAllMocks();
    reqFindMany.mockResolvedValue([ROW]);
  });
  it("proposta: filtra por proposalId+provider e expõe o anexo da PROPOSTA", async () => {
    const out = await listCreditRequests({ proposalId: "p1" });
    expect(reqFindMany.mock.calls[0][0].where).toEqual({ proposalId: "p1", provider: "fichacerta" });
    expect(out[0].reportAttachmentId).toBe("pa1");
    expect(out[0].jobs[0].situacao).toBe("com_restricao");
    // a fronteira vale para a lista inteira (request + jobs)
    const s = JSON.stringify(out);
    expect(s).not.toContain("52998224725");
    expect(s).not.toContain("sintese");
    expect(out[0].parecer?.locacao.risco).toBe("MÉDIO");
  });
  it("negócio: filtra por dealId+provider e expõe o anexo do NEGÓCIO (casado na conversão)", async () => {
    const out = await listCreditRequests({ dealId: "d1" });
    expect(reqFindMany.mock.calls[0][0].where).toEqual({ dealId: "d1", provider: "fichacerta" });
    expect(out[0].reportAttachmentId).toBe("da1");
  });
  it("negócio sem laudo casado → reportAttachmentId null (não cai no da proposta)", async () => {
    reqFindMany.mockResolvedValue([{ ...ROW, reportDealAttachmentId: null }]);
    const out = await listCreditRequests({ dealId: "d1" });
    expect(out[0].reportAttachmentId).toBeNull();
  });
});
