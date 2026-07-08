import type { ValidationIssue } from "./types";

export function validateCPF(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(clean)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(clean[i]) * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(clean[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(clean[i]) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  return remainder === parseInt(clean[10]);
}

export function validateCNPJ(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(clean)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(clean[i]) * weights1[i];
  let remainder = sum % 11;
  const d1 = remainder < 2 ? 0 : 11 - remainder;
  if (parseInt(clean[12]) !== d1) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(clean[i]) * weights2[i];
  remainder = sum % 11;
  const d2 = remainder < 2 ? 0 : 11 - remainder;
  return parseInt(clean[13]) === d2;
}

export function validateContractData(
  dataJson: Record<string, unknown>,
  // Natureza do instrumento. O contrato de administração de locação
  // (kind="administracao") não tem a semântica de venda (pagamento, cônjuge,
  // "Seção 8 multas / step 7 Comissão"), então pulamos essas checagens.
  kind: string = "contract"
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const isAdministracao = kind === "administracao";

  // --- Payment sum check ---
  const pagamento = dataJson.pagamento as Record<string, unknown> | undefined;
  if (pagamento) {
    const total = (pagamento.valor_total as number) || 0;
    const sinal = (pagamento.sinal_arras as number) || 0;
    const proprios = (pagamento.recursos_proprios as number) || 0;
    const fgts = (pagamento.fgts as number) || 0;
    const consorcio = (pagamento.cessao_consorcio as number) || 0;
    const alienacao = (pagamento.alienacao_fiduciaria as number) || 0;
    const outras = (pagamento.outras_formas as number) || 0;

    const componentSum = sinal + proprios + fgts + consorcio + alienacao + outras;
    if (total > 0 && Math.abs(componentSum - total) > 1) {
      issues.push({
        field: "pagamento",
        severity: "error",
        message: `Soma dos componentes (R$ ${componentSum.toLocaleString("pt-BR")}) difere do valor total (R$ ${total.toLocaleString("pt-BR")})`,
        suggestion: "Ajuste os valores de pagamento para que a soma seja igual ao valor total",
      });
    }

    if (total === 0) {
      issues.push({
        field: "pagamento.valor_total",
        severity: "error",
        message: "Valor total do imóvel é zero",
      });
    }
  }

  // --- CPF validation ---
  const vendedores = (dataJson.vendedores as Array<Record<string, unknown>>) || [];
  for (let i = 0; i < vendedores.length; i++) {
    const cpf = vendedores[i].cpf as string;
    if (cpf && !validateCPF(cpf)) {
      issues.push({
        field: `vendedores[${i}].cpf`,
        severity: "error",
        message: `CPF do vendedor "${vendedores[i].nome || i + 1}" é inválido: ${cpf}`,
      });
    }
    if (!cpf || cpf.replace(/\D/g, "").length === 0) {
      issues.push({
        field: `vendedores[${i}].cpf`,
        severity: "warning",
        message: `CPF do vendedor "${vendedores[i].nome || i + 1}" não preenchido`,
      });
    }

    // Spouse required if married
    const estadoCivil = vendedores[i].estado_civil as string;
    const conjuge = vendedores[i].conjuge as Record<string, unknown> | undefined;
    if (
      (estadoCivil === "Casado(a)" || estadoCivil === "União Estável" || estadoCivil === "Uniao Estavel") &&
      (!conjuge || !conjuge.nome)
    ) {
      issues.push({
        field: `vendedores[${i}].conjuge`,
        severity: "error",
        message: `Vendedor "${vendedores[i].nome}" é ${estadoCivil} mas não informou dados do cônjuge`,
        suggestion: "Preencha os dados do cônjuge/companheiro(a)",
      });
    }
  }

  const compradores = (dataJson.compradores as Array<Record<string, unknown>>) || [];
  for (let i = 0; i < compradores.length; i++) {
    const cpf = compradores[i].cpf as string;
    if (cpf && !validateCPF(cpf)) {
      issues.push({
        field: `compradores[${i}].cpf`,
        severity: "error",
        message: `CPF do comprador "${compradores[i].nome || i + 1}" é inválido: ${cpf}`,
      });
    }
  }

  // --- Missing clauses by scenario ---
  const statusProp = dataJson.status_propriedade as string;
  const saldoDevedor = (dataJson.saldo_devedor as number) || 0;
  const ocupacao = dataJson.ocupacao as string;
  const alienacaoFid = (pagamento?.alienacao_fiduciaria as number) || 0;

  if (alienacaoFid > 0) {
    issues.push({
      field: "clausulas",
      severity: "info",
      message: "Financiamento via alienação fiduciária detectado. Recomenda-se cláusula de condição suspensiva.",
      suggestion: "Adicione cláusula de condição suspensiva de aprovação de crédito",
    });
  }

  if (ocupacao === "ocupado-terceiro") {
    issues.push({
      field: "clausulas",
      severity: "info",
      message: "Imóvel ocupado por terceiro. Verificar se o direito de preferência do locatário foi respeitado (Lei 8.245/91, art. 27).",
    });
  }

  if (statusProp === "financiado-saldo" && saldoDevedor > 0 && alienacaoFid > 0) {
    const diff = Math.abs(alienacaoFid - saldoDevedor);
    const pct = saldoDevedor > 0 ? (diff / saldoDevedor) * 100 : 0;
    if (pct > 15) {
      issues.push({
        field: "pagamento.alienacao_fiduciaria",
        severity: "warning",
        message: `Valor de alienação fiduciária (R$ ${alienacaoFid.toLocaleString("pt-BR")}) difere ${pct.toFixed(0)}% do saldo devedor (R$ ${saldoDevedor.toLocaleString("pt-BR")})`,
      });
    }
  }

  // --- Empty config fields (venda/CCV) ---
  // Pula no contrato de administração: sua Seção 8 é Exclusividade, não multas,
  // e não há "step 7 Comissão e Config" no formulário de administração.
  const config = dataJson.config as Record<string, unknown> | undefined;
  if (!isAdministracao && (!config || !config.multa_penal_moratoria)) {
    issues.push({
      field: "config",
      severity: "warning",
      message: "Configurações de multas e penalidades não preenchidas. Seção 8 do contrato ficará com campos vazios.",
      suggestion: "Preencha as configurações no step 7 do formulário (Comissão e Config)",
    });
  }

  // --- Missing signature data ---
  const assinatura = dataJson.assinatura as Record<string, unknown> | undefined;
  if (!assinatura?.cidade || !assinatura?.data) {
    issues.push({
      field: "assinatura",
      severity: "warning",
      message: "Dados de assinatura (cidade, data) não preenchidos",
    });
  }

  return issues;
}
