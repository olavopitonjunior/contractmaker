// Gate da integração iList por org.
//
// DECISÃO (2026-07-23): o gating é pela EXISTÊNCIA da conexão (enabled=true),
// sem FEATURE flag no catálogo de módulos. Motivos: (1) o mesmo super-admin que
// ligaria a flag é quem cria a conexão — flag seria redundante; (2) o iList é
// transversal a vendas E locação, e o catálogo exige feature → 1 módulo.
// Fail-closed por construção: org sem conexão não tem rows em IListListing e
// as rotas respondem { configured: false }.

import { prisma } from "@/lib/db/prisma";
import type { IListConnection } from "@prisma/client";
import { isIListEnvConfigured } from "./env";

/** Conexão ativa da org, ou null (não configurada/desabilitada/env ausente). */
export async function getIListConnection(orgId: string): Promise<IListConnection | null> {
  if (!isIListEnvConfigured()) return null;
  const conn = await prisma.iListConnection.findUnique({ where: { orgId } });
  if (!conn || !conn.enabled) return null;
  return conn;
}
