// Feature flags client-safe — SEM imports de servidor (prisma, fs, etc.) pra
// poder ser importado por Client Components. As vars NEXT_PUBLIC_* são inlined
// no build do Next; trocar exige redeploy.

/**
 * Espelho client do LOCACAO_SIMPLIFIED_MODE (lib/env/staging.ts). Liga a
 * navegação enxuta do módulo de locação no staging. Server Components devem
 * usar a versão de staging.ts; Client Components usam esta.
 */
export const LOCACAO_SIMPLIFIED_MODE =
  process.env.NEXT_PUBLIC_LOCACAO_SIMPLIFIED_MODE === "true";
