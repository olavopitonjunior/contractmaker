import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

/**
 * Harness de testes de isolamento multi-tenant (Fase 0b). Roda contra um DB
 * Postgres REAL (branch Neon staging) — NÃO carrega o mock global do Prisma
 * (src/__tests__/setup.ts). Exige DATABASE_URL apontando pra staging + as orgs
 * sintéticas seedadas (scripts/seed-synthetic-orgs.ts --apply).
 *
 * Uso: `npm run test:isolation` com .env.staging carregado.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.isolation.test.ts"],
    // sem setupFiles → Prisma real, sem mocks
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
