import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/fichacerta/account", () => ({
  requireFichaCertaCreds: vi.fn(),
}));
vi.mock("@/lib/fichacerta/client", () => ({
  createSolicitation: vi.fn(),
  getSolicitation: vi.fn(),
  addApplicant: vi.fn(),
  requestReport: vi.fn(),
  getReport: vi.fn(),
  downloadReportPdf: vi.fn(),
}));
vi.mock("@/lib/certidoes/executor", () => ({
  checkBatchCompletion: vi.fn().mockResolvedValue(undefined),
  reportCertidaoProblem: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/storage/s3", () => ({
  uploadBufferToStorage: vi.fn().mockResolvedValue("https://blob/laudo.pdf"),
}));
vi.mock("@/lib/proposals/attachments", () => ({
  persistProposalDocument: vi.fn().mockResolvedValue({ attachment: { id: "pa-laudo" }, deduped: false, assignmentUpdated: false }),
}));

import { submitCreditRequest, reconcileCreditRequest, runFichaCertaJob } from "../fichacerta-runner";
import { requireFichaCertaCreds } from "@/lib/fichacerta/account";
import * as client from "@/lib/fichacerta/client";
import { FichaCertaError } from "@/lib/fichacerta/types";
import { checkBatchCompletion, reportCertidaoProblem } from "@/lib/certidoes/executor";
import { persistProposalDocument } from "@/lib/proposals/attachments";
import { prisma } from "@/lib/db/prisma";

const reqUpdateMany = prisma.creditAnalysisRequest.updateMany as unknown as ReturnType<typeof vi.fn>;
const reqFindUnique = prisma.creditAnalysisRequest.findUnique as unknown as ReturnType<typeof vi.fn>;
const reqUpdate = prisma.creditAnalysisRequest.update as unknown as ReturnType<typeof vi.fn>;
const jobUpdate = prisma.certidaoJob.update as unknown as ReturnType<typeof vi.fn>;
const jobUpdateMany = prisma.certidaoJob.updateMany as unknown as ReturnType<typeof vi.fn>;
const jobFindMany = prisma.certidaoJob.findMany as unknown as ReturnType<typeof vi.fn>;
const jobCount = prisma.certidaoJob.count as unknown as ReturnType<typeof vi.fn>;

const CREDS = { orgId: "org1", login: "l", password: "p", baseUrl: "https://stage-api", products: [1, 9], costCents: 1500 };
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../../certidoes/__tests__/fixtures", name), "utf8"));

const JOB_PF = {
  id: "j-loc",
  batchId: "b1",
  status: "pending",
  endpoint: "fichacerta/laudo-pf",
  label: "Análise de crédito (Ficha Certa) — Locatário",
  orgId: "org1",
  dealId: null,
  proposalId: "p1",
  creditRequestId: "req1",
  resultData: null,
  costCents: null,
  requestPayload: { tipo_pretendente: "INQUILINO", nome: "Maria", cpf: "52998224725", residir: true, renda: { principal: { origem: 11, valor: "3500.00" }, outra: { origem: "" } } },
};
const JOB_FIADOR_PJ = {
  ...JOB_PF,
  id: "j-fiador",
  endpoint: "fichacerta/laudo-pj",
  label: "Análise de crédito (Ficha Certa) — Fiador",
  requestPayload: { tipo_pretendente: "OUTROS", razao_social: "Fiança S.A.", cnpj: "11222333000181" },
};
const REQUEST = {
  id: "req1",
  orgId: "org1",
  proposalId: "p1",
  provider: "fichacerta",
  status: "submitting",
  externalId: null,
  submittedAt: null,
  createdAt: new Date("2026-09-05T00:00:00Z"),
  requestJson: { locacao: { tipo_imovel: "RESIDENCIAL", aluguel: "3200.00", codigo_imovel: "PROP-1" }, produtos: [1, 9], produtosPj: [4] },
  reportProposalAttachmentId: null,
  reportUrl: null,
  jobs: [JOB_PF, JOB_FIADOR_PJ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireFichaCertaCreds).mockResolvedValue(CREDS as never);
  reqUpdateMany.mockResolvedValue({ count: 1 });
  reqFindUnique.mockResolvedValue(REQUEST);
  reqUpdate.mockResolvedValue({});
  jobUpdate.mockResolvedValue({});
  jobUpdateMany.mockResolvedValue({ count: 2 });
  jobFindMany.mockResolvedValue([]);
  jobCount.mockResolvedValue(0);
  vi.mocked(client.createSolicitation).mockResolvedValue({ id: 220 });
  vi.mocked(client.getSolicitation).mockResolvedValue({ data: { id: 220, pretendentes: [{ id: 572, cpf: "52998224725" }] } } as never);
  vi.mocked(client.addApplicant).mockResolvedValue({ id: 573 });
  vi.mocked(client.requestReport).mockResolvedValue({});
});

