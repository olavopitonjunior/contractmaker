# QA — Fluxo de Venda End-to-End (Claude Chrome)

Você é um QA sênior especializado em UI/UX. Vai executar um **processo completo de venda imobiliária** no Contractmaker e produzir um relatório qualitativo sobre o fluxo, a usabilidade e a experiência do usuário.

**Você já está logado no sistema.** Não faça logout, não navegue para `/login`.

**Ambiente:** https://web-zeta-three-4lyvmj9ut6.vercel.app
**Stack:** Next.js 14 + TipTap + Prisma/Postgres (Neon) + Shadcn UI
**Idioma da UI:** português brasileiro

---

## Regras gerais

- Trabalhe em **aba anônima** sempre que possível, ou em uma aba separada da sessão ativa do usuário.
- **Não aprove contratos reais.** Se precisar testar aprovação, marque o título do deal com `[QA TESTE]`.
- Ao final do teste, **deixe o deal identificado** com `[QA TESTE — data/hora]` no título para que o usuário possa revisar ou remover depois.
- **Tire screenshots** de cada etapa importante, especialmente de qualquer coisa estranha.
- Abra o **DevTools Console** desde o início e reporte qualquer erro vermelho que aparecer em qualquer tela.
- Cronometre mentalmente quanto tempo cada passo demora. Qualquer coisa acima de **3 segundos sem feedback visual** é um problema de UX para reportar.
- Ao encontrar erro fatal (tela branca, 500, crash do editor), **pare imediatamente**, screenshot, e reporte.

---

## Persona de teste

Use estes dados ao longo do formulário para manter consistência:

**Vendedor (pessoa física):**
- Nome: Roberto Carlos Mendes
- Nacionalidade: Brasileiro
- Estado civil: **Casado(a)** (importante — vai exigir dados do cônjuge)
- Profissão: Arquiteto
- RG: 12.345.678-9
- CPF: 123.456.789-00
- E-mail: roberto.mendes@email.com
- Endereço: Avenida Paulista, nº 1578, Apto 1201, Bairro Bela Vista, São Paulo/SP, CEP 01310-200
- Cônjuge: Marta Silva Mendes, CPF 987.654.321-00, RG 98.765.432-1, Brasileira, Professora

**Comprador (pessoa física):**
- Nome: Fernanda Costa Oliveira
- Nacionalidade: Brasileira
- Estado civil: Solteiro(a)
- Profissão: Médica
- RG: 22.333.444-5
- CPF: 234.567.890-11
- E-mail: fernanda.oliveira@email.com
- Endereço: Rua dos Pinheiros, nº 450, Bairro Pinheiros, São Paulo/SP, CEP 05422-010

**Imóvel:**
- Logradouro: Rua das Hortênsias, nº 789
- Bairro: Jardim Europa
- Cidade: São Paulo/SP
- CEP: 01449-000
- Matrícula: 45.678 do 10º CRI de São Paulo
- Inscrição IPTU: 123.456.789.0
- Descrição: Apartamento de 3 quartos, sendo 1 suíte, 2 banheiros, sala ampla com varanda gourmet, cozinha planejada, área de serviço, 2 vagas de garagem cobertas. Área privativa de 98m², área total de 145m². Andar alto, vista livre.

**Pagamento:**
- Valor total: R$ 1.250.000,00
- Sinal/arras: R$ 125.000,00
- Recursos próprios: R$ 225.000,00
- Financiamento bancário (alienação fiduciária): R$ 800.000,00
- FGTS: R$ 100.000,00
- (Soma: 1.250.000 — deve bater com o valor total)

**Comissão:**
- Valor: R$ 75.000,00 (6% do total)
- Quem paga: Vendedor
- Quando paga: Na assinatura do contrato
- Imobiliária: Premium Imóveis Ltda
- CNPJ: 12.345.678/0001-99
- CRECI: J-22.345

---

## ROTEIRO

### Passo 1 — Criar formulário

1.1 Navegue até `/forms/new` (ou clique em "Novo Formulário" na sidebar).

