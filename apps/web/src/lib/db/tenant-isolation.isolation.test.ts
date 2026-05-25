import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { scopedPrisma, ORG_SCOPED_MODELS } from "@/lib/db/scoped-prisma";

/**
 * Teste de isolamento multi-tenant (Fase 0b) — roda contra DB REAL (staging),
 * fora do mock global. Gate de qualidade: garante que scopedPrisma(orgId) não
 * deixa um tenant ler dados de outro. Depende das orgs sintéticas seedadas.
 *
 * Rodar: `set -a; source .env.staging; set +a; npm run test:isolation`
 */

const ALPHA = "seed_alpha_org";
const BETA = "seed_beta_org";

describe("tenant isolation — scopedPrisma", () => {
  beforeAll(async () => {
    const [a, b] = await Promise.all([
      prisma.organization.findUnique({ where: { id: ALPHA } }),
      prisma.organization.findUnique({ where: { id: BETA } }),
    ]);
    if (!a || !b) {
      throw new Error(
        "Orgs sintéticas ausentes. Rode `scripts/seed-synthetic-orgs.ts --apply` contra a staging antes do isolation test."
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ORG_SCOPED_MODELS detecta models com orgId e ignora globais", () => {
    for (const m of ["Lead", "Pipeline", "AuditLog", "AsaasAccount", "Notification"]) {
      expect(ORG_SCOPED_MODELS.has(m)).toBe(true);
    }
    expect(ORG_SCOPED_MODELS.has("User")).toBe(false);
    expect(ORG_SCOPED_MODELS.has("PlatformRole")).toBe(false);
  });

  it("findMany retorna só registros da própria org", async () => {
    const dbA = scopedPrisma(ALPHA);
    const dbB = scopedPrisma(BETA);
    const [leadsA, leadsB] = await Promise.all([
      dbA.lead.findMany(),
      dbB.lead.findMany(),
    ]);
    expect(leadsA.length).toBeGreaterThan(0);
    expect(leadsB.length).toBeGreaterThan(0);
    expect(leadsA.every((l) => l.orgId === ALPHA)).toBe(true);
    expect(leadsB.every((l) => l.orgId === BETA)).toBe(true);
    expect(leadsA.some((l) => l.orgId === BETA)).toBe(false);
  });

  it("count é escopado por org", async () => {
    const dbA = scopedPrisma(ALPHA);
    const scoped = await dbA.lead.count();
    const real = await prisma.lead.count({ where: { orgId: ALPHA } });
    expect(scoped).toBe(real);
  });

  it("findFirst não vaza registro de outra org (cross-read → null)", async () => {
    const dbA = scopedPrisma(ALPHA);
    const betaLead = await prisma.lead.findFirst({ where: { orgId: BETA } });
    expect(betaLead).toBeTruthy();
    const leaked = await dbA.lead.findFirst({ where: { id: betaLead!.id } });
    expect(leaked).toBeNull();
  });

  it("Pipeline e AuditLog também isolados", async () => {
    const dbA = scopedPrisma(ALPHA);
    const [pipes, audits] = await Promise.all([
      dbA.pipeline.findMany(),
      dbA.auditLog.findMany(),
    ]);
    expect(pipes.every((p) => p.orgId === ALPHA)).toBe(true);
    expect(audits.every((x) => x.orgId === ALPHA)).toBe(true);
  });

  it("create injeta orgId automaticamente (sem passar orgId explícito)", async () => {
    const dbA = scopedPrisma(ALPHA);
    const owner = await prisma.user.findFirst({
      where: { email: "owner@alpha.seed.local" },
      select: { id: true },
    });
    expect(owner).toBeTruthy();
    const created = await dbA.lead.create({
      // orgId omitido de propósito — a extensão injeta. Cast: o tipo exige orgId.
      data: {
        title: "isolation-test-lead",
        status: "open",
        userId: owner!.id,
      } as never,
    });
    try {
      expect(created.orgId).toBe(ALPHA);
    } finally {
      await prisma.lead.delete({ where: { id: created.id } });
    }
  });
});
