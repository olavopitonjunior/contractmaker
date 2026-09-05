// Conexão da conta Superlógica da imobiliária. Fluxo de 1 passo: o admin cola
// licença + app_token + access_token → validamos nas DUAS APIs que a exportação
// usa (Imobiliárias e Financeiro v2) → gravamos cifrado. Nada é persistido se a
// validação falhar. Molde: lib/clicksign/connect.ts.

import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/security/crypto";
import { slGet, slGetV2, SuperlogicaError, type SuperlogicaCredentials } from "./client";

export class SuperlogicaConnectError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "SuperlogicaConnectError";
  }
}

export interface ValidationResult {
  /** Nome da empresa/filial matriz lido de `filiais` (pode vir vazio). */
  accountName: string | null;
}

const LICENCA_RE = /^[a-z0-9]{3,32}$/;

/**
 * Valida os tokens com leituras baratas e autenticadas nas duas bases.
 * - Imobiliárias: `contratos?itensPorPagina=1` (a mesma prova usada no benchmark).
 * - Financeiro v2: `caixa?itensPorPagina=1` (contas bancárias vêm daqui).
 * Token inválido chega como `status 500 "Client Id ... app_token, is invalid"`
 * (gateway Sensedia) — mapeado para 400 com mensagem didática.
 */
export async function validateSuperlogicaCreds(
  creds: SuperlogicaCredentials
): Promise<ValidationResult> {
  try {
    await slGet(creds, "contratos", { itensPorPagina: 1 });
  } catch (err) {
    throw mapValidationError(err, "Imobiliárias");
  }
  try {
    await slGetV2(creds, "caixa", { itensPorPagina: 1 });
  } catch (err) {
    throw mapValidationError(err, "Financeiro");
  }
  let accountName: string | null = null;
  try {
    const filiais = await slGet<{ st_nome_fil?: string; st_nomefantasia_fil?: string }>(
      creds,
      "filiais",
      { itensPorPagina: 1 }
    );
    const f = filiais.data[0];
    accountName = (f?.st_nomefantasia_fil || f?.st_nome_fil || "").trim() || null;
  } catch {
    // best-effort: o nome é só exibição
  }
  return { accountName };
}

function mapValidationError(err: unknown, api: string): SuperlogicaConnectError {
  if (err instanceof SuperlogicaError) {
    if (/app_token|access_token|invalid|inv[aá]lid|unauthor/i.test(err.message)) {
      return new SuperlogicaConnectError(
        `A Superlógica recusou os tokens na API ${api}. Confira o app token (Usuários › Aplicativos) e o access token da licença.`,
        400
      );
    }
    return new SuperlogicaConnectError(
      `Não foi possível validar na API ${api} da Superlógica: ${err.message}`,
      502
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new SuperlogicaConnectError(
    `Falha de rede ao falar com a Superlógica (${api}): ${msg}`,
    502
  );
}

export interface ConnectInput {
  orgId: string;
  userId: string;
  licenca: string;
  appToken: string;
  accessToken: string;
}

export interface ConnectResult {
  ok: true;
  status: "connected";
  licenca: string;
  accountName: string | null;
}

/**
 * Valida e persiste (upsert por org). Reconectar sobrescreve os tokens e
 * preserva os padrões já escolhidos.
 */
export async function connectSuperlogicaAccount(input: ConnectInput): Promise<ConnectResult> {
  const licenca = input.licenca.trim().toLowerCase();
  const appToken = input.appToken.trim();
  const accessToken = input.accessToken.trim();
  if (!LICENCA_RE.test(licenca)) {
    throw new SuperlogicaConnectError(
      'Licença inválida. Use o nome da base, como em "adm037585".',
      400
    );
  }
  if (appToken.length < 8 || accessToken.length < 8) {
    throw new SuperlogicaConnectError("Informe o app token e o access token.", 400);
  }

  const validation = await validateSuperlogicaCreds({ appToken, accessToken });

  const encApp = encryptSecret(appToken);
  const encAccess = encryptSecret(accessToken);
  const now = new Date();
  await prisma.superlogicaAccount.upsert({
    where: { orgId: input.orgId },
    create: {
      orgId: input.orgId,
      licenca,
      appTokenEncrypted: encApp.ciphertext,
      appTokenIvBase64: encApp.iv,
      appTokenTagBase64: encApp.tag,
      accessTokenEncrypted: encAccess.ciphertext,
      accessTokenIvBase64: encAccess.iv,
      accessTokenTagBase64: encAccess.tag,
      status: "connected",
      accountName: validation.accountName,
      connectedById: input.userId,
      lastValidatedAt: now,
      lastError: null,
    },
    update: {
      licenca,
      appTokenEncrypted: encApp.ciphertext,
      appTokenIvBase64: encApp.iv,
      appTokenTagBase64: encApp.tag,
      accessTokenEncrypted: encAccess.ciphertext,
      accessTokenIvBase64: encAccess.iv,
      accessTokenTagBase64: encAccess.tag,
      status: "connected",
      accountName: validation.accountName,
      connectedById: input.userId,
      lastValidatedAt: now,
      lastError: null,
    },
  });

  return {
    ok: true,
    status: "connected",
    licenca,
    accountName: validation.accountName,
  };
}