1.2 **Observe a tela de criação:**
- O título do formulário é `[QA TESTE — <data>] Venda Apto Jardim Europa`.
- Há instrução clara sobre para que serve esse título?
- Há explicação sobre o fluxo (7 etapas)?
- **UX a reportar:** a tela é acolhedora ou parece vazia? Dá para entender o que vai acontecer?

1.3 Submeta o formulário. Deve aparecer uma tela de confirmação com o link compartilhável.

1.4 **Observe:**
- O link é clicável/copiável?
- Há instrução clara de que esse link pode ser compartilhado com cliente?
- Há CTA para ir direto ao formulário?

---

### Passo 2 — Preencher o formulário público

2.1 Abra o formulário no link gerado (em uma nova aba se possível).

2.2 **Observe a estrutura:**
- O stepper visual de 7 etapas aparece no topo? É claro qual etapa você está?
- O header tem branding e contexto?
- Dá para entender que isso é um formulário que pode ser preenchido sem login?

2.3 **Etapa 1 — Vendedor:**
- Preencha todos os campos do vendedor (persona acima).
- **IMPORTANTE:** ao selecionar Estado Civil = "Casado(a)", confira que o campo realmente muda para "Casado(a)" (não seleciona outro item por acidente).
- Após selecionar Casado(a), a seção "Dados do Cônjuge" deve aparecer abaixo.
- **Role a página** e confirme que consegue ver **todos** os campos: Bairro, Cidade, UF, CEP, e toda a seção do cônjuge. Se algum campo não aparecer ao rolar, reporte como bug.
- Preencha os dados do cônjuge.
- Clique "Próximo".

2.4 **Etapa 2 — Comprador:** mesma coisa, preencha os dados da Fernanda. Ela é solteira então não tem cônjuge. Teste se o dropdown de Estado Civil funciona corretamente (clique em "Solteiro(a)" e confirme).

2.5 **Etapa 3 — Imóvel:**
- Preencha logradouro, número, bairro, cidade, UF, CEP, matrícula, cartório, inscrição IPTU.
- Preencha a **Descrição do Imóvel** com o texto completo da persona. É um campo textarea.
- **Teste**: tente avançar com a descrição vazia — o sistema deve bloquear com mensagem de erro (é campo obrigatório).

2.6 **Etapa 4 — Status e Débitos:**
- Status: "Quitado e Registrado"
- Sem débitos
- Vícios: "Renúncia"
- Avance.

2.7 **Etapa 5 — Pagamento:**
- **IMPORTANTE (UX crítico):** teste o **MoneyInput**.
- Digite no campo "Valor Total da Venda" a string `1250000`. O campo deve formatar como `R$ 1.250.000,00` automaticamente (seja enquanto digita, seja ao sair do foco).
- Agora teste digitar `1250000,50` em outro campo. Deve virar `R$ 1.250.000,50`.
- Agora teste `1.250.000` (com pontos). Deve virar `R$ 1.250.000,00`.
- Preencha: Sinal 125.000, Recursos Próprios 225.000, Financiamento 800.000, FGTS 100.000.
- **Confira o indicador de soma**: deve aparecer um painel verde mostrando "Soma das parcelas: R$ 1.250.000,00 / Valor total: R$ 1.250.000,00" (batendo). Se a soma não bater, o painel deve ficar vermelho.
- Teste um erro: reduza o valor do Sinal para R$ 100.000. O painel deve ficar vermelho avisando "Faltam R$ 25.000,00 para fechar o valor total".
- Volte o sinal para R$ 125.000 e avance.

2.8 **Etapa 6 — Posse e Título:**
- Momento da posse: "Na assinatura do contrato"
- Título definitivo: "Após obtenção das certidões negativas", 60 dias
- Avance.

2.9 **Etapa 7 — Comissão e Configurações:**
- Preencha os dados da comissão (valor em MoneyInput também), imobiliária e CRECI.
- Quem paga: Vendedor / Quando paga: Assinatura
- Mantenha os defaults de multas e prazos.
- Preencha cidade/UF/data de assinatura.
- Preencha pelo menos 1 testemunha (pode ser fictícia).

