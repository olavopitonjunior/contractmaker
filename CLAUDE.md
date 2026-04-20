# Contractmaker - Claude Code Context

## Visao Geral
Plataforma de gestao de vendas e contratos imobiliarios. Esteira completa: Formulario de vendas -> Kanban de negocios -> Geracao de contratos com IA -> Edicao rica -> Export PDF/DOCX.

## Tech Stack
- **Framework:** Next.js 14 (App Router) - deploy Vercel
- **UI:** Tailwind CSS v4 + Shadcn (new-york) + lucide-react + sonner
- **Auth:** NextAuth.js v5 + Prisma Adapter + Credentials provider
- **DB:** PostgreSQL + Prisma ORM
- **Editor:** TipTap (ProseMirror) para edicao de contratos
- **Kanban:** @dnd-kit/core + @dnd-kit/sortable
- **AI:** Anthropic SDK (Claude) - agent do chat, analise, geracao de clausulas | Google GenAI SDK (Gemini 2.5 Flash) - OCR do upload de documentos
- **Template:** Handlebars com helpers brasileiros (moeda, cpf, cnpj, cep, dataExtenso, extenso, numero, numeroExtenso, percentual)
- **RAG:** pgvector (Neon) + Voyage-law-2 embeddings (1024 dim, HNSW cosine) para base de conhecimento juridica
- **Passive Analysis:** Claude Haiku 4.5 debouncado no editor (analise automatica on-open + on-edit)
- **Certidoes:** Infosimples REST API v2 (CND Federal/PGFN, CNDT, TRF Civel unificado, CEAT trabalhista regional, TJSP/TJRJ/TJRS, CENPROT SP, IPTU SP/RJ) — ~R$ 0,04-0,06 por chamada
- **PDF:** puppeteer-core + @sparticuz/chromium (Vercel-compatible)
- **DOCX:** html-to-docx
- **Storage:** @vercel/blob (primario) + S3 (fallback)
- **Forms:** React Hook Form + Zod
- **Toasts:** sonner

## Estrutura do Projeto
```
apps/web/                    # Next.js app principal
  prisma/
    schema.prisma            # Schema completo do banco
    seed.ts                  # Dados iniciais (templates v2 + 23 clausulas padronizadas)
  src/
    app/
      (auth)/                # Login/registro (publico)
      (dashboard)/           # Area protegida
        pipeline/            # Kanban de negocios
        deals/[dealId]/      # Detalhe do negocio
        contracts/[id]/      # Editor de contrato
        clauses/             # Biblioteca de clausulas (agrupada por banco G1-G6)
        templates/           # Templates de contrato
        settings/            # Config organizacao
      f/[token]/             # Formulario publico (sem auth)
      api/                   # API routes
    components/
      ui/                    # Shadcn components (inclui popover.tsx)
      layout/                # Sidebar, Header
      pipeline/              # KanbanBoard, KanbanCard
      forms/                 # SalesFormWizard, step forms
      contracts/             # ContractEditor, ContractEditorPage, EditorBubbleMenu,
                             # FindReplaceBar, CommentsPanel, AddCommentDialog,
                             # SuggestionsToolbar, ApprovalReviewDialog, ClauseSelector,
                             # ChangeLogPanel, VersionTimeline
      chat/                  # ChatPanel, ChatMessage
      export/                # ExportDialog
    hooks/                   # useAutoSave, useDebounce, useAutoAnalyze
    lib/
      auth/                  # NextAuth config
      db/                    # Prisma client
      ai/                    # agent, tools (18), tool-handlers, prompts, validators, ocr,
                             # quickChecks, embeddings (Voyage), chunking, knowledge, memory,
                             # usage (observability: AIUsage + pricing + recordAIUsage)
      certidoes/             # infosimples client, planner, executor, normalizers,
                             # endpoints catalog, comarcas-rj, report builder, fixtures, tests
      render/                # Handlebars (helpers moeda/extenso/percentual/...), PDF/DOCX
                             # exporter.ts com htmlForDocx preprocessor + serverless chromium launcher
      storage/               # S3 (legacy) — exports/attachments hoje usam @vercel/blob direto
      forms/                 # Zod schemas, validation, extracted-to-form mapping
      editor/                # TipTap custom extensions (CommentMark, SuggestionMark,
                             # PageBreakNode, SearchReplace, FontSize, LineHeight,
                             # TextTransform, FormatPainter)
templates/                   # Handlebars .hbs files
  contrato_compra_venda.hbs  # Template legado v1 (deprecated)
  ccv_a_vista_v2.hbs         # Template padronizado: pagamento a vista (15 clausulas)
  ccv_financiamento_v2.hbs   # Template padronizado: financiamento (17 clausulas)
  relatorio_certidoes.hbs    # Template do relatorio de due diligence (PDF)
examples/                    # Dados de exemplo
```

## Convencoes
- Idioma do codigo: ingles (nomes de variaveis, funcoes, componentes)
- Idioma da UI: portugues brasileiro
- IDs: cuid() para novos models, uuid() para models legados
- API routes: Next.js App Router route handlers
- Validacao: Zod em todas as APIs
- Componentes: Server Components por padrao, "use client" apenas quando necessario
- Estilo: Tailwind utility classes, Shadcn components como base
- Imports: path alias `@/*` -> `src/*`

## Dados Criticos
- `DadosContrato`: tipo TypeScript que define a estrutura de dados de vendas imobiliarias (vendedores, compradores, imoveis, pagamento, comissao, config)
- O formulario de vendas produz exatamente a estrutura DadosContrato
- Campo `modalidade` ("a_vista" | "financiamento") determina qual template e usado
- O Handlebars renderiza contratos usando esta estrutura
- Alteracoes no DadosContrato devem ser ADITIVAS (novos campos opcionais), nunca breaking

## Templates Padronizados (v2)
Dois modelos de CCV baseados nos documentos Zimmermann:

- **CCV A Vista** (`ccv_a_vista_v2.hbs`): 15 clausulas. Sinal + saldo em recursos proprios. Posse apos pagamento integral. Escritura publica.
- **CCV Financiamento** (`ccv_financiamento_v2.hbs`): 17 clausulas. Sinal + financiamento bancario. Posse apos registro do contrato de financiamento. Instrumento definitivo com 45 dias uteis. Clausula 9.5 de rescisao por nao obtencao de financiamento.

Templates usam `<!-- CLAUSE_SLOT:Gx -->` como pontos de insercao para clausulas variaveis do banco.

## Banco de Clausulas Padronizadas (23 clausulas em 6 grupos)
| Grupo | Tema | Qtd |
|-------|------|-----|
| G1 | Sinal, Arras e Início de Pagamento | 3 |
| G2 | Imissão na Posse | 4 |
| G3 | Rescisão e Condição Resolutiva | 4 |
| G4 | Financiamento e Registro (OBRIGATÓRIO em financiamento) | 4 |
| G5 | Comissão de Corretagem | 3 |
| G6 | Declarações e Disposições Especiais | 5 |

Cada clausula tem `agentNotes` (orientacao juridica interna para a IA) e `groupCode` (G1-G6).

## Agente IA (18 tools)
O agente roda em `src/lib/ai/agent.ts` com loop de tool-use (max 5 iteracoes). Todas as tools estao definidas em `src/lib/ai/tools.ts` e handlers em `src/lib/ai/tool-handlers.ts`:

- **Consulta:** `query_clauses` (com groupCode/isVariable), `query_templates`, `explain_clause`
- **Edicao:** `edit_contract_section`, `update_contract_data`, `insert_clause`, `remove_clause`
- **Analise:** `validate_contract`, `suggest_improvements`, `analyze_contradictions` (5 checks: matematica, qualificacao, referencia, prazos, clausulas mutuamente exclusivas)
- **OCR:** `extract_document_data`
- **Comentarios:** `add_comment` (cria comentario lateral ancorado em trecho, severity info/warning/error)
- **Base de Conhecimento (RAG):** `query_knowledge_base` (Voyage-law-2 embeddings + pgvector cosine, fallback para keyword search se VOYAGE_API_KEY ausente)
- **Aprendizado:** `find_similar_contracts` (busca em `ContractMemory` por embedding ou fingerprint)
- **Modo Propose:** `propose_new_clause` (cria `ClauseProposal` pendente), `propose_template_change` (cria `TemplateSuggestion` pendente — JAMAIS edita `handlebarsSource` direto)
- **Design System:** `apply_style_preset`, `insert_image` (upload via Vercel Blob, 5MB max)

O `insert_clause` usa CLAUSE_SLOT:Gx para posicionar clausulas semanticamente no template.
O `suggest_improvements` verifica clausulas obrigatorias por modalidade e dados do contrato.
O `add_comment` valida que o `selectedText` existe no `htmlContent` antes de ancorar (evita alucinacao).
`propose_template_change` e `propose_new_clause` tem rate limit (max 5 pendentes/org, 1/dia/template).

