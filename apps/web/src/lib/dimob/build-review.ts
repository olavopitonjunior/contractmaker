/**
 * Modelo de REVISÃO da DIMOB: transforma o agregado em registros decodificados,
 * cada campo com origem ("de onde veio") e status de validação. É o que a grade
 * editável consome. Puro e testável.
 */

import { R01_LAYOUT, R02_LAYOUT, R04_LAYOUT, type DimobRecordLayout } from "./layout";
import { decodeRecord, type DecodedCell } from "./decode";
import type { DimobValue } from "./txt-writer";
import {
  declaranteValues,
  saleRecordValues,
  leaseRecordValues,
  type OwnerR02,
} from "./build-file";
import {
  validateDeclarante,
  validateRecord,
  validateLeaseRecord,
  type DimobIssue,
} from "./validate";
import type { DimobSalesAggregate, DimobDeclarante } from "./aggregate-sales";
import type { DimobLeaseRecord } from "./aggregate-lease";

/** validate.ts usa alguns nomes de campo diferentes das chaves do layout. */
const FIELD_ALIAS: Record<string, string> = {
  cnpj: "cnpjDeclarante",
  dataOperacao: "dataContrato",
};

/** Origem dos campos do R01 (declarante). */
const R01_ORIGINS: Record<string, string> = {
  cnpjDeclarante: "Organization.cnpj (Dados fiscais)",
  anoCalendario: "ano selecionado",
  nomeEmpresarial: "Organization.legalName (Dados fiscais)",
  cpfResponsavel: "Organization.fiscalResponsibleCpf (Dados fiscais)",
  endereco: "Organization.legalAddress (Dados fiscais)",
  uf: "Organization.fiscalUf (Dados fiscais)",
  codigoMunicipio: "Organization.fiscalMunicipioCode (Dados fiscais)",
};

export type CellStatus = "ok" | "warning" | "error";

export interface ReviewCell extends DecodedCell {
  origin: string | null;
  status: CellStatus;
  statusMessage: string | null;
  /** true quando o valor foi editado pelo usuário (override). */
  overridden?: boolean;
  /** Valor original (pré-edição), para o "era: …". */
  originalValue?: string | null;
}

export interface ReviewRecord {
  recordId: string;
  kind: string; // "R01" | "R04"
  title: string;
  dealId: string | null;
  cells: ReviewCell[];
  raw: string;
  /** Pendências que não casam com uma célula específica (ex.: rateio). */
  recordIssues: DimobIssue[];
}

const RANK: Record<CellStatus, number> = { ok: 0, warning: 1, error: 2 };

function statusFromLevel(level: DimobIssue["level"]): CellStatus {
  return level === "error" ? "error" : "warning";
}

function enrich(
  layout: DimobRecordLayout,
  values: Record<string, DimobValue>,
  origins: Record<string, string>,
  issues: DimobIssue[]
): { cells: ReviewCell[]; raw: string; unmatched: DimobIssue[] } {
  const decoded = decodeRecord(layout, values);
  const cellKeys = new Set(decoded.cells.map((c) => c.key));

  // Agrupa issues por chave de célula (aplicando alias); guarda os sem match.
  const byCell = new Map<string, DimobIssue[]>();
  const unmatched: DimobIssue[] = [];
  for (const issue of issues) {
    const key = FIELD_ALIAS[issue.field] ?? issue.field;
    if (cellKeys.has(key)) {
      byCell.set(key, [...(byCell.get(key) ?? []), issue]);
    } else {
      unmatched.push(issue);
    }
  }

  const cells: ReviewCell[] = decoded.cells.map((c) => {
    const cellIssues = byCell.get(c.key) ?? [];
    let status: CellStatus = "ok";
    let statusMessage: string | null = null;
    for (const i of cellIssues) {
      const s = statusFromLevel(i.level);
      if (RANK[s] >= RANK[status]) {
        status = s;
        statusMessage = i.message;
      }
    }
    return { ...c, origin: origins[c.key] ?? null, status, statusMessage };
  });

  return { cells, raw: decoded.raw, unmatched };
}

/**
 * Marca (mutando) as células que foram editadas pelo usuário, anexando o valor
 * original a partir dos registros do agregado SEM overrides.
 */
export function markOverrides(
  records: ReviewRecord[],
  original: ReviewRecord[],
  state: Record<string, Record<string, string>>
): void {
  const origIndex = new Map<string, Map<string, string>>();
  for (const r of original) {
    const m = new Map<string, string>();
    for (const c of r.cells) m.set(c.key, c.value);
    origIndex.set(r.recordId, m);
  }
  for (const r of records) {
    const ov = state[r.recordId];
    if (!ov) continue;
    const om = origIndex.get(r.recordId);
    for (const c of r.cells) {
      if (ov[c.key] !== undefined) {
        c.overridden = true;
        c.originalValue = om?.get(c.key) ?? null;
      }
    }
  }
}