2.10 **Antes de clicar em Finalizar**, volte nas 6 etapas anteriores clicando no stepper ou usando o botão "Anterior". Confira que:
- Todos os dados que você preencheu foram salvos (indicador "Salvo" ou similar no topo).
- Consegue editar campos e voltar para frente sem perder nada.
- Não há flicker de layout, scroll reset incorreto, etc.

2.11 Volte à etapa 7, clique **Finalizar**.
- Deve aparecer uma tela "Formulário Concluído!" com CTAs para abrir o contrato e ver o pipeline.
- **Cronometre**: quanto tempo demorou entre o clique e a tela de sucesso? Se demorar mais de ~5s sem feedback, reporte.

---

### Passo 3 — Verificar deal no Pipeline

3.1 Clique no botão "Ver Pipeline" na tela de sucesso.

3.2 **Observe:**
- O card do novo deal deve aparecer **com highlight** (ring laranja ou destaque visual por alguns segundos) na coluna "Confecção de Contrato".
- O viewport do navegador deve **fazer scroll automático** até o card, se ele estiver fora da área visível.
- O título do card reflete o título personalizado (`[QA TESTE — <data>] Venda Apto Jardim Europa`)?
- O valor do card mostra R$ 1.250.000,00?

3.3 **Teste o drag-and-drop** (se estiver na coluna certa, pule):
- Arraste o card para outra coluna (ex: volte para "Formulário").
- Observe se o drag é suave, se há feedback visual, se o drop funciona.
- Arraste de volta para "Confecção de Contrato".

3.4 **Observe o pipeline geral:**
- As colunas são legíveis? O espaçamento é confortável?
- O totalizador da coluna ("N deals · R$ X") está correto?
- Os acentos estão corretos em todos os nomes de estágios ("Formulário", "Confecção de Contrato", "Assinatura", "Concluído")?

---

### Passo 4 — Abrir o detalhe do deal

4.1 Clique no card do deal.

4.2 **Observe o header do deal:**
- Título correto?
- Badge da stage colorida?
- Valor R$ 1.250.000,00 visível?
- Botões visíveis: "Pipeline" (voltar), "Formulário" (abrir form), "Confeccionar Contrato", e tab de Dados/Anexos/Contratos.

4.3 Clique no botão **"Formulário"** no header.
- **Deve abrir em nova aba** o formulário público correspondente (url `/f/...`).
- Se não abrir ou abrir na mesma aba, reporte.
- Feche essa aba e volte.

4.4 **Explore a aba Dados:**
- Deve haver 4 cards: Vendedor(es), Comprador(es), Imóvel(is), Pagamento.
- Os cards devem estar **abertos/expandidos por padrão** (mostrando todos os dados preenchidos).
- Confira que aparece:
  - Vendedor: nome, CPF, RG, estado civil "Casado(a)", profissão, email, endereço completo **com bairro**.
  - Comprador: idem.
  - Imóvel: endereço completo **com bairro**, matrícula, cartório, inscrição IPTU, descrição completa.
  - Pagamento: valor total, sinal, recursos próprios, financiamento, FGTS — todos formatados como BRL (R$ com vírgula decimal).
- Clique em `▾ detalhes` para colapsar/expandir. Funciona suavemente?

4.5 **Aba Anexos:** deve estar vazia. Não teste upload (ainda não é foco deste teste).

4.6 **Aba Contratos:**
- Deve mostrar 1 contrato gerado automaticamente (V1).
- O label da aba diz "Contratos (1 versão)"?

---

### Passo 5 — Abrir o contrato gerado

5.1 Clique no contrato na aba de Contratos. Ou, alternativamente, volte ao header do deal e clique em "Confeccionar Contrato" — se já existe um contrato, deve aparecer um modal perguntando sobre criar nova versão. **Clique "Cancelar"** nesse modal por enquanto.

5.2 Clique no card do contrato V1 existente para abrir o editor.

5.3 **Observe o editor:**
- Cronometre quanto tempo leva para carregar o contrato no TipTap.
- O header deve mostrar: título, badge de status (rascunho), versão, botões "Salvar Versão", "Aprovar", "Chat IA", "Exportar".
- A toolbar do editor deve ter grupos claros: texto (B/I/U/S), headings (H1/H2/H3), listas, alinhamento, inserir (link/tabela/HR/page break), ações (undo/redo/search).
- Passe o mouse em 3-4 botões da toolbar e confira se há tooltips com nome + atalho.

