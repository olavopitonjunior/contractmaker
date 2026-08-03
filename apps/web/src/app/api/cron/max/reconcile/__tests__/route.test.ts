/**
 * Reconciliação do provisionamento do Max.
 *
 * O buraco que ela fecha: serviço fora do ar no instante em que alguém liga a
 * feature = token emitido que nunca chegou do outro lado. Sem cron, esse estado
 * é permanente e silencioso — flag verde, agente mudo, e ninguém tem motivo
 * para clicar de novo porque a tela não indica falha.
 *
 * O que este arquivo protege é sobretudo o que o cron NÃO faz: não repica orgs
 * saudáveis, não insiste para sempre, e não deixa uma org quebrada bloquear as
 * outras.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";
import { syncMaxForOrg } from "@/lib/max/provisioning";

vi.mock("@/lib/max/provisioning", async (orig) => ({
  ...(await orig<typeof import("@/lib/max/provisioning")>()),
  syncMaxForOrg: vi.fn(),
}));
vi.mock("@/lib/env/staging", () => ({
  isCronAllowedInStaging: vi.fn().mockResolvedValue(true),
}));

const mockPrisma = vi.mocked(prisma);
const sync = vi.mocked(syncMaxForOrg);

const SECRET = "cron-secreto";
const req = (secret: string | null = SECRET) =>
  new NextRequest("http://localhost/api/cron/max/reconcile", {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });

function pendentes(rows: Array<Record<string, unknown>>) {
  mockPrisma.agentProvisioning.findMany.mockResolvedValue(rows as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
  pendentes([]);
  mockPrisma.agentProvisioning.count.mockResolvedValue(0 as never);
  sync.mockResolvedValue({ action: "provisioned", delivered: true } as never);
});

describe("seleção", () => {
  it("só pega pending_delivery e failed — org saudável não é repicada", async () => {
    await GET(req());

    const where = (mockPrisma.agentProvisioning.findMany.mock.calls[0][0] as {
      where: { status: { in: string[] }; attempts: { lt: number } };
    }).where;
    expect(where.status.in.sort()).toEqual(["failed", "pending_delivery"]);
    expect(where.status.in).not.toContain("active");
    expect(where.status.in).not.toContain("revoked");
  });

  /**
   * Entrega que falhou 8 vezes seguidas quase nunca é transitória — é segredo
   * divergente, URL errada ou serviço desligado. Insistir só gera ruído.
   */
  it("para de insistir depois do teto de tentativas", async () => {
    await GET(req());

    const where = (mockPrisma.agentProvisioning.findMany.mock.calls[0][0] as {
      where: { attempts: { lt: number } };
    }).where;
    expect(where.attempts.lt).toBe(8);
  });

  /**
   * Sem ordenação por mais antigo, uma org que falha sempre monopoliza o lote e
   * as outras nunca chegam a ser tentadas.
   */
  it("ordena pelas mais antigas e limita o lote", async () => {
    await GET(req());

    const args = mockPrisma.agentProvisioning.findMany.mock.calls[0][0] as {
      orderBy: { updatedAt: string };
      take: number;
    };
    expect(args.orderBy).toEqual({ updatedAt: "asc" });
    expect(args.take).toBe(20);
  });
});

describe("execução", () => {
  it("reconcilia e conta as entregues", async () => {
    pendentes([
      { orgId: "org-a", status: "pending_delivery", attempts: 1 },
      { orgId: "org-b", status: "failed", attempts: 2 },
    ]);

    const body = await (await GET(req())).json();

    expect(sync).toHaveBeenCalledTimes(2);
    expect(body.tentadas).toBe(2);
    expect(body.entregues).toBe(2);
  });

  it("uma org quebrada não impede as outras", async () => {
    pendentes([
      { orgId: "org-a", status: "failed", attempts: 1 },
      { orgId: "org-b", status: "failed", attempts: 1 },
    ]);
    sync
      .mockRejectedValueOnce(new Error("banco fora") as never)
      .mockResolvedValueOnce({ action: "provisioned", delivered: true } as never);

    const body = await (await GET(req())).json();

    expect(body.tentadas).toBe(2);
    expect(body.entregues).toBe(1);
    expect(body.resultados[0].resultado).toBe("erro");
    expect(body.resultados[1].resultado).toBe("entregue");
  });

  it("entrega ainda falhando é reportada como tal, não como sucesso", async () => {
    pendentes([{ orgId: "org-a", status: "pending_delivery", attempts: 3 }]);
    sync.mockResolvedValue({
      action: "provisioned",
      delivered: false,
      detail: "unreachable: timeout",
    } as never);

    const body = await (await GET(req())).json();

    expect(body.entregues).toBe(0);
    expect(body.resultados[0].resultado).toBe("ainda_falhando");
    expect(body.resultados[0].detail).toContain("timeout");
  });

  /**
   * Efeito colateral desejado de reusar `syncMaxForOrg`: se a feature foi
   * desligada entre o flip e a reconciliação, o ciclo revoga em vez de
   * reenviar — a decisão de "ligado/desligado" mora num lugar só.
   */
  it("feature desligada no meio-tempo revoga em vez de reenviar", async () => {
    pendentes([{ orgId: "org-a", status: "pending_delivery", attempts: 1 }]);
    sync.mockResolvedValue({ action: "deprovisioned", revoked: 1 } as never);

    const body = await (await GET(req())).json();

    expect(body.resultados[0].resultado).toBe("deprovisioned");
    expect(body.entregues).toBe(0);
  });

  /**
   * É o número que pede ação humana: orgs que o cron desistiu de tentar e que
   * ninguém mais conserta sozinho.
   */
  it("reporta separadamente as que esgotaram as tentativas", async () => {
    mockPrisma.agentProvisioning.count.mockResolvedValue(3 as never);

    const body = await (await GET(req())).json();

    expect(body.esgotadas).toBe(3);
  });
});

/**
 * `requireCronAuth` é fail-CLOSED: sem `CRON_SECRET` no ambiente a rota
 * responde 503 em vez de ficar pública. Vale afirmar aqui porque este cron
 * emite credencial — aberto, seria um provisionador anônimo.
 */
describe("auth", () => {
  it("sem secret no header não executa", async () => {
    const res = await GET(req(null));

    expect(res.status).toBe(401);
    expect(mockPrisma.agentProvisioning.findMany).not.toHaveBeenCalled();
  });

  it("secret errado não executa", async () => {
    expect((await GET(req("outro"))).status).toBe(401);
  });

  it("ambiente sem CRON_SECRET responde 503, nunca aberto", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const res = await GET(req());

    expect(res.status).toBe(503);
    expect(mockPrisma.agentProvisioning.findMany).not.toHaveBeenCalled();
  });
});
