import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

/**
 * Harness de testes de isolamento multi-tenant (Fase 0b). Roda contra um DB
 * Postgres REAL (branch Neon staging) — NÃO carrega o mock global do Prisma
 * (src/__tests__/setup.ts). Exige DATABASE_URL apontando pra staging.
 *
 * ⚠️ Os arquivos daqui NÃO têm o mesmo pré-requisito de dados:
 *  - `db/tenant-isolation.isolation.test.ts` exige as orgs sintéticas
 *    (`scripts/seed-synthetic-orgs.ts --apply`) e ESTOURA no beforeAll sem elas;
 *  - `max/user-identity.isolation.test.ts` é AUTOCONTIDO — cria e apaga os
 *    próprios fixtures, e não depende de seed nenhum.
 *
 * Então `npm run test:isolation` sem o seed fica vermelho pelo primeiro, e isso
 * não diz nada sobre o segundo. Rodando um arquivo só, passe o caminho.
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