5.4 **Role o contrato inteiro** e observe:
- **Clausula 1.1:** verifica se o texto está completo, sem parênteses vazios `()`. Não deve aparecer "adquirido conforme , devidamente registrado sob ,".
- **Qualificação das partes:** o bairro de Roberto (Bela Vista) e de Fernanda (Pinheiros) deve aparecer.
- **Seção do cônjuge:** como Roberto é casado, deve haver uma seção "(Cônjuge/Companheiro)" com os dados de Marta.
- **Cláusula 2 (Preço):**
  - Deve mostrar R$ 1.250.000,00 como valor total.
  - Alínea (a) Sinal: R$ 125.000,00.
  - Alínea (b) Financiamento: R$ 800.000,00.
  - Alínea (b.1) FGTS: R$ 100.000,00.
  - Alínea (c) Recursos Próprios: R$ 225.000,00. **Esta é a que foi corrigida recentemente — confirme que existe.**
- **Cláusula 3 (Posse):** como você selecionou "Na assinatura do contrato", o texto deve dizer "será transmitida aos PROMISSÁRIOS COMPRADORES na data da assinatura do presente instrumento" (e não "em até 60 dias contados do pagamento integral").
- **Cláusula 11 (Comissão):**
  - Valor R$ 75.000,00.
  - Percentual deve aparecer como `6,00%` (com vírgula, não `6.00%` com ponto).
  - A imobiliária Premium Imóveis deve ser mencionada com CNPJ e **CRECI J-22.345**.
- **Qualificação da Intermediadora (topo do contrato):** também deve mostrar o CRECI.

5.5 **Contador de palavras/caracteres** no rodapé do editor: deve ser consistente e atualizar ao digitar.

---

### Passo 6 — Testar o editor: bubble menu, find/replace, comentários

6.1 **Bubble menu:** selecione 2-3 palavras em qualquer cláusula.
- Deve aparecer uma barra flutuante com ícones: Bold, Italic, Underline, Strike, Link, Highlight, Comentar, e um botão laranja "IA".
- Clique no Highlight — o trecho deve ficar marcado em amarelo.
- Selecione de novo e clique no Highlight novamente — deve remover.

6.2 **Atalhos:** selecione uma palavra e pressione Ctrl+B / Ctrl+I / Ctrl+U. Confirme que funciona.

6.3 **Find & Replace:**
- Pressione **Ctrl+F**. Deve aparecer uma barra abaixo da toolbar com campo Buscar e Substituir.
- Digite `PROMISSÁRIO`. Todas as ocorrências devem ficar destacadas em amarelo. A ativa em laranja. O contador mostra "1 de N".
- Clique na seta de próximo várias vezes e observe o scroll automático.
- No campo Substituir, digite `COMPRADOR` (teste). Clique "Substituir" (apenas na ativa). Confirme que substituiu só uma.
- **Desfaça com Ctrl+Z** para restaurar.
- Pressione Esc para fechar a barra.

6.4 **Comentário lateral:**
- Selecione um trecho em qualquer cláusula.
- No bubble menu, clique no ícone de balão (Comentar).
- Deve abrir um Dialog "Novo comentário" mostrando o trecho selecionado.
- Digite: `Teste QA — este é um comentário de teste` e confirme.
- Deve:
  - Destacar o trecho com fundo amarelo claro no editor.
  - Abrir o painel lateral direito "Comentários" com o comentário criado.
- Teste "Responder" no comentário. Adicione `Teste de resposta`.
- Teste "Resolver". O fundo amarelo some do editor. O comentário some do painel aberto.

6.5 **Quebra de página manual:**
- Posicione o cursor em um parágrafo qualquer.
- Pressione **Ctrl+Enter**.
- Deve aparecer uma linha tracejada com "Quebra de página" centrado.
- Remova a quebra (clique na linha e delete).

---

### Passo 7 — Testar o Chat IA

7.1 Clique no botão "Chat IA" no header. Um painel lateral direito deve abrir.

