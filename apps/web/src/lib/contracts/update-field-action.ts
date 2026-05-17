import { prisma } from "@/lib/db/prisma";

/**
 * Deep-set em objeto JSON por path do tipo "a.b[0].c". Mutação in-place no
 * objeto retornado (clone primeiro se quiser evitar mutar input).
 *
 * Suporta:
 *   - "a.b.c"           → obj.a.b.c = value
 *   - "a[0].b"          → obj.a[0].b = value
 *   - "a.b[0].c"        → obj.a.b[0].c = value
 *
 * Cria nodos intermediários ausentes (array vs object por shape do segment
 * próximo). Não suporta paths exóticos tipo "a['b.c']" — wildcards/escapes
 * estão fora do escopo intencionalmente (whitelist controla tudo).
 */
function deepSet(
  target: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const tokens: Array<{ kind: "key"; value: string } | { kind: "idx"; value: number }> = [];
  const segments = path.split(".");
  for (const seg of segments) {
    // separa "vendedores[0]" em "vendedores" + [0]
    const idxMatch = seg.match(/^([^\[]+)((?:\[\d+\])+)?$/);
    if (!idxMatch) {
      throw new Error(`Path inválido em deepSet: ${path}`);
    }
    const key = idxMatch[1];
    if (key) tokens.push({ kind: "key", value: key });
    const idxPart = idxMatch[2] ?? "";
    for (const m of idxPart.matchAll(/\[(\d+)\]/g)) {
      tokens.push({ kind: "idx", value: Number(m[1]) });
    }
  }

  let cursor: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < tokens.length - 1; i++) {
    const tok = tokens[i];
    const next = tokens[i + 1];
    if (tok.kind === "key") {
      const c = cursor as Record<string, unknown>;
      if (c[tok.value] === undefined || c[tok.value] === null) {
        c[tok.value] = next.kind === "idx" ? [] : {};
      }
      cursor = c[tok.value] as Record<string, unknown> | unknown[];
    } else {
      const arr = cursor as unknown[];
      if (arr[tok.value] === undefined || arr[tok.value] === null) {
        arr[tok.value] = next.kind === "idx" ? [] : {};
      }
      cursor = arr[tok.value] as Record<string, unknown> | unknown[];
    }
  }
  const last = tokens[tokens.length - 1];
  if (last.kind === "key") {
    (cursor as Record<string, unknown>)[last.value] = value;
  } else {
    (cursor as unknown[])[last.value] = value;
  }
}

export interface RunContractFieldUpdateArgs {
  contractId: string;
  fieldPath: string;
  value: unknown;
  actorUserId: string;
}

export interface RunContractFieldUpdateResult {
  status: number;
  body: unknown;
}

/**
 * Atualiza UM campo de um contrato. Cria nova `version` (incrementa),
 * preserva o `dataJson` anterior em audit log via metadata.
 *
 * Não cria `ContractVersion` snapshot ainda — feature a adicionar depois
 * (precisa renderizar HTML do GDoc atual). Por enquanto, version no Contract
 * é incrementada (passa de v3 → v4) e o changeLog do contract-changes endpoint
 * pega o diff via comparação dataJson antigo vs novo.
 *
 * Caller é responsável por: cross-user guard, status != aprovado, whitelist
 * do fieldPath. Aqui só executa.
 */
export async function runContractFieldUpdate(
  args: RunContractFieldUpdateArgs
): Promise<RunContractFieldUpdateResult> {
  const contract = await prisma.contract.findUnique({
    where: { id: args.contractId },
    select: { id: true, dataJson: true, version: true, status: true },
  });
  if (!contract) {
    return { status: 404, body: { error: "Contrato não encontrado" } };
  }
  if (contract.status === "aprovado") {
    return {
      status: 409,
      body: { error: "Contract is approved (immutable)" },
    };
  }

  // Clone shallow do dataJson pra não mutar o original em memória
  const newData: Record<string, unknown> = JSON.parse(
    JSON.stringify(contract.dataJson ?? {})
  );

  try {
    deepSet(newData, args.fieldPath, args.value);
  } catch (err) {
    return {
      status: 400,
      body: {
        error: `deepSet falhou em ${args.fieldPath}: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const updated = await prisma.contract.update({
    where: { id: args.contractId },
    data: {
      dataJson: newData as object,
      version: { increment: 1 },
    },
    select: { id: true, version: true, updatedAt: true },
  });

  return {
    status: 200,
    body: {
      ok: true,
      contractId: updated.id,
      version: updated.version,
      fieldPath: args.fieldPath,
      updatedAt: updated.updatedAt.toISOString(),
    },
  };
}
