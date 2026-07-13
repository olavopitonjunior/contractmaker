import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

interface SearchResult {
  id: string;
  type: "contrato" | "imovel" | "pessoa" | "cobranca";
  title: string;
  subtitle?: string;
  href: string;
}

/**
 * GET /api/search/global?q=...
 *
 * Busca global limitada (até 5 por tipo). Usada pelo command palette.
 * Sem indexer fulltext — usa ILIKE simples por enquanto. Escala até ~10k linhas
 * por tipo OK. Acima disso, migrar pra Postgres FTS ou Voyage.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ results: [] });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const insensitive = "insensitive" as const;
  const orFilter = (field: string) => ({ contains: q, mode: insensitive });

  const [imoveis, contratos, owners, tenants, clientes, cobrancas] = await Promise.all([
    prisma.property.findMany({
      where: {
        orgId: org.id,
        OR: [
          { rua: orFilter("rua") },
          { bairro: orFilter("bairro") },
          { cidade: orFilter("cidade") },
          { matricula: orFilter("matricula") },
        ],
      },
      select: {
        id: true,
        rua: true,
        numero: true,
        bairro: true,
        cidade: true,
        uf: true,
        kind: true,
      },
      take: 5,
    }),
    prisma.leaseContract.findMany({
      where: {
        orgId: org.id,
        OR: [
          { property: { rua: orFilter("rua") } },
          { property: { bairro: orFilter("bairro") } },
          { tenants: { some: { tenant: { nome: orFilter("nome") } } } },
        ],
      },
      include: {
        property: { select: { rua: true, numero: true, cidade: true } },
        tenants: { include: { tenant: { select: { nome: true } } } },
      },
      take: 5,
    }),
    prisma.propertyOwner.findMany({
      where: {
        orgId: org.id,
        OR: [{ nome: orFilter("nome") }, { cpfCnpj: orFilter("cpfCnpj") }],
      },
      select: { id: true, nome: true, cpfCnpj: true, tipoPessoa: true },
      take: 5,
    }),
    prisma.tenant.findMany({
      where: {
        orgId: org.id,
        OR: [{ nome: orFilter("nome") }, { cpfCnpj: orFilter("cpfCnpj") }],
      },
      select: { id: true, nome: true, cpfCnpj: true, tipoPessoa: true },
      take: 5,
    }),
    prisma.leaseClient.findMany({
      where: {
        orgId: org.id,
        OR: [
          { nome: orFilter("nome") },
          { cpfCnpj: orFilter("cpfCnpj") },
          { phone: orFilter("phone") },
        ],
      },
      select: { id: true, nome: true, cpfCnpj: true, tipoPessoa: true },
      take: 5,
    }),
    prisma.rentCharge.findMany({
      where: {
        orgId: org.id,
        OR: [
          { competencia: orFilter("competencia") },
          { leaseContract: { tenants: { some: { tenant: { nome: orFilter("nome") } } } } },
        ],
      },
      include: {
        leaseContract: {
          select: {
            property: { select: { rua: true } },
            tenants: { include: { tenant: { select: { nome: true } } } },
          },
        },
      },
      take: 5,
    }),
  ]);

  const results: SearchResult[] = [
    ...imoveis.map((p) => ({
      id: p.id,
      type: "imovel" as const,
      title: `${p.rua ?? ""} ${p.numero ?? ""}`.trim() || `Imóvel ${p.id.slice(0, 6)}`,
      subtitle: `${p.kind} · ${p.bairro ?? ""} ${p.cidade ?? ""}/${p.uf ?? ""}`.trim(),
      href: `/locacao/imoveis/${p.id}`,
    })),
    ...contratos.map((lc) => ({
      id: lc.id,
      type: "contrato" as const,
      title: `${lc.property?.rua ?? ""} ${lc.property?.numero ?? ""}`.trim() || `Contrato ${lc.id.slice(0, 6)}`,
      subtitle: lc.tenants.map((t) => t.tenant.nome).join(", ") || "sem inquilinos",
      href: `/locacao/contratos/${lc.id}`,
    })),
    ...owners.map((o) => ({
      id: o.id,
      type: "pessoa" as const,
      title: o.nome,
      subtitle: `${o.tipoPessoa === "fisica" ? "PF" : "PJ"} · ${o.cpfCnpj} · Proprietário`,
      href: `/locacao/pessoas/proprietarios/${o.id}`,
    })),
    ...tenants.map((t) => ({
      id: t.id,
      type: "pessoa" as const,
      title: t.nome,
      subtitle: `${t.tipoPessoa === "fisica" ? "PF" : "PJ"} · ${t.cpfCnpj} · Locatário`,
      href: `/locacao/pessoas/locatarios/${t.id}`,
    })),
    ...clientes.map((c) => ({
      id: c.id,
      type: "pessoa" as const,
      title: c.nome,
      subtitle: `${c.tipoPessoa === "fisica" ? "PF" : "PJ"} · ${c.cpfCnpj ?? "sem doc"} · Cliente`,
      href: `/locacao/pessoas/clientes/${c.id}`,
    })),
    ...cobrancas.map((c) => ({
      id: c.id,
      type: "cobranca" as const,
      title: `${c.competencia} · ${c.leaseContract?.tenants[0]?.tenant.nome ?? "—"}`,
      subtitle: `${c.leaseContract?.property?.rua ?? ""} · R$ ${c.valorBase.toFixed(2)}`,
      href: `/locacao/cobrancas?competencia=${c.competencia}`,
    })),
  ];

  return NextResponse.json({ results });
}
