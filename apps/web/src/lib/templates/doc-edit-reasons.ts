/**
 * Por que uma edição do app não foi aplicada, em português de operador.
 *
 * Existe como módulo próprio porque duas telas precisam da MESMA resposta: a
 * revisão de um modelo e o painel da biblioteca. O painel nasceu sem isso e
 * dizia apenas "não aplicado" — medido em produção em 04/09, quando o conserto
 * dos 16 modelos da RE/MAX Trio foi recusado e a tela não sabia dizer por quê.
 * Quem opera não tem como agir sobre "não aplicado"; sobre "há texto entre os
 * itens da lista", tem.
 */
export const DOC_EDIT_REASON: Record<string, string> = {
  ambiguous: "aparece em mais de um lugar do documento",
  "not-found": "não encontrei esse trecho no texto",
  "unknown-token": "chave fora do catálogo desta modalidade",
  "phrase-has-token":
    "o trecho a remover carrega uma chave de preenchimento — removê-lo apagaria o campo",
  "same-token": "a chave de destino é a mesma da origem: não há o que trocar",
  "token-missing-in-phrase":
    "o parágrafo não tem mais a chave que seria trocada (ou tem mais de uma) — revalide",
  "empty-source": "não há texto de origem para restaurar",
  "empty-block": "o bloco a substituir chegou vazio",
  "block-not-consecutive":
    "os parágrafos do bloco não estão seguidos no documento — há texto entre eles, e apagar do primeiro ao último levaria esse texto junto",
  "structure-not-found":
    "não localizei esses parágrafos na estrutura do documento — ele foi editado no Google Docs desde a última verificação",
  "batch-failed": "o Google recusou a edição",
  "replace-noop":
    "o trecho existe no texto, mas a edição não pegou — costuma ser formatação invisível partindo o parágrafo no meio",
  "over-matched":
    "a edição atingiu mais lugares do que o esperado (possivelmente cabeçalho ou rodapé) — confira no documento",
  "over-removed":
    "um parágrafo do bloco foi apagado em mais de um lugar, fora do trecho revisado — confira o histórico de versões do Doc",
  "verify-failed": "a edição foi enviada, mas a conferência no documento não confirmou o resultado",
  "verify-unavailable":
    "não consegui conferir o documento agora (Drive indisponível) — revalide",
};

/** Motivo legível a partir da resposta de `POST /api/templates/[id]/doc-edit`. */
export function motivoDaRecusa(json: unknown): string {
  const results = (json as { results?: Array<{ reason?: string; status?: string }> } | null)
    ?.results;
  const recusado = results?.find((r) => r.status !== "applied");
  if (!recusado?.reason) return "a correção não pôde ser aplicada";
  return DOC_EDIT_REASON[recusado.reason] ?? recusado.reason;
}
