# ai-bench — benchmark de modelos por operação

Harness reprodutível para decidir, **com número**, qual modelo usar em cada
operação de IA (extração, OCR, retrieval, edição) em vez de por intuição.

Hoje o roteamento é um palpite razoável (Editor=Sonnet, extração=Gemini Flash,
especialistas=Haiku). Este harness confirma ou refuta comparando acurácia ×
latência × custo na mesma matriz de modelos.

## Rodar

```bash
cd apps/web
ANTHROPIC_API_KEY=sk-... GEMINI_API_KEY=... npx tsx scripts/ai-bench/run.ts
# ou um subconjunto:
npx tsx scripts/ai-bench/run.ts --models=haiku,gemini-flash
```

Modelos sem a key correspondente são pulados (não falham o run).

## Fixtures

`fixtures/extraction.json` — casos de extração campo-a-campo. Os 2 casos atuais
são **sintéticos**, só pra o harness rodar de ponta a ponta. Para um número
confiável, **substitua/expanda com CCVs reais ANONIMIZADOS** (troque nomes/CPFs
por fictícios; mantenha a estrutura). Cada caso adiciona 1 chamada por modelo.

## O que mede

- **Acurácia**: % de campos esperados que o modelo extraiu corretamente
  (números por igualdade ±0,01; strings case-insensitive).
- **Latência**: ms por chamada.
- **Custo**: US$ estimado via a MESMA tabela `PRICING` do runtime
  (`src/lib/ai/usage.ts`) — então o número bate com o que o dashboard mostra.

## Extensões previstas (TODO)

- **Retrieval** (`query_knowledge_base`): dataset de 30-50 pares
  `clauseQuery → knowledgeItemId esperado`, medir precision@1 e **calibrar o
  piso de similaridade** (o `insert_clause` usa 0.4 hoje sem calibração — este
  é o número que valida ou ajusta esse limiar).
- **Edição**: rubrica LLM-as-judge sobre tarefas de edição de contrato.
- **Outros providers**: adicionar GPT-5.x/o-series e Llama via API à `MODELS`
  (a estrutura já é agnóstica — só falta o client + o pricing na tabela).

Nada troca de modelo em produção sem passar por aqui primeiro.