describe("submitCreditRequest — pending → submitting → processing", () => {
  it("CAS: request que não está pending não é enviado de novo", async () => {
    reqUpdateMany.mockResolvedValue({ count: 0 });
    const r = await submitCreditRequest("req1");
    expect(r).toEqual({ ok: false, reason: "not_pending" });
    expect(client.createSolicitation).not.toHaveBeenCalled();
  });

  it("cria a solicitação com o 1º pretendente, adiciona o 2º (PJ com produto 4), pede o laudo e põe os jobs em awaiting_portal com numero_pedido = id da solicitação", async () => {
    const r = await submitCreditRequest("req1");
    expect(r).toEqual({ ok: true });
    expect(client.createSolicitation).toHaveBeenCalledWith(
      CREDS,
      expect.objectContaining({ produtos: [1, 9], locacao: expect.objectContaining({ tipo_imovel: "RESIDENCIAL" }), pretendente: expect.objectContaining({ cpf: "52998224725" }) })
    );
    expect(client.addApplicant).toHaveBeenCalledWith(CREDS, 220, expect.objectContaining({ produtos: [4], pretendente: expect.objectContaining({ cnpj: "11222333000181" }) }));
    expect(client.requestReport).toHaveBeenCalledWith(CREDS, 220);
    // externalId gravado assim que a solicitação nasce (idempotência do retry)
    expect(reqUpdate.mock.calls.some((c) => c[0].data.externalId === "220")).toBe(true);
    // pretendente_id por job + numero_pedido para a trava por alvo/cron
    const loc = jobUpdate.mock.calls.find((c) => c[0].where.id === "j-loc")![0].data.resultData;
    expect(loc).toMatchObject({ solicitacao_id: 220, pretendente_id: 572, numero_pedido: "220" });
    const fia = jobUpdate.mock.calls.find((c) => c[0].where.id === "j-fiador")![0].data.resultData;
    expect(fia).toMatchObject({ solicitacao_id: 220, pretendente_id: 573 });
    const awaiting = jobUpdateMany.mock.calls.find((c) => c[0].data.status === "awaiting_portal")![0];
    expect(awaiting.where.creditRequestId).toBe("req1");
    expect(awaiting.data.expectedReadyAt).toBeInstanceOf(Date);
    expect(reqUpdate.mock.calls.at(-1)![0].data.status).toBe("processing");
  });

  it("retry não recria quem já tem pretendente_id; quem não tem é casado por CPF/CNPJ antes de adicionar", async () => {
    reqFindUnique.mockResolvedValue({
      ...REQUEST,
      externalId: "220",
      jobs: [
        { ...JOB_PF, status: "api_error", resultData: { solicitacao_id: 220, pretendente_id: 572, numero_pedido: "220" } },
        { ...JOB_FIADOR_PJ, status: "api_error" },
      ],
    });
    // A solicitação já tem os dois (createSolicitation + addApplicant passaram; a queda foi depois).
    vi.mocked(client.getSolicitation).mockResolvedValue({ data: { id: 220, pretendentes: [{ id: 572, cpf: "52998224725" }, { id: 573, cnpj: "11222333000181" }] } } as never);
    await submitCreditRequest("req1");
    expect(client.createSolicitation).not.toHaveBeenCalled();
    expect(client.addApplicant).not.toHaveBeenCalled();
    expect(jobUpdate.mock.calls.find((c) => c[0].where.id === "j-fiador")![0].data.resultData).toMatchObject({ pretendente_id: 573 });
    expect(client.requestReport).toHaveBeenCalledWith(CREDS, 220);
  });

  it("retry com pretendente ausente na solicitação → addApplicant; com 2 na lista e nenhum casando → falha retentável, nunca chuta o 1º", async () => {
    reqFindUnique.mockResolvedValue({ ...REQUEST, externalId: "220", jobs: [{ ...JOB_FIADOR_PJ, status: "api_error" }] });
    vi.mocked(client.getSolicitation).mockResolvedValue({ data: { id: 220, pretendentes: [{ id: 572, cpf: "52998224725" }] } } as never);
    await submitCreditRequest("req1");
    expect(client.addApplicant).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    vi.mocked(requireFichaCertaCreds).mockResolvedValue(CREDS as never);
    reqUpdateMany.mockResolvedValue({ count: 1 });
    reqFindUnique.mockResolvedValue({ ...REQUEST, jobs: [JOB_PF] });
    vi.mocked(client.createSolicitation).mockResolvedValue({ id: 230 });
    vi.mocked(client.getSolicitation).mockResolvedValue({ data: { id: 230, pretendentes: [{ id: 1, cpf: "00000000000" }, { id: 2, cpf: "11111111111" }] } } as never);
    const r = await submitCreditRequest("req1");
    expect(r.ok).toBe(false);
    expect(jobUpdateMany.mock.calls.find((c) => c[0].data.status === "api_error")).toBeTruthy();
    expect(jobUpdate.mock.calls.some((c) => c[0].data?.resultData?.pretendente_id != null)).toBe(false);
  });

  it("job já em api_error + nova falha 401 na mesma chamada → também vira failed_permanent", async () => {
    reqFindUnique.mockResolvedValue({
      ...REQUEST,
      externalId: "220",
      jobs: [{ ...JOB_PF, status: "pending" }, { ...JOB_FIADOR_PJ, status: "api_error" }],
    });
    vi.mocked(client.getSolicitation).mockRejectedValue(new FichaCertaError("Unauthorized", 401));
    await submitCreditRequest("req1");
    const fail = jobUpdateMany.mock.calls.find((c) => c[0].data.status === "failed_permanent")![0];
    expect(fail.where.id.in).toEqual(["j-loc", "j-fiador"]);
    expect(fail.where.status.in).toContain("api_error");
  });

  it("401 → jobs failed_permanent, request failed, problema reportado", async () => {
    vi.mocked(client.createSolicitation).mockRejectedValue(new FichaCertaError("Unauthorized", 401));
    const r = await submitCreditRequest("req1");
    expect(r).toEqual({ ok: false, reason: "error_401" });
    const fail = jobUpdateMany.mock.calls.find((c) => c[0].data.status === "failed_permanent");
    expect(fail).toBeTruthy();
    expect(reqUpdate.mock.calls.at(-1)![0].data.status).toBe("failed");
    expect(reportCertidaoProblem).toHaveBeenCalled();
    expect(checkBatchCompletion).toHaveBeenCalledWith("b1");
  });

  it("422 → jobs failed com a mensagem, request failed (sem retry)", async () => {
    vi.mocked(client.createSolicitation).mockRejectedValue(new FichaCertaError("participante obrigatório", 422));
    await submitCreditRequest("req1");
    const fail = jobUpdateMany.mock.calls.find((c) => c[0].data.status === "failed")!;
    expect(String(fail[0].data.errorMessage)).toContain("participante obrigatório");
    expect(reqUpdate.mock.calls.at(-1)![0].data.status).toBe("failed");
  });

  it("5xx/rede → jobs api_error com nextRetryAt e request volta a pending (cron retenta)", async () => {
    vi.mocked(client.createSolicitation).mockRejectedValue(new FichaCertaError("gateway", 502));
    await submitCreditRequest("req1");
    const err = jobUpdateMany.mock.calls.find((c) => c[0].data.status === "api_error")!;
    expect(err[0].data.nextRetryAt).toBeInstanceOf(Date);
    expect(reqUpdate.mock.calls.at(-1)![0].data.status).toBe("pending");
  });

  it("conta desconectada → failed_permanent sem chamar a API", async () => {
    vi.mocked(requireFichaCertaCreds).mockRejectedValue(new Error("not configured"));
    const r = await submitCreditRequest("req1");
    expect(r).toEqual({ ok: false, reason: "not_configured" });
    expect(client.createSolicitation).not.toHaveBeenCalled();
  });
});

