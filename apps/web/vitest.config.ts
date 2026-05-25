import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Testes de isolation rodam num harness separado (vitest.isolation.config.ts)
    // contra DB real — fora do mock global do Prisma. Excluídos da suíte unit.
    exclude: [...configDefaults.exclude, "**/*.isolation.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/ai/**", "src/app/api/contracts/**", "src/app/api/settings/**"],
    },
  },
});
