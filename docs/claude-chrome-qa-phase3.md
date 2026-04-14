# Prompt — QA Fase 3 (Claude Chrome)

Copie o bloco abaixo no Claude Chrome. Antes de enviar, substitua os placeholders:

- `<URL_PROD>` — URL do deploy (ex: `https://web-zeta-three-4lyvmj9ut6.vercel.app`)
- `<DEAL_TESTE_ID>` — opcional, ID de um deal marcado com `[QA TESTE]`

**O Claude Chrome já estará logado no sistema na sessão do usuário.** Não faça logout, não
navegue para `/login`, não peça credenciais.

## Pré-requisitos

Antes de rodar o QA, confirme que as variáveis de ambiente estão configuradas no Vercel:

- `ANTHROPIC_API_KEY` — obrigatório
- `VOYAGE_API_KEY` — obrigatório para RAG semântico; sem ela, busca cai em keyword fallback
- `ANTHROPIC_PASSIVE_MODEL` — opcional (default `claude-haiku-4-5-20251001`)
- `OCR_MODEL` — opcional (default `claude-haiku-4-5-20251001`)
- `VOYAGE_EMBED_MODEL` — opcional (default `voyage-law-2`)
- `BLOB_READ_WRITE_TOKEN` — necessário para upload de imagens no editor

E que estas migrations foram aplicadas:
- `20260413010151_add_comments_suggestions`
- `20260413140000_add_comment_dedupe_key`
- `20260413150000_add_knowledge_base` (pgvector)
- `20260413160000_add_learning_models` (pgvector)
- `20260413170000_add_document_style`

## Prompt

