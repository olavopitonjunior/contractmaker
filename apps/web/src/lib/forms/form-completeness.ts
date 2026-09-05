import { collectLocacaoHardBlockIssues, isLocacaoSchemaType } from "@/lib/forms/validation-locacao";

/**
 * O `SalesForm.status` "completo" é afirmação, não decoração: fecha o link
 * público (`completedAt`), vira marco de SLA e libera a geração do contrato.
 * A conversão de proposta gravava "completo" sem olhar o dado — uma proposta
 * de locação sem locador virava formulário completo, e o contrato saía sem
 * uma das partes.
 *
 * O critério aqui é o MESMO que o produto usa para deixar o cliente concluir
 * o formulário: o bloqueio duro (`collectLocacaoHardBlockIssues`) — parte
 * ausente ou sem identidade. Deliberadamente NÃO é o schema Zod inteiro:
 * medido nas 17 propostas de venda de produção, o schema completo reprovaria
 * 17 (quase todas por `imoveis.0.descricao`, campo que a proposta nem coleta),
 * e transformar toda conversão de venda em pendente seria redesenhar o funil,
 * não consertar o defeito relatado.
 *
 * Esteira sem regra de bloqueio duro (venda) não é julgada: sem oráculo,
 * mantém o comportamento antigo (`complete: true`, `checked: false`).
 */
export interface FormCompleteness {
  complete: boolean;
  /** Caminhos que faltam (`locadores`, `locatarios.0.nome`…), para log e evento. */
  missing: string[];
  /** As mesmas pendências em português, para mostrar a quem está na tela. */
  messages: string[];
  /** false quando a esteira não tem regra de bloqueio — não houve juízo. */
  checked: boolean;
}

const OK: FormCompleteness = { complete: true, missing: [], messages: [], checked: true };
const SEM_ORACULO: FormCompleteness = { complete: true, missing: [], messages: [], checked: false };

export function checkFormCompleteness(schemaType: string, dataJson: unknown): FormCompleteness {
  if (!isLocacaoSchemaType(schemaType)) return SEM_ORACULO;
  const data = dataJson && typeof dataJson === "object" ? (dataJson as Record<string, unknown>) : {};
  let issues: { path: string; message: string }[];
  try {
    issues = collectLocacaoHardBlockIssues(data);
  } catch (err) {
    // Regra não é oráculo se derruba a conversão: dado degenerado não bloqueia.
    // Mas rede de segurança que se desarma calada é pior que não ter: se algum
    // dia isto disparar, tem que aparecer no log — é a mesma falha que este
    // arquivo existe para consertar (formulário "completo" sem juízo).
    console.error("[form-completeness] regra de bloqueio duro lançou; conversão seguiu sem juízo", err);
    return SEM_ORACULO;
  }
  if (issues.length === 0) return OK;
  const missing: string[] = [];
  const messages: string[] = [];
  for (const i of issues) {
    if (!missing.includes(i.path)) missing.push(i.path);
    if (i.message && !messages.includes(i.message)) messages.push(i.message);
  }
  return { complete: false, missing: missing.slice(0, 30), messages: messages.slice(0, 10), checked: true };
}
