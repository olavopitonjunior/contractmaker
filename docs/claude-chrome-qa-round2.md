# QA Round 2 — Contractmaker (pós-correções)

Você é um QA sênior validando correções aplicadas após o relatório anterior que identificou
6 bugs (1 critical, 2 major, 3 minor) no fluxo de formulário → contrato → editor → chat IA.
O sistema é uma plataforma SaaS em Next.js 14 + TipTap + Prisma/Postgres + Anthropic Claude.

Ambiente: <URL_PROD>
Idioma da UI: português brasileiro

**Você já está logado no sistema.** Não faça logout, não navegue para `/login`, não peça
credenciais.

## Regras gerais

- Faça hard reload (Ctrl+Shift+R) antes de cada cenário para garantir que está pegando
  o bundle novo. NÃO abra aba anônima — isso derrubaria a sessão ativa.
- **Não aprove contratos reais.** Se precisar testar o fluxo completo, use apenas deals
  marcados como `[QA R2]` no título.
- **Limpe dados de teste ao final** — deals, formulários e contratos criados.
- Abra DevTools Console desde o início. Reporte **qualquer** erro vermelho no console.
- Para cada cenário, reporte PASS / FAIL / BLOCKED com descrição e screenshot quando
  relevante.

## Persona de teste

- Vendedor: Carla Moreira, CPF 111.444.777-35 (VÁLIDO), **casada** com João Moreira
- Comprador: Pedro Alves, CPF 529.982.247-25 (VÁLIDO)
- Imóvel: Rua das Acácias 456, Vila Mariana, São Paulo/SP, matrícula 12.345
- Valor total: R$ 1.250.000,00
- Sinal: R$ 125.000 / Recursos próprios: R$ 225.000 / Financiamento: R$ 800.000 / FGTS: R$ 100.000
- Modalidade: financiamento
- Comissão: R$ 75.000 (6% do valor total), paga pela Parte Compradora
- Imobiliária: QA Teste Imóveis, CNPJ 00.000.000/0001-00, CRECI 12345-F

---

## ROTEIRO DE TESTES

### BLOCO 1 — BUG #2: Acentuação "formulário"

**1.1** Navegue para `/forms`
- VALIDAR: se a lista estiver vazia, a mensagem mostra "Nenhum formulário criado ainda."
  com acento agudo em "á".

**1.2** Clique em "Novo Formulário" (ou acesse `/forms/new`)
- Preencha o título: `[QA R2] Venda Apto Vila Mariana`
- Clique "Criar Formulário"
- VALIDAR: toast "Formulário criado!" aparece corretamente.
- VALIDAR: o label acima do link gerado diz "Link do formulário:" com acento agudo, não
  "formulario".

**1.3** Abra o DevTools Console e simule um erro (pode ser forçado deletando o `fetch`
no network ou pular — se não conseguir, marque BLOCKED). O toast de erro (se houver) deve
dizer "Erro ao criar formulário" com acento.

---

### BLOCO 2 — BUG #1: Scroll do formulário público com cônjuge

**2.1** Copie o link do formulário criado no bloco 1 e abra em uma NOVA ABA (mesma sessão,
não anônima).

**2.2** Navegue até a **Etapa 1 — Vendedor** (é a segunda etapa após Documentos).
- Preencha Nome, Nacionalidade, Profissão, RG, CPF, Email básicos
- **Selecione "Estado Civil" = "Casado(a)"**
- VALIDAR: a seção "Dados do Cônjuge" aparece com campos Nome, CPF, RG, Nacionalidade,
  Profissão.

**2.3** TENTE fazer scroll para baixo até ver:
- Todos os campos de Endereço (Logradouro, Número, Bairro, Cidade, UF, CEP)
- Todos os campos de Cônjuge
- Os botões "Anterior" / "Próximo" no rodapé

- VALIDAR (CRÍTICO): **todos** esses campos devem ser alcançáveis por scroll convencional
  (mouse wheel ou PageDown). Nenhum deve ficar abaixo do viewport sem poder ser revelado.
- Use DevTools para inspecionar: `document.documentElement.scrollHeight` deve ser maior
  que `window.innerHeight` quando o cônjuge está visível. Reporte os valores.

**2.4** Redimensione para **mobile 375×667** e repita o teste.
- VALIDAR: o mesmo comportamento em mobile — todos os campos acessíveis.

---

### BLOCO 3 — BUG #4 e #5: Geração de contrato (posse e comissão)