```
Você é um QA sênior validando a **Fase 3** do Contractmaker, que transformou o editor em algo
próximo do Google Docs e o agente IA de reativo para autônomo com RAG, aprendizado de
longo prazo e modo Propose. O sistema é uma plataforma SaaS em Next.js 14 + TipTap +
Prisma/Postgres (Neon) + pgvector + Voyage-law-2 + Anthropic Claude.

Ambiente: <URL_PROD>
Idioma da UI: português brasileiro

**Você já está logado no sistema.** Não faça logout, não navegue para `/login`, não peça
credenciais.

## Regras gerais

- Faça hard reload (Ctrl+Shift+R) antes de cada cenário para garantir que está pegando
  o bundle novo. NÃO abra aba anônima — isso derrubaria a sessão ativa.
- **Não aprove contratos reais.** Se precisar testar aprovação, use apenas contratos
  marcados como `[QA TESTE]` no título do deal.
- **Limpe dados de teste ao final** — comentários, sugestões, proposals, presets, items
  da base de conhecimento criados durante o teste.
- Abra DevTools Console desde o início. Reporte **qualquer** erro vermelho no console.
- Para cada cenário, reporte PASS / FAIL / BLOCKED com screenshot e descrição.
- Se um cenário depender de outro que falhou, marque BLOCKED e explique.

## Persona de teste

Use os mesmos dados da persona antiga (se existir) ou crie um novo formulário com:

- Vendedor: Roberto Mendes, CPF 123.456.789-09 (CPF VÁLIDO), casado com Marta Silva Mendes
- Comprador: Fernanda Oliveira, CPF 987.654.321-00 (CPF INVÁLIDO — é proposital para testar quickChecks)
- Imóvel: Rua das Hortênsias 789, Jardim Europa, São Paulo/SP, matrícula 45.678
- Valor total: R$ 1.250.000,00
- Sinal: R$ 125.000 / Recursos próprios: R$ 225.000 / Financiamento: R$ 800.000 / FGTS: R$ 100.000
- Modalidade: financiamento

---

## ROTEIRO DE TESTES

### BLOCO 1 — Fase 3a: Análise automática e badge proativo

**1.1 Análise ao abrir o contrato**
- Crie/abra um contrato existente com dados inválidos (use o CPF inválido da persona)
- Cronometre: em até 10s após o carregamento, o botão "Comentários" no header deve mostrar
  um badge com contagem (ex: "⚠ 2")
- VALIDAR: badge tem cor baseada em severity:
  - Vermelho pulsante se houver `error`
  - Âmbar se `warning`
  - Cinza se só `info`
- VALIDAR: clicando no botão "Comentários", o painel lateral abre mostrando cards com
  `authorType=ai`, severity explícita, selectedText ancorado no editor (fundo amarelo)
- VALIDAR: pelo menos um finding deve apontar o CPF inválido ("CPF de Comprador 1...")

**1.2 Análise passiva durante edição (debounce)**
- Feche o painel de comentários
- Edite manualmente o valor de "Sinal" de R$ 125.000 para R$ 100.000 (quebrando a soma)
- Pare de digitar e aguarde 30 segundos SEM tocar no editor
- VALIDAR: após ~30s, um novo comentário IA deve aparecer apontando que a soma das
  parcelas (1.225.000) não bate com o valor total (1.250.000)
- VALIDAR: o badge do botão Comentários atualiza contagem automaticamente
- Desfaça com Ctrl+Z
- Aguarde 30s — nada de novo deve aparecer (quickChecks passa limpo)

**1.3 Anti-duplicação de comments IA**
- Abra o contrato várias vezes em abas diferentes (sem fechar as outras)
- VALIDAR: os comentários IA existentes NÃO são duplicados a cada abertura. O `dedupeKey`
  por contentHash deve prevenir duplicatas.

**1.4 Quick checks determinísticos (sem LLM)**
- Edite o HTML para introduzir mais um CPF inválido
- Aguarde 30s
- VALIDAR: o finding aparece MUITO rápido (deve ser quickChecks client-safe, sem chamar
  Haiku — reporta imediatamente se tiver hit determinístico)

---

### BLOCO 2 — Fase 3b: Editor estilo Google Docs

**2.1 Grupo Fonte na toolbar**
- Abra um contrato em rascunho
- VALIDAR na toolbar: entre o grupo "Texto" (B/I/U/S) e o grupo "Headings" há um novo
  grupo com:
  1. Dropdown de **família de fonte** (Times New Roman, Arial, Calibri, Georgia, Courier, Helvetica)
  2. Dropdown de **tamanho** (8pt até 72pt)
  3. Botão de **cor do texto** (ícone "A") — abre paleta
  4. Botão de **cor de destaque** (ícone marca-texto) — abre paleta

**2.2 Aplicar cor ao texto**
- Selecione 2 palavras
- Abra o ColorPicker (ícone A) → escolha vermelho
- VALIDAR: texto fica vermelho
- Confirme que há indicador da cor ativa no botão (barra fina vermelha abaixo do ícone)

**2.3 Highlight multicolor**
- Selecione outro trecho
- Use o HighlightPicker → amarelo
- VALIDAR: fundo amarelo aplicado (cor de marca-texto)
- Selecione o mesmo trecho → highlight de novo → sem cor → fundo removido

**2.4 Fonte e tamanho**
- Selecione um parágrafo inteiro
- Dropdown família → "Courier New"
- Dropdown tamanho → "14"
- VALIDAR: texto muda para Courier 14pt visualmente

**2.5 Transformar caixa**
- Selecione uma palavra em caixa baixa
- Clique no botão **CaseSensitive** (ícone Aa no grupo alinhamento)
- Escolha "MAIÚSCULAS"
- VALIDAR: palavra vira toda maiúscula
- Ctrl+Z — volta

**2.6 Espaçamento entre linhas**
- Selecione um parágrafo
- Clique no botão LineHeight
- Escolha "Duplo"
- VALIDAR: espaçamento entre linhas dobra visualmente

**2.7 Format Painter (pincel)**
- Formate uma palavra com bold + vermelho
- Selecione essa palavra
- Ctrl+Alt+C (ou clique no botão de pincel)
- Selecione outra palavra sem formatação
- Ctrl+Alt+V
- VALIDAR: o formato (bold + vermelho) foi copiado para a segunda palavra

**2.8 Zoom**
- No rodapé do editor, procure o controle de zoom (botões +/- e dropdown)
- Clique "150%"
- VALIDAR: conteúdo escala 1.5x, toolbar continua no mesmo tamanho
- VALIDAR: rolagem vertical funciona sem cortar
- Volte para 100%

**2.9 Spellcheck PT-BR**
- Digite "recebimentoo" (com erro)
- VALIDAR: navegador sublinha a palavra em vermelho (spellchecker nativo lang=pt-BR)
- Clique direito → sugestões em português

**2.10 Atalhos de fonte**
- Selecione texto
- Ctrl+Shift+. → aumenta fonte
- Ctrl+Shift+, → diminui fonte

---

### BLOCO 3 — Fase 3c: Base de Conhecimento (RAG)

**3.1 Acesso à página**
- Vá em `/settings` → clique em "Base de Conhecimento"
- VALIDAR: página abre com 5 tabs (Todas, Legislação, Modelos Referenciais, Regras, Glossário)
- VALIDAR: se `VOYAGE_API_KEY` não estiver configurada, aparece um banner âmbar
  "Embeddings não configurados"

**3.2 Criar item de conhecimento**
- Clique "Novo item"
- Categoria: "Legislação"
- Título: "QA TEST — CC art. 417 Arras"
- Conteúdo: cole ~500 palavras sobre arras confirmatórias (ou lorem ipsum jurídico)
- Tags: qa-test, legislation
- Clique "Criar"
- VALIDAR: toast de sucesso; item aparece na lista
- VALIDAR: se RAG estiver ativo, o item deve aparecer imediatamente (embedding gerado em
  background)

**3.3 Testar busca semântica (RAG)**
- No campo "Filtrar por título, conteúdo ou tag", digite "arras"
- Clique em **"Testar RAG"** (botão com ícone Sparkles)
- Clique em "Rodar" no painel que abre
- VALIDAR: aparece o item criado no passo 3.2 com **similarity score > 0.3**
- VALIDAR: o badge "Modo: semântico (Voyage-law-2)" está visível
- Faça outra busca por "multa quando o comprador desiste" (query não-lexical)
- VALIDAR: ainda retorna o item — isso prova que é busca semântica, não keyword

**3.4 Chunking em documento longo**
- Crie outro item com conteúdo de >3000 caracteres (cole um texto jurídico longo)
- Salve
- VALIDAR: o card mostra badge "N chunks" (maior que 1)
- Isso indica que o chunking funcionou e múltiplos embeddings foram gerados

**3.5 Editar + Deletar item**
- Edite o item (clique no ícone lápis)
- Mude o conteúdo
- Salve
- VALIDAR: toast "atualizado"; re-embedding deve rodar em background
- Teste delete — clique lixeira, confirme → item some

**3.6 Tool query_knowledge_base via chat**
- Abra qualquer contrato
- No chat IA, envie: "Consulte a base de conhecimento sobre arras confirmatórias e me
  explique como se aplica a este contrato"
- VALIDAR: a IA deve responder mencionando o item "QA TEST — CC art. 417 Arras" que você
  criou (prova que chamou `query_knowledge_base` e citou o resultado)

---

### BLOCO 4 — Fase 3d: Aprendizado e modo Propose

**4.1 Hook pós-aprovação cria memória**
- Crie um deal marcado `[QA TESTE]`
- Gere um contrato com dados válidos (corrija o CPF da persona)
- Use o chat IA: "Valide este contrato" para garantir que não há bloqueadores
- Clique em "Aprovar" — confirme o dialog se aparecer
- VALIDAR: toast "Contrato aprovado!"
- Isso deve disparar, em background, `createContractMemory` — não tem UI visível mas o
  sistema gerou uma `ContractMemory` row

**4.2 find_similar_contracts via chat**
- Abra OUTRO contrato (diferente do aprovado) — pode ser do mesmo template
- No chat: "Antes de editar, verifique como a organização tratou casos similares"
- VALIDAR: a IA chama `find_similar_contracts` e responde mencionando que encontrou o
  contrato aprovado no passo 4.1 (com summary e fingerprint)
- Se `VOYAGE_API_KEY` ativa, ela deve citar a similarity score; se não, ranking por
  fingerprint

**4.3 UI /clauses/proposals**
- Vá em `/settings` → "Propostas de Cláusulas" (ou direto `/clauses/proposals`)
- VALIDAR: página abre com tabs Pendentes/Resolvidas (podem estar vazias)

**4.4 Criar proposta manualmente (via API para testar UI)**
- Abra DevTools Network
- Rode no Console:
  ```js
  fetch('/api/clauses/proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'QA TEST — Cláusula de Vistoria',
      content: 'Os COMPRADORES declaram ter realizado vistoria do imóvel...',
      reason: 'Proposta criada manualmente no QA para validar o fluxo Propose',
      groupCode: 'G2',
      category: 'posse',
      tags: ['qa-test'],
    }),
  }).then(r => r.json()).then(console.log);
  ```
- Recarregue `/clauses/proposals`
- VALIDAR: a proposta aparece na tab "Pendentes" com título, justificativa, conteúdo
- Clique "Adicionar à biblioteca" — VALIDAR: toast de sucesso, proposta vai pra "Resolvidas"
- Vá em `/clauses` e confirme que a nova cláusula existe lá com source "ai_proposal"

**4.5 UI /templates/[id]/suggestions**
- Vá em `/templates`, abra qualquer template
- Navegue para `/templates/<template-id>/suggestions` (ou adicione um link no breadcrumb)
- VALIDAR: página abre com "Nenhuma sugestão pendente"

**4.6 Criar sugestão de template via API**
- No Console:
  ```js
  const templateId = 'COLE_O_ID_DO_TEMPLATE_AQUI';
  // Primeiro descubra um trecho que existe no template
  fetch(`/api/templates/${templateId}`).then(r=>r.json()).then(t => {
    console.log(t.handlebarsSource.slice(0, 500));
  });
  ```
- Copie um trecho do handlebarsSource (ex: 20-50 chars únicos)
- Rode:
  ```js
  fetch(`/api/templates/${templateId}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'QA TEST — Ajuste de cláusula',
      reason: 'Proposta manual no QA para testar o diff viewer',
      diffHunks: [{
        before: 'COLE_O_TRECHO_AQUI',
        after: 'NOVO_TRECHO_AQUI',
      }],
    }),
  }).then(r => r.json()).then(console.log);
  ```
- Recarregue a página `/templates/<id>/suggestions`
- VALIDAR: cartão mostra diff verde/vermelho side-by-side
- Clique "Aplicar no template"
- VALIDAR: toast "Template agora está na versão X.Y.Z+1"
- Vá em `/templates/<id>` e confirme que o source mudou e a versão incrementou

**4.7 Rate limit de proposals**
- Crie 6 proposals de cláusula em rápida sequência
- VALIDAR: o 6º deve retornar erro "5 propostas pendentes"

---

### BLOCO 5 — Fase 3e: Design System, imagens, TOC

**5.1 Criar DocumentStyle preset**
- Vá em `/settings` → "Estilos de Documento"
- Clique "Novo preset"
- Nome: "QA TEST — Formal"
- Família: Times New Roman / Tamanho: 12 / Line height: 1.5
- Margens: 30/25/25/25
- Cor primária: preto
- Cor destaque: laranja (#C97B0A)
- Rodapé HTML:
  ```html
  <div style="font-size:9pt;text-align:center;color:#666;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>
  ```
- Marque "Definir como padrão"
- VALIDAR: preview à direita mostra uma amostra do estilo em tempo real
- Clique "Criar"
- VALIDAR: toast de sucesso, preset aparece na lista com badge "Padrão" (estrela)

**5.2 Aplicar preset via Chat IA**
- Abra um contrato em rascunho
- No chat IA: "Aplique o preset 'QA TEST — Formal' a este contrato"
- VALIDAR: a IA chama `apply_style_preset` e responde confirmando. A resposta deve
  incluir os props aplicados (fontFamily, fontSizeBase, etc.)
- VALIDAR no editor: o corpo do contrato agora tem fonte Times, tamanho 12

**5.3 Exportar PDF com o preset aplicado**
- Clique "Exportar" → PDF
- Abra o PDF baixado
- VALIDAR: fonte Times New Roman 12pt
- VALIDAR: margens visíveis (superior 30mm aproximadamente)
- VALIDAR: rodapé mostra "1 / N" centrado na parte inferior de cada página

**5.4 Upload de imagem (requer BLOB_READ_WRITE_TOKEN)**
- No editor, arraste uma imagem PNG/JPG (<5MB) para dentro
- OU use o chat IA com URL: "Insira esta imagem no topo: https://picsum.photos/400/200"
- VALIDAR: imagem aparece no editor centralizada
- VALIDAR: se não houver BLOB_READ_WRITE_TOKEN, o POST /images retorna 503 com mensagem
  clara; neste caso, o Chat IA com URL externa ainda deve funcionar

**5.5 Tool insert_image via chat**
- No chat IA: "Insira a imagem https://picsum.photos/500/300 depois da primeira cláusula"
- VALIDAR: a IA chama `insert_image` e confirma a inserção
- VALIDAR visualmente: imagem aparece no local indicado

**5.6 Tamanho máximo de upload**
- Tente fazer upload de um arquivo > 5MB
- VALIDAR: erro "Arquivo excede 5 MB"

**5.7 Tipo inválido**
- Tente upload de um .pdf renomeado para .png
- VALIDAR: erro de tipo inválido

---

### BLOCO 6 — Integração e Sanity

**6.1 Contador de tools do agente**
- No Console: olhe os logs quando a IA roda
- OU inspecione o network em `/api/contracts/[id]/chat` — a resposta deve incluir
  `toolsUsed` ou similar
- VALIDAR: o agente tem **18 tools** disponíveis (query_clauses, query_templates,
  explain_clause, edit_contract_section, update_contract_data, insert_clause,
  remove_clause, validate_contract, suggest_improvements, extract_document_data,
  add_comment, analyze_contradictions, query_knowledge_base, find_similar_contracts,
  propose_new_clause, propose_template_change, apply_style_preset, insert_image)

**6.2 Prompt rules**
- Vá em `/settings` → aba "Agente IA"
- VALIDAR: o system prompt tem **18 regras numeradas**

**6.3 Console limpo**
- Recarregue várias páginas (/contracts/[id], /settings/knowledge-base,
  /settings/document-styles, /clauses/proposals, /templates/[id]/suggestions)
- VALIDAR: zero errors no Console em cada uma

**6.4 Build size check**
- Verifique se o editor `/contracts/[id]` carrega em tempo razoável (<3s em 4G)
- Pode comparar o Network tab: o bundle do editor deve estar em torno de 167kB
  (crescimento esperado pelas novas extensões TipTap)

**6.5 Mobile responsiveness**
- Redimensione para 375px
- VALIDAR: toolbar faz flex-wrap, rodapé (zoom control) fica acessível
- VALIDAR: página /settings/document-styles fica utilizável em mobile

---

## RELATÓRIO FINAL

Apresente no formato:

### Tabela executiva

| # | Cenário | Resultado | Observações |
|---|---|---|---|
| 1.1 | Análise ao abrir | PASS/FAIL | ... |
| 1.2 | Análise passiva (debounce) | ... | ... |
| 1.3 | Anti-duplicação | ... | ... |
| 1.4 | Quick checks | ... | ... |
| 2.1 | Grupo Fonte toolbar | ... | ... |
| 2.2 | Cor texto | ... | ... |
| 2.3 | Highlight multicolor | ... | ... |
| 2.4 | Fonte e tamanho | ... | ... |
| 2.5 | Transformar caixa | ... | ... |
| 2.6 | Line height | ... | ... |
| 2.7 | Format painter | ... | ... |
| 2.8 | Zoom | ... | ... |
| 2.9 | Spellcheck | ... | ... |
| 2.10 | Atalhos fonte | ... | ... |
| 3.1 | Página KB | ... | ... |
| 3.2 | Criar item | ... | ... |
| 3.3 | Busca RAG | ... | ... |
| 3.4 | Chunking | ... | ... |
| 3.5 | Edit/delete | ... | ... |
| 3.6 | query_knowledge_base chat | ... | ... |
| 4.1 | Hook pós-aprovação | ... | ... |
| 4.2 | find_similar_contracts | ... | ... |
| 4.3 | Página proposals | ... | ... |
| 4.4 | Aprovar proposal | ... | ... |
| 4.5 | Página suggestions | ... | ... |
| 4.6 | Aprovar template suggestion | ... | ... |
| 4.7 | Rate limit | ... | ... |
| 5.1 | Criar preset | ... | ... |
| 5.2 | apply_style_preset | ... | ... |
| 5.3 | PDF com preset | ... | ... |
| 5.4 | Upload imagem | ... | ... |
| 5.5 | insert_image chat | ... | ... |
| 5.6 | Limite 5MB | ... | ... |
| 5.7 | Tipo inválido | ... | ... |
| 6.1 | 18 tools | ... | ... |
| 6.2 | 18 rules | ... | ... |
| 6.3 | Console limpo | ... | ... |
| 6.4 | Bundle size | ... | ... |
| 6.5 | Mobile | ... | ... |

### Bugs encontrados

Para cada bug:

```
BUG #N — <título curto>
Severidade: blocker / critical / major / minor
Passo: <número>
URL: <url>
Screenshot: <id ou descrição>

Comportamento observado:
<o que aconteceu>

Comportamento esperado:
<o que deveria acontecer>

Passos para reproduzir:
1. ...
2. ...
```

### Análise qualitativa

- **Autonomia percebida do agente**: o usuário sente que a IA "trabalha sozinha" ou
  ainda precisa perguntar tudo?
- **Latência da análise passiva**: 30s é aceitável ou atrapalha o fluxo de edição?
- **Qualidade dos findings IA**: são úteis ou ruidosos?
- **RAG útil?**: a IA cita a base de conhecimento de forma que ajuda, ou parece forçada?
- **Modo Propose intuitivo?**: o usuário entende por que mudanças em template não são
  aplicadas direto?
- **Editor Google-Docs-like**: comparando com Google Docs real, o que ainda falta?
- **Design system útil?**: os presets fazem sentido, ou é complexidade desnecessária?

### Limpeza final

Confirme que você:
- Removeu o item "QA TEST — CC art. 417 Arras" da base de conhecimento
- Removeu o preset "QA TEST — Formal"
- Removeu as proposals/suggestions criadas
- Deixou a cláusula "QA TEST — Cláusula de Vistoria" marcada ou removida da biblioteca
- NÃO aprovou nenhum contrato real
- Se aprovou o contrato `[QA TESTE]` do bloco 4.1, registre o ID no relatório para
  limpeza manual posterior

---

**Comece pelo Bloco 1.** Antes de qualquer cenário que envolva criar ou deletar dados,
avise brevemente: "Vou agora executar o passo X" e prossiga. Não precisa pedir permissão.
```
