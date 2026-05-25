import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  requirePlatformRole,
  getPlatformRole,
  PlatformRoleRequiredError,
} from "./platform";

const findUnique = prisma.platformRole.findUnique as unknown as ReturnType<
  typeof vi.fn
>;

describe("requirePlatformRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lança PlatformRoleRequiredError quando o user não é staff", async () => {
    findUnique.mockResolvedValue(null);
    await expect(requirePlatformRole("u1", "super_admin")).rejects.toBeInstanceOf(
      PlatformRoleRequiredError
    );
  });

  it("permite quando a role bate exatamente", async () => {
    findUnique.mockResolvedValue({ userId: "u1", role: "support", scope: ["audit_query"] });
    await expect(requirePlatformRole("u1", "support")).resolves.toEqual({
      role: "support",
      scope: ["audit_query"],
    });
  });

  it("super_admin satisfaz exigência de qualquer role inferior", async () => {
    findUnique.mockResolvedValue({ userId: "u1", role: "super_admin", scope: [] });
    await expect(requirePlatformRole("u1", "support")).resolves.toMatchObject({
      role: "super_admin",
    });
    await expect(requirePlatformRole("u1", "billing")).resolves.toMatchObject({
      role: "super_admin",
    });
  });

  it("support NÃO satisfaz exigência de super_admin", async () => {
    findUnique.mockResolvedValue({ userId: "u1", role: "support", scope: [] });
    const err = await requirePlatformRole("u1", "super_admin").catch((e) => e);
    expect(err).toBeInstanceOf(PlatformRoleRequiredError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("PLATFORM_ROLE_REQUIRED");
    expect(err.requiredRole).toBe("super_admin");
  });

  it("getPlatformRole retorna null pra não-staff e o contexto pra staff", async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(getPlatformRole("u1")).resolves.toBeNull();

    findUnique.mockResolvedValueOnce({ userId: "u2", role: "billing", scope: ["x"] });
    await expect(getPlatformRole("u2")).resolves.toEqual({ role: "billing", scope: ["x"] });
  });
});