**3.1** Preencha TODAS as 7 etapas do formulário com os dados da persona.
- **IMPORTANTE:** na Etapa 6 (Posse e Título), **NÃO altere** o campo "Momento da Entrega
  da Posse" — mantenha o default "Na assinatura do contrato".
  - Isso garante que a correção do default `momento_texto` seja efetivamente testada.

**3.2** Finalize o formulário. O contrato deve ser gerado automaticamente.
- Clique em "Abrir Contrato".

**3.3** Navegue até **Cláusula Terceira — Da Imissão na Posse** (procure por "3.1").
- VALIDAR (BUG #4): o texto da cláusula 3.1 deve ler:
  > "A posse direta do imóvel será transferida ao(s) PROMISSÁRIO(S) COMPRADOR(ES), livre
  > e desembaraçada de pessoas e coisas, **na data da assinatura do presente instrumento**."
- Deve ser uma **frase completa e gramatical**, sem terminar em "assinatura do contrato."
  solto.

**3.4** Navegue até **Cláusula Décima Quarta — Da Comissão** (procure por "14.1").
- VALIDAR (BUG #5): o texto da cláusula 14.1 deve incluir:
  > "...comissão de corretagem no valor total de **R$ 75.000,00** (setenta e cinco mil reais),
  > equivalente a **6,00%** do valor total da transação, a ser paga pela Parte Compradora..."
- O percentual **deve** aparecer com vírgula decimal (`6,00%`), não ponto (`6.00%`).

**3.5** Se houver tempo, gere um segundo contrato com modalidade **à vista** (crie outro
formulário, mude o valor do financiamento para 0 e aumente recursos próprios para compensar).
- VALIDAR: na Cláusula Décima Primeira (Comissão) do contrato à vista, o percentual também
  aparece como "6,00%" (não como "%" vazio).

---

### BLOCO 4 — BUG #3: Chat IA e perguntas informativas

**4.1** No editor do contrato aberto no bloco 3, clique em "Chat IA".

**4.2** Envie exatamente: `Quais cláusulas existem neste contrato?`
- Aguarde a resposta.
- VALIDAR (CRÍTICO BUG #3): a resposta **NÃO deve** ser "Feito!", "Pronto!" ou uma única
  palavra curta.
- VALIDAR: a resposta deve ser uma **lista markdown estruturada** com:
  - Cada cláusula numerada (Primeira, Segunda, ..., ou 1, 2, 3...)
  - Título em negrito de cada cláusula
  - Resumo de 1–2 linhas do conteúdo
- VALIDAR: a resposta deve ter pelo menos ~500 caracteres.

**4.3** Envie: `Me explique a cláusula de rescisão`
- VALIDAR: resposta em markdown explicativo (pelo menos 2 parágrafos), citando a
  cláusula específica e a base legal (art. Código Civil). Não é "Feito!".

**4.4** Envie: `Liste os dados dos vendedores`
- VALIDAR: resposta em formato de lista com Nome, CPF, Estado Civil, etc., baseada nos
  dados reais do contrato.

**4.5** Para contrastar (controle), envie um comando de EDIÇÃO: `Altere a multa da cláusula
9.1 de 5% para 8%`
- VALIDAR: a IA deve aplicar a edição (ou sugerir via track changes) e responder com a
  estrutura "## Alterações Realizadas / ## Justificativa / ## Verificação".
- Isso confirma que as duas modalidades (pergunta vs comando) são diferenciadas.

---

### BLOCO 5 — Regressão: os 5 bugs corrigidos da Fase 3 continuam funcionando

**5.1** No editor do contrato, verifique que o botão "Família da fonte" na toolbar abre
um dropdown visual ao clicar (BUG #4 do relatório Fase 3).

**5.2** Vá em `/settings/document-styles`. Clique "Novo preset", preencha Nome = "QA R2
Test" e margens = 30mm. Salve. Volte para a lista.
- VALIDAR: o preset "QA R2 Test" aparece na lista (BUG #1 Fase 3).

**5.3** Vá em `/settings` → aba "Agente IA".
- VALIDAR: o System Prompt mostra regras numeradas até pelo menos **18** (contem os números
  1., 2., ..., 18.).
- VALIDAR: o texto auxiliar abaixo do textarea diz "**18 ferramentas**", não "10" (BUG #3
  Fase 3).

**5.4** Edite o contrato: abra um contrato existente, faça uma alteração textual qualquer
e aguarde ~30s sem tocar no editor.
- VALIDAR: após ~30s, a análise passiva IA deve disparar. Pode não gerar novo comentário
  se não houver inconsistência nova, mas o request deve aparecer na aba Network:
  `POST /api/contracts/<id>/auto-analyze` (BUG #2 Fase 3).

---

### BLOCO 6 — Sanity checks

**6.1** Abra `/` → `/pipeline` → `/contracts` → `/settings` → `/settings/knowledge-base` →
`/settings/document-styles` → `/clauses/proposals`
- VALIDAR: zero erros vermelhos no Console em cada página.

**6.2** Console: `performance.now()` durante navegação deve mostrar carregamento < 3s
por página em 4G simulado.

**6.3** Mobile 375px: abra `/pipeline`, `/f/<token>`, `/contracts/<id>`
- VALIDAR: todas as páginas são utilizáveis sem scroll horizontal quebrado.

---

## RELATÓRIO FINAL

Apresente no formato:

### Tabela executiva

| # | Cenário | Bug alvo | Resultado | Observações |
|---|---|---|---|---|
| 1.1 | Lista vazia com acento | #2 | PASS/FAIL | ... |
| 1.2 | Link "formulário" com acento | #2 | ... | ... |
| 1.3 | Toast de erro com acento | #2 | ... | ... |
| 2.1 | Abrir form público | #1 | ... | ... |
| 2.3 | Scroll com cônjuge (desktop) | #1 | ... | scrollHeight=X, innerHeight=Y |
| 2.4 | Scroll com cônjuge (mobile 375) | #1 | ... | ... |
| 3.3 | Cláusula 3.1 gramatical | #4 | ... | texto encontrado: "..." |
| 3.4 | Cláusula 14.1 com 6,00% | #5 | ... | ... |
| 3.5 | Comissão no contrato à vista | #5 | ... | ... |
| 4.2 | Chat lista cláusulas em markdown | #3 | ... | tamanho da resposta: X chars |
| 4.3 | Chat explica cláusula | #3 | ... | ... |
| 4.4 | Chat lista dados dos vendedores | #3 | ... | ... |
| 4.5 | Chat aplica edição corretamente | - | ... | controle |
| 5.1 | Dropdown de fonte abre | Fase 3 #4 | ... | ... |
| 5.2 | Preset persiste após salvar | Fase 3 #1 | ... | ... |
| 5.3 | Settings mostra 18 regras/tools | Fase 3 #3 | ... | ... |
| 5.4 | Análise passiva dispara | Fase 3 #2 | ... | ... |
| 6.1 | Console limpo em todas páginas | - | ... | ... |
| 6.3 | Mobile utilizável | - | ... | ... |

### Bugs ainda presentes

Para cada bug que falhou:

```
BUG — <título>
Bug alvo: #N do relatório anterior
Severidade: blocker / critical / major / minor
Passo: <número>
URL: <url>

Comportamento observado:
<o que aconteceu>

Comportamento esperado:
<o que deveria acontecer>

Diferença do relatório anterior:
<explicar se a correção não aplicou, aplicou parcialmente, ou introduziu nova regressão>
```

### Análise qualitativa

- **Fluxo de preenchimento do formulário** agora é tranquilo sem clipping? Note
  especificamente se em 2.3 foi possível alcançar todos os campos.
- **Qualidade jurídica do contrato gerado** — a cláusula 3.1 lê naturalmente? A cláusula
  14.1 agora informa o percentual de forma clara?
- **Chat IA** — a diferenciação entre pergunta e comando agora é consistente? Alguma
  resposta ainda foi "Feito!"?
- **Regressão Fase 3** — algum dos 5 bugs anteriores voltou a aparecer?

### Limpeza final

Confirme que você:
- Deletou o(s) formulário(s) `[QA R2]` criados
- Deletou o(s) deal(s) `[QA R2]` gerados
- Deletou o(s) contrato(s) associado(s)
- Removeu o preset "QA R2 Test" de `/settings/document-styles`
- NÃO aprovou nenhum contrato real
- Se não conseguir deletar alguma coisa, liste os IDs no relatório para limpeza manual.

---

**Comece pelo Bloco 1.** Antes de cada bloco, avise brevemente: "Iniciando Bloco X" e
prossiga. Não precisa pedir permissão a cada passo. Se algo bloquear o teste, marque
BLOCKED com motivo e continue para o próximo bloco.