describe("reconcileCreditRequest — processing → completed", () => {
  const PROCESSING = {
    ...REQUEST,
    status: "processing",
    externalId: "220",
    submittedAt: new Date("2026-09-05T00:00:00Z"),
    jobs: [{ ...JOB_PF, status: "awaiting_portal", resultData: { solicitacao_id: 220, pretendente_id: 572, numero_pedido: "220" } }],
  };

  it("pretendente concluído → job success com situacao/detalhes/updateKey; tudo terminal → PDF do laudo anexado UMA vez e request completed", async () => {
    reqFindUnique.mockResolvedValueOnce(PROCESSING).mockResolvedValueOnce({ ...PROCESSING });
    vi.mocked(client.getReport).mockResolvedValue(fixture("fichacerta-report-aprovado.json"));
    vi.mocked(client.downloadReportPdf).mockResolvedValue(Buffer.from("%PDF-1.4 laudo"));
    jobFindMany.mockResolvedValue([{ ...PROCESSING.jobs[0], status: "success", costCents: 1500 }]);
    jobCount.mockResolvedValue(0);

    await reconcileCreditRequest("req1", { source: "webhook" });

    const upd = jobUpdate.mock.calls.find((c) => c[0].where.id === "j-loc")![0].data;
    expect(upd.status).toBe("success");
    expect(upd.costCents).toBe(1500);
    expect(upd.resultData).toMatchObject({ situacao: expect.stringMatching(/sem_restricao|com_restricao|indeterminado/), pretendente_id: 572 });
    expect(typeof upd.resultData.updateKey).toBe("string");

    expect(client.downloadReportPdf).toHaveBeenCalledWith(CREDS, 220);
    expect(persistProposalDocument).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "p1", category: "laudo_credito", source: "fichacerta", status: "ready" })
    );
    const done = reqUpdate.mock.calls.at(-1)![0].data;
    expect(done.status).toBe("completed");
    expect(done.reportProposalAttachmentId).toBe("pa-laudo");
    expect(done.costCents).toBe(1500);
    expect(checkBatchCompletion).toHaveBeenCalledWith("b1");
  });

  it("reentrega do mesmo laudo (updateKey igual) não reescreve o job", async () => {
    const report = fixture("fichacerta-report-aprovado.json");
    const pret = report.pretendentes[0];
    const { pretendenteUpdateKey } = await import("@/lib/fichacerta/normalize");
    const key = pretendenteUpdateKey(220, pret);
    reqFindUnique.mockResolvedValue({
      ...PROCESSING,
      status: "completed",
      reportProposalAttachmentId: "pa-laudo",
      jobs: [{ ...PROCESSING.jobs[0], status: "success", resultData: { pretendente_id: 572, updateKey: key } }],
    });
    vi.mocked(client.getReport).mockResolvedValue(report);
    jobFindMany.mockResolvedValue([{ ...PROCESSING.jobs[0], status: "success", costCents: 1500 }]);
    await reconcileCreditRequest("req1", { source: "webhook" });
    expect(jobUpdate).not.toHaveBeenCalled();
    expect(client.downloadReportPdf).not.toHaveBeenCalled();
  });

  it("em andamento → re-arma expectedReadyAt; passou do prazo máximo → failed_permanent + problema", async () => {
    reqFindUnique.mockResolvedValue(PROCESSING);
    vi.mocked(client.getReport).mockResolvedValue(fixture("fichacerta-report-andamento.json"));
    jobFindMany.mockResolvedValue([PROCESSING.jobs[0]]);
    jobCount.mockResolvedValue(1);
    await reconcileCreditRequest("req1", { source: "poll" });
    const rearm = jobUpdateMany.mock.calls.find((c) => c[0].data.expectedReadyAt)!;
    expect(rearm[0].data.expectedReadyAt).toBeInstanceOf(Date);
    expect(reqUpdate.mock.calls.at(-1)![0].data.status).toBeUndefined();

    vi.clearAllMocks();
    vi.mocked(requireFichaCertaCreds).mockResolvedValue(CREDS as never);
    reqFindUnique.mockResolvedValue({ ...PROCESSING, submittedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000) });
    vi.mocked(client.getReport).mockResolvedValue(fixture("fichacerta-report-andamento.json"));
    jobFindMany.mockResolvedValue([PROCESSING.jobs[0]]);
    jobCount.mockResolvedValue(0);
    jobUpdateMany.mockResolvedValue({ count: 1 });
    reqFindUnique.mockResolvedValueOnce({ ...PROCESSING, submittedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000) }).mockResolvedValueOnce(PROCESSING);
    await reconcileCreditRequest("req1", { source: "poll" });
    expect(jobUpdateMany.mock.calls.some((c) => c[0].data.status === "failed_permanent")).toBe(true);
    expect(reportCertidaoProblem).toHaveBeenCalled();
  });

  it("GET report fora → usa o payload do webhook como fallback", async () => {
    reqFindUnique.mockResolvedValueOnce(PROCESSING).mockResolvedValueOnce(PROCESSING);
    vi.mocked(client.getReport).mockRejectedValue(new FichaCertaError("down", 503));
    jobFindMany.mockResolvedValue([{ ...PROCESSING.jobs[0], status: "success", costCents: 1500 }]);
    jobCount.mockResolvedValue(0);
    vi.mocked(client.downloadReportPdf).mockRejectedValue(new FichaCertaError("down", 503));
    await reconcileCreditRequest("req1", { source: "webhook", payload: fixture("fichacerta-webhook-pretendente.json") });
    expect(jobUpdate.mock.calls.find((c) => c[0].where.id === "j-loc")![0].data.status).toBe("success");
  });
});

describe("runFichaCertaJob — entrada do executor", () => {
  it("job sem creditRequestId → failed_permanent", async () => {
    await runFichaCertaJob({ id: "j-x", creditRequestId: null, batchId: "b1" });
    expect(jobUpdate.mock.calls[0][0].data.status).toBe("failed_permanent");
  });
  it("request já enviado → reconcilia em vez de reenviar", async () => {
    reqUpdateMany.mockResolvedValue({ count: 0 });
    reqFindUnique.mockResolvedValue({ ...REQUEST, status: "processing", externalId: "220", submittedAt: new Date(), jobs: [] });
    vi.mocked(client.getReport).mockResolvedValue(fixture("fichacerta-report-andamento.json"));
    await runFichaCertaJob({ id: "j-loc", creditRequestId: "req1", batchId: "b1" });
    expect(client.createSolicitation).not.toHaveBeenCalled();
    expect(client.getReport).toHaveBeenCalled();
  });
});
