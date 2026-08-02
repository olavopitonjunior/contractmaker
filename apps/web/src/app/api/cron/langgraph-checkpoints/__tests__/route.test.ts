/**
 * O que este arquivo protege: a FORMA do SQL de um cron que apaga de tabelas
 * invisíveis ao Prisma (sem FK, sem tipo). A direção do NOT EXISTS é fácil de
 * inverter em silêncio — invertida, o cron apagaria exatamente as threads
 * VIVAS. E a ordem filhas→mãe + transação são o que impede estado parcial.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/security/cron-auth", () => ({
  requireCronAuth: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/env/staging", () => ({
  isCronAllowedInStaging: vi.fn().mockResolvedValue(true),
}));

const mockPrisma = vi.mocked(prisma);

function req() {
  return new NextRequest("http://localhost/api/cron/langgraph-checkpoints");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$queryRawUnsafe.mockResolvedValue([] as never);
  mockPrisma.$executeRawUnsafe.mockResolvedValue(1 as never);
  // Forma-array do $transaction: resolve as promises na ordem.
  mockPrisma.$transaction.mockImplementation(((ops: Promise<number>[]) =>
    Promise.all(ops)) as never);
});

describe("GET /api/cron/langgraph-checkpoints", () => {
  it("sem lixo: zero deletes, resposta com contadores zerados", async () => {
    const body = await (await GET(req())).json();
    expect(body.threads).toBe(0);
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("o predicado vai na direção certa: NOT EXISTS de sessão VIVA (updatedAt >= corte)", async () => {
    await GET(req());
    const sql = String(mockPrisma.$queryRawUnsafe.mock.calls[0][0]);
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain('s."updatedAt" >= $1');
    // O corte viaja como parâmetro, não interpolado.
    expect(mockPrisma.$queryRawUnsafe.mock.calls[0][1]).toBeInstanceOf(Date);
  });

  it("deleta filhas antes da mãe, em transação, com placeholders por id", async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { thread_id: "t1" },
      { thread_id: "t2" },
    ] as never);

    const body = await (await GET(req())).json();
    expect(body.threads).toBe(2);
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    const sqls = mockPrisma.$executeRawUnsafe.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toContain("checkpoint_writes");
    expect(sqls[1]).toContain("checkpoint_blobs");
    expect(sqls[2]).toContain("checkpoints");
    // 2 ids → ($1,$2), e os ids viajam como parâmetros.
    expect(sqls[0]).toContain("IN ($1,$2)");
    expect(mockPrisma.$executeRawUnsafe.mock.calls[0].slice(1)).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("falha no lote: 500 COM os contadores do que já foi apagado, não 500 genérico", async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { thread_id: "t1" },
    ] as never);
    mockPrisma.$transaction.mockRejectedValueOnce(new Error("conexão caiu") as never);
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.partial).toBe(true);
    expect(body.threads).toBe(1);
  });
});
