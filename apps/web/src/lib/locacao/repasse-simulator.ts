// Cálculo puro do preview de repasse — sem I/O. Reusado pelo endpoint
// /api/locacao/repasses/simular e testável isoladamente.

export interface ChargeInput {
  rentChargeId: string;
  competencia: string;
  valorBase: number;
  encargos: number;
  taxaAdminPercent: number;
  regimeIr: string;
  ownerships: Array<{ ownerId: string; nome: string; percentual: number }>;
}

export interface OwnerSplit {
  ownerId: string;
  nome: string;
  percentual: number;
  valorLiquido: number;
  irRetido: number;
}

export interface SimulationResult {
  totalBruto: number;
  totalTaxaAdm: number;
  totalIrRetido: number;
  totalLiquidoProprietarios: number;
  porProprietario: OwnerSplit[];
  detalhes: Array<{
    rentChargeId: string;
    competencia: string;
    valorBase: number;
    encargos: number;
    taxaAdmAplicada: number;
    regimeIr: string;
    irRetido: number;
  }>;
}

const IR_ALIQUOTA_PROXY = 0.275;

export function simulateRepasse(charges: ChargeInput[]): SimulationResult {
  const ownerAccum = new Map<string, OwnerSplit>();
  const detalhes: SimulationResult["detalhes"] = [];
  let totalBruto = 0;
  let totalTaxaAdm = 0;
  let totalIrRetido = 0;

  for (const c of charges) {
    const bruto = c.valorBase + c.encargos;
    totalBruto += bruto;

    const taxaAdmValor = (bruto * c.taxaAdminPercent) / 100;
    totalTaxaAdm += taxaAdmValor;

    const ir = c.regimeIr === "retem_imobiliaria" ? c.valorBase * IR_ALIQUOTA_PROXY : 0;
    totalIrRetido += ir;

    const liquidoTotal = bruto - taxaAdmValor - ir;

    detalhes.push({
      rentChargeId: c.rentChargeId,
      competencia: c.competencia,
      valorBase: c.valorBase,
      encargos: c.encargos,
      taxaAdmAplicada: taxaAdmValor,
      regimeIr: c.regimeIr,
      irRetido: ir,
    });

    for (const own of c.ownerships) {
      const parteOwner = liquidoTotal * (own.percentual / 100);
      const irOwner = ir * (own.percentual / 100);
      const existing = ownerAccum.get(own.ownerId);
      if (existing) {
        existing.valorLiquido += parteOwner;
        existing.irRetido += irOwner;
      } else {
        ownerAccum.set(own.ownerId, {
          ownerId: own.ownerId,
          nome: own.nome,
          percentual: own.percentual,
          valorLiquido: parteOwner,
          irRetido: irOwner,
        });
      }
    }
  }

  const totalLiquidoProprietarios = Array.from(ownerAccum.values()).reduce(
    (acc, o) => acc + o.valorLiquido,
    0
  );

  return {
    totalBruto,
    totalTaxaAdm,
    totalIrRetido,
    totalLiquidoProprietarios,
    porProprietario: Array.from(ownerAccum.values()).sort(
      (a, b) => b.valorLiquido - a.valorLiquido
    ),
    detalhes,
  };
}
