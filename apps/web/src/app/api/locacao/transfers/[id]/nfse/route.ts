import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { emitirNfse } from "@/lib/nfse/focus-nfe-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/locacao/transfers/[id]/nfse — dispara emissão de NFS-e pra o repasse.
 *
 * Fluxo:
 *  - Busca AsaasTransfer + RentCharge correlato + LeaseContract + ownerships
 *  - Resolve prestador (imobiliária CNPJ) e tomador (proprietário principal)
 *  - Chama Focus NFe → atualiza AsaasTransfer.nfse{Emitida,Numero,Url}
 *  - Stub mode quando NFE_FOCUS_API_KEY ausente
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.RENT_MARK_REPASSED);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const transfer = await prisma.asaasTransfer.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!transfer) {
    return NextResponse.json({ error: "Transfer não encontrado" }, { status: 404 });
  }
  if (transfer.nfseEmitida) {
    return NextResponse.json(
      { error: "NFS-e já emitida pra este repasse", numero: transfer.nfseNumero },
      { status: 409 }
    );
  }

  // Resolve contexto: rentCharge → leaseContract → property/ownerships.
  const rentCharge = await prisma.rentCharge.findFirst({
    where: { repasseTransferId: id, orgId: ctx.orgId },
    include: {
      leaseContract: {
        include: {
          property: {
            include: {
              ownerships: { include: { owner: true } },
            },
          },
        },
      },
    },
  });
  if (!rentCharge?.leaseContract) {
    return NextResponse.json(
      { error: "Transfer sem cobrança/contrato vinculado — NFS-e exige contexto fiscal" },
      { status: 422 }
    );
  }

  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { name: true },
  });

  const principal =
    rentCharge.leaseContract.property?.ownerships.find(
      (o) => o.tipo === "proprietario_principal"
    ) ?? rentCharge.leaseContract.property?.ownerships[0];
  if (!principal) {
    return NextResponse.json(
      { error: "Imóvel sem proprietário principal cadastrado" },
      { status: 422 }
    );
  }

  // Prestador (imobiliária) — vem de config futura; stub usa placeholder.
  const prestadorCnpj = process.env.NFE_PRESTADOR_CNPJ ?? "00000000000000";
  const prestadorInscricao = process.env.NFE_PRESTADOR_INSCRICAO_MUNICIPAL ?? "0000000";

  const enderecoFmt = rentCharge.leaseContract.property
    ? [
        rentCharge.leaseContract.property.rua,
        rentCharge.leaseContract.property.numero,
        rentCharge.leaseContract.property.bairro,
        rentCharge.leaseContract.property.cidade,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  const result = await emitirNfse({
    referencia: transfer.id,
    prestador: {
      cnpj: prestadorCnpj,
      inscricaoMunicipal: prestadorInscricao,
    },
    tomador: {
      cpfCnpj: principal.owner.cpfCnpj,
      razaoSocial: principal.owner.nome,
      email: principal.owner.email ?? undefined,
    },
    servico: {
      valor: transfer.value,
      descricao: `Repasse de aluguel competência ${rentCharge.competencia} · ${enderecoFmt}`,
      itemListaServico: "01.06", // Locação de imóveis (LC 116/2003)
      aliquota: 5,
    },
  });

  // Atualiza AsaasTransfer com o resultado.
  await prisma.asaasTransfer.update({
    where: { id },
    data: {
      nfseEmitida: result.status === "autorizado" || result.status === "stub",
      nfseRequerida: true,
      nfseNumero: result.numero ?? null,
      nfseUrl: result.pdfUrl ?? null,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: result.status === "erro" ? "TRANSFER_NFSE_REQUESTED" : "TRANSFER_NFSE_EMITTED",
      result: result.status === "erro" ? "FAILURE" : "SUCCESS",
      resource: transfer.id,
      resourceType: "AsaasTransfer",
      metadata: {
        nfseStatus: result.status,
        nfseNumero: result.numero,
        error: result.errorMessage,
      },
    }
  );

  return NextResponse.json({
    status: result.status,
    numero: result.numero,
    pdfUrl: result.pdfUrl,
    error: result.errorMessage,
  });
}
