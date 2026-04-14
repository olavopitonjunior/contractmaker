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
                             # quickChecks, embeddings (Voyage), chunking, knowledge, memory
      render/                # Handlebars (helpers moeda/extenso/percentual/...), PDF, DOCX, exporter
      storage/               # Vercel Blob, S3
      forms/                 # Zod schemas, validation, extracted-to-form mapping
      editor/                # TipTap custom extensions (CommentMark, SuggestionMark,
                             # PageBreakNode, SearchReplace, FontSize, LineHeight,
                             # TextTransform, FormatPainter)
templates/                   # Handlebars .hbs files
  contrato_compra_venda.hbs  # Template legado v1 (deprecated)
  ccv_a_vista_v2.hbs         # Template padronizado: pagamento a vista (15 clausulas)
  ccv_financiamento_v2.hbs   # Template padronizado: financiamento (17 clausulas)
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
6. Ao clicar "Aprovar": revisao pre-aprovacao roda validate + conta issues. Se houver pendencias, abre `ApprovalReviewDialog`. Usuario pode forcar aprovacao (se nao houver errors). Apos aprovacao, `createContractMemory` roda em background (fire-and-forget) e o contrato vira memoria de longo prazo do agente.
7. Contratos aprovados sao imutaveis: chat/edicao/comentarios/versionamento bloqueados. Pode exportar PDF/DOCX (com `DocumentStyle` default aplicado: fontes, margens, header/footer, numeracao de paginas).

## Rotas Publicas (sem auth)
- `/f/[token]` - formulario de vendas (inclui Etapa 0 de upload de documentos)
- `/api/forms/[token]` - GET dados, PATCH auto-save
- `/api/forms/[token]/attachments` - GET/POST/PATCH/DELETE anexos do form
- `/api/forms/[token]/attachments/[id]/file` - serve o binario para o browser
- `/api/forms/[token]/attachments/[id]/extract` - OCR via Gemini 2.5 Flash, persiste extractedData
- `/login`, `/register`

## Alertas
- Puppeteer requer Vercel Pro (timeout 60s). CSS `@media print` em `globals.css` garante que page breaks manuais aparecem no PDF.
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
