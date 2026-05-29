import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { exportPdfToBuffer } from "@/lib/render/exporter";
import { registerHandlebarsHelpers } from "@/lib/render/handlebars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DocKind = "espelho" | "contrato" | "recibo";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/locacao/leases/[id]/print?kind=espelho|contrato|recibo&competencia=YYYY-MM
 *
 * Renderiza template Handlebars + gera PDF via Puppeteer serverless e devolve
 * como download. `recibo` exige `?competencia=YYYY-MM` (cobrança paga daquela
 * competência); `espelho` e `contrato` usam dados atuais do contrato.
 *
 * `contrato` reusa o templates/locacao_residencial_v2.hbs já sincronizado em prod.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_VIEW);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const kind = (req.nextUrl.searchParams.get("kind") ?? "espelho") as DocKind;
  if (!["espelho", "contrato", "recibo"].includes(kind)) {
    return NextResponse.json({ error: "Kind inválido" }, { status: 422 });
  }

  const lease = await prisma.leaseContract.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      property: {
        include: { ownerships: { include: { owner: true } } },
      },
      tenants: { include: { tenant: true } },
      guarantee: true,
    },
  });
  if (!lease) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { name: true },
  });

  registerHandlebarsHelpers();

  const enderecoImovel = lease.property
    ? [
        [lease.property.rua, lease.property.numero].filter(Boolean).join(", "),
        lease.property.bairro,
        [lease.property.cidade, lease.property.uf].filter(Boolean).join("/"),
        lease.property.cep,
      ]
        .filter(Boolean)
        .join(" · ")
    : "—";

  const templateFile =
    kind === "recibo" ? "recibo_locacao.hbs" : kind === "espelho" ? "espelho_locacao.hbs" : "locacao_residencial_v2.hbs";

  const templatePath = path.join(process.cwd(), "templates", templateFile);
  let templateSource: string;
  try {
    templateSource = await fs.readFile(templatePath, "utf-8");
  } catch (err) {
    return NextResponse.json(
      { error: `Template ${templateFile} não encontrado`, detail: String(err) },
      { status: 500 }
    );
  }

  const template = Handlebars.compile(templateSource, { noEscape: false });
  const today = new Date().toLocaleDateString("pt-BR");

  let html: string;
  if (kind === "recibo") {
    const competencia = req.nextUrl.searchParams.get("competencia");
    if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) {
      return NextResponse.json(
        { error: "Param `competencia` (YYYY-MM) obrigatória pra recibo" },
        { status: 422 }
      );
    }
    const charge = await prisma.rentCharge.findFirst({
      where: {
        leaseContractId: lease.id,
        orgId: ctx.orgId,
        competencia,
        status: { in: ["paga", "repassada"] },
      },
    });
    if (!charge) {
      return NextResponse.json(
        { error: "Sem cobrança paga nessa competência" },
        { status: 404 }
      );
    }
    const titular = lease.tenants.find((t) => t.tipo === "titular") ?? lease.tenants[0];
    const principal =
      lease.property?.ownerships.find((o) => o.tipo === "proprietario_principal") ??
      lease.property?.ownerships[0];
    const valorTotalNum =
      charge.valorBase + charge.encargos + charge.multa + charge.juros;
    html = template({
      nomeOrg: org?.name ?? "imobpro.ai",
      competencia: charge.competencia,
      inquilino: titular?.tenant.nome ?? "—",
      cpfCnpjInquilino: titular?.tenant.cpfCnpj ?? "—",
      enderecoImovel,
      dataVencimento: charge.dueDate.toLocaleDateString("pt-BR"),
      dataPagamento: charge.paidAt?.toLocaleDateString("pt-BR") ?? "—",
      aluguelBase: `R$ ${charge.valorBase.toFixed(2)}`,
      encargos: `R$ ${charge.encargos.toFixed(2)}`,
      multa: charge.multa > 0 ? `R$ ${charge.multa.toFixed(2)}` : null,
      juros: charge.juros > 0 ? `R$ ${charge.juros.toFixed(2)}` : null,
      valorTotal: `R$ ${valorTotalNum.toFixed(2)}`,
      valorPorExtenso: Handlebars.helpers.extenso(valorTotalNum),
      nomeProprietario: principal?.owner.nome ?? "Proprietário",
      dataEmissao: today,
    });
  } else if (kind === "espelho") {
    html = template({
      nomeOrg: org?.name ?? "imobpro.ai",
      enderecoImovel,
      finalidade: lease.finalidade,
      status: lease.status,
      vigenciaInicio: lease.vigenciaInicio?.toLocaleDateString("pt-BR") ?? "—",
      vigenciaFim: lease.vigenciaFim?.toLocaleDateString("pt-BR") ?? "indeterminado",
      aluguel: `R$ ${lease.valorAluguel.toFixed(2)}`,
      encargos: `R$ ${lease.valorEncargos.toFixed(2)}`,
      diaVencimento: lease.diaVencimento,
      taxaAdmPercent: lease.taxaAdminPercent,
      indiceReajuste: lease.indiceReajuste,
      regimeIr: lease.regimeIr,
      locadores: lease.property?.ownerships.map((o) => ({
        nome: o.owner.nome,
        percentual: o.percentual,
      })) ?? [],
      locatarios: lease.tenants.map((t) => ({
        nome: t.tenant.nome,
        tipo: t.tipo,
      })),
      garantia: lease.guarantee
        ? {
            tipo: lease.guarantee.tipo,
            provider: lease.guarantee.provider,
            status: lease.guarantee.status,
          }
        : null,
      dataEmissao: today,
    });
  } else {
    // contrato — usa o locacao_residencial_v2.hbs com payload mínimo. Quem
    // quiser PDF do contrato fiel deve gerar via Google Docs export.
    html = template({
      locador: lease.property?.ownerships.map((o) => ({
        tipo_pessoa: "fisica",
        nome: o.owner.nome,
      })) ?? [],
      locatario: lease.tenants.map((t) => ({
        tipo_pessoa: "fisica",
        nome: t.tenant.nome,
      })),
      imovel: {
        rua: lease.property?.rua,
        numero: lease.property?.numero,
        bairro: lease.property?.bairro,
        cidade: lease.property?.cidade,
        uf: lease.property?.uf,
        cep: lease.property?.cep,
      },
      aluguel: {
        valor: lease.valorAluguel,
        encargos: lease.valorEncargos,
        dia_vencimento: lease.diaVencimento,
      },
      config: {
        municipio_imovel: lease.property?.cidade ?? "—",
        data_assinatura: today,
        vigencia_inicio_texto: lease.vigenciaInicio?.toLocaleDateString("pt-BR") ?? "—",
        vigencia_fim_texto: lease.vigenciaFim?.toLocaleDateString("pt-BR") ?? "—",
      },
    });
  }

  const buffer = await exportPdfToBuffer(html);
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${kind}_${lease.id.slice(0, 8)}.pdf"`,
    },
  });
}
