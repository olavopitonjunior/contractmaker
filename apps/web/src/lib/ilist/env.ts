// Credenciais GLOBAIS da plataforma pra RexAPI (Gryphtech RE/MAX).
// A apiKey/secretKey é única e o token resultante acessa TODAS as regiões
// (inclusive escrita) — por isso NUNCA vira configuração por tenant; o que é
// por-org é só região+offices (IListConnection). Ver docs/integracoes/ilist-rexapi-study.md.

export interface IListEnv {
  /** Base SEM sufixo /api/v1 — ex. https://rexapi.stage.gryphtech.com */
  baseUrl: string;
  apiKey: string;
  secretKey: string;
}

export function isIListEnvConfigured(): boolean {
  return Boolean(
    process.env.ILIST_BASE_URL && process.env.ILIST_API_KEY && process.env.ILIST_SECRET_KEY,
  );
}

export function getIListEnv(): IListEnv {
  const baseUrl = process.env.ILIST_BASE_URL;
  const apiKey = process.env.ILIST_API_KEY;
  const secretKey = process.env.ILIST_SECRET_KEY;
  if (!baseUrl || !apiKey || !secretKey) {
    throw new Error(
      "Integração iList não configurada: defina ILIST_BASE_URL, ILIST_API_KEY e ILIST_SECRET_KEY.",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, secretKey };
}
