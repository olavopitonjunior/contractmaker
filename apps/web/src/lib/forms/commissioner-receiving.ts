/**
 * Gate opcional: exigir os dados de recebimento (PIX/conta) do corretor antes
 * de concluir a etapa Comissão. Ligado por org em
 * `OrgFormSettings.requireCommissionerReceiving`.
 *
 * Por que não é um path de `customRequiredPaths`, como os demais campos
 * obrigatórios: os dados bancários do corretor **não vivem no `dataJson`** de
 * propósito. O `dataJson` é devolvido inteiro pelo `GET /api/forms/[token]` a
 * qualquer portador do link e vai no resumo por e-mail; chave PIX e conta
 * sobem no POST e ficam no `SplitRecipient`, cuja whitelist pública nunca
 * expõe PII bancária (ver `CadastroRecebimento.tsx`). O mecanismo de
 * obrigatoriedade opera sobre paths do `dataJson` — colocá-los lá
 * reintroduziria exatamente o vazamento que o desenho evita.
 *
 * O que fica no `dataJson` é só o ESTADO: `splitRecipientId` (o vínculo, que já
 * existia) e `recebimentoPendente` (booleano derivado de
 * `SplitRecipient.pendingFields`, que é o mesmo critério de "pagável" usado
 * pela esteira de repasse).
 *
 * Puro: sem DB e sem rede — roda no wizard (client) e no finalize (server).
 */

export interface ComissionadoRecebimento {
  nome?: string;
  splitRecipientId?: string;
  recebimentoPendente?: boolean;
}

export interface RecebimentoPendencia {
  /** Índice na lista de comissionados/angariadores. */
  index: number;
  nome: string;
  /** `sem_cadastro`: nunca foi salvo. `sem_pix`: salvo, mas sem meio de repasse. */
  motivo: "sem_cadastro" | "sem_pix";
}

/**
 * Linhas que ainda não satisfazem a exigência.
 *
 * `enabled` combina a flag da org com `viewerIsMember`: o formulário público é
 * ANÔNIMO e o cliente não vê nem pode enviar esses campos (o servidor rejeita
 * PIX/banco de não-membro). Bloquear quem não tem como cumprir seria um beco
 * sem saída — daí a exigência valer só para quem preenche pela imobiliária.
 */
export function pendenciasDeRecebimento(
  comissionados: readonly ComissionadoRecebimento[] | undefined,
  enabled: boolean
): RecebimentoPendencia[] {
  if (!enabled || !comissionados?.length) return [];
  const out: RecebimentoPendencia[] = [];
  comissionados.forEach((c, index) => {
    const nome = (c?.nome ?? "").trim();
    // Linha ainda em branco não é pendência de recebimento — é linha vazia, e
    // quem cuida disso é a validação de nome do próprio schema.
    if (!nome) return;
    if (!c?.splitRecipientId) {
      out.push({ index, nome, motivo: "sem_cadastro" });
      return;
    }
    if (c.recebimentoPendente === true) {
      out.push({ index, nome, motivo: "sem_pix" });
    }
  });
  return out;
}

/** Mensagem única para o toast das duas esteiras. */
export function mensagemDePendencia(
  pendencias: readonly RecebimentoPendencia[]
): string {
  if (pendencias.length === 0) return "";
  const nomes = pendencias.map((p) => p.nome).join(", ");
  const semCadastro = pendencias.some((p) => p.motivo === "sem_cadastro");
  return semCadastro
    ? `Salve o cadastro com os dados bancários de: ${nomes}.`
    : `Falta a chave PIX no cadastro de: ${nomes}. Sem ela o repasse automático não sai.`;
}
