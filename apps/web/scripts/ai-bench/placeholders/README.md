# Bateria do passe de inserção de chaves

Responde **com número** a pergunta que até 09/2026 era respondida por inspeção
de lote: *quanto do que deveria virar chave virou, e quanto do que virou está no
lugar errado?*

A falta desse número tem custo medido: os 16 modelos da RE/MAX Trio passaram
16/16 na validação sintática e **10 estavam errados** — descoberto por conferência
manual, Doc a Doc, depois de já estarem no ambiente.

## Rodar

```bash
cd apps/web

# rodada com modelo (1 chamada por caso)
ANTHROPIC_API_KEY=sk-... npx tsx scripts/ai-bench/placeholders/run.ts

# um caso só
npx tsx scripts/ai-bench/placeholders/run.ts --case=02-RES-SEM-FIANCA

# REMEDIR o planejador sobre respostas já pagas — de graça, em segundos
npx tsx scripts/ai-bench/placeholders/run.ts --replay=scripts/ai-bench/placeholders/results-<stamp>.json
```

`--replay` é o modo do dia a dia: mexeu numa trava do `planInsertion`, remede
tudo sem chamar o modelo. A rodada com modelo só quando o **prompt** muda.

## O que é medido

Três etapas, separadas justamente para poderem ser exercidas isoladamente
(`src/lib/templates/ai-placeholder-insertion.ts`):

| Etapa | Custa | Pura | Papel |
|---|---|---|---|
| `proposeMapeamentos` | sim (Anthropic) | não | o que a IA propôs |
| `planInsertion` | não | **sim** | o que entraria no Doc, com todas as travas |
| `runSemanticChecks` | não | **sim** | defeitos por categoria no texto resultante |

A pontuação roda sobre o **texto simulado** que o planejador produz. Nada aqui
escreve no Google Docs: um erro de planejamento é visível sem gastar escrita no
Drive e sem depender do Drive estar de pé.

## Gabarito

`gold/*.json`, **anotado à mão**. Aponta cada chave por **índice de parágrafo**,
não por valor — depois da padronização o texto não contém mais o dado, então
"o CPF do locador virou chave" só pode ser afirmado por posição.

```bash
# imprime os parágrafos numerados como o pontuador os vê
npx tsx scripts/ai-bench/placeholders/annotate.ts 02-RES-SEM-FIANCA.txt
```

Campos:

- **`expected`** — onde cada chave deve estar. Tolerância de ±1 parágrafo, porque
  bloco composto ocupa mais de um e o índice aponta o primeiro.
- **`forbidden`** — onde uma chave **não** pode aparecer. Serve para fixar erro já
  visto (a chave do corretor no item da imobiliária, a qualificação do locador
  dentro do bloco de assinaturas) que de outro modo seria um `fp` anônimo.

Duas regras de anotação que evitam gabarito mentiroso:

1. **`clausula_garantia` não entra.** O slot de cláusula é aplicado por
   `apply-clause-slot.ts`, não por este passe. Cobrá-lo aqui reprovaria o passe
   por algo que não é dele.
2. **Chave plausível não anotada vira `fp`.** Então o `expected` precisa estar
   razoavelmente completo, ou a precisão sai artificialmente baixa.

## Corpus

Os contratos são os mesmos que a ingestão já usa nos testes de consolidação
(`src/lib/templates/__tests__/fixtures/ativa-residencial/`) — reais e
anonimizados. Reusar em vez de copiar é deliberado: um segundo corpus divergiria
do primeiro sem ninguém perceber.

**Estado atual: 2 casos anotados** (`01-RES-FIADOR`, `02-RES-SEM-FIANCA`), de 4
disponíveis. Dois casos dão uma linha de base, **não** um número com o qual
decidir. Para a decisão sobre construir um revisor por IA, o corpus precisa
crescer — e crescer com os casos que a Trio expôs (chave da entidade trocada,
CRECI ao lado da chave, cláusula colapsada), que não existem nestes dois
arquivos.

### Acrescentar casos da Trio

Os contratos da Trio estão em `IngestionItem.text` em produção e **têm PII real**.
O caminho é: extrair → `sanitizePii` → trocar nome por fictício à mão →
**revisão humana antes de commitar** (não há detector determinístico de nome de
pessoa, então nenhuma automação fecha essa porta sozinha).

## Recall das checagens semânticas (a decisão do R7)

```bash
npx tsx scripts/ai-bench/placeholders/semantic-recall.ts \
  --replay=scripts/ai-bench/placeholders/results-trio-baseline.json \
  --corpus-dir=<dir com os .txt do replay>
```

Responde a pergunta do plano de 03/09/2026: *as checagens determinísticas
pegam os erros semânticos que a Trio expôs, ou é preciso um revisor por IA?*
Os 10 rascunhos errados foram corrigidos no próprio Google Docs — o texto com
o defeito não existe mais. O que existe é o registro do QUE estava errado, e
`src/lib/templates/eval/semantic-inject.ts` reproduz cada registro sobre o
texto limpo que o planejador produz hoje (replay, sem modelo): item a) com as
chaves do corretor, CRECI real depois da chave, endereço da imobiliária depois
da chave, cadastro da própria org literal, cabeçalho + lista do rateio numa
chave solta, cabeçalho numerado sumido com a citação ficando. Cada injeção tem
um parágrafo esperado; acertou = a categoria certa a ±1 parágrafo. "n/a"
quando o texto não tem a cláusula — nunca um zero falso.

**Medido em 05/09/2026, corpus da Trio (16 contratos, 96 injeções):**

| classe | antes | depois |
|---|---|---|
| wrong-entity | 16/16 | 16/16 |
| leftover-creci | 16/16 | 16/16 |
| leftover-endereco | **0/16** | 16/16 |
| org-literal | 16/16 | 16/16 |
| collapsed-list | **0/16** | 16/16 |
| dangling-only | **8/16** | 16/16 |
| **total** | **58%** | **100%** |

Ruído de base (achados no texto limpo): 0 nas duas medições. Os três zeros
eram regras, não limites do método: endereço por extenso não contava como
sobra; o colapso exigia vizinhos SEM chave (o 4.1 sempre tem
`{{aluguel_dia_vencimento}}`); "4.2.2." contava como definição do "4.2".
Consertados no mesmo PR.

**Decisão:** recall ≥ 80% → **o revisor por IA (R7) não é construído.** Erro
novo de produção vira uma injeção aqui + uma regra em `semantic-checks.ts`,
e a bateria diz se a regra pegou. A saída (`results-semantic-*.json`) é
gitignored e não carrega texto de contrato — só categorias e índices.

## Saída

Tabela no console + `results-<stamp>.json` com as respostas cruas (o que o
`--replay` consome) e os placares. O `results-*.json` **não** vai para o git:
carrega o texto do corpus e as propostas cruas.
