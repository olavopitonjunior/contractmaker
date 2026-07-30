import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/templates/canonical-seed", () => ({
  seedCanonicalTemplatesForOrg: vi
    .fn()
    .mockResolvedValue({ created: [], skipped: [] }),
}));

import { PATCH } from "../route";
import { seedCanonicalTemplatesForOrg } from "@/lib/templates/canonical-seed";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const seedTemplates = seedCanonicalTemplatesForOrg as unknown as ReturnType<
  typeof vi.fn
>;
const platformFindUnique = prisma.platformRole.findUnique as unknown as ReturnType<typeof vi.fn>;
const orgFindUnique = prisma.organization.findUnique as unknown as ReturnType<typeof vi.fn>;
const orgModuleUpsert = prisma.orgModule.upsert as unknown as ReturnType<typeof vi.fn>;
const pipelineFindFirst = prisma.pipeline.findFirst as unknown as ReturnType<typeof vi.fn>;
const pipelineCreate = prisma.pipeline.create as unknown as ReturnType<typeof vi.fn>;
const pipelineStageCreateMany = prisma.pipelineStage.createMany as unknown as ReturnType<typeof vi.fn>;

function patchReq(body: unknown): Request {
  return new Request("http://localhost/api/admin/orgs/org1/modules", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: { orgId: "org1" } };

describe("PATCH /api/admin/orgs/[orgId]/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformFindUnique.mockResolvedValue(null);
    orgFindUnique.mockResolvedValue({ id: "org1" });
    // Habilitar um módulo agora chama seedPipeline (garante o pipeline do kind).
    // Retornar um pipeline existente torna o seed um no-op — o teste foca no upsert.
    pipelineFindFirst.mockResolvedValue({ id: "pipe1" });
    seedTemplates.mockResolvedValue({ created: [], skipped: [] });
  });

  it("401 sem sessão", async () => {
    authMock.mockResolvedValue(null);
    const res = await PATCH(patchReq({ module: "locacao" }) as never, params);
    expect(res.status).toBe(401);
  });

  it("403 quando não é super_admin (sem PlatformRole)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    platformFindUnique.mockResolvedValue(null);
    const res = await PATCH(patchReq({ module: "locacao", enabled: false }) as never, params);
    expect(res.status).toBe(403);
    expect(orgModuleUpsert).not.toHaveBeenCalled();
  });

  it("400 para módulo inválido (super_admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    platformFindUnique.mockResolvedValue({ role: "super_admin", scope: [] });
    const res = await PATCH(patchReq({ module: "financeiro" }) as never, params);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_MODULE");
  });

  it("upsert com merge de flags válidas; ignora flag de outro módulo", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    platformFindUnique.mockResolvedValue({ role: "super_admin", scope: [] });
    const res = await PATCH(
      patchReq({
        module: "locacao",
        enabled: true,
        featureFlags: { "locacao.cobrancas": true, "vendas.certidoes": true },
      }) as never,
      params
    );
    expect(res.status).toBe(200);
    expect(orgModuleUpsert).toHaveBeenCalledTimes(1);
    const arg = orgModuleUpsert.mock.calls[0][0];
    // só a flag do próprio módulo sobrevive à sanitização
    expect(arg.update.featureFlags).toEqual({ "locacao.cobrancas": true });
    expect(arg.update.enabled).toBe(true);
  });

  it("habilitar módulo cria o pipeline do kind quando ausente (fecha o gap)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    platformFindUnique.mockResolvedValue({ role: "super_admin", scope: [] });
    pipelineFindFirst.mockResolvedValue(null); // ainda não existe
    pipelineCreate.mockResolvedValue({ id: "pipeNew" });
    const res = await PATCH(
      patchReq({ module: "locacao", enabled: true }) as never,
      params
    );
    expect(res.status).toBe(200);
    expect(pipelineCreate).toHaveBeenCalledTimes(1);
    expect(pipelineCreate.mock.calls[0][0].data.kind).toBe("locacao");
    expect(pipelineStageCreateMany).toHaveBeenCalledTimes(1);
  });

  it("desabilitar módulo não semeia pipeline", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    platformFindUnique.mockResolvedValue({ role: "super_admin", scope: [] });
    const res = await PATCH(
      patchReq({ module: "locacao", enabled: false }) as never,
      params
    );
    expect(res.status).toBe(200);
    expect(pipelineFindFirst).not.toHaveBeenCalled();
    expect(seedTemplates).not.toHaveBeenCalled();
  });

  /**
   * A criação do tenant só semeia os módulos escolhidos ali. Sem semear ao
   * HABILITAR depois, uma org só-locação que ligasse Vendas ficava sem nenhum
   * template de venda e a 1ª geração morria em "Nenhum template ativo".
   */
  it("habilitar Vendas depois semeia SÓ as modalidades de venda", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    platformFindUnique.mockResolvedValue({ role: "super_admin", scope: [] });
    const res = await PATCH(
      patchReq({ module: "vendas", enabled: true }) as never,
      params
    );
    expect(res.status).toBe(200);
    expect(seedTemplates).toHaveBeenCalledWith("org1", {
      onlyModalidades: ["a_vista", "financiamento", "proposta_venda"],
    });
  });

  it("habilitar Locação semeia as 5 modalidades de locação (e nenhuma de venda)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    platformFindUnique.mockResolvedValue({ role: "super_admin", scope: [] });
    await PATCH(patchReq({ module: "locacao", enabled: true }) as never, params);
    const only = seedTemplates.mock.calls[0][1].onlyModalidades;
    expect(only).toEqual([
      "locacao",
      "locacao_comercial",
      "administracao_locacao",
      "proposta_locacao_residencial",
      "proposta_locacao_comercial",
    ]);
  });

  it("falha do seed de templates NÃO derruba a habilitação do módulo", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    platformFindUnique.mockResolvedValue({ role: "super_admin", scope: [] });
    seedTemplates.mockRejectedValueOnce(new Error("boom"));
    const res = await PATCH(
      patchReq({ module: "vendas", enabled: true }) as never,
      params
    );
    expect(res.status).toBe(200);
    expect(orgModuleUpsert).toHaveBeenCalledTimes(1);
  });
});