System prompt tem **18 regras fundamentais** + regra 10.1 (perguntas informativas) em `src/lib/ai/prompts.ts`. Regra 10 obriga resposta em markdown com secoes `## Alteracoes Realizadas`, `## Justificativa`, `## Verificacao`. Regra 10.1 proibe tools de edicao em perguntas informativas (quem/qual/como/...) e exige lista markdown descritiva. Regra 11 prefere modo sugestao (track changes) a edicao direta. Regra 13 obriga placeholders `[preencher X]` quando dados ausentes. Regras 14-18 cobrem prioridade de findings, RAG, aprendizado, modo propose e design system.

## Analise Automatica (Phase 3a — autonomia do agente)
O agente roda passivamente no editor via `useAutoAnalyze.ts` (`apps/web/src/hooks/`):
- **On-open:** ao carregar um contrato, dispara `POST /api/contracts/[id]/auto-analyze { trigger: 'open' }` usando Sonnet 4.5 para analise profunda
- **On-edit (debounced):** escuta `editor.on('update')`; apos 30s de idle OU 60s maximo, dispara com `trigger: 'edit'` usando Haiku 4.5 (variavel `ANTHROPIC_PASSIVE_MODEL`)
- **Quick checks client-safe:** `src/lib/ai/quickChecks.ts` tem 4 checks deterministicos (soma de parcelas, CPF/CNPJ checksum, referencias internas, duplicacao de qualificacao) — rodam primeiro, sem custo de LLM
- **Dedupe:** `ContractComment.dedupeKey` (hash FNV-1a de authorType+selectedText+text) com `@@unique([contractId, dedupeKey])` previne duplicatas em re-analises
- **Badge proativo:** `ContractEditorPage` mostra contagem de comments IA nao-resolvidos no botao "Comentarios" com cor/pulsacao baseadas no `maxSeverity`
- O cliente envia o `htmlContent` atual (editor live state) no body do request para que o servidor nao analise DB stale

## Editor de Contratos (TipTap avancado, Google-Docs-like)
O editor em `src/components/contracts/ContractEditor.tsx` usa TipTap v3 com:
- **StarterKit v3** (ja inclui Underline, Link, Strike nativamente)
- **Table** (resizable) + TableRow/Cell/Header
- **Highlight** multicolor
- **TextAlign** (heading + paragraph, inclui justify)
- **CharacterCount** (rodape mostra "X palavras · Y caracteres")
- **Typography** (aspas curvas, travessao automatico)
- **TextStyle + Color + FontFamily** (oficiais) para cor do texto e familia da fonte
- **Image** (`@tiptap/extension-image`) — upload via `POST /api/contracts/[id]/images` (Vercel Blob, 5MB max)
- **BubbleMenu** (floating toolbar ao selecionar texto)

Extensoes customizadas em `src/lib/editor/`:
- `SearchReplace.ts` — Find & Replace via ProseMirror Decorations (Ctrl+F). Comandos `setSearchTerm`, `nextResult`, `replaceCurrent`, `replaceAll`, `clearSearch`.
- `CommentMark.ts` — Mark `<span data-comment-id>` com classe `comment-anchor`. Comandos `setCommentMark({commentId})`, `unsetCommentMark(id)`.
- `SuggestionMark.ts` — Mark `<ins>`/`<del>` para track changes com attrs `{suggestionId, type, authorType}`. Comandos `setInsertionMark`, `setDeletionMark`, `acceptSuggestion(id)`, `rejectSuggestion(id)`.
- `PageBreakNode.ts` — Node de bloco com CSS `page-break-after: always`. Atalho `Ctrl+Enter`.
- `FontSize.ts` — TextStyle mark com atributo `fontSize` (valores 8-72pt). Comandos `setFontSize`, `unsetFontSize`, `increaseFontSize`, `decreaseFontSize` (atalhos `Ctrl+Shift+.` / `Ctrl+Shift+,`).
- `LineHeight.ts` — Extension que adiciona atributo `lineHeight` a nos `paragraph`/`heading`. Valores `[1.0, 1.15, 1.5, 2.0, 2.5, 3.0]`.
- `TextTransform.ts` — Comando `transformCase('upper'|'lower'|'title'|'sentence')` que substitui destrutivamente o texto da selecao (Ctrl+Z reverte).
- `FormatPainter.ts` — Storage `{copiedMarks, hasClipboard}`. Atalhos `Ctrl+Alt+C` copia marks da selecao, `Ctrl+Alt+V` aplica no destino.

Toolbar em 7 grupos: **Texto** (Bold/Italic/Underline/Strike), **Fonte** (FontFamily/FontSize/ColorPicker text+highlight), **Headings**, **Listas** (+Indent/Outdent), **Alinhamento** (+Justify/LineHeight/TextTransform/FormatPainter), **Inserir** (Link/Tabela/HR/PageBreak/Image), **Acoes** (Undo/Redo/Search). Todos os botoes tem `TooltipProvider` com atalho visivel. Dropdowns usam Radix com portal — `globals.css` tem regra defensiva `[data-radix-popper-content-wrapper] { z-index: 100 !important }` para flutuar acima da toolbar sticky com backdrop-filter.

BubbleMenu ([EditorBubbleMenu.tsx]) aparece ao selecionar texto: Bold, Italic, Underline, Strike, Link (popover), Highlight, Comentar (balao), botao "IA" laranja. O botao IA chama `onAskAI(text)` que abre o `ChatPanel` pre-populando o input com o trecho como blockquote.

Zoom: controle no rodape (`ZoomControl.tsx`) com steps `[50, 75, 90, 100, 125, 150, 200]%`. Aplicado via `transform: scale()` APENAS no wrapper `.a4-page` (interno), mantendo a toolbar fora do stacking context.

Spellcheck nativo PT-BR: `spellcheck="true" lang="pt-BR"` no elemento contenteditable.

`ContractEditor` expoe prop `onReady(editor)` — chamada uma unica vez quando o TipTap editor fica disponivel. `ContractEditorPage` usa isso para manter o editor em `useState<Editor | null>` (em vez de ler `editorRef.current?.getEditor()` no JSX, que era instavel). O handle via `forwardRef` tambem expoe `applyCommentMarkByText(anchorId, selectedText)` que busca o texto via `doc.descendants` e aplica `CommentMark` — usado para ancorar visualmente comentarios IA criados no servidor sem selecao ativa.

Wrapper visual A4: editor envolvido em `.a4-page` com `width: 794px` (210mm @ 96dpi), `min-height: 1123px`. CSS em `src/app/globals.css`.

## Comentarios e Track Changes
Models Prisma:
- **ContractComment** — id, contractId, userId?, authorName, authorType ("user"|"ai"), text, anchorId, selectedText, severity ("info"|"warning"|"error"), resolved, parentId (replies), createdAt.
- **ContractSuggestion** — id, contractId, userId?, authorType, type ("insertion"|"deletion"|"replacement"), suggestionId (anchor), originalText, newText, reason, status ("pending"|"accepted"|"rejected"), resolvedAt, resolvedBy.

API routes:
- `GET/POST /api/contracts/[id]/comments` — lista + cria comentarios
- `PATCH/DELETE/POST /api/contracts/[id]/comments/[commentId]` — atualiza (resolve), deleta, responde
- `GET/POST /api/contracts/[id]/suggestions?status=pending` — lista + cria sugestoes
- `PATCH/DELETE /api/contracts/[id]/suggestions/[suggestionId]` — accept/reject (salva htmlContent), delete

UI:
- `CommentsPanel.tsx` — Sheet lateral direito, cards com autor/data/severity/selectedText blockquote/replies. Click navega para anchor no editor via `ContractEditorHandle.scrollToComment`.
- `AddCommentDialog.tsx` — modal pedindo texto do comentario (Ctrl+Enter para enviar).
- `SuggestionsToolbar.tsx` — barra ambar no topo do editor quando ha sugestoes pendentes. "Aceitar todas" / "Rejeitar todas" em lote (sync com DB via PATCH).

`ContractEditor` expoe um handle via `forwardRef`: `applyCommentMark`, `removeCommentMark`, `scrollToComment`, `focus`, `getHTML`, `getEditor`. `ContractEditorPage` usa o ref para aplicar marcas apos POST de comentario.

## Etapa 0 - Anexo de Documentos + OCR (formulario de vendas)
O formulario publico (`/f/[token]`) agora comeca pela **Etapa 0 - Documentos** (antes de Vendedor/Comprador/Imovel). Total passou de 7 para 8 etapas. `STEP_LABELS` e `STEP_REQUIRED_FIELDS` em `lib/forms/validation.ts` refletem isso; a etapa 0 nao tem required fields (e opcional — usuario pode pular clicando "Proximo").

