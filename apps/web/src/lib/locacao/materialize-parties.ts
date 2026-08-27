import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

// Normaliza as partes do LeaseContract.dataJson (locadores/locatários/angariadores)
// em registros canônicos PropertyOwner/Tenant/LeaseTenant/PropertyOwnership/
// LeaseAngariador. Chamado na ATIVAÇÃO ("Criar administração"): em rascunho as
// partes ficam só no dataJson (evita atrito de cpf vazio); ao ativar viram
// cadastros reais — é o que faz as listas /locacao/contratos e /locacao/imoveis
// pararem de mostrar "sem inquilinos" / sem proprietário.
//
// Idempotente: upsert por (orgId, cpfCnpj) e pelas uniques dos joins → re-rodar
// não duplica. Partes sem CPF/CNPJ recebem chave sintética (a unique (orgId,
// cpfCnpj) colidiria entre várias partes sem doc); o doc sintético é substituível
// editando a pessoa depois.

type AnyRecord = Record<string, unknown>;

function asRecord(v: unknown): AnyRecord {
  return v && typeof v === "object" ? (v as AnyRecord) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

interface PartyFields {
  tipoPessoa: string;
  nome: string;
  cpfCnpj: string;
  email: string | null;
  phone: string | null;
}

/** Resolve uma parte do form (PF: nome/cpf; PJ: razao_social/cnpj + representante). */
function partyFields(raw: unknown): PartyFields | null {
  const p = asRecord(raw);
  const isPj = str(p.tipo_pessoa) === "juridica";
  if (isPj) {
    const nome = str(p.razao_social);
    if (!nome) return null;
    const rep = asRecord(p.representante);
    return {
      tipoPessoa: "juridica",
      nome,
      cpfCnpj: str(p.cnpj),
      email: str(p.email) || str(rep.email) || null,
      phone: str(rep.mobile_phone) || null,
    };
  }
  const nome = str(p.nome);
  if (!nome) return null;
  return {
    tipoPessoa: "fisica",
    nome,
    cpfCnpj: str(p.cpf),
    email: str(p.email) || null,
    phone: str(p.mobile_phone) || null,
  };
}

/** Doc real ou chave sintética estável (evita colisão da unique (orgId,cpfCnpj)). */
function docOrSynthetic(doc: string, leaseId: string, papel: string, idx: number): string {
  return doc || `sem-doc:${leaseId}:${papel}:${idx}`;
}

export async function materializeLeaseParties(
  args: { orgId: string; leaseContractId: string },
  db: Prisma.TransactionClient = prisma
): Promise<void> {
  const { orgId, leaseContractId } = args;
  const lease = await db.leaseContract.findFirst({
    where: { id: leaseContractId, orgId },
    select: { id: true, propertyId: true, dataJson: true },
  });
  if (!lease) return;

  const data = asRecord(lease.dataJson);
  const locadores = Array.isArray(data.locadores) ? data.locadores : [];
  const locatarios = Array.isArray(data.locatarios) ? data.locatarios : [];
  const comissao = asRecord(data.comissao);
  const angariadores = Array.isArray(comissao.angariadores) ? comissao.angariadores : [];

  // Locadores → PropertyOwner + PropertyOwnership (rateio igual; 1º = principal).
  const validLocadores = locadores
    .map((raw, idx) => ({ f: partyFields(raw), idx }))
    .filter((x): x is { f: PartyFields; idx: number } => x.f !== null);
  const ownerPct =
    validLocadores.length > 0
      ? Math.round((100 / validLocadores.length) * 100) / 100
      : 100;
  for (const { f, idx } of validLocadores) {
    const cpfCnpj = docOrSynthetic(f.cpfCnpj, leaseContractId, "locador", idx);
    const owner = await db.propertyOwner.upsert({
      where: { orgId_cpfCnpj: { orgId, cpfCnpj } },
      create: {
        orgId,
        tipoPessoa: f.tipoPessoa,
        nome: f.nome,
        cpfCnpj,
        email: f.email,
        phone: f.phone,
      },
      update: { nome: f.nome, email: f.email ?? undefined, phone: f.phone ?? undefined },
    });
    if (lease.propertyId) {
      await db.propertyOwnership.upsert({
        where: { propertyId_ownerId: { propertyId: lease.propertyId, ownerId: owner.id } },
        create: {
          orgId,
          propertyId: lease.propertyId,
          ownerId: owner.id,
          percentual: ownerPct,
          tipo: idx === 0 ? "proprietario_principal" : "proprietario",
        },
        update: {},
      });
    }
  }

  // Locatários → Tenant + LeaseTenant (1º = titular, demais = solidário).
  const validLocatarios = locatarios
    .map((raw, idx) => ({ f: partyFields(raw), idx }))
    .filter((x): x is { f: PartyFields; idx: number } => x.f !== null);
  for (const { f, idx } of validLocatarios) {
    const cpfCnpj = docOrSynthetic(f.cpfCnpj, leaseContractId, "locatario", idx);
    const tenant = await db.tenant.upsert({
      where: { orgId_cpfCnpj: { orgId, cpfCnpj } },
      create: {
        orgId,
        tipoPessoa: f.tipoPessoa,
        nome: f.nome,
        cpfCnpj,
        email: f.email,
        phone: f.phone,
      },
      update: { nome: f.nome, email: f.email ?? undefined, phone: f.phone ?? undefined },
    });
    await db.leaseTenant.upsert({
      where: { leaseContractId_tenantId: { leaseContractId, tenantId: tenant.id } },
      create: { orgId, leaseContractId, tenantId: tenant.id, tipo: idx === 0 ? "titular" : "solidario" },
      update: {},
    });
  }

  // Angariadores → PropertyOwner (cadastro de corretor) + LeaseAngariador.
  for (let idx = 0; idx < angariadores.length; idx++) {
    const a = asRecord(angariadores[idx]);
    const nome = str(a.nome);
    if (!nome) continue;
    const cpfCnpj = docOrSynthetic(str(a.cpf) || str(a.cnpj), leaseContractId, "angariador", idx);
    // A imobiliária parceira entra como angariador PJ; hardcodar "fisica" fazia
    // o cadastro nascer com a pessoa errada (e o CNPJ num campo de CPF).
    const tipoPessoa =
      str(a.tipo_pessoa) === "juridica" || (!str(a.cpf) && str(a.cnpj))
        ? "juridica"
        : "fisica";
    const party = await db.propertyOwner.upsert({
      where: { orgId_cpfCnpj: { orgId, cpfCnpj } },
      create: { orgId, tipoPessoa, nome, cpfCnpj },
      update: { nome },
    });
    // LeaseAngariador não tem unique composto — checar antes de criar (idempotência).
    const existing = await db.leaseAngariador.findFirst({
      where: { leaseContractId, partyId: party.id },
      select: { id: true },
    });
    if (!existing) {
      await db.leaseAngariador.create({
        data: {
          orgId,
          leaseContractId,
          partyId: party.id,
          formaComissao: str(a.forma_comissao) === "valor_fixo" ? "valor_fixo" : "percentual",
          percentual: num(a.percentual),
          valorFixo: num(a.valor_fixo),
          mesesComissao: num(a.meses_comissao),
        },
      });
    }
  }
}