7.2 **Teste de conversa básica:**
- Envie: `Quais cláusulas existem neste contrato?`
- **Cronometre** a resposta. Deve ser em até 30s.
- A resposta deve vir em **markdown estruturado** com cabeçalhos.

7.3 **Teste de edição via chat (crítico):**
- Envie: `Altere o valor da multa cominatória diária de R$ 150,00 para R$ 200,00`
- A IA pode:
  (a) aplicar direto via `edit_contract_section`
  (b) sugerir via track changes (barra âmbar no topo do editor "N sugestões pendentes")
- Qualquer um é aceitável — reporte qual ocorreu.
- **IMPORTANTE:** observe se o painel do chat **permanece aberto** após a resposta. Se fechar automaticamente, reporte como bug.
- A resposta da IA deve ter estrutura markdown com seções "## Alterações Realizadas", "## Justificativa", "## Verificação".

7.4 **Segunda mensagem (sem fechar o chat):**
- Sem fechar o painel, envie outra mensagem: `Está tudo consistente no contrato?`
- Confirme que a IA responde sem quebras, que o histórico da conversa anterior continua visível, e que você pode scrollar no chat.

7.5 Feche o chat clicando no X. Confira que fecha suavemente.

---

### Passo 8 — Versionamento

8.1 Faça uma edição manual trivial no editor (ex: mude uma palavra).

8.2 Clique em "Salvar Versão" no header. Toast de sucesso?

8.3 Abra o painel "Versões" (se houver — procure no sidebar direito ou em algum botão "Histórico").
- Deve ter V1 e V2 agora. V2 marcada como "atual".

8.4 **Clique em V1.**
- O editor deve carregar o conteúdo da V1 (sem suas edições manuais e sem alterações da IA).
- Confirme que o header indica claramente que você está visualizando V1 (não V2).

8.5 Clique em V2 para voltar à versão atual.

---

### Passo 9 — Nova versão (modal de confirmação)

9.1 Volte ao detalhe do deal (`/deals/[id]`).

9.2 Clique em "Confeccionar Contrato" no header.
- Deve aparecer um modal perguntando "Criar nova versão do contrato?".
- **Leia o texto do modal com atenção.** Deve avisar que:
  - O deal já tem N versão(ões).
  - A nova versão vai ser **V3** (não V2 — o modal deve calcular corretamente o próximo número).
  - Edições manuais/IA da versão anterior **não serão transferidas**.
- Clique "Cancelar" por agora.

---

### Passo 10 — Revisão pré-aprovação (opcional, só se houver tempo)

10.1 Volte ao editor do contrato. Adicione 1 comentário novo com severity "warning" (se disponível) ou "info".

10.2 Clique em "Aprovar" no header.

10.3 **Deve aparecer** um Dialog "Revisão necessária antes de aprovar" listando:
- Contagem de comentários abertos
- Contagem de sugestões pendentes (se houver)
- Contagem de erros/warnings

10.4 Clique em "Revisar" — deve fechar sem aprovar.

10.5 **NÃO aprove o contrato.** Se o título do deal tem `[QA TESTE]`, você pode clicar em "Aprovar mesmo assim" e verificar:
- Toast de sucesso.
- Editor fica read-only.
- Banner verde "Contrato aprovado — edição bloqueada".
- Chat IA e botões de edição ficam desabilitados.

---

### Passo 11 — Exportação

11.1 Clique em "Exportar" no header. Deve abrir um dialog ou menu com opções PDF/DOCX.

11.2 Exporte em **PDF**. Baixe e abra.
- Cronometre o tempo da geração.
- Confira que o layout está limpo, os parágrafos bem formatados, e as quebras de página respeitadas se você adicionou alguma.
- Bairro, CRECI, recursos próprios, cláusula 3.1 com "na data da assinatura" devem estar presentes.

11.3 Exporte em **DOCX**. Abra no Word/LibreOffice.
- Formatação preservada? Fontes coerentes? Headers/footers?

---

### Passo 12 — Sanity checks finais

12.1 Volte ao pipeline. O deal continua visível?

12.2 Abra o DevTools Console. Recarregue a página atual. **Zero erros vermelhos?** Warnings amarelos são aceitáveis.