**Componente:** `components/forms/steps/DocumentosStep.tsx`
- Dropzone nativo (sem lib) aceita imagens JPG/PNG/WebP/GIF e PDFs ate 10 MB, max 15 arquivos por form.
- Resize client-side via `createImageBitmap` + canvas para max 2000px antes do upload (reduz token de imagem no Claude). PDFs nao sao rasterizados — vao direto pro Claude como `type: "document"`.
- Pipeline por arquivo: upload → OCR → sugestao de atribuicao (auto ou manual via dropdown).
- Botao "Aplicar aos campos (N)" itera docs prontos, chama `mapExtractedToForm` e preenche campos do React Hook Form respeitando `skipIfDirty` (nao sobrescreve valores ja digitados).
- Ao reabrir o form, `GET /api/forms/[token]/attachments` restaura os docs + extractedData.

**Componente visual:** `components/forms/DocumentCard.tsx`
- Thumbnail 80x80 (clicavel → abre preview), badge de categoria, confidence em %, chips dos campos extraidos, select de atribuicao, botao remover. Modo `readOnly` usado no DealDetail.
- Estados: `uploading | extracting | ready | failed`. Estado `applied` com borda verde quando os campos foram aplicados no form.

**API routes** (publicas, autorizacao pelo token do form):
- `GET/POST/PATCH/DELETE /api/forms/[token]/attachments` — lista/cria/atualiza assignment/deleta FormAttachment. POST recebe multipart com campo `file`. PATCH recebe `{assignment: {kind, index}}` e persiste em `extractedData.assignment`.
- `GET /api/forms/[token]/attachments/[id]/file` — serve o buffer do storage (s3:// ou file://) como resposta HTTP. E o que o browser usa via `fileUrl`.
- `POST /api/forms/[token]/attachments/[id]/extract` — baixa buffer, chama `classifyAndExtract`, persiste `category` + `extractedData` no FormAttachment. Cache: se ja tem extractedData, retorna sem refazer. `maxDuration = 60`.

**OCR engine:** `lib/ai/ocr.ts`
- `classifyAndExtract(base64, mimeType): Promise<ExtractionResult>` — **uma unica chamada Gemini 2.5 Flash** via SDK `@google/genai`. Classifica + extrai em JSON combinado `{tipo, campos, confidence}`. Input/output via `inlineData: {mimeType, data}` — mesmo padrao para imagens e PDFs (sem branching por tipo).
- Suporta **imagens** (`image/jpeg|png|webp|gif`) E **PDFs nativos** (`application/pdf`) sem necessidade de rasterizacao client-side.
- Modelo default: `gemini-2.5-flash` (override via env `GEMINI_OCR_MODEL` — alternativas: `gemini-2.5-flash-lite`, `gemini-2.0-flash`).
- Credencial: `GEMINI_API_KEY` (obter em https://aistudio.google.com/apikey). Lazy client via `getGenAI()` — lanca erro se key ausente.
- Categorias validas: `rg | cpf | cnh | matricula | iptu | escritura | procuracao | comprovante_residencia | outro`. O `COMBINED_PROMPT` lista os campos esperados por categoria.
- `classifyDocument` e `extractDocumentData` legacy continuam no arquivo usando Anthropic Claude — sao acionadas pelo tool `extract_document_data` do agent do chat do editor de contrato. O switch para Gemini e **isolado ao fluxo de upload do formulario**.

**Mapeamento OCR → form:** `lib/forms/extracted-to-form.ts`
- `mapExtractedToForm(extraction, assignment, form, {skipIfDirty})` — le `FIELD_MAP_PERSON` / `FIELD_MAP_IMOVEL` e chama `form.setValue` para cada campo matcheado. Faz coercao (sanitize cpf para 11 digitos, UF para 2 letras uppercase, parse de `endereco_completo` em rua+numero via regex).
- `suggestAssignment(category, fields, snapshot)` — heuristica: property docs → imovel[0]; person docs → match por cpf ou nome nos vendedores/compradores ja preenchidos, senao primeira posicao vazia (prioriza vendedores se so ha vendedores, compradores caso contrario).
- `PERSON_CATEGORIES` inclui `rg, cpf, cnh, procuracao, comprovante_residencia`. `PROPERTY_CATEGORIES` inclui `matricula, iptu, escritura`.
- `DocumentKind` = `"vendedor" | "comprador" | "imovel" | "outro"`.

**Persistencia no Deal:** ao finalizar o form (status → "completo"), `PATCH /api/forms/[token]/route.ts` chama `generateContractForDeal` e **copia os FormAttachments para DealAttachments** (insert em lote, mesmas URLs — nao recria blobs). Se form for deletado depois, a copia no Deal sobrevive.

**Visualizacao no Deal:** `components/pipeline/DealDetail.tsx` tem aba "Documentos" renderizada por `DocumentsTab` (componente interno no mesmo arquivo). Busca `deal.form.attachments` (com extractedData) agrupando por `extractedData.assignment.kind` — Parte Vendedora / Parte Compradora / Imovel / Outros. Cada card usa `DocumentCard` em `readOnly`.

**Schema Prisma:** sem migrations novas. `FormAttachment { id, formId, filename, mime, url, category, extractedData Json? }` ja existia com os campos necessarios. O `extractedData` guarda `{fields: {...}, confidence: number, assignment?: {kind, index}}`.

**Custo estimado:** Gemini 2.5 Flash ~US$ 0,30/MT input + US$ 2,50/MT output. Doc tipico ~1.3K input (img resized) + ~300 output ≈ US$ 0,0013/doc. Form com 8 docs ≈ **US$ 0,01/form** (58% mais barato que Haiku 4.5).

## Base de Conhecimento RAG (Phase 3c)
**Schema:** `KnowledgeItem { id, orgId, category, title, content, chunkIndex, chunkTotal, parentId, tags, source, embedding vector(1024) }` — coluna `embedding` criada via migration SQL raw (pgvector nao e nativo no Prisma). Indice HNSW com `vector_cosine_ops`. Categorias: `legislation | model | rule | glossary`.

**Wrapper:** `src/lib/ai/embeddings.ts` — `embed(texts[], inputType)` e `embedOne(text, inputType)` chamam a API Voyage (`voyage-law-2` default). `inputType` aceita `"document"` para indexacao e `"query"` para busca. `isEmbeddingsConfigured()` retorna false se `VOYAGE_API_KEY` ausente.

**Chunking:** `src/lib/ai/chunking.ts` divide documentos grandes em chunks ~800 tokens com overlap 100 (parent/child relationship via `parentId`).

**Tool `query_knowledge_base`:** usa pgvector via `$queryRawUnsafe` com operador `<=>`. Se embeddings nao configurados, faz fallback keyword search via Prisma ILIKE. Retorna `{results, mode: "semantic"|"keyword"}`.

**UI:** `/settings/knowledge-base` com 5 tabs (Todas + 4 categorias), filtro, botao "Testar RAG" que mostra similarity score. Forms de criacao/edicao via Sheet. Upload de PDF/DOCX roda OCR (Gemini Flash) + chunking + embedding em background.

## Aprendizado e Modo Propose (Phase 3d)
**Memoria de contratos aprovados:** hook fire-and-forget em `POST /api/contracts/[id]/approve` chama `createContractMemory(contractId)` apos aprovacao. Salva em `ContractMemory { id, orgId, contractId, templateId, dataFingerprint Json, summary, acceptedSuggestions Json, rejectedSuggestions Json, manualEdits Json, embedding vector(1024) }`. Summary gerado por Haiku 4.5. Fingerprint inclui modalidade, estado civil, faixa de valor, etc. Incrementa `usageCount` nas clausulas utilizadas.

**Tool `find_similar_contracts`:** busca por embedding (semantico) se Voyage disponivel, senao fallback por similaridade de `dataFingerprint`. Retorna top-3 com summary, acceptedSuggestions, rejectedSuggestions, manualEditsSnippets — o agente cita nos dialogos "Na sua organizacao, em 3 contratos similares, voce costuma usar X".

**Modo Propose (NUNCA edita templates/biblioteca direto):**
- `ClauseProposal { id, orgId, title, content, reason, groupCode, category, tags, status }` — sugestao de nova clausula para a biblioteca. UI em `/clauses/proposals` com tabs Pendentes/Resolvidas. Aprovar cria `Clause` com `source: "ai_proposal"`.
- `TemplateSuggestion { id, templateId, orgId, authorType, reason, diffHunks Json, evidence Json, status }` — mudanca proposta no `handlebarsSource` de um template. UI em `/templates/[id]/suggestions` com diff viewer verde/vermelho. Aprovar aplica os hunks ao `handlebarsSource` e incrementa `templateVersion`.
- Rate limit: max 5 pendentes por org/template, 1 nova/dia/template.
- Hunks sao validados contra o source atual antes de aceitar — hunk invalido (`before` nao existe mais) e marcado como stale.

## Design System (Phase 3e)
**Schema:** `DocumentStyle { id, orgId, name, isDefault, fontFamily, fontSizeBase, lineHeight, marginTopMm/Bottom/Left/Right, colorPrimary, colorAccent, headerHtml, footerHtml, pageNumbers, includeToc }`.

**UI:** `/settings/document-styles` com CRUD e preview ao vivo (`StylePreview` component mostra amostra do estilo em tempo real). Um preset por org pode ser `isDefault=true`.

**Aplicacao em export:** `apps/web/src/app/api/contracts/[id]/export/route.ts` carrega o `DocumentStyle` default da org e passa para `exportPdf(html, path, 'A4', styleExport)` em `lib/render/exporter.ts`. O Puppeteer aplica `margin`, `headerTemplate`, `footerTemplate`, `displayHeaderFooter` e wrapa o HTML com `<style>` contendo fontFamily, fontSizeBase, lineHeight, colorPrimary. Numeros de pagina via `<span class="pageNumber"></span> / <span class="totalPages"></span>` no footer default.

**Tool `apply_style_preset`:** aplica o preset ao contrato inteiro ou secao via wrapper `<div class="document-style-preset">`. Tool `insert_image` recebe url + alt + width + alignment e insere bloco `<p><img>` no editor.

**Sumario (TOC):** `TableOfContents.tsx` le `editor.state.doc` coletando headings (h1/h2/h3) e gera lista clicavel. Acessivel via botao no header do editor.

## Certidoes via Infosimples (Phase 4)
Extracao automatizada de certidoes juridicas para due diligence imobiliaria, disparada manualmente do Deal detail → aba "Certidoes".

**Escopo MVP (sem login GOV.BR)**:
- **Federais** (PF ou PJ): `receita-federal/pgfn` (CND Federal + Divida Ativa — PF usa `birthdate`), `tribunal/tst/cndt` (CNDT nacional), `tribunal/trf/cert-unificada` (Civel JF, dispara 6 TRFs de uma vez)
- **Trabalhistas por UF**: `tribunal/trt2/ceat` + `tribunal/trt2/ceat-digital` + `tribunal/trt15/ceat` (SP capital + SP interior), `tribunal/trt1/ceat` (RJ), `tribunal/trt4/ceat` (RS)
- **Civeis estaduais**: `tribunal/tjsp/pedido-civel` → `tribunal/tjsp/obter-civel` (2 etapas, ~5-15min), `tribunal/tjrj/pedido-cert` → `tribunal/tjrj/obter-certidao` (2 etapas, ate 8 dias uteis), `tribunal/tjrs/primeiro-grau` (5 chamadas por parte RS cobrindo tipo_certidao 3/4/7/8/9 — civel, familia, falencia, execucoes patrimoniais, execucoes fiscais)
- **Protestos**: `cenprot-sp/protestos` (apenas SP, sem login). CENPROT nacional fica fora do MVP (requer GOV.BR)
- **Municipais**: `pref/sp/sao-paulo/iptu` (exige SQL), `pref/rj/rio-janeiro/cert-trib` + `pref/rj/rio-janeiro/cnd` (exige inscricao municipal). IPTU POA sem cobertura Infosimples — skipped com aviso.

**Schema Prisma**:
- `CertidaoJob { id, dealId, batchId, endpoint, label, targetKind, targetIndex, requestPayload, status, resultCode, resultData, attachmentId, errorMessage, latencyMs, costCents, expectedReadyAt, retryCount }` — status: `pending | fetching | awaiting_portal | success | failed | skipped`
- `DealAttachment` estendido com `extractedData Json?` + `source String @default("manual")` (valores: `manual | form_copy | infosimples`)

**Pipeline**:
1. **Client** (CertidoesTab.tsx) gera `batchId = crypto.randomUUID()` e chama `POST /api/deals/:id/certidoes { batchId }` sem aguardar
2. **Route handler** (`apps/web/src/app/api/deals/[dealId]/certidoes/route.ts`) valida budget mensal via `getMonthlySpend()`, chama `planCertidoesForDeal(dealData)` para gerar lista de `PlannedJob[]` + `SkippedJob[]`, cria todos os `CertidaoJob` rows em uma `prisma.$transaction`, retorna 202 em < 500ms e dispara `void runBatch(batchId)` fire-and-forget
3. **Executor** (`lib/certidoes/executor.ts`) roda `pLimit(5)` paralelo com `Promise.allSettled`. Cada job chama `callInfosimples(endpoint, args)`, normaliza via `normalize(endpoint, resp)`, baixa o PDF de `site_receipts[0]` via `downloadReceipt()` + `uploadBufferToStorage()`, cria `DealAttachment { source: "infosimples" }` e atualiza o `CertidaoJob`
4. **Two-step portals** (TJSP/TJRJ): apos `pedido-*` retornar 200, job vai para `status: awaiting_portal` + `expectedReadyAt = now + 1h (TJSP) ou +24h (TJRJ)`, guarda `numero_pedido` em `resultData`
5. **Cron diario** (`apps/web/src/app/api/cron/certidoes/poll-portal/route.ts`, declarado em `vercel.json` para `0 9 * * *`) sweeps jobs `awaiting_portal` com `expectedReadyAt < now` e chama `obter-*`. Se ainda nao pronto, reagenda `+12h`. Apos `MAX_AGE = 14 dias`, marca como `failed: "Timeout portal"`.
6. **Client polla** `GET /api/deals/:id/certidoes?batchId=...` a cada 2s ate todos jobs estarem em estado terminal (hook `useCertidoesBatch.ts`)

**Planner** (`lib/certidoes/planner.ts`): percorre `vendedores[] + compradores[] + imoveis[]` e gera `PlannedJob` por regra de UF/PF/PJ. Campos faltantes geram `SkippedJob { reason, missingField }` — ex: PF sem `data_nascimento` bloqueia PGFN, imovel SP sem `sql` bloqueia IPTU SP, imovel RJ sem `inscricao_municipal` bloqueia ambos IPTU RJ. Comarca TJRJ derivada de `cidade` via tabela em `comarcas-rj.ts` (fallback "Capital").

**Normalizers** (`lib/certidoes/normalizers.ts`): 1 extractor por endpoint que converte o `data[0]` cru em `{situacao, validade, emissao, detalhes, consta_debito}`. Fallback chains para nomes de campos — ex: `cndtExtractor` tenta `normalizado_validade → validade → data_validade` porque o smoke test revelou que a API real usa `validade` (nao `data_validade` como a doc sugeria). Codes 6xx viram `situacao: "nao_emitida"` (nao e erro — e resultado valido). Fallback generico para endpoint desconhecido. Testes vitest em `__tests__/normalizers.test.ts` + `planner.test.ts` (34 casos) com fixtures reais sanitizados em `__fixtures__/`.

**Budget guard**: env `INFOSIMPLES_MONTHLY_BUDGET_CENTS` (default 5000 = R$ 50,00). `getMonthlySpend()` soma `CertidaoJob.costCents` do mes corrente. POST retorna 402 se `spent + planCost > budget`.

**Dados do formulario**: schema em `lib/forms/validation.ts` tem `data_nascimento` (PF, obrigatorio p/ PGFN, autofilled via OCR do RG), `sql` (imovel, opcional), `inscricao_municipal` (imovel, opcional). `FIELD_MAP_PERSON` em `extracted-to-form.ts` mapeia `data_nascimento` do OCR → form.

**UI**:
- **CertidoesTab.tsx**: lista agrupada por parte/imovel, color coding por `situacao` (verde negativa, amarelo positiva, vermelho failed, cinza skipped), botoes de retry individual e "Gerar relatorio"
- **ExtractCertidoesDialog.tsx**: preview do plano com lista de jobs + skipped com razao + custo estimado + aviso se budget excedido
- **`/settings/certidoes`**: dashboard de qualidade com gasto/budget, taxa de sucesso, p50/p95 latencia por endpoint, erros recentes (top 10)

**Relatorio de due diligence**: `POST /api/deals/:id/certidoes/report` renderiza `templates/relatorio_certidoes.hbs` via Handlebars + Puppeteer, salva como `DealAttachment { category: "relatorio_certidoes", source: "infosimples" }`. Tabela por parte com situacao/validade/detalhes, secao "Pendencias" listando positivas + falhas + skipped.

**Env vars**: `INFOSIMPLES_TOKEN` (obrigatorio, sem ele POST retorna 500), `INFOSIMPLES_MONTHLY_BUDGET_CENTS` (opcional, default 5000), `CRON_SECRET` (opcional — se setado, cron exige `Authorization: Bearer $CRON_SECRET`).

## Observabilidade de IA (AIUsage)
Tabela `AIUsage` em `schema.prisma` registra **cada** chamada a IA com tokens, custo estimado em USD, latencia, provider (anthropic/gemini/voyage), model, operation (`chat` | `passive_open` | `passive_edit` | `ocr_form` | `ocr_tool` | `embed_kb` | `embed_memory` | `embed_query` | `summarize_memory` | `clause_generate`), `toolsUsed[]`, `iterations`, sucesso/erro. Relations em `Organization`, `User` e `Contract`. Indices por `(orgId, createdAt)`, `(orgId, provider, createdAt)`, `(orgId, operation, createdAt)` e `(contractId, createdAt)`.

**Helper:** `src/lib/ai/usage.ts` exporta:
- `PRICING` — tabela hardcoded com preco USD/MT (input + output + cacheRead + cacheWrite) de 8 modelos (Claude Opus/Sonnet/Haiku, Gemini 2.5 Flash/Lite/2.0, Voyage law-2/v3). Ultima revisao: 2026-04-14. **Atualizar manualmente quando precos mudarem** em anthropic.com/pricing, ai.google.dev/pricing, voyageai.com/pricing.
- `calcCostUsd(model, promptTokens, completionTokens, cacheRead, cacheWrite)` — converte tokens em USD. Modelo desconhecido retorna 0 silenciosamente.
- `recordAIUsage(params)` — **fire-and-forget**. Nunca joga excecao (erros so logam em `console.error`). Mensagens de erro sao truncadas em 500 chars para evitar vazamento de PII.

**Instrumentacao (7 call sites):**
- `agent.ts:runContractAgent` — **agregado** por turno: loop de tool-use soma tokens de todas as iteracoes em um unico record com `iterations=N` e `toolsUsed` deduplicado via Set.
- `agent.ts:runPassiveAnalysis` — `passive_open` (Sonnet) ou `passive_edit` (Haiku) conforme trigger.
- `ocr.ts:classifyAndExtract` — Gemini, `operation="ocr_form"`. Le `response.usageMetadata.promptTokenCount/candidatesTokenCount` (nem sempre presente — se ausente, registra com 0 tokens mas ainda loga a chamada).
- `ocr.ts:classifyDocument` + `extractDocumentData` — legacy Haiku via `ocr_tool`. Aceitam `ctx?: OcrUsageContext` opcional.
- `embeddings.ts:embed` e `embedOne` — Voyage. Aceitam `EmbedUsageContext { orgId, operation }` opcional. Sem ctx, chamada roda normalmente mas nao loga.
- `memory.ts:summarizeContract` — Haiku, `summarize_memory` pos-aprovacao.
- `api/clauses/ai-generate/route.ts` — Sonnet, `clause_generate`.

**Callers passam ctx:**
- `knowledge.ts` passa `{orgId, operation: "embed_kb"}` pro embed de KB.
- `memory.ts` passa `{orgId, contractId, operation: "embed_memory"}` pro embed pos-aprovacao e `{orgId, operation: "embed_query"}` pro `find_similar_contracts`.
- `tool-handlers.ts` em `query_knowledge_base` passa `{orgId, contractId, operation: "embed_query"}`.
- `api/forms/[token]/attachments/[id]/extract/route.ts` passa `{orgId}` da SalesForm para `classifyAndExtract`.

**API de agregacao:** `GET /api/ai-usage?from=YYYY-MM-DD&to=YYYY-MM-DD` retorna `{totals, byDay, byModel, byOperation, byProvider, byUser, byContract, recentErrors}`. Escopado por `orgId` da sessao. Default: ultimos 30 dias. Usa `prisma.aIUsage.groupBy` para agregacoes SQL-nativas + fetches adicionais para nomes de usuarios e titulos de contratos (top 10 cada).

**Dashboard:** `/settings/ai-usage` (`apps/web/src/app/(dashboard)/settings/ai-usage/page.tsx`) + client component `AIUsageClient.tsx`. 4 KPI cards (custo, tokens, latencia media, taxa de erro colorida verde/ambar/vermelho), line chart SVG inline de custo por dia (sem recharts — zero nova dep), bar rows CSS por modelo/operacao, cards por provedor, top usuarios e contratos linkaveis, lista de erros recentes. Filtros: ultimos 7d / 30d / mes atual / mes anterior.

**Migration:** `apps/web/prisma/migrations/20260414180000_add_ai_usage/migration.sql` criou a tabela + 4 indices + 3 FKs. Aplicada em prod via `prisma migrate deploy`.

## Revisao pre-aprovacao
`POST /api/contracts/[id]/approve` roda: `validateContractData` + conta `ContractSuggestion` pendentes + `ContractComment` nao-resolvidos (e severity error). Se houver issues, retorna `{requiresReview: true, canForce, issues, errorCount, warningCount, pendingSuggestions, unresolvedComments}`. Frontend abre `ApprovalReviewDialog` com botoes "Revisar" e "Aprovar mesmo assim" (este ultimo oculto quando `canForce=false`, ou seja, quando ha errors). Segunda chamada com `{force: true}` pula validacoes e aprova.

## Fluxo Principal
1. Usuario cria formulario -> gera link compartilhavel `/f/{token}` (titulo do form sincroniza com `deal.title` no Kanban)
2. Qualquer pessoa preenche o formulario (auto-save via PATCH `/api/forms/[token]`). **Etapa 0:** anexa RG, CPF, CNH, matricula, IPTU, comprovante etc. — OCR extrai os campos e autopreenche Vendedor/Comprador/Imovel. Etapa 0 e opcional (pode pular).
3. Usuario cria negocio a partir do formulario -> aparece no Kanban. Documentos anexados sao copiados para DealAttachments e aparecem na aba "Documentos" do Deal agrupados por parte/imovel.
4. Usuario clica "Confeccionar Contrato" -> auto-detecta modalidade -> seleciona template v2 -> renderiza com dados
5. Usuario edita no TipTap ou via chat IA. Opcoes no editor:
   - Selecao + BubbleMenu: bold/italic/underline/link/highlight/comentar/IA
   - Toolbar: font family, font size, cor do texto, cor de destaque, line height, transformar caixa, format painter, zoom
   - `Ctrl+F`: Find & Replace
   - `Ctrl+Enter`: quebra de pagina manual
   - Comentarios laterais com anchor no texto (usuario ou IA via `add_comment`)
   - Sugestoes da IA entram como track changes (aceitar/rejeitar individual ou em lote)
   - **Analise automatica**: ao abrir, Sonnet 4.5 analisa o contrato e popula comentarios IA com findings (matematica, qualificacao, referencias, prazos). Durante edicao, Haiku 4.5 re-analisa apos 30s de idle (debounced). Badge no botao "Comentarios" mostra contagem e severity.
   - **Chat IA com RAG**: perguntas informativas ("quais clausulas existem?") geram resposta em markdown descritivo sem tools de edicao (regra 10.1). Comandos ("altere multa para 8%") usam tools de edicao com resposta estruturada "## Alteracoes / ## Justificativa / ## Verificacao".
6. **Extracao de certidoes (opcional, manual)**: na aba "Certidoes" do Deal detail, corretor clica "Extrair certidoes". `ExtractCertidoesDialog` mostra preview do plano (jobs a extrair + skipped por dados faltantes + custo estimado). Confirmacao dispara batch fire-and-forget. Client polla status a cada 2s. Jobs success baixam PDFs para a aba Documentos com `source: "infosimples"`. Jobs `awaiting_portal` (TJSP/TJRJ) aguardam cron diario. Botao "Gerar relatorio" produz PDF de due diligence agrupando por parte/imovel com pendencias destacadas.
7. Ao clicar "Aprovar": revisao pre-aprovacao roda validate + conta issues. Se houver pendencias, abre `ApprovalReviewDialog`. Usuario pode forcar aprovacao (se nao houver errors). Apos aprovacao, `createContractMemory` roda em background (fire-and-forget) e o contrato vira memoria de longo prazo do agente.
8. Contratos aprovados sao imutaveis: chat/edicao/comentarios/versionamento bloqueados. Pode exportar PDF/DOCX (com `DocumentStyle` default aplicado: fontes, margens, header/footer, numeracao de paginas).

## Rotas Publicas (sem auth)
- `/f/[token]` - formulario de vendas (inclui Etapa 0 de upload de documentos)
- `/api/forms/[token]` - GET dados, PATCH auto-save
- `/api/forms/[token]/attachments` - GET/POST/PATCH/DELETE anexos do form
- `/api/forms/[token]/attachments/[id]/file` - serve o binario para o browser
- `/api/forms/[token]/attachments/[id]/extract` - OCR via Gemini 2.5 Flash, persiste extractedData
- `/login`, `/register`

## Export (PDF/DOCX) — storage e launcher
- **Puppeteer/Chromium em serverless**: `src/lib/render/exporter.ts::launchBrowser()` detecta env via `VERCEL` / `AWS_LAMBDA_FUNCTION_NAME` e usa `@sparticuz/chromium` + `puppeteer-core`. Em dev local, procura Chrome do sistema via paths comuns (Windows/macOS/Linux). **Sem fallback para `puppeteer` full** — o pacote completo tenta baixar Chrome em runtime para `/tmp/.cache/puppeteer` e quebra em serverless read-only. Se `@sparticuz/chromium` nao carregar, erro explicito em PT-BR.
- **`next.config.js::serverComponentsExternalPackages`** inclui `@sparticuz/chromium` e `puppeteer-core` — Next.js deixa esses pacotes como `require` runtime em vez de tentar bundlar os binarios (quebra fatal se bundlado).
- **PDF margins**: `wrapWithStyle()` em `exporter.ts` NAO injeta `@page { margin: 0 }` (costumava, e brigava com `page.pdf({ margin })` do Puppeteer resultando em texto no limite da pagina). Puppeteer e a unica fonte de verdade: defaults classicos 30/25/35/25 mm (top/bottom/left/right — esquerda maior para encadernacao) quando nao ha `DocumentStyle` preset configurado.
- **DOCX preprocessing**: `html-to-docx` ignora CSS em classes (todo `globals.css` e perdido na conversao). `exporter.ts::htmlForDocx(html, style)` preprocessa o HTML injetando estilos inline nos tags principais antes de passar pro `html-to-docx`:
  - `<section class="cover-page">` achatada em paragrafos centralizados inline (font-size 24pt bold uppercase pro titulo, 13pt italico laranja pro subtitulo, borda top/bottom pro imovel) + `<p style="page-break-before: always">` forcando quebra pra pagina 2.
  - `<div class="assinaturas">` vira paragrafos centralizados com spacing apertado.
  - `<h1>`, `<h2>`, `<h3>` ganham `style=` inline via regex negative-lookahead `(?![^>]*\sstyle=)` — evita duplicar em tags ja transformadas no cover.
  - `<p>` ganha `text-align: justify; margin: 6pt 0`.
  - `<hr>` vira `<p>— — —</p>` centralizado (html-to-docx nao renderiza `<hr>` consistentemente).
  - Wrapper global `<div style="font-family: ...; font-size: ...pt">`.
  - Margens passadas como options em twips (1 mm ≈ 56.69 twips); `font`, `fontSize` (half-points: 12pt = 24), `pageNumber: true`, `footer: true`.
  - **Limitacoes conscientes**: drop cap (`::first-letter`), ornamentos SVG (`::after`), marca d'agua "MINUTA" e ligaturas tipograficas NAO sao traduzidos para OOXML — perdidos na conversao. PDF preserva tudo; DOCX fica mais proximo mas nao identico.
- **Storage dos exports** (`src/app/api/contracts/[id]/export/route.ts`): prioridade em 3 niveis:
  1. **`BLOB_READ_WRITE_TOKEN` set** (padrao em prod): `@vercel/blob put()` com `access: "public"`, `addRandomSuffix: false`, `allowOverwrite: true`. Retorna URL publica direta (`https://<store>.public.blob.vercel-storage.com/exports/<contract-id>/contract-<id>.pdf`). Re-exports sobrescrevem o mesmo path.
  2. **`S3_BUCKET` set**: usa `uploadBufferToStorage` (AWS S3).
  3. **Nenhum dos dois**: em dev local, escreve em `process.cwd()/public/exports/<id>/` (funciona porque Next serve `public/` automaticamente). Em serverless (VERCEL=1), falha com erro explicito em PT-BR dizendo para configurar `BLOB_READ_WRITE_TOKEN` ou `S3_BUCKET`.
- Puppeteer requer Vercel Pro (timeout 60s). CSS `@media print` em `globals.css` garante que page breaks manuais aparecem no PDF.

## Pagadoria (Fases 1a-5) — Módulo financeiro com Asaas

Feature branch: `feat/pagadoria-fase-1a-security`. Documentação consolidada em [docs/pagadoria-handoff.md](docs/pagadoria-handoff.md) — sempre consultar antes de mexer.

- **Fase 1a — Security baseline**: RBAC (`CustomRole` + `PERMISSION.*`), 2FA TOTP com otplib v12 + recovery codes em bcrypt, SessionElevation (sudo token 15min), TrustedDevice (30d), auditoria imutável em `AuditLog`. Libs em [apps/web/src/lib/security/](apps/web/src/lib/security/).
- **Fase 1b — Asaas + KYC + cobrança**: subconta white-label por org (`AsaasAccount` com `apiKey` encriptada + walletId + `generalStatus/commercialInfoStatus/documentationStatus/bankAccountInfoStatus`), upload de docs via multipart em `/myAccount/documents/{id}`, cobranças (`CommissionCharge`) com status canônico (PENDING/RECEIVED/OVERDUE/...), idempotência webhook via `AsaasWebhookEvent.asaasEventId`. Em sandbox, bypass de KYC via [lib/asaas/sandbox.ts::approveSandboxAccount](apps/web/src/lib/asaas/sandbox.ts) — documentação "Esse tipo de documento não pode ser enviado via API" é esperada em sandbox para docs de identidade.
- **Fase 2 — Módulo `/financeiro` + taxas + `/pay`**: dashboard com KPIs, listagem com filtros + busca debounced, detalhe com timeline, taxas configuráveis (`OrgFinancialSettings.finePercent/interestPercentMonth` com limites CDC), branding por org, página pública `/pay/[token]` com PII mascarada.
- **Fase 3 — Transferências + dual approval + conciliação + relatórios**: `AsaasTransfer` com preview de taxas + dual approval para valores > `dualApprovalCapCents`, conciliação em `BankReconciliation` com auto-match via externalReference, 4 relatórios (recebíveis, aging, cashflow, inadimplentes).
- **Fase 4 — Polish**: notificações bell topbar com contagem, dispositivos confiáveis UI, platform fee (campos em `OrgFinancialSettings.platformFeePercent` + `platformFeeWalletId`).
- **Fase 5 — Split multi-recipient por cobrança (2026-04-20)**: novo model `SplitRecipient` (orgId + label + walletId + active). CRUD em `/settings/pagamentos/split-recipients`. Componente `components/financeiro/SplitEditor.tsx` no form de nova cobrança avulsa permite configurar até 10 destinatários (corretora/vendedor/plataforma) com percentuais. Função pública `composeSplits()` em [lib/asaas/commission.ts](apps/web/src/lib/asaas/commission.ts) valida: max 10 entries, sem duplicatas, sem wallet da própria org (Asaas rejeita), soma `percentualValue ≤ 100`. Platform fee (Fase 4) é anexado automaticamente quando `platformFeeWalletId` está configurado. Persistido em `CommissionCharge.splitJson`. 13 unit tests em [commission-splits.test.ts](apps/web/src/lib/asaas/__tests__/commission-splits.test.ts).

**QA**: prompt autônomo em [docs/claude-chrome-qa-pagadoria-uxui.md](docs/claude-chrome-qa-pagadoria-uxui.md) (17 blocos) + preflight em `GET /api/admin/preflight-qa` (30+ checks de env, DB, Asaas, Resend, Upstash). Setup automatizado: [apps/web/scripts/setup-pagadoria-qa.ts](apps/web/scripts/setup-pagadoria-qa.ts) cadastra webhook + aprova subconta sandbox + sync DB.

## Phase H — Correções pós-QA E2E (2026-04-18)

QA E2E real (deal `cmo3orktd000513ssiufbzqzo`, 52 jobs SP) revelou 2 P0 de falso-negativo legal + 6 P1 + 8 P2. Correções deployadas:

- **Falso-negativo TRF3/PGE-SP (P0-A)**: Infosimples retornou `code 602 "URL inválida"` (endpoint depreciado) + data vazio + billable=false. Mapper antigo: `602 → genuine_no_data → situacao="negativa"` → UI verde sem PDF. Corrigido em [apps/web/src/lib/certidoes/error-codes.ts:67](apps/web/src/lib/certidoes/error-codes.ts) — `602` agora é `integration_error` → `nao_emitida`. Também `605 → portal_unavailable` (era genuine_no_data).
- **Billing honesto (H.18)**: `executor.ts` agora respeita `resp.header.billable === false` (não cobra) e força `status: "failed"` quando `situacao === "nao_emitida"` sem anexo. Evita cobrança fantasma (R$ 0,32/deal no QA).
- **PGFN cascade (P0-B)**: `pgfnExtractor` lê `debitos_rfb`/`debitos_pgfn` (booleanas) + fallback em `raw.certidao` (string descritiva). Antes lia só `tipo_certidao` que vem null nas respostas recentes → "indeterminado".
- **TJSP payload (P1-1)**: `planner.ts` agora inclui `data_nascimento` + `nome_mae` (opcional) para PF. Sem `data_nascimento`, skipped em vez de disparar e falhar com code 606 (era 100% fail no QA). Campo `nome_mae` adicionado no schema + step Vendedor/Comprador + mapeamento OCR (`mae` → `nome_mae`).
- **CENPROT SP (P1-2)**: payload agora inclui `uf: "SP"` — portal exige location hint, sem ele 612 em ~75% dos casos. Complementar: executor flaga `status: "failed"` quando endpoint de categoria `civel|trabalhista|fiscal|protesto|municipal|federal` retorna sem `site_receipts[0]` mesmo com code=200 + situacao=negativa (evita "negativa sem prova documental"). Usa `CATEGORIES_REQUIRING_PDF` exportado de `endpoints.ts`.
- **Code 615 remapeado**: era `inconsistent_input` ("name mismatch"), corrigido para `portal_unavailable` ("site indisponível") conforme docs Infosimples — TRF cert-unificada intermitente agora classifica corretamente e cai em retry automático.
- **OCR auto-atribuição (P1-3)**: fallback de "primeira pessoa = vendedor[0]" removido. Agora docs sem match explícito de CPF/nome ficam em `kind: "outro"`. Botão "Aplicar aos campos" desabilita até todas as atribuições serem explícitas (dropdown).
- **Deal docs herdam atribuição (P1-4)**: finalize copia `extractedData` inteiro (com `assignment`) do FormAttachment → DealAttachment. `DocumentsTab` tem `rematchAssignment()` que compara CPF/nome do doc contra vendedores/compradores finais do deal e sobrescreve se necessário.
- **Sweep com dry-run (P1-5)**: `handleSweep` mostra `window.confirm` com count antes de executar.
- **EditPartyDialog vazio (P1-6)**: fallback agora é `deal.form?.dataJson ?? deal.dataJson` — antes só lia `deal.dataJson` que é sempre null no fluxo atual.
- **Health probe inválido (P2-1)**: CNPJ de probe trocado de `"00000000000000"` (DV inválido) para CNPJ real da Infosimples (13.347.016/0001-17). Aceita code 200 ou 600 como OK.
- **Relatório "Falhas: 0" (P2-2)**: `buildReportData` adiciona branch para `situacao === "nao_emitida"` (antes ficava fora de todas as contagens).
- **Ícone verde em "nao_emitida" (P2-4)**: `statusIcon` no CertidoesTab agora renderiza `XCircle` vermelho quando `situacao === "nao_emitida"`, mesmo com `status === "success"`.
- **E-Proc SP skipped invisível (P2-6)**: endpoint `tribunal/tjsp/eproc` adicionado ao catálogo como placeholder (costCents=0). SkippedJob com `externalLink` agora renderiza card com botão "Abrir portal oficial".
- **Campos duplicados imóvel (P2-7)**: SQL (SP) e Inscrição Municipal (RJ) agora condicionais por UF do imóvel.
- **Corretora PF/PJ (P2-8)**: `comissao.corretora_tipo_pessoa` radio ("fisica" | "juridica"). Labels e placeholders trocam conforme seleção.
- **Remoção destrutiva (P2-9)**: remove button em Vendedor/Comprador pede confirmação se slot tem dados.

## Phase I — Correções pós-QA E2E rodado em 2026-04-18

Segundo E2E rodou contra deploy `5191da0b` (Phase H). Phase H validada sem regressões em P0-A, P0-B, P1-5, P1-6, P2-1, P2-7, P2-8 e H.18 billing. **Cinco bugs novos encontrados** + corrigidos:

- **I.1 — TJSP 16/16 fail com code 606 (BLOCKER)**: planner enviava `tipo_certidao: "familia-sucessoes"` (valor com hífen composto). Infosimples aceita apenas `familia` simples. Corrigido em `TJSP_TIPOS` [planner.ts:99](apps/web/src/lib/certidoes/planner.ts#L99). Payload agora passa `data_nascimento` + `nome_mae` (H.3) com valores canônicos de `tipo_certidao`. Esperado destravar ~30% do valor da feature em SP.
- **I.2 — `/certidoes/download-all` retorna 503 (critical)**: QA tentava URL `/download-all` que não existia (UI chamava `/zip`). Criado alias em [download-all/route.ts](apps/web/src/app/api/deals/[dealId]/certidoes/download-all/route.ts) que re-exporta o handler do `/zip`. Ambas URLs funcionam.
- **I.3 — PGE-SP depreciado 4/4 code 602 (major)**: endpoint `pge-sp/cndt` foi removido do `stateDebtEndpointForUf` [planner.ts:50](apps/web/src/lib/certidoes/planner.ts#L50) — SP agora cai em `sefaz/certidao-debitos` unificado como outras UFs. Quando Infosimples confirmar novo endpoint, reativar.
- **I.4 — TRF cert-unificada + TRF individual 100% fail (major)**: ambos os endpoints (`tribunal/trf/cert-unificada` + `tribunal/trf{1-6}/certidao`) estão inoperantes. Removidos do plano default — agora só disparam com `expandAll: true` (picker manual). Plano default gera `SkippedJob` informativo com `externalLink` para portal oficial do TRF regional (trf1.jus.br / trf2 / trf3 / trf4).
- **I.5 — Notificações de batch duplicadas 5× (minor)**: `checkBatchCompletion` é chamado por cada job ao terminar; idempotência por query JSONB em `metadata.batchId` sofria race condition. Solução: adicionada coluna dedicada `batchId String?` em `Notification` + `@@unique([type, batchId])` via migration `20260418120000_add_notification_batchId_unique`. `emitNotification` agora silently swallow P2002 (duplicate) — o primeiro worker ganha, outros são no-op.

## Phase J — Estados ricos de certidão + retry automático (2026-04-18)

Diretriz do usuário: **nunca pular uma certidão solicitada**. Toda falha precisa ter seu fluxo de resolução próprio (API down → retry auto, dados faltando → destacar campo, provedor depreciado → link para portal oficial). A I.4 skip-default foi revertida.

### Estados semânticos novos (em `status` do CertidaoJob)

- `api_error` — 5xx/timeout Infosimples → retry auto em **30s / 2min / 10min**
- `portal_unavailable` — code 615/665/666 → retry auto em **10min / 30min / 2h**
- `rate_limited` — code 668 → retry auto em **30min / 1h**
- `data_missing` — code 606/612/613 → **não retry**, destacar campo via `missingFields[]`
- `data_invalid` — code 614 → **não retry**, EditPartyDialog
- `informativo` — `category: cadastro | fgts` com code 200 → label "Consulta informativa (não é certidão)"
- `failed_permanent` — retries esgotados OU code 602 depreciado → CTA "Abrir portal oficial" via `portalUrl`

### Infra

- **`outcome-classifier.ts`** (`lib/certidoes/`) — função pura `classifyOutcome()` produz `{status, costCents, nextRetryAt, missingFields, portalUrl, errorMessage}`. Executor delega decisão centralizada. 12 casos em teste.
- **Backoff por categoria**: tabela `BACKOFF_MS` no classifier. Cron `/api/cron/certidoes/poll-portal` sweeps jobs com `nextRetryAt <= now` e status `api_error | portal_unavailable | rate_limited`, re-executa via `runSingleJob`. Schedule subiu de 1h → **5min** para pegar retry curto.
- **Schema** (migration `20260418130000_add_certidao_job_retry_fields`): `nextRetryAt DateTime?`, `maxRetries Int @default(3)`, `missingFields String[]`, `portalUrl String?`. Index parcial `(status, nextRetryAt) WHERE nextRetryAt IS NOT NULL` para o cron.
- **Catálogo** (`endpoints.ts`): novos campos `emitsPdf?: boolean` (override de `CATEGORIES_REQUIRING_PDF`) e `portalUrl?: string`. Endpoints principais ganharam `portalUrl` + `expectedWaitMinutes` (TJSP 15min, TJRJ ~8d úteis). `trf/cert-unificada` com `emitsPdf: false` (retorna JSON agregado, não PDF).

### UX

- **Ícones** por status: `RefreshCw` azul spinning lento em retry agendado; `AlertTriangle` âmbar em data_missing/invalid; `AlertTriangle` vermelho em failed_permanent; `Info` azul-céu em informativo.
- **Labels contextuais** (`statusLabel`): "Portal fora do ar — nova tentativa em ~10 min" (relativo a `nextRetryAt`), "Faltam dados · {missingFields}", "Consulta informativa (não é certidão)".
- **CTA "Abrir portal oficial"**: botão `ExternalLink` aparece para qualquer status terminal não-sucesso quando `portalUrl` existe. Substitui o `externalLink` legado (continua funcionando por compat).
- **CTA "Completar {campos}"**: em `data_missing`, botão âmbar com tooltip listando os campos específicos (ex: "Complementar: data_nascimento, nome_mae"). Abre o fluxo de complementação já existente (`setComplementJobId`).

## Phase K — Gaps do Mapeamento_Certidoes.md (2026-04-18)

Auditoria do Mapeamento (1936 linhas) revelou 4 certidões com cobertura Infosimples não implementadas. Adicionadas ao catálogo + normalizers + 2 disparam no plano default:

- **`receita-federal/cpf`** (Mapeamento 2.1.5) — situação cadastral do CPF. Filtro obrigatório inicial — dispara sempre para toda parte PF no planner. `emitsPdf: false` (informativo). Regular = `situacao: "informativa"` (OK); qualquer outra → `positiva` (bloqueia minuta).
- **`antecedentes-criminais-pf/emit` + `/validar`** (Mapeamento 2.1.4) — Polícia Federal antecedentes. 2-step. Dispara apenas quando `deal.modalidade === "financiamento"` (facultativo em particulares). PF sem `data_nascimento` + `nome_mae` vira skipped com `missingField` explícito.
- **`sncr/ccir`** (Mapeamento 2.3.2) — CCIR INCRA para imóveis rurais. NO CATÁLOGO + EXTRACTOR pronto. NÃO dispara no plano default (aba imóvel está fora do planner desde F.II-α — decisão adiada para pós-QA Phase J). Disponível via picker "Adicionar outras".
- **`registradores/matric-pedido` + `matric-obter`** (Mapeamento 2.3.1) — Matrícula ONR (Certidão de Inteiro Teor, 2-step até 5 dias úteis). Idem CCIR: catálogo + extractor + testes, mas planner só dispara via picker. `expectedWaitMinutes: 7200` (5 dias úteis ≈ 5×24×60).

Todos os 4 endpoints têm `portalUrl` para fallback manual (receita CPF, dpf.gov.br antecedentes, sncr.serpro.gov.br, registradores.org.br).

**Documentação criada**: [docs/certidoes-architecture.md](docs/certidoes-architecture.md) — documento arquitetural único descrevendo os 12 estados semânticos, backoffs, fluxo do classifier, e step-by-step para adicionar novo endpoint.

**Gaps remanescentes** (Phase L, só após QA Phase J validar):
- CNIB (indisponibilidade) — sem cobertura Infosimples, só portalUrl
- ITR — idem
- TJMG/TJPR/TJES cível — idem
- Imóvel volta ao planner (Matrícula ONR + CCIR)

**Seção 12 do Mapeamento** (estrangeiro, espólio, menor, divórcio, falência): escopo futuro (Phase M+) — demanda redesign do form com flags condicionais.

## Alertas
- Handlebars helpers em `src/lib/render/handlebars.ts` sao aditivos — novos helpers podem ser adicionados, mas helpers existentes NAO devem ser alterados (quebra contratos antigos).
- TipTap edita HTML direto; re-render do Handlebars sobrescreve edicoes manuais (incluindo comment anchors e suggestion marks)
- Marks customizadas (`CommentMark`, `SuggestionMark`) persistem como HTML (`<span data-comment-id>`, `<ins>/<del>`). Preservam entre reloads desde que o editor nao regenere a partir do template.
- Forms publicos NAO requerem auth - qualquer um com o link pode editar
- Template legado v1 (`contrato_compra_venda.hbs`) esta deprecated mas mantido para contratos existentes
- Contratos aprovados sao imutaveis: chat bloqueado, versionamento bloqueado, comentarios/sugestoes bloqueados. API retorna 403 em POST.
- `@tiptap/extension-search-and-replace` NAO existe no registro oficial — a extensao custom em `lib/editor/SearchReplace.ts` substitui essa dependencia.
- Ao modificar `ContractEditor.tsx`, preservar o `forwardRef<ContractEditorHandle>` (expoe `applyCommentMark`, `applyCommentMarkByText`, `removeCommentMark`, `scrollToComment`, `focus`, `getHTML`, `getEditor`) e a prop `onReady(editor)` — `ContractEditorPage` depende do handle e do state do editor para `useAutoAnalyze` e aplicacao de comment marks IA.
- Mudancas em templates (`handlebarsSource`) e biblioteca de clausulas JAMAIS devem ser aplicadas direto pelo agente — SEMPRE via `propose_template_change` / `propose_new_clause` (modo Propose com revisao humana).
- pgvector (coluna `embedding vector(1024)`) exige Neon plan Standard+ e migration SQL raw. Prisma NAO tem tipo nativo `vector` — inserts/updates usam `$executeRawUnsafe`, queries usam `$queryRawUnsafe` com operador `<=>`.
- `VOYAGE_API_KEY` opcional: se ausente, `query_knowledge_base` e `find_similar_contracts` fazem fallback para keyword search / fingerprint similarity.
- Analise passiva (`useAutoAnalyze`) envia o `htmlContent` atual do editor no body da request — servidor usa `params.htmlOverride` em vez do DB para ver o estado vivo durante edicao.
- Upload de imagens em `/api/contracts/[id]/images` limita 5MB e valida `ALLOWED_TYPES = [image/jpeg, image/png, image/webp]`. Requer `BLOB_READ_WRITE_TOKEN` no env.
- Certidoes Infosimples sao **operacoes pagas**: cada chamada cobra ~R$ 0,04-0,06 na conta da org. Smoke test revelou que a API retorna `code: 603` com "A conta esta sem saldo" quando o saldo acaba — nosso normalizer mapeia isso para `nao_emitida` (nao e erro, e um resultado valido). Ativar o feature em prod requer `INFOSIMPLES_TOKEN` setado e saldo ativo.
- Budget mensal de certidoes (`INFOSIMPLES_MONTHLY_BUDGET_CENTS`, default 5000) e hard gate: POST `/api/deals/:id/certidoes` retorna 402 se o batch fosse estourar o budget. Contar pelo somatorio de `CertidaoJob.costCents` do mes.
- TJSP (5-15min) e TJRJ (ate 8 dias uteis) sao processos de 2 etapas: pedido → obter. Jobs ficam `awaiting_portal` entre as etapas. Cron diario em `vercel.json` (`0 9 * * *`) sweeps os jobs com `expectedReadyAt < now` e chama o `obter-*` correspondente. **Sem Vercel Pro**, o cron nao roda e os jobs ficam eternamente em `awaiting_portal` — requer chamada manual ao endpoint ou upgrade de plano.
- Normalizers de certidoes sao **frageis** contra mudancas no schema da Infosimples. Usam fallback chains de nomes de campos (ex: `cndtExtractor` tenta `normalizado_validade → validade → data_validade`). Fixtures em `__fixtures__/` sao copias sanitizadas de payloads reais — servem como regressao. Apos a primeira extracao real em prod, **salvar o `resultData` real como fixture novo** e adicionar teste vitest correspondente.
- **Regra anti-falso-negativo** (Phase H, 2026-04-18): qualquer resposta Infosimples em endpoint da categoria `civel|trabalhista|fiscal|protesto|municipal|federal` que não tenha `site_receipts[0]` (PDF anexado) é marcada como `status: "failed"` pelo executor, **independentemente** do `resp.code`, `raw.header.billable` ou situacao retornada. Endpoint informativo (`cadastro`, `fgts`) é exceção. Garante que nenhum card com ícone verde em produção seja uma "certidão sem lastro documental" — regressão verificada via `CATEGORIES_REQUIRING_PDF` em `endpoints.ts`.
- Certidoes sao disparadas SEMPRE manualmente (botao no Deal detail) — nao ha auto-extract no finalizar do form. Decisao deliberada para o corretor ter controle total do gasto e visibilidade antes de confirmar.
- Infosimples NAO cobre CND de IPTU em Porto Alegre (RS). Planner gera `SkippedJob` com `reason: "sem cobertura, extrair manualmente"`. Relatorio de due diligence lista essas pendencias na secao final.
- Prisma migrations sao rodadas automaticamente via `prisma migrate deploy` no build script (ver `apps/web/package.json:build`). Nova migration e aplicada no proximo deploy do Vercel sem intervencao manual.
- **Env vars em Vercel Production** — sincronizar programaticamente usando `printf "%s" "$value"` ou gravação via Node `fs.writeFileSync` (sem trailing newline). `echo "$value" | vercel env add` adiciona `\n` no final do valor armazenado, corrompendo o runtime (2026-04-20: incidente bloqueou 2FA + Prisma + NextAuth por horas). `vercel env pull` escapa newlines reais como `\n` escapado no output, mascarando a corrupção até a próxima falha.
- **Sandbox Asaas rejeita docs de identidade** (RG/CNH/selfie) via API — retorna `{code: "invalid_object", description: "Esse tipo de documento não pode ser enviado via API. Por favor, entre em contato com o suporte."}`. Workaround: usar `approveSandboxAccount(subaccountApiKey)` em `lib/asaas/sandbox.ts` que chama `POST /v3/sandbox/myAccount/approve` e força todos os 4 status da subconta para APPROVED sem upload de docs. **Nunca chamar em produção** — guard interno rejeita se `ASAAS_ENV=production`.
- **Split de pagamento multi-recipient**: `composeSplits()` valida que a soma de `percentualValue` ≤ 100%. **Asaas rejeita** splits contendo o próprio `walletId` da subconta emissora — o remanescente (100% − soma dos splits) cai automaticamente nela. Splits duplicados (mesmo walletId) também são rejeitados. Máximo 10 entries por cobrança (limite Asaas). Split é aplicado em `/api/financeiro/charges/nova` (avulsa); cobranças geradas a partir de Deal (`/api/deals/[dealId]/commission-charges`) ainda não aceitam `customSplits` — só a platform fee automática.
- **platformFeePercent só gera split se platformFeeWalletId estiver configurado**. Gap legacy onde o campo existia em `OrgFinancialSettings` mas ficava null (faltava no Zod schema do PATCH) foi corrigido em Fase 5. Checar em `/settings/pagamentos/taxas` se o walletId master está preenchido — sem ele, cobrar `platformFeePercent=5%` não gera split, só aparenta gerar.
