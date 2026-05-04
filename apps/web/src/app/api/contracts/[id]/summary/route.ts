import { NextRequest, NextResponse } from "next/server";
import { authOrBearer, hasScope } from "@/lib/auth/auth-or-bearer";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/contracts/[id]/summary
 *
 * Sumário human-readable de um contrato — para Newton responder "me dá um
 * resumo desse contrato" no WhatsApp. Skill: `get_contract_summary`.
 *
 * Auth: Bearer (escopo `contracts:rw`) OU session.
 *
 * NÃO chama LLM — extrai campos estruturados do `dataJson` + estado +
 * envelope mais recente. Determinístico, rápido, sem custo. Para análise
 * jurídica profunda, usar `/api/contracts/[id]/auto-analyze` em separado.
 *
 * Response:
 *   {
 *     contractId,
 *     dealId,
 *     status,
 *     version,
 *     partes: { vendedores: [...], compradores: [...] }, // só nomes
 *     valor: number | null,
 *     ultimaAtualizacao: ISO,
 *     envelopeAtual: { id, status, signedCount, totalSigners } | null,
 *     markdown: string  // resumo formatado pronto pra colar no WhatsApp
 *   }
 *
 * Privacy: nomes das partes vão na response (já são públicos no contrato);
 * CPF/RG NUNCA. Valor monetário é público no contrato.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ident = await authOrBearer(req);
  if (!ident) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(ident, "contracts:rw")) {
    return NextResponse.json(
      { error: "Forbidden", reason: "missing scope contracts:rw" },
      { status: 403 }
    );
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      dealId: true,
      status: true,
      version: true,
      dataJson: true,
      updatedAt: true,
      userId: true,
      envelopes: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          signers: { select: { signedAt: true } },
        },
      },
    },
  });

  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Cross-user guard para Bearer: usuário só vê contratos próprios via
  // bearer token. Session já é guarded por org no fluxo padrão.
  if (ident.via === "bearer" && contract.userId !== ident.userId) {
    return NextResponse.json(
      { error: "Forbidden", reason: "not the contract owner" },
      { status: 403 }
    );
  }

  const data = (contract.dataJson ?? {}) as Record<string, unknown>;
  const partes = extractPartes(data);
  const valor = extractValor(data);
  const env = contract.envelopes[0] ?? null;
  const envelopeAtual = env
    ? {
        id: env.id,
        status: env.status,
        signedCount: env.signers.filter((s) => s.signedAt !== null).length,
        totalSigners: env.signers.length,
      }
    : null;

  const markdown = renderMarkdown({
    status: contract.status,
    version: contract.version,
    partes,
    valor,
    envelopeAtual,
    ultimaAtualizacao: contract.updatedAt,
  });

  return NextResponse.json({
    contractId: contract.id,
    dealId: contract.dealId,
    status: contract.status,
    version: contract.version,
    partes,
    valor,
    ultimaAtualizacao: contract.updatedAt.toISOString(),
    envelopeAtual,
    markdown,
  });
}

interface Parte {
  nome: string;
}

function extractPartes(data: Record<string, unknown>): {
  vendedores: Parte[];
  compradores: Parte[];
} {
  const vendedores = Array.isArray(data.vendedores)
    ? (data.vendedores as Array<Record<string, unknown>>)
        .map((v) => ({ nome: typeof v.nome === "string" ? v.nome : "" }))
        .filter((v) => v.nome)
    : [];
  const compradores = Array.isArray(data.compradores)
    ? (data.compradores as Array<Record<string, unknown>>)
        .map((c) => ({ nome: typeof c.nome === "string" ? c.nome : "" }))
        .filter((c) => c.nome)
    : [];
  return { vendedores, compradores };
}

function extractValor(data: Record<string, unknown>): number | null {
  const pag = data.pagamento as Record<string, unknown> | undefined;
  if (pag && typeof pag.valor_total === "number") return pag.valor_total;
  return null;
}

function renderMarkdown(args: {
  status: string;
  version: number;
  partes: { vendedores: Parte[]; compradores: Parte[] };
  valor: number | null;
  envelopeAtual: {
    id: string;
    status: string;
    signedCount: number;
    totalSigners: number;
  } | null;
  ultimaAtualizacao: Date;
}): string {
  const parts: string[] = [];
  parts.push(`*Status:* ${humanStatus(args.status)} (versão ${args.version})`);
  if (args.partes.vendedores.length > 0) {
    parts.push(
      `*Vendedor(es):* ${args.partes.vendedores.map((v) => v.nome).join(", ")}`
    );
  }
  if (args.partes.compradores.length > 0) {
    parts.push(
      `*Comprador(es):* ${args.partes.compradores.map((c) => c.nome).join(", ")}`
    );
  }
  if (args.valor !== null) {
    parts.push(`*Valor:* ${formatBrl(args.valor)}`);
  }
  if (args.envelopeAtual) {
    parts.push(
      `*Assinatura:* ${humanEnvelopeStatus(args.envelopeAtual.status)} ` +
        `(${args.envelopeAtual.signedCount}/${args.envelopeAtual.totalSigners} assinaram)`
    );
  }
  parts.push(`*Última atualização:* ${formatDateBr(args.ultimaAtualizacao)}`);
  return parts.join("\n");
}

function humanStatus(s: string): string {
  const map: Record<string, string> = {
    rascunho: "Rascunho",
    em_revisao: "Em revisão",
    aprovado: "Aprovado",
    assinado: "Assinado",
    cancelado: "Cancelado",
  };
  return map[s] ?? s;
}

function humanEnvelopeStatus(s: string): string {
  const map: Record<string, string> = {
    draft: "rascunho",
    running: "em andamento",
    closed: "concluído",
    canceled: "cancelado",
  };
  return map[s] ?? s;
}

function formatBrl(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

function formatDateBr(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}