12.3 Redimensione a janela do browser para aproximadamente 375px de largura (mobile).
- A toolbar do editor deve fazer wrap.
- O bubble menu ainda funciona?
- O painel de comentários ocupa tela cheia?
- O pipeline faz scroll horizontal confortável?

12.4 Volte a desktop (1440px+). Confira que tudo volta ao normal.

---

## RELATÓRIO FINAL

Produza um relatório no final com as seguintes seções:

### 1. Tabela executiva

| # | Etapa | Resultado | Observações |
|---|---|---|---|
| 1 | Criar formulário | PASS/FAIL | ... |
| 2 | Preencher 7 etapas | ... | ... |
| 3 | Deal no pipeline | ... | ... |
| 4 | Detalhe do deal | ... | ... |
| 5 | Contrato gerado | ... | ... |
| 6 | Editor (bubble, find, comments) | ... | ... |
| 7 | Chat IA | ... | ... |
| 8 | Versionamento | ... | ... |
| 9 | Modal nova versão | ... | ... |
| 10 | Pré-aprovação | ... | ... |
| 11 | Exportação | ... | ... |
| 12 | Sanity checks | ... | ... |

### 2. Bugs encontrados

Para cada bug, use este formato:

```
BUG #N — <título curto>
Severidade: blocker / critical / major / minor
Passo: <número do passo do roteiro>
URL: <url da tela>
Screenshot: <descrição do screenshot>

Comportamento observado:
<o que aconteceu de fato>

Comportamento esperado:
<o que deveria acontecer>

Passos para reproduzir:
1. ...
2. ...

Hipótese de causa raiz (opcional):
<se você tiver um palpite>
```

### 3. Análise qualitativa de UI/UX

Responda essas perguntas com base na sua experiência durante o teste (não é sobre bugs, é sobre **sentimento de uso**):

**Clareza do fluxo:**
- Em qualquer momento você se sentiu perdido sobre o que fazer a seguir? Onde?
- As instruções em tela eram suficientes? Faltou alguma mensagem de orientação?
- O progresso (etapas do formulário, stages do pipeline) é claro?

**Feedback visual:**
- As ações importantes (salvar, finalizar, gerar contrato, aprovar) geram feedback imediato (toast, badge, spinner)?
- Houve algum momento em que você clicou e não soube se algo aconteceu?
- As animações de transição são agradáveis ou atrapalham?

**Consistência:**
- A linguagem, tom e terminologia estão consistentes entre telas?
- Há acentos faltando ou palavras sem acentuação ("Profissao", "Comissao", etc.)?
- Botões com a mesma função têm o mesmo texto/ícone em telas diferentes?
- Cores, tamanhos e espaçamentos parecem coerentes?

**Performance percebida:**
- Alguma ação demorou o suficiente para você pensar "travou"?
- O editor TipTap responde imediatamente ao digitar?
- Find/replace, bubble menu e chat abrem rápido?

**Legibilidade:**
- O contraste de cores é adequado (especialmente em cards, badges e cláusulas)?
- O tamanho de fonte é confortável para leitura longa (contrato)?
- Há hierarquia visual clara (títulos, subtítulos, corpo)?

**Pontos de confusão:**
- Qual foi o ponto mais confuso do fluxo completo?
- Onde um usuário iniciante provavelmente travaria?
- Que campo ou botão tem o nome ruim e precisa ser melhor explicado?

### 4. Sugestões de melhoria

Liste 5-10 melhorias concretas que você recomenda, ordenadas por impacto:
1. ...
2. ...
3. ...

### 5. Destaques positivos

Liste 3-5 coisas que funcionaram **muito bem** e merecem ser mantidas:
1. ...
2. ...

---

## Limpeza ao final

- **Não delete** nada. Apenas confirme que o título do deal criado começa com `[QA TESTE — <data>]` para que o usuário possa revisar e remover depois.
- Se você aprovou um contrato de teste, registre o ID do deal no relatório para que o usuário saiba.

---

**Comece pelo Passo 1.** Antes de cada passo que envolva **criar**, **finalizar** ou **aprovar** dados, avise brevemente: "Vou agora executar o passo X: criar formulário" — mas não precisa pedir permissão, apenas seguir.

Boa sorte!
