/**
 * Validação da DIMOB de vendas. Funções puras sobre o agregado.
 *
 * `error`   => bloqueia a geração do TXT (campo obrigatório ausente/ inválido).
 * `warning` => não bloqueia, mas o usuário deve revisar (ex.: comissão caiu no
 *              fallback total, rateio ambíguo multi-parte).
 *
 * Campos NÃO obrigatórios (FAQ p58/59): número e data do contrato do imóvel,
 * endereço do imóvel — nunca bloqueiam.
 */

import { isValidCpfCnpj } from "@/lib/validators/cnpj";
import type {
  DimobSalesAggregate,
  DimobSaleRecord,
  DimobDeclarante,
} from "./aggregate-sales";
import type { DimobLeaseRecord } from "./aggregate-lease";

export type DimobIssueLevel = "error" | "warning";

export interface DimobIssue {
  level: DimobIssueLevel;
  scope: "declarante" | "operacao" | "locacao";
  field: string;
  message: string;
  dealId?: string;
  leaseId?: string;
}

export function validateDeclarante(d: DimobDeclarante): DimobIssue[] {
  const issues: DimobIssue[] = [];
  const err = (field: string, message: string) =>
    issues.push({ level: "error", scope: "declarante", field, message });

  if (!isValidCpfCnpj(d.cnpj) || d.cnpj.length !== 14) {
    err("cnpj", "CNPJ do declarante ausente ou inválido.");
  }
  if (!d.nomeEmpresarial) err("nomeEmpresarial", "Nome empresarial do declarante ausente.");
  if (d.cpfResponsavel.length !== 11) {
    err("cpfResponsavel", "CPF do responsável perante a RFB ausente ou inválido.");
  }
  if (!/^[A-Za-z]{2}$/.test(d.uf)) err("uf", "UF do declarante ausente.");
  if (!d.codigoMunicipio) err("codigoMunicipio", "Código do município do declarante ausente.");
  return issues;
}

export function validateRecord(r: DimobSaleRecord): DimobIssue[] {
  const issues: DimobIssue[] = [];
  const push = (level: DimobIssueLevel, field: string, message: string) =>
    issues.push({ level, scope: "operacao", field, message, dealId: r.dealId });

  if (!r.comprador.nome) push("error", "nomeComprador", "Comprador sem nome.");
  if (!isValidCpfCnpj(r.comprador.cpfCnpj)) {
    push("error", "cpfCnpjComprador", "CPF/CNPJ do comprador ausente ou inválido.");
  }
  if (!r.vendedor.nome) push("error", "nomeVendedor", "Vendedor sem nome.");
  if (!isValidCpfCnpj(r.vendedor.cpfCnpj)) {
    push("error", "cpfCnpjVendedor", "CPF/CNPJ do vendedor ausente ou inválido.");
  }
  if (!r.dataOperacao) push("error", "dataOperacao", "Data da operação (assinatura) ausente.");
  if (!(r.valorAlienacao > 0)) push("error", "valorAlienacao", "Valor da alienação ausente ou zero.");

  if (!(r.valorComissao > 0)) {
    push("warning", "valorComissao", "Comissão do declarante zerada — confirme se não houve comissão.");
  }
  if (r.commissionSource === "total_fallback") {
    push(
      "warning",
      "valorComissao",
      "Não foi possível identificar a fatia do declarante entre os comissionados; usada a comissão total."
    );
  }
  if (r.needsReview) {
    push(
      "warning",
      "rateio",
      "Operação com múltiplos vendedores e compradores — revise o rateio de valor/comissão."
    );
  }
  return issues;
}

/** Validação de um registro R02 (locação). Bloqueia CPF/CNPJ ausente/sintético. */
export function validateLeaseRecord(r: DimobLeaseRecord): DimobIssue[] {
  const issues: DimobIssue[] = [];
  const push = (level: DimobIssueLevel, field: string, message: string) =>
    issues.push({ level, scope: "locacao", field, message, leaseId: r.leaseId });

  if (!r.locador.nome) push("error", "nomeLocador", "Locador sem nome.");
  if (!isValidCpfCnpj(r.locador.cpfCnpj)) {
    push("error", "cpfCnpjLocador", `CPF/CNPJ do locador ausente ou inválido (${r.locador.nome || "sem nome"}).`);
  }
  if (!r.locatario.nome) push("error", "nomeLocatario", "Locatário sem nome.");
  if (!isValidCpfCnpj(r.locatario.cpfCnpj)) {
    push("error", "cpfCnpjLocatario", "CPF/CNPJ do locatário ausente ou inválido.");
  }
  if (!(r.totalRendimento > 0)) {
    push("warning", "rendimento", "Sem aluguel recebido no ano — confirme se deve constar.");
  }
  return issues;
}

export function validateLeaseRecords(records: DimobLeaseRecord[]): DimobIssue[] {
  return records.flatMap(validateLeaseRecord);
}

export function validateAggregate(agg: DimobSalesAggregate): DimobIssue[] {
  return [
    ...validateDeclarante(agg.declarante),
    ...agg.records.flatMap(validateRecord),
  ];
}

/** true se há qualquer issue de nível error (geração deve ser bloqueada). */
export function hasBlockingErrors(issues: DimobIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