/** Constrói a lista de registros de revisão (R01 + um R04 por operação). */
export function buildReviewRecords(agg: DimobSalesAggregate): ReviewRecord[] {
  const out: ReviewRecord[] = [];

  // R01 — declarante
  const r01 = enrich(
    R01_LAYOUT,
    declaranteValues(agg.declarante, agg.year),
    R01_ORIGINS,
    validateDeclarante(agg.declarante)
  );
  out.push({
    recordId: "declarante",
    kind: "R01",
    title: "Declarante (dados iniciais)",
    dealId: null,
    cells: r01.cells,
    raw: r01.raw,
    recordIssues: r01.unmatched,
  });

  // R04 — uma linha por operação
  agg.records.forEach((r, i) => {
    const res = enrich(
      R04_LAYOUT,
      saleRecordValues(agg.declarante, agg.year, r, i + 1),
      r.fieldOrigins,
      validateRecord(r)
    );
    out.push({
      recordId: r.recordId,
      kind: "R04",
      title: `${r.vendedor.nome || "— vendedor —"} → ${r.comprador.nome || "— comprador —"}`,
      dealId: r.dealId,
      cells: res.cells,
      raw: res.raw,
      recordIssues: res.unmatched,
    });
  });

  return out;
}

// ───────────────────────── Locação (R02) ─────────────────────────

export interface LeaseMonthCell {
  month: number; // 1..12
  aluguel: number;
  comissao: number;
  imposto: number;
  aluguelOverridden?: boolean;
  comissaoOverridden?: boolean;
  impostoOverridden?: boolean;
}

export interface LeaseReviewRecord {
  recordId: string;
  leaseId: string;
  kind: "R02";
  title: string; // locador → locatário
  locador: { nome: string; cpfCnpj: string; tipoPessoa: string };
  locatario: { nome: string; cpfCnpj: string };
  imovel: DimobLeaseRecord["imovel"];
  numeroContrato: string | null;
  dataContrato: string | null;
  meses: LeaseMonthCell[];
  totais: { aluguel: number; comissao: number; imposto: number };
  raw: string;
  recordIssues: DimobIssue[];
  overridden: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function ownerFromLeaseRecord(r: DimobLeaseRecord): OwnerR02 {
  return {
    ownerId: r.ownerId,
    locador: r.locador,
    locatario: r.locatario,
    numeroContrato: r.numeroContrato,
    dataContrato: r.dataContrato,
    meses: r.meses,
    imovel: r.imovel,
  };
}

/**
 * Constrói os registros de revisão de LOCAÇÃO — um card por lease×locador, com a
 * tabela mensal (Jan–Dez × Aluguel/Comissão/IRRF). `raw` é a linha R02 que ESTE
 * registro contribui (o TXT final ainda colapsa por locador). Puro.
 */
export function buildLeaseReviewRecords(
  declarante: DimobDeclarante,
  year: number,
  records: DimobLeaseRecord[],
  state: Record<string, Record<string, string>> = {}
): LeaseReviewRecord[] {
  return records.map((r, i) => {
    const ov = state[r.recordId] ?? {};
    const meses: LeaseMonthCell[] = r.meses.map((m, idx) => {
      const month = idx + 1;
      return {
        month,
        aluguel: m.rendimento,
        comissao: m.comissao,
        imposto: m.imposto,
        aluguelOverridden: ov[`aluguel_${month}`] !== undefined || undefined,
        comissaoOverridden: ov[`comissao_${month}`] !== undefined || undefined,
        impostoOverridden: ov[`imposto_${month}`] !== undefined || undefined,
      };
    });
    const totais = {
      aluguel: round2(meses.reduce((a, m) => a + m.aluguel, 0)),
      comissao: round2(meses.reduce((a, m) => a + m.comissao, 0)),
      imposto: round2(meses.reduce((a, m) => a + m.imposto, 0)),
    };
    const raw = decodeRecord(
      R02_LAYOUT,
      leaseRecordValues(declarante, year, ownerFromLeaseRecord(r), i + 1)
    ).raw;
    return {
      recordId: r.recordId,
      leaseId: r.leaseId,
      kind: "R02" as const,
      title: `${r.locador.nome || "— locador —"} → ${r.locatario.nome || "— locatário —"}`,
      locador: r.locador,
      locatario: r.locatario,
      imovel: r.imovel,
      numeroContrato: r.numeroContrato,
      dataContrato: r.dataContrato,
      meses,
      totais,
      raw,
      recordIssues: validateLeaseRecord(r),
      overridden: Object.keys(ov).length > 0,
    };
  });
}
