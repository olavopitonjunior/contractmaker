import { prisma } from "@/lib/db/prisma";
import { normalizeGarantiaTipo } from "@/lib/contracts/template-category";
import { nextReadjustmentDate } from "@/lib/locacao/readjustment-calculator";

// Materializa/atualiza o LeaseContract a partir do dataJson do formulário público
// de locação e o liga ao Contract (Google Doc) recém-gerado. Idempotente por
// dealId: se já existe LeaseContract do deal, só atualiza contractId + campos.
//
// Escopo (form path): cria o Property (LeaseContract.propertyId é obrigatório) a
// partir do imóvel inline + o LeaseContract rascunho com os campos fiscais
// (config.fiscal, operador-only) + Guarantee. As partes (locadores/locatários/
// angariadores) ficam no LeaseContract.dataJson; a normalização em
// PropertyOwner/Tenant/LeaseAngariador acontece na ativação ("Criar
// administração"), evitando o atrito de cpf vazio em rascunho.

type AnyRecord = Record<string, unknown>;

function asRecord(v: unknown): AnyRecord {
  return v && typeof v === "object" ? (v as AnyRecord) : {};
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseLocalDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const dt = ymd
    ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0)
    : new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export async function createLeaseContractFromDataJson(args: {
  orgId: string;
  deal: { id: string };
  dataJson: AnyRecord;
  contractId: string;
}): Promise<{ leaseContractId: string }> {
  const { orgId, deal, dataJson, contractId } = args;
  const imovel = asRecord(dataJson.imovel);
  const aluguel = asRecord(dataJson.aluguel);
  const fiscal = asRecord(dataJson.fiscal);
  const garantia = asRecord(dataJson.garantia);
  const finalidade =
    typeof dataJson.finalidade === "string" ? (dataJson.finalidade as string) : "residencial";

  // Se já existe LeaseContract pro deal, só liga o contractId (idempotência).
  const existing = await prisma.leaseContract.findFirst({ where: { dealId: deal.id, orgId } });
  if (existing) {
    await prisma.leaseContract.update({
      where: { id: existing.id },
      data: { contractId },
    });
    return { leaseContractId: existing.id };
  }

  // Property: usa o referenciado (se pertencer à org) ou cria do imóvel inline.
  let propertyId: string | null = null;
  const refId = typeof imovel.propertyId === "string" ? (imovel.propertyId as string) : null;
  if (refId) {
    const p = await prisma.property.findFirst({ where: { id: refId, orgId }, select: { id: true } });
    propertyId = p?.id ?? null;
  }
  if (!propertyId) {
    const created = await prisma.property.create({
      data: {
        orgId,
        kind: typeof imovel.kind === "string" ? (imovel.kind as string) : "apartamento",
        status: "em_negociacao",
        rua: (imovel.rua as string) || null,
        numero: (imovel.numero as string) || null,
        complemento: (imovel.complemento as string) || null,
        bairro: (imovel.bairro as string) || null,
        cidade: (imovel.cidade as string) || null,
        uf: (imovel.uf as string) || null,
        cep: (imovel.cep as string) || null,
        matricula: (imovel.matricula as string) || null,
        cartorio: (imovel.cartorio as string) || null,
        inscricaoIptu: (imovel.inscricao_iptu as string) || null,
        area: imovel.area != null ? num(imovel.area) : null,
        descricaoIa: (imovel.descricao as string) || null,
      },
    });
    propertyId = created.id;
  }

  const inicio = parseLocalDate(aluguel.vigencia_inicio) ?? new Date();
  const meses = num(aluguel.vigencia_meses, 30);
  const fim = new Date(inicio);
  fim.setMonth(fim.getMonth() + meses);

  const lease = await prisma.leaseContract.create({
    data: {
      orgId,
      propertyId,
      dealId: deal.id,
      contractId,
      status: "rascunho",
      finalidade,
      valorAluguel: num(aluguel.valor),
      valorEncargos: num(aluguel.encargos),
      diaVencimento: num(aluguel.dia_vencimento, 10),
      indiceReajuste:
        typeof aluguel.indice_reajuste === "string" ? (aluguel.indice_reajuste as string) : "IGPM",
      vigenciaInicio: inicio,
      vigenciaFim: fim,
      dataProximoReajuste: nextReadjustmentDate(inicio),
      taxaAdminPercent: num(fiscal.taxa_admin_percent ?? aluguel.taxa_admin_percent, 10),
      regimeIr: typeof fiscal.regime_ir === "string" ? (fiscal.regime_ir as string) : "nao_retem",
      regimeCobranca:
        typeof fiscal.regime_cobranca === "string"
          ? (fiscal.regime_cobranca as string)
          : "mes_a_vencer",
      isencaoMultaMeses: fiscal.isencao_multa_meses != null ? num(fiscal.isencao_multa_meses) : null,
      emitirNfse: fiscal.emitir_nfse === true,
      repasseGarantido:
        typeof fiscal.repasse_garantido === "string" ? (fiscal.repasse_garantido as string) : "nao",
      repasseGarantidoMeses:
        fiscal.repasse_garantido_meses != null ? num(fiscal.repasse_garantido_meses) : null,
      // Guarda o form completo — a aba do deal lê partes/comissão daqui até a
      // normalização em PropertyOwner/Tenant/LeaseAngariador na ativação.
      dataJson: dataJson as object,
    },
  });

  // Guarantee (1:1) quando há modalidade definida ≠ sem_garantia.
  // Canonicaliza na ESCRITA: um dataJson legado não pode criar Guarantee nova
  // com o valor renomeado (`garantia_digital`).
  const gtipo =
    normalizeGarantiaTipo(garantia.tipo) ??
    (typeof garantia.tipo === "string" ? (garantia.tipo as string) : null);
  if (gtipo && gtipo !== "sem_garantia") {
    await prisma.guarantee.create({
      data: {
        orgId,
        leaseContractId: lease.id,
        tipo: gtipo,
        provider: (garantia.provider as string) || null,
        coberturaMeses: garantia.cobertura_meses != null ? num(garantia.cobertura_meses) : null,
        fiadorPartyJson: gtipo === "fiador" ? (asRecord(garantia.fiador) as object) : undefined,
        status: "pendente",
      },
    });
  }

  return { leaseContractId: lease.id };
}
