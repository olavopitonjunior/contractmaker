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

---

# Bench de VISÃO (`--vision`)

O bench acima manda **texto** e mede extração sobre texto já legível. Ele **não
exercita OCR**. Para decidir modelo de OCR existe o bench de visão, que manda o
binário do documento e usa o `COMBINED_PROMPT` de produção.

```bash
cd apps/web

# 1. montar o corpus a partir de anexos reais (ver travas abaixo)
DATABASE_URL=... npx tsx scripts/ai-bench/pull-fixtures.ts \
  --org=<orgId> --confirmo-o-banco=staging

# 2. PREENCHER O GABARITO À MÃO — sem isto o bench não vale nada (ver abaixo)

# 3. rodar
GEMINI_API_KEY=... npx tsx scripts/ai-bench/run.ts --vision
```

## O gabarito NÃO pode ser o `extractedData`

`FormAttachment.extractedData` é saída do `gemini-2.5-flash`, o modelo que está
sendo julgado. Usá-lo como gabarito faria o bench **premiar quem concorda com o
incumbente e punir quem o corrige** — o resultado diria "ninguém supera o modelo
atual" por construção, mesmo que alguém supere.

Por isso `pull-fixtures.ts` grava o `extractedData` como `_rascunhoDoModeloAtual`
e deixa `esperado` **vazio**. Alguém precisa abrir cada documento e conferir
campo a campo. É trabalho manual, e é o ponto: sem ele o bench mede
concordância, não acurácia. O runner recusa rodar se nenhum caso tiver gabarito.

## Braços

O desenho separa duas variáveis que mudariam juntas num bench ingênuo — o
**modelo** e o **`responseSchema`**. Sem os dois primeiros braços, um ganho do
schema apareceria como mérito do modelo novo, e trocaríamos de modelo quando
bastava consertar a chamada.

| chave | o quê |
|---|---|
| `baseline` | `gemini-2.5-flash` **sem** schema — produção exata de hoje |
| `schema` | `gemini-2.5-flash` **com** schema — isola o ganho do schema |
| `lite35` | `gemini-3.5-flash-lite` |
| `lite31` | `gemini-3.1-flash-lite` |
| `gemma` | `gemma-4-31b-it` |

Falta um braço de **duas etapas** (classificar, depois extrair com o schema da
categoria) para responder se o objeto superset numa chamada é mesmo o melhor
formato. Ele depende dos schemas por categoria, que nascem depois deste bench —
até lá, a pergunta do formato segue **em aberto**.

## Critérios de medição

Em `src/lib/ai/bench/vision-scoring.ts`, testado — a métrica que decide a troca
de modelo não pode existir só dentro de um script.

**Alucinação e omissão são medidas separadas**, e essa é a decisão que organiza
o resto:

> campo **vazio** o corretor percebe e preenche; campo **preenchido errado** ele
> assina.

Um modelo que erra pouco mas erra "com confiança" é pior, num contrato, que um
que deixa em branco. Por isso a taxa de alucinação é **critério de reprova
independente** — acurácia melhor **não** compensa alucinar mais.

Também medidos: acurácia ponderada (CPF, matrícula e nome pesam 3×), acerto de
categoria (categoria errada trava o "Aplicar" pelo gate H.5), taxa de JSON
aproveitável (onde o Gemma sangra — cerca markdown sobrando em ~1/3 das
chamadas), latência p50/p95 e custo/documento.

O custo usa `geminiUsageToTokens`, que soma `thoughtsTokenCount`. Sem isso o
`gemini-2.5-flash` apareceria com ~1/5 do custo de output real, justamente no
relatório que decide a troca.

## Travas de PII — não contorne

Os documentos são RG, CPF, CNH e matrícula de **pessoas reais**, e este
repositório é **público**.

- `fixtures/vision/` está no `.gitignore` desde antes de o downloader existir.
  O gitleaks do pre-commit procura padrão de credencial, **não CPF dentro de um
  PDF escaneado** — o gitignore é a única defesa.
- `pull-fixtures.ts` exige `--org` (sem escopo, varreria tenants de clientes) e
  `--confirmo-o-banco` (rodar contra produção copiaria documento de cliente para
  uma máquina de desenvolvimento).
- O nome do arquivo vem do ID do anexo, não do `filename` original — nomes de
  upload trazem o nome da pessoa e viram PII em `ls`, em log e em print de tela.
- **Nada de PII em artefato versionado**: corpo de PR, mensagem de commit,
  `docs/`. Só agregados — tokens, US$, latência, acurácia.

## Extensões previstas (TODO)

- **Retrieval** (`query_knowledge_base`): dataset de 30-50 pares
  `clauseQuery → knowledgeItemId esperado`, medir precision@1 e **calibrar o
  piso de similaridade** (o `insert_clause` usa 0.4 hoje sem calibração — este
  é o número que valida ou ajusta esse limiar).
- **Edição**: rubrica LLM-as-judge sobre tarefas de edição de contrato.
- **Outros providers**: adicionar GPT-5.x/o-series e Llama via API à `MODELS`
  (a estrutura já é agnóstica — só falta o client + o pricing na tabela).

Nada troca de modelo em produção sem passar por aqui primeiro.
