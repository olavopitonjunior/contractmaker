# Contractmaker - Claude Code Context

## Visão geral

Plataforma de gestão de vendas e contratos imobiliários. Esteira: Lead/formulário público → Kanban de negócios → contrato (gerado por template **ou** importado por upload) → editor Google Docs embedado → assinatura ClickSign → PDF assinado de volta na pasta. Módulo financeiro (Pagadoria) integrado com Asaas. Due diligence automática via Infosimples.

**Produção:** [https://imobpro.ia.br](https://imobpro.ia.br) (custom domain registro.br, deploy Vercel `prj_tkIfHl9chuVwZkNtHLAl5QXY2YOB`). **Sem ambiente de homologação** — testes E2E rodam direto contra prod.

**Modo de operação atual:** single-tenant compartilhado — env `SHARED_ORG_ID=cmnt1ldo4000111bw4yo517k0`. Todo signup novo via `/api/auth/register` é criado como `OrgMembership { role: "member" }` da org `default`. Olavo (`olavo.piton@gmail.com`) e admin (`admin@contractmaker.com`) são owners. Schema continua multitenant.

## Tech stack

- **Framework:** Next.js 14 App Router · Vercel Pro
- **UI:** Tailwind v4 · Shadcn (new-york) · lucide-react · sonner
- **Auth:** NextAuth v5 + Prisma Adapter + Credentials (JWT). 2FA TOTP, SessionElevation (sudo 15min), TrustedDevice (30d), AuditLog imutável
- **DB:** PostgreSQL (Neon) + Prisma ORM. pgvector vector(1024) HNSW cosine pra RAG
- **Editor:** Google Docs embedado (iframe + Drive/Docs API)
- **Kanban:** @dnd-kit
- **AI:** Anthropic SDK (chat + análise + cláusulas) | Google GenAI Gemini 2.5 Flash (OCR docs do form + extração de CCV inteiro) | Voyage `law-2` 1024d (RAG)
- **Pagamentos:** Asaas v3 (subconta white-label, KYC, splits multi-recipient, transferências PIX)
- **Assinatura:** ClickSign v3 — **100% produção, nunca sandbox** (custo ~R$ 1,50/signer real é aceitável em QA)
- **Templates:** Handlebars com helpers BR (`moeda`, `cpf`, `cnpj`, `cep`, `dataExtenso`, `extenso`, `numero`, `numeroExtenso`, `percentual`)
- **Certidões:** Infosimples REST v2 (~R$ 0,04-0,06 por chamada)
- **PDF/DOCX:** `drive.files.export` nativo do Drive (todos os contratos vivem em GDoc); puppeteer-core + html-to-docx só pra fallback raro de contracts órfãos (sem googleDocId)
- **Storage:** @vercel/blob (primário) + S3 (fallback)
- **Forms:** React Hook Form + Zod
- **Cache/Rate-limit:** Upstash Redis

## Convenções

- Código em inglês, UI em português brasileiro
- IDs: `cuid()` em models novos, `uuid()` em legados
- Validação: Zod em todas APIs
- Server Components por padrão; `"use client"` só quando necessário
- Path alias `@/*` → `src/*`
- Migrations sempre via Prisma migrate; pgvector em SQL raw (Prisma não tem tipo `vector`)
- Mudanças em `DadosContrato`: aditivas só, novos campos opcionais
- Commits em português; keywords técnicos OK em inglês
- ClickSign: nunca usar sandbox; envelopes reais em QA

## Dados críticos

`DadosContrato` (TS): vendedores, compradores, imóveis, pagamento, comissão, config. Mudanças aditivas só. **Duas fontes:** form público de vendas (preenchimento manual em 8 etapas) ou OCR de CCV inteiro via Gemini (fluxo de import). Handlebars renderiza a partir dela. Campo `modalidade: "a_vista" | "financiamento"` decide o template.

## Pontos de entrada do deal

Dashboard `/pipeline` tem dropdown "Novo negócio" com 2 opções:

1. **Novo formulário (link público)** → `/forms/new` → cria SalesForm + Deal vazio na stage Formulário, gera token `/f/[token]` pro cliente preencher → finalize do form dispara `generateContractForDeal` (Handlebars + GDoc).
2. **Cadastro rápido com upload** → `/deals/new-from-upload` → corretor sobe um CCV pronto (PDF/DOCX, 20MB max). Pipeline: `uploadFileAsGoogleDoc` (Drive converte pra Doc nativo, preserva layout) → Gemini extrai `DadosContrato` parcial → cria SalesForm `status=vinculado` + Deal na stage "Confecção de Contrato" + Contract `templateId=null` + DealAttachment `category=contrato_original, source=upload`. Editor abre direto.

Fluxos diferem em 3 pontos: contrato importado tem `template === null` (UI mostra "Contrato importado"), CTA do header vira "Abrir contrato" (não "Confeccionar Contrato"), e a aba Dados ganha botão "Re-extrair dados" pra refazer OCR on-demand sobre o PDF original.

## Templates v2 (CCV Zimmermann)

Dois templates ativos em `templates/`:
- **`ccv_a_vista_v2.hbs`** (15 cláusulas): sinal + saldo próprio · posse após pagamento integral · escritura pública
- **`ccv_financiamento_v2.hbs`** (17 cláusulas): sinal + financiamento bancário · posse após registro · 45 dias úteis pra instrumento definitivo · cláusula 9.5 de rescisão por não obtenção do crédito

**Layout** (padrão histórico Zimmermann, validado contra v1 da Sandra Yamamoto):
- `<h1>INSTRUMENTO PARTICULAR DE COMPROMISSO DE VENDA E COMPRA</h1>` + `<h2>Modalidade: …</h2>` + separador `❦`. Sem cover-page
- Bloco intermediadora com branch `{{#if (eq comissao.corretora_tipo_pessoa "fisica")}}` — PF: "Corretor(a): X / CPF: Y"; PJ: "Imobiliária: X / CNPJ: Y"
- Parcelas dinâmicas: à vista usa `{{this.letra}})` (b, c, d…); financiamento usa `Parcela {{this.numero}}.`. `enrichContractData` adiciona `letra`/`numero` em `contract-generation.ts`
- Inscrição municipal só renderiza quando ≠ inscrição IPTU

Slots `<!-- CLAUSE_SLOT:Gx -->` marcam pontos de inserção das cláusulas variáveis. HTML comments são descartados pelo Drive ao importar — slots ficam invisíveis no GDoc final.

**Sync DB obrigatório:** mudanças nos `.hbs` SÓ afetam contratos novos depois de `pnpm tsx apps/web/scripts/sync-templates.ts --apply`. Geração lê `ContractTemplate.handlebarsSource` (não filesystem). Flags: `--seed` cria rows novas, `--update-metadata` ajusta name/description.

**Default por (orgId, modalidade):** invariant — `POST/PATCH /api/templates` faz `updateMany { isDefault: false }` antes de gravar. UI `/templates` mostra selo "Padrão atual" + contador `_count.contracts` + aba Arquivados. Versionamento congela `templateId` (versões herdam template do momento da criação).

**Engine dual:**
- `engine: "handlebars"` (default): `renderContratoHTML(handlebarsSource, dataJson)` → `uploadHtmlAsGoogleDoc`. Suporta loops, conditionals, slots
- `engine: "google_docs"`: `copyContractGoogleDoc(googleTemplateDocId)` + `replacePlaceholdersInDoc` flat. **Não suporta** `{{#each}}` nem `{{#if}}` — só pra contratos simples ou aditivos

**Preview embedado:** `POST /api/templates/[id]/preview` renderiza contra `lib/templates/preview-sample-data.ts`, sobe via `uploadHtmlAsGoogleDoc`, cacheia `googleTemplateDocId` + `previewSourceHash`. Hash é zerado no PATCH quando `handlebarsSource` muda.

**Scripts úteis:**
- `apps/web/scripts/audit-templates.ts` (read-only): lista rows com sha + contagem de contratos
- `apps/web/scripts/archive-legacy-templates.ts`: arquiva legados, idempotente, dry-run default

## Banco de cláusulas (23 padronizadas em 6 grupos)

| Grupo | Tema | Qtd |
|---|---|---|
| G1 | Sinal, arras e início de pagamento | 3 |
| G2 | Imissão na posse | 4 |
| G3 | Rescisão e condição resolutiva | 4 |
| G4 | Financiamento e registro (obrigatório em financiamento) | 4 |
| G5 | Comissão de corretagem | 3 |
| G6 | Declarações e disposições especiais | 5 |

Cada cláusula tem `agentNotes` (orientação jurídica interna pra IA) e `groupCode`.

## Agente IA (18 tools)

`src/lib/ai/agent.ts` roda loop de tool-use (max 5 iterações). Tools em `tools.ts`, handlers em `tool-handlers.ts`.

**Pré-carregamento de contexto especialista** — `loadExpertContext` (`src/lib/ai/expert-context.ts`) busca top 3 contratos similares aprovados, top 8 cláusulas mais usadas (filtra G4 fora de financiamento), templates ativos. Injeta como bloco markdown antes do 1º turn LLM. Custo ~1.5k tokens upfront economiza 4-6k em iterações. Regra 0 do system prompt obriga uso desse contexto antes de editar.

**Budget per-contrato** — `src/lib/ai/budget.ts::assertContractBudget` antes de cada `messages.create` (chat e passive). Soma `AIUsage.totalTokens` filtrados por contractId; bloqueia se ≥ `CONTRACT_AI_TOKEN_BUDGET` (default 200_000). Endpoint `GET /api/contracts/[id]/budget`. Badge IA no header indica % consumida (cinza < 80%, âmbar 80-100%, vermelho ≥ 100%).

- **Consulta:** `query_clauses` (groupCode/isVariable), `query_templates`, `explain_clause`
- **Edição:** `edit_contract_section`, `update_contract_data`, `insert_clause` (CLAUSE_SLOT:Gx), `remove_clause`
- **Análise:** `validate_contract`, `suggest_improvements`, `analyze_contradictions` (5 checks)
- **OCR (chat):** `extract_document_data` (Anthropic — diferente do form que usa Gemini)
- **Comentários:** `add_comment` valida `selectedText` antes de ancorar
- **RAG:** `query_knowledge_base` (Voyage pgvector cosine; fallback ILIKE sem chave)
- **Aprendizado:** `find_similar_contracts` (`ContractMemory` por embedding ou fingerprint)
- **Modo Propose** (NUNCA edita templates direto): `propose_new_clause` cria `ClauseProposal`, `propose_template_change` cria `TemplateSuggestion` com `diffHunks`. Rate limit 5 pendentes/org, 1/dia/template. Hunks revalidados antes de aplicar
- **Design system:** `apply_style_preset`, `insert_image` (Vercel Blob, 5MB max)

System prompt (`src/lib/ai/prompts.ts`) tem 18 regras. Destaques: regra 10 obriga markdown estruturado (`## Alterações Realizadas / ## Justificativa / ## Verificação`), regra 10.1 proíbe edições em perguntas informativas, regra 11 prefere modo sugestão a edição direta, regra 13 obriga placeholders `[preencher X]` quando dados ausentes.

**Default model:** Haiku 4.5 (`claude-haiku-4-5-20251001`) — ~3× mais barato que Sonnet pra tool-use. Override via `AgentConfig.model` (DB) ou `ANTHROPIC_MODEL`. System prompt usa `cache_control: ephemeral` (TTL 5min).

## Análise automática (passive)

`useAutoAnalyze.ts` — sem editor JS, server lê `getDocPlainText` direto do Drive. On-mount dispara `trigger=open`; polling fixo de 90s (`GDOCS_REFRESH_MS`) re-dispara `trigger=edit`. Cliente não envia HTML.

- **On-open:** Sonnet 4.5 (deep)
- **On-edit:** Haiku 4.5 (env `ANTHROPIC_PASSIVE_MODEL`)
- **Quick checks (zero LLM):** `quickChecks.ts` — soma de parcelas, CPF/CNPJ checksum, refs internas, duplicação de qualificação
- **Dedupe:** `ContractComment.dedupeKey = FNV-1a(authorType+selectedText+text)` + `@@unique([contractId, dedupeKey])`
- **Cap de custo:** 50 unresolved AI comments por contrato. Skip-no-change baseado em `ContractChangeLog`. `max_tokens` 1024 + `analysisInput` 8000 chars + 3 findings/run no prompt. Cleanup: `cleanup-stale-ai-comments.ts --apply --contractId=<id>`
- **Backoff:** `lastAttemptAt` setado ANTES da request (success ou erro)

## Editor — Google Docs

`ContractEditorPage.tsx` orquestra o editor: monta `GoogleDocsEditor.tsx` (iframe Drive) + header com badges (versão/status/IA budget), painéis Sheet (Comments/Versions/ChangeLog), `SuggestionsToolbar` acima do iframe, ChatPanel, ExportDialog, ShareDialog. Sem editor JS local — Google Docs é fonte de verdade do texto. Contratos sem `googleDocId` mostram banner de erro com CTA pra recriar pelo deal (caso raro/legado pós-System Reset 2026-05-03).

**Pipeline de criação (handlebars):** `contract-generation.ts` → `renderContratoHTML(template, dataJson)` produz HTML completo com loops/conditionals/slots resolvidos → `uploadHtmlAsGoogleDoc({htmlContent, name})` em `lib/google/upload-rendered-html.ts` faz upload via owner OAuth como GDoc nativo + share com SA → aplica `DocumentStyle` default via `googleApplyStylePreset`.

**Pipeline de import (cadastro rápido):** `lib/services/contract-import.ts` → `uploadFileAsGoogleDoc({buffer, sourceMime})` em `lib/google/upload-file-as-gdoc.ts` (Drive auto-converte PDF/DOCX → Doc nativo via `mimeType: vnd.google-apps.document` + `media.mimeType: <pdf|docx>`) → `extractCcvDataJson` (Gemini) → cria Contract com `templateId: null`. **NÃO aplica DocumentStyle** (preserva layout original do contrato externo).

**Versionamento (`/api/contracts/[id]/version`):** GDocs mode faz `exportDocAsHtml` (snapshot) + `copyContractGoogleDoc` (preserva estilo) + reaplica DocumentStyle + registra novo watch. Cria nova `Contract` row com `googleDocId/Url/Status` setados.

**Aprovação (`/approve`):** GDocs mode faz `exportDocAsHtml` antes de `status=aprovado` e atualiza `Contract.htmlContent` no DB — snapshot final pro `createContractMemory` indexar embedding sobre o texto correto.

**GDocs mode runtime:**
- Iframe `https://docs.google.com/document/d/{id}/edit?embedded=true&rm=embedded`. Read-only via `/preview` quando aprovado
- "Compartilhar" via `ShareDialog.tsx` consome `GET/POST/DELETE /api/contracts/[id]/share` (Drive permissions API + owner OAuth). `lib/google/docs.ts`: `listDocPermissions` (filtra SA + GOOGLE_OWNER_EMAIL), `addDocPermission`, `removeDocPermission`. POST bloqueado em contratos aprovados
- Tools de edição em `lib/ai/google-tool-handlers.ts` (`googleEditSection/InsertClause/RemoveClause/ApplyStylePreset/InsertImage/AddComment/ProposeSuggestion`) usam `safeGoogleCall` — exceções viram `{error, googleApiError:true}`
- `propose_suggestion` é DEFAULT em GDocs mesmo pra verbos imperativos. Force direta via "aplique direto"/"faça já"/"sem revisão" (regex `FORCE_DIRECT_EDIT`). Razão: iframe Drive não permite undo do que a SA fez
- Auto-save desligado (doc é fonte de verdade). Watch Drive em `/api/webhooks/google-drive` popula `ContractChangeLog`
- `SuggestionsToolbar` aparece quando há `ContractSuggestion` pending; aceitar/rejeitar via `PATCH /suggestions/[id]` aplica `replaceAllText`/`deleteContentRange`/`insertText` no doc real
- `CommentsPanel` tem CTA "+ Novo comentário" com `requireSelectedTextInput=true` (anti-fantasma — POST `/comments` valida via `createAnchoredComment`, retorna 422 se trecho não existir)
- Banner amarelo `CloudOff` quando `googleDocStatus.startsWith("error:")` — mostra causa truncada (240 chars)

Migração de contratos legados (caso surjam após restore de backup): `apps/web/scripts/migrate-tiptap-to-gdocs.ts --dealId <id>` faz upload do `htmlContent` persistido como GDoc nativo + aplica DocumentStyle + registra watch. Dry-run default; `--apply` persiste.

Z-index `[data-radix-popper-content-wrapper] { z-index: 100 !important }` em `globals.css` faz dropdowns flutuarem acima da toolbar sticky.

## Comentários e track changes

Models: `ContractComment { authorType, severity, anchorId, selectedText, parentId, dedupeKey, resolved }` e `ContractSuggestion { type, suggestionId, status: pending|accepted|rejected }`.

Endpoints: `GET/POST /api/contracts/[id]/comments`, `PATCH/DELETE/POST [...]/[commentId]`, `GET/POST /api/contracts/[id]/suggestions`, `PATCH/DELETE [...]/[suggestionId]`.

UI: `CommentsPanel.tsx` (Sheet lateral; CTA "+ Novo comentário" só em GDocs), `AddCommentDialog.tsx` (textarea de trecho editável quando `requireSelectedTextInput`), `SuggestionsToolbar.tsx` (barra âmbar com aceitar/rejeitar tudo + lista expansível).

Em GDocs, `add_comment` e `propose_suggestion` espelham no Drive Comments API. PATCH `/suggestions/[id]` aplica a mudança no doc real e fecha o thread espelhado. `googleProposeSuggestion` envolve `createAnchoredComment` em try/catch retornando `{error}` em vez de throw.

## Etapa 0 (form público) — Upload + OCR de docs auxiliares

Form público (`/f/[token]`) tem 8 etapas; etapa 0 é opcional pra anexar docs identificadores (RG/CPF/CNH/matrícula/IPTU/comprovante). `STEP_LABELS` em `lib/forms/validation.ts`.

`components/forms/steps/DocumentosStep.tsx`: dropzone aceita JPG/PNG/WebP/GIF + PDFs até 10MB, max 15 arquivos. Resize client-side via `createImageBitmap` pra max 2000px (PDFs vão direto). Pipeline: upload → OCR → atribuição → "Aplicar aos campos" preenche RHF respeitando `skipIfDirty`.

**OCR engine** (`lib/ai/ocr.ts::classifyAndExtract`): uma única chamada Gemini 2.5 Flash via `@google/genai`. Retorna `{tipo, campos, confidence}` em JSON combinado. Suporta imagens E PDFs nativos. Modelo override: `GEMINI_OCR_MODEL`. Categorias: `rg | cpf | cnh | matricula | iptu | escritura | procuracao | comprovante_residencia | certidao_casamento | ficha_resumo | outro`.

**Custo:** ~$0.01/form (8 docs). 58% mais barato que Haiku 4.5 vision.

Mapeamento `lib/forms/extracted-to-form.ts::mapExtractedToForm` chama `form.setValue` por campo; `suggestAssignment` matcha por CPF/nome (sem fallback "primeira pessoa = vendedor[0]" — sem match vai pra `kind: "outro"`).

Persistência: ao finalize, `PATCH /api/forms/[token]/route.ts` copia FormAttachments → DealAttachments com `extractedData` inteiro (incluindo `assignment`).

## Import de contrato (cadastro rápido)

Endpoint: `POST /api/deals/import-contract` (multipart, `runtime: nodejs`, `maxDuration: 60`).
- Aceita `file` (PDF ou DOCX, ≤ 20MB) + `title` opcional
- Valida header binário (PDF magic `%PDF-1.` / ZIP magic `50 4B 03 04` pra DOCX)
- Sobe arquivo bruto pro Vercel Blob
- Cria SalesForm vazio (`status=vinculado`) + Deal na stage "Confecção de Contrato" + DealAttachment `category=contrato_original, source=upload`
- Chama `importContractFromFile` (`lib/services/contract-import.ts`)
- Audit `CONTRACT_IMPORT`

`importContractFromFile`:
1. `uploadFileAsGoogleDoc` (Drive converte preservando layout)
2. `watchFile` (best-effort)
3. `exportDocAsHtml` pra snapshot inicial em `Contract.htmlContent`
4. `extractCcvDataJson` (Gemini, best-effort — falha vira `{}`)
5. Atualiza `SalesForm.dataJson` com extraído
6. Cria `Contract { templateId: null, dataJson: extraído, htmlContent, googleDocId/Url, status: rascunho, version: 1 }`
7. Atualiza Deal title/value via `deriveDealMetadata` (compartilhado com fluxo Handlebars)

**Re-extração on-demand:** `POST /api/contracts/[id]/re-extract` rebusca o `DealAttachment` original (`category=contrato_original, source=upload`) e refaz `extractCcvDataJson`. Atualiza SalesForm + Contract. Botão "Re-extrair dados" aparece no header da aba Dados quando o deal tem Contract com `templateId=null`. Audit `CONTRACT_REEXTRACT`.

**Prompt CCV** (`lib/extraction/ccv-extractor.ts`): força `comissao.comissionados[]` array sempre que houver comissão (mesmo único corretor) + `pagamento.parcelas[]` sequencial. `comissao.corretora_*` mantido por retrocompat — `comissionados` é fonte canônica. Heurística de modalidade: `financiamento` quando há menção a financiamento bancário, FGTS ou cessão de consórcio.

**`Contract.templateId` é nullable:** contratos importados não têm template Handlebars. Código que tocava `contract.template.X` usa null-safe via `contract.template?.X` ou deriva orgId via `deal.pipeline.orgId`. Endpoints `/render` e `/contract-pdf` retornam erro explícito quando `templateId === null` sem `googleDocId` (não há fonte pra renderizar HTML).

## RAG — Base de conhecimento

`KnowledgeItem { id, orgId, category, title, content, chunkIndex, chunkTotal, parentId, tags, source, embedding vector(1024) }`. Embedding via SQL raw. HNSW index com `vector_cosine_ops`. Categorias: `legislation | model | rule | glossary`.

`src/lib/ai/embeddings.ts::embed/embedOne` chama Voyage `law-2`. `inputType` aceita `"document"` ou `"query"`. `isEmbeddingsConfigured()` checa `VOYAGE_API_KEY`.

Chunking ~800 tokens com overlap 100 (`chunking.ts`). Tool `query_knowledge_base` usa `$queryRawUnsafe` com operador `<=>`. Sem Voyage, fallback ILIKE.

UI `/settings/knowledge-base` com 5 tabs, filtro, "Testar RAG" mostrando similarity score. Upload PDF/DOCX roda OCR Gemini + chunking + embedding em background.

## Aprendizado (ContractMemory) e modo Propose

Hook fire-and-forget em `POST /api/contracts/[id]/approve` chama `createContractMemory(contractId)`. Salva summary (Haiku), dataFingerprint (modalidade, estado civil, faixa de valor), acceptedSuggestions, rejectedSuggestions, manualEdits, embedding. Incrementa `Clause.usageCount`.

Tool `find_similar_contracts` busca top-3 por embedding (Voyage) ou fingerprint (fallback). O agente cita "Em 3 contratos similares na sua organização, você costuma usar X".

**Modo Propose:**
- `ClauseProposal` → UI `/clauses/proposals`. Aprovar cria `Clause { source: "ai_proposal" }`
- `TemplateSuggestion { diffHunks, evidence }` → UI `/templates/[id]/suggestions` com diff verde/vermelho. Aprovar aplica hunks e incrementa `templateVersion`. Hunks revalidados (`before` ainda existe?) antes de aplicar

Pra contratos importados (templateId=null), `diffManualEdits` retorna `[]` (sem template pra diffar) e `extractFingerprint` aceita `templateModalidade=null`.

## Design System (DocumentStyle)

Schema: `DocumentStyle { fontFamily, fontSizeBase, lineHeight, marginTopMm/Bottom/Left/Right, colorPrimary, colorAccent, headerHtml, footerHtml, pageNumbers, includeToc }`. UI `/settings/document-styles` com preview ao vivo.

**Preset default obrigatório** pra fluxo Handlebars: orgs precisam de uma row `DocumentStyle isDefault=true`. Em prod o "Padrão Zimmermann" (id `cmot43tt30001126r97zhcm3z`) tem `fontFamily: "EB Garamond"`, `fontSizeBase: 11`, `lineHeight: 1.5`, margens 30mm.

**Aplicação automática em GDocs (Handlebars):**
- `contract-generation.ts` após `uploadHtmlAsGoogleDoc` chama `googleApplyStylePreset(docId, preset)`. Falha não bloqueia
- `/version` route reaplica após `copyContractGoogleDoc` (defesa em profundidade)
- `googleApplyStylePreset` aplica via Docs API: `updateTextStyle` (font/size/cor), `updateParagraphStyle` (lineSpacing/alignment), `updateDocumentStyle` (margens)

**CENTER seletivo:** body recebe `JUSTIFIED`. Centraliza apenas: HEADING_1 (sempre), o **primeiro** HEADING_2 ("Modalidade: …"), e parágrafos só com símbolos decorativos (regex `/^[❦◆◇●○•★※\s_*-]+$/`, length<10). Cláusulas usando HEADING_2 ficam justified. Padrão dá 3 centers + body justified, espelhando v1 Zimmermann.

**Contratos importados:** preset NÃO é aplicado — preserva layout original do PDF/DOCX externo.

Export PDF: `/api/contracts/[id]/export/route.ts` carrega preset default da org e passa pra `exportPdf`. Puppeteer aplica `margin`, `headerTemplate`, `footerTemplate`. `<span class="pageNumber">/<span class="totalPages">` no footer default. Em GDocs mode, export usa `drive.files.export` nativo (preserva estilo).

## Certidões (Infosimples)

Disparo manual no Deal detail → aba Certidões. Pipeline: client gera `batchId` UUID → `POST /api/deals/:id/certidoes` retorna 202 em <500ms e dispara `runBatch(batchId)` fire-and-forget → executor `pLimit(5)` com `Promise.allSettled` → cada job chama `callInfosimples`, normaliza, baixa PDF de `site_receipts[0]`, cria `DealAttachment { source: "infosimples" }` → client polla a cada 2s.

**Two-step portals (TJSP/TJRJ):** `pedido-*` retorna 200 → job vira `awaiting_portal` com `expectedReadyAt = now+1h (TJSP) / +24h (TJRJ)` → cron `/api/cron/certidoes/poll-portal` (`*/5min` em `vercel.json`) sweeps com `expectedReadyAt < now` e chama `obter-*`. `MAX_AGE = 14 dias` → `failed: "Timeout portal"`.

**Schema:** `CertidaoJob { dealId, batchId, endpoint, label, targetKind, targetIndex, requestPayload, status, resultCode, resultData, attachmentId, errorMessage, latencyMs, costCents, expectedReadyAt, retryCount, nextRetryAt, maxRetries (3), missingFields[], portalUrl }`.

**Estados semânticos** (`lib/certidoes/outcome-classifier.ts::classifyOutcome`):

| Status | Causa | Comportamento |
|---|---|---|
| `success` | code 200 + PDF anexado (civel/trabalhista/fiscal/protesto/municipal/federal) | Verde, anexo no Deal |
| `informativo` | category `cadastro` ou `fgts` com code 200 | "Consulta informativa" |
| `api_error` | 5xx/timeout | Retry 30s/2min/10min |
| `portal_unavailable` | code 615/665/666 | Retry 10min/30min/2h |
| `rate_limited` | code 668 | Retry 30min/1h |
| `data_missing` | code 606/612/613 | Sem retry · `missingFields[]` · CTA "Completar campos" |
| `data_invalid` | code 614 | Sem retry · abrir EditPartyDialog |
| `failed_permanent` | retries esgotados | CTA "Abrir portal oficial" via `portalUrl` |
| `skipped` | dados faltando pré-dispatch | Card com `externalLink` se aplicável |

**Planner** (`lib/certidoes/planner.ts`) percorre vendedores/compradores/imóveis. Campos faltando geram `SkippedJob`. PF sem `data_nascimento` bloqueia PGFN/TJSP/Antecedentes PF. Imóvel SP sem `sql` bloqueia IPTU SP. RJ sem `inscricao_municipal` bloqueia ambos IPTU RJ. Comarca TJRJ via `comarcas-rj.ts` (fallback "Capital").

**Endpoints cobertos:** Federais (PGFN/CND PF+PJ, CNDT, TRF), trabalhistas (TRT2/TRT15/TRT1/TRT4 CEAT), cíveis (TJSP/TJRJ 2-step, TJRS 5 chamadas), protestos SP (CENPROT), municipais (IPTU SP via SQL, IPTU+CND RJ via inscricao_municipal). Receita CPF + Antecedentes PF entram automaticamente em financiamento. CCIR/Matrícula ONR só via picker manual.

**Catálogo** (`endpoints.ts`): `category`, `emitsPdf?`, `portalUrl?`, `expectedWaitMinutes?`. `CATEGORIES_REQUIRING_PDF` exportado. **Normalizers** (`normalizers.ts`): 1 por endpoint, com fallback chains de nomes de campo. Codes 6xx geralmente viram `nao_emitida`.

**Budget guard:** `INFOSIMPLES_MONTHLY_BUDGET_CENTS` (default 5000). POST retorna 402 se estouraria.

**Anti-falso-negativo:** categoria civel/trabalhista/fiscal/protesto/municipal/federal sem `site_receipts[0]` é sempre `failed`, ignorando code/billable. Garante que cards verdes têm PDF de lastro. **Billing honesto:** respeita `resp.header.billable === false`.

**Relatório PDF:** `POST /api/deals/:id/certidoes/report` renderiza `templates/relatorio_certidoes.hbs`. Salva como `DealAttachment { category: "relatorio_certidoes" }`.

**Dashboard de qualidade:** `/settings/certidoes` mostra gasto/budget, taxa de sucesso, p50/p95 latência, últimos erros.

**Gaps remanescentes:** CNIB, ITR, TJMG/TJPR/TJES cível — só via `portalUrl` manual. Casos especiais (estrangeiro, espólio, menor, divórcio, falência) → escopo futuro.

## Assinatura digital (ClickSign)

Envelope vincula a UM de dois: Contract aprovado (`source="contract"`) ou DealAttachment avulso (`source="attachment"`). Schema: `Envelope.contractId String?` + `attachmentId String?` + CHECK XOR (`(contractId NOT NULL XOR attachmentId NOT NULL)`).

**Caminho A — Contract aprovado:** `lib/clicksign/executor.ts::sendEnvelopeForContract` exige `contract.status === "aprovado"`, gera PDF via `generateContractPdfBuffer` (Drive export quando há `googleDocId`; Puppeteer + Handlebars como fallback), monta signers via `dealDataToSigners(dataJson)`. Endpoint `POST /api/contracts/[id]/envelopes`.

**Caminho B — DealAttachment avulso:** `sendEnvelopeForAttachment` baixa o PDF via `downloadBufferFromUrl(attachment.url)`, signers vêm 100% do input do dialog. Não exige aprovação. Endpoint `POST /api/deals/[dealId]/envelopes`. UI: aba Assinaturas tem seção "Documentos avulsos" + botão "+ Enviar documento da pasta" → `SendAttachmentEnvelopeDialog` (wizard com chips de auto-fill das partes do deal). Use cases: aditivos, distratos, procurações, recibos.

**Helper compartilhado** `createEnvelopeFromBuffer` (privado): budget check → upload snapshot → `prisma.envelope.create` → ClickSign API (createEnvelope → addDocument → addSigners → addRequirements → activate). Em qualquer falha marca `status: failed` + `deleteDraftEnvelope` best-effort.

**Listagem unificada:** `GET /api/deals/[dealId]/envelopes` retorna contract-based + attachment-based com `subjectLabel` derivado server-side. Hook `useDealEnvelopePolling(dealId)` em `src/hooks/useDealEnvelopePolling.ts`. Hook contract-level `useEnvelopePolling(contractId)` continua existindo.

**Cancelamento:** `DELETE /api/deals/[dealId]/envelopes/[envelopeId]` (deal-level, funciona pra ambos sources) ou `DELETE /api/contracts/[id]/envelopes/[envelopeId]` (legado, só contract-based).

**Ciclo fechado — webhook close:**
- `POST /api/webhooks/clicksign` valida HMAC-SHA256 (header `content-hmac` ou `x-clicksign-signature`)
- Eventos `close|auto_close|document_closed` disparam `downloadSignedPdf(envelopeId, url)` fire-and-forget
- Baixa PDF → `uploadBufferToStorage` (`envelopes/<id>/signed.pdf`) → grava `Envelope.signedDocumentUrl`
- **Cria DealAttachment automático** no mesmo deal — `category="contrato_assinado"` quando `source="contract"`, `category="documento_assinado"` quando `source="attachment"`. `source="clicksign_signed"`. Idempotente: `findFirst { dealId, url: stored }` antes de criar (ClickSign pode reentregar)

**Webhook URL canônica:** `https://imobpro.ia.br/api/webhooks/clicksign`.

**API client** (`lib/clicksign/client.ts`): host `app.clicksign.com` (não `api.`), Bearer via query string `?access_token=TOKEN`. Bearer header retorna 401 enganoso na v3.

**Custo:** envelope-level tracking via `Envelope.costCents`. Budget mensal `getMonthlyBudgetCents()` somando `running + closed` do mês. POST retorna 402 se estouraria.

**Diálogo de envio editável (`SendEnvelopeDialog.tsx`):** ao clicar "Enviar para assinatura" o usuário vê linhas editáveis de Nome/E-mail/CPF agrupadas por origem (Vendedor / Comprador / Corretor / Testemunhas). Vendedor + Comprador titulares são sempre signers; **Cônjuges, Corretora(s) e Testemunhas são opt-in** via checkbox "Incluir como signatário" por linha (pré-marcado se já tem email no form). Botões "+ Adicionar Corretor" e "+ Adicionar testemunha" empurram linhas extras com flag pré-marcada. Linhas com `addedDuringDialog=true` em contrato aprovado mostram banner amarelo: aparecem só no certificado ClickSign, **não no corpo do PDF do contrato congelado** (regenerar PDF quebraria imutabilidade).

**Múltiplos comissionados:** popup itera `comissao.comissionados[]` (canônico, suporta corretora + intermediária + sub-corretor). Quando o array está vazio, fallback hidrata 1 row do legado `imobiliaria_*` (preserva contratos do form Handlebars antigos). Submit empurra o array inteiro via `comissao.comissionados`; campos legados `imobiliaria_*` nunca são tocados pelo popup (templates Handlebars continuam consumindo o que estava lá).

**Cônjuges como signers:** vendedores/compradores casados com `conjuge.nome` preenchido aparecem como sub-linhas opt-in dentro do mesmo card da parte titular. SourceKind permanece `vendedor`/`comprador`; sourceIndex do cônjuge é `idx + 1000` no `EnvelopeSigner` pra evitar colisão (sem unique constraint no schema, é só convenção).

Submit faz duas chamadas em sequência: `PATCH /api/contracts/[id]/signers-data` (whitelist regex — emails das partes, `vendedores/compradores.<i>.conjuge.{email,nome,cpf,incluir_como_signatario}`, `comissao.comissionados`, `testemunhas`) → `POST /api/contracts/[id]/envelopes` (executor re-lê `contract.dataJson` agora atualizado). Mapping `dealDataToSigners` (`lib/clicksign/mapping.ts`) itera `comissionados[]` e cônjuges marcados; coleta corretora/testemunha/cônjuge apenas quando `incluir_como_signatario === true && email && nome`. `SourceKind` é `"vendedor" | "comprador" | "testemunha" | "corretora"`. Schema do form ganhou `comissao.comissionados[]` (Zod opcional) + `vendedores[].conjuge.incluir_como_signatario` + `testemunhas[].email` + flags em todos os opt-ins (defaults aditivos não quebram forms antigos).

## Pagadoria (módulo financeiro Asaas)

Documentação consolidada em [docs/pagadoria-handoff.md](docs/pagadoria-handoff.md) — sempre consultar antes de mexer.

Fases entregues:
- **1a Security:** RBAC (`CustomRole` + `PERMISSION.*`), 2FA, SessionElevation, TrustedDevice, AuditLog
- **1b Asaas + KYC:** `AsaasAccount` (apiKey AES-256-GCM + walletId + 4 status fields), upload docs multipart, `CommissionCharge` com status canônico (PENDING/RECEIVED/OVERDUE...), idempotência via `AsaasWebhookEvent.asaasEventId`
- **2 `/financeiro` + `/pay`:** dashboard KPIs, taxas configuráveis (`OrgFinancialSettings.finePercent/interestPercentMonth` com limites CDC), branding por org, página pública `/pay/[token]` com PII mascarada
- **3 Transferências + dual approval + conciliação + relatórios:** `AsaasTransfer` com preview de taxas + dual approval > `dualApprovalCapCents`, `BankReconciliation` auto-match via `externalReference`, 4 relatórios (recebíveis/aging/cashflow/inadimplentes)
- **4 Polish:** notif bell, devices UI, platform fee (`platformFeePercent` + `platformFeeWalletId`)
- **5 Split multi-recipient:** `SplitRecipient { orgId, label, walletId, active }`, CRUD em `/settings/pagamentos/split-recipients`. `composeSplits()` valida max 10 entries, sem duplicatas, sem wallet própria, soma `percentualValue ≤ 100`. Persistido em `CommissionCharge.splitJson`

**QA infra:** preflight `GET /api/admin/preflight-qa` (30+ checks). Setup `apps/web/scripts/setup-pagadoria-qa.ts`.

**Sandbox helpers:** `lib/asaas/sandbox.ts::approveSandboxAccount` força os 4 status pra APPROVED via `POST /v3/sandbox/myAccount/approve`. **Guard interno rejeita se `ASAAS_ENV=production`**.

**Webhook URL canônica:** `https://imobpro.ia.br/api/webhooks/asaas` (id `3bd623b8-ed2e-45d4-b201-648f46ee404b`).

**Conta PJ ativa em prod desde 2026-04-27.** Primeira cobrança real creditou OK.

## Observabilidade de IA (AIUsage)

Tabela `AIUsage` registra cada chamada IA: tokens, custo USD, latência, provider (anthropic/gemini/voyage), model, operation, `toolsUsed[]`, `iterations`, sucesso/erro.

**Operations:** `chat | passive_open | passive_edit | ocr_form | ocr_tool | extract_ccv_doc | embed_kb | embed_memory | embed_query | summarize_memory | clause_generate | doc_analysis`.

**Helper** `src/lib/ai/usage.ts`:
- `PRICING` — tabela hardcoded (Claude Opus/Sonnet/Haiku, Gemini 2.5 Flash/Lite/2.0, Voyage law-2/v3). **Atualizar manual quando preços mudarem.** Última revisão: 2026-04-14
- `calcCostUsd(model, prompt, completion, cacheRead, cacheWrite)` — modelo desconhecido retorna 0
- `recordAIUsage(params)` — fire-and-forget, nunca lança, error message truncado em 500 chars

Agente agrega tokens das N iterações em 1 record com `iterations=N` e `toolsUsed` deduplicado via Set.

**Dashboard:** `/settings/ai-usage` (`AIUsageClient.tsx`) — 4 KPI cards, line chart SVG inline, bar rows CSS, top 10 users/contratos. Filtros: 7d/30d/mês atual/anterior. API: `GET /api/ai-usage?from=YYYY-MM-DD&to=YYYY-MM-DD`.

## Aprovação de contrato

`POST /api/contracts/[id]/approve` valida + conta `ContractSuggestion` pendentes + `ContractComment` não-resolvidos (severity error). Se issues, retorna `{requiresReview, canForce, errorCount, warningCount, ...}`. Frontend abre `ApprovalReviewDialog` com botões "Revisar" / "Aprovar mesmo assim" (oculto se `canForce=false`). Segunda chamada com `{force: true}` aprova.

GDocs mode: `runContractApproval` em `lib/contracts/approve-action.ts` faz `exportDocAsHtml(googleDocId)` antes de `status=aprovado` e atualiza `Contract.htmlContent` no DB — snapshot final pro `createContractMemory`.

**Aprovado = imutável:** chat/edição/comentários/versionamento bloqueados; API retorna 403 em POSTs. `/auto-analyze` retorna 200 com `{findings:[], modelUsed:"approved"}` em vez de 403.

## Mecanismos de delete

UI permite apagar 4 níveis. Todos com auth + cross-org guard via `deal.pipeline.orgId`, audit log, e bloqueio quando há `Envelope` em `closed`/`running`. GDocs vão pra lixeira do Drive (best-effort).

| Endpoint | UI | O que apaga |
|---|---|---|
| `DELETE /api/contracts/[id]` | Lixeira em `VersionTimeline` | Versão específica. Cascata: ContractClause/Comment/Suggestion/ChangeLog/ChatSession/Envelope. Promove próxima versão se era `isLatest`. Bloqueia aprovado |
| `DELETE /api/pipeline/deals/[dealId]/contracts` | "Excluir contratos" no header | Todas Contract rows (mantém Deal+SalesForm). Sequencial trash dos GDocs |
| `DELETE /api/deals/[dealId]/attachments/[attachmentId]` | Ícone X em DealAttachment | Anexo individual. Best-effort `@vercel/blob.del()`. CertidaoJob.attachmentId vira null |
| `DELETE /api/pipeline/deals/[dealId]` | "Excluir negócio" no header | Deal completo. Cascata CertidaoJob → DealAttachment → Contract → Deal. SalesForm condicional via `?deleteForm=true` |

Audit actions: `CONTRACT_DELETE`, `CONTRACT_DELETE_BULK`, `ATTACHMENT_DELETE`, `DEAL_DELETE`.

## Fluxo principal

**Caminho 1 — Form público (CCV gerado por template):**

1. Form `/f/[token]` (auto-save). Etapa 0 anexa docs → OCR Gemini autopreenche
2. Finalize: `dedupConjuges` mescla parte duplicada que já consta como cônjuge. Roda só na transição rascunho→completo
3. `generateContractForDeal` cria deal+contract → `renderContratoHTML` template v2 → `uploadHtmlAsGoogleDoc` → aplica `DocumentStyle` default → registra watch Drive. Modalidade auto-detectada via `pagamento.alienacao_fiduciaria/fgts/cessao_consorcio > 0`
4. Editor `/contracts/[id]`: iframe Drive. Chat IA Haiku 4.5 com prompt caching. Análise passiva on-open + on-edit (server lê doc live via `getDocPlainText`)
5. "Salvar Versão": `exportDocAsHtml` + `copyContractGoogleDoc` + reaplica DocumentStyle
6. (Opcional) Certidões → `ExtractCertidoesDialog` → batch fire-and-forget. "Gerar relatório" produz PDF de due diligence
7. "Aprovar" → revisão pré-aprovação. GDocs snapshota HTML. Após aprovado: `createContractMemory`, contrato fica imutável
8. "Enviar pra assinatura" → ClickSign envelope (caminho A)
9. Webhook `close` baixa PDF assinado → cria DealAttachment `category=contrato_assinado` na pasta Documentos
10. Export PDF/DOCX: `drive.files.export` nativo (preserva fonts/spacing/imagens)

**Caminho 2 — Cadastro rápido com upload:**

1. `/pipeline` → "Novo negócio" → "Cadastro rápido com upload" → `/deals/new-from-upload`
2. Upload PDF/DOCX (≤20MB) → `POST /api/deals/import-contract`
3. `uploadFileAsGoogleDoc` (Drive converte preservando layout) + Gemini extrai `DadosContrato` parcial + cria SalesForm vinculado + Deal em "Confecção de Contrato" + Contract `templateId=null`
4. Editor abre direto. Aba Dados mostra extração; "Re-extrair dados" pra refazer OCR se faltou algo
5. (Opcional) "Aprovar" → mesmo fluxo do caminho 1
6. Pra docs avulsos não-CCV (aditivo/distrato/procuração): aba Assinaturas → "+ Enviar documento da pasta" → wizard com chips das partes → ClickSign envelope (caminho B, sem aprovação)
7. Webhook `close` cria DealAttachment `category=documento_assinado` na pasta

## Rotas públicas (sem auth)

- `/f/[token]` (form de vendas), `/api/forms/[token]` (auto-save) e subrotas attachments
- `/pay/[token]` (página de pagamento Asaas)
- `/login`, `/register`, `/forgot-password`, `/reset-password`
- `/logout` (cleanup completo: revoga elevation, deleta sessions, audit)
- `/privacy`, `/terms` (LGPD)
- `/api/webhooks/{asaas,clicksign,google-drive}` (HMAC validado)

## Export PDF/DOCX

**Chromium serverless:** `lib/render/exporter.ts::launchBrowser()` detecta env via `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME` e usa `@sparticuz/chromium` + `puppeteer-core`. Local: procura Chrome do sistema. **Sem fallback pra `puppeteer` full** (tenta baixar Chrome em runtime → quebra em serverless read-only).

`next.config.js::serverComponentsExternalPackages` inclui `@sparticuz/chromium` + `puppeteer-core` — Next.js deixa como `require` runtime em vez de bundlar.

**PDF margins:** Puppeteer é única fonte de verdade — defaults 30/25/35/25mm (esquerda maior pra encadernação). `wrapWithStyle()` NÃO injeta `@page { margin }`.

**DOCX preprocessing:** `html-to-docx` ignora CSS de classes. `htmlForDocx(html, style)` injeta estilos inline via regex. **Limitações:** drop cap, ornamentos SVG, marca d'água "MINUTA" e ligaturas não traduzem pra OOXML — perdidos na conversão. PDF preserva tudo.

**Storage dos exports:** prioridade `BLOB_READ_WRITE_TOKEN` → `S3_BUCKET` → local `public/exports/` (só dev). Em serverless sem nenhum: erro explícito em PT-BR.

**GDocs mode** (`contract.googleDocId` set): export usa `drive.files.export` nativo, ignora preset (estilo já aplicado no doc).

Puppeteer requer Vercel Pro (timeout 60s).

## Schemas críticos compartilhados

**`DealAttachment.source`:** `"manual" | "form_copy" | "infosimples" | "upload" | "clicksign_signed"`.
**`DealAttachment.category`** comum: `contrato_original | contrato_assinado | documento_assinado | relatorio_certidoes | rg | cpf | cnh | matricula | iptu | comprovante_residencia | escritura | procuracao | ...`.

**`Contract.templateId`** é nullable. Null = contrato importado, conteúdo vive no GDoc.
**`Envelope.contractId`** é nullable; `attachmentId` complementar; CHECK XOR garante exatamente um. `source: "contract" | "attachment"`.

**Audit actions** relevantes: `DEAL_CREATE/UPDATE/DELETE`, `FORM_CREATE/UPDATE`, `ATTACHMENT_UPLOAD/DELETE`, `CONTRACT_GENERATE/IMPORT/REEXTRACT/STATUS_UPDATE/APPROVE/DELETE/DELETE_BULK`, `ENVELOPE_CREATE/RESEND`, `CERTIDAO_BATCH_DISPATCH`, `KYC_*`, `CHARGE_*`, `TRANSFER_*`, `INTENT_*`.

## Alertas (gotchas)

- **Env vars Vercel:** sempre `printf '%s' 'value' | vercel env add NAME ENV` (single quotes, sem `\n`). `echo` insere `\n` literal e corrompe runtime. `vercel env pull` mostra `\n` escapado, mascarando. Pra usar em scripts locais: `perl -pe 's/\\\\n"$/"/' .env.vercel-prod > .env.vercel-prod.clean`
- **Logout completo:** sidebar usa `<Link href="/logout">` (não `signOut()` direto). `/logout` faz `POST /api/auth/logout` (revoga elevation, deleta sessions, audit) + `signOut`
- **Radix DropdownMenu + asChild:** envolvendo function component sem forwardRef pode falhar a recalcular position. Dropdowns com `side="top"` no SidebarMenuButton — usar links diretos
- **Handlebars helpers** em `src/lib/render/handlebars.ts` são aditivos. Não alterar existentes (quebra contratos antigos)
- **Marks customizadas (`CommentMark`, `SuggestionMark`)** persistem como HTML. Re-render do Handlebars sobrescreve — não regenerar editor a partir do template depois de edições
- **Contratos aprovados são imutáveis** pra conteúdo (HTML, GDoc, status). API retorna 403 em POSTs. `/auto-analyze` retorna `modelUsed:"approved"` sem chamar LLM. **Exceção:** `PATCH /api/contracts/[id]/signers-data` aceita patch escopo restrito (whitelist de regex no `route.ts`) mesmo em contrato aprovado — só atualiza emails/CPF/nomes das partes + bloco `comissao.*` + array `testemunhas`. Nenhum desses campos é renderizado no HTML/PDF do contrato (só metadados pra ClickSign), então não quebra a imutabilidade legal
- **Templates e biblioteca de cláusulas:** agente NUNCA edita direto. Sempre via `propose_template_change` / `propose_new_clause`
- **pgvector** exige Neon Standard+. Inserts/updates via `$executeRawUnsafe`, queries via `$queryRawUnsafe` com `<=>`
- **`VOYAGE_API_KEY` opcional:** sem ele, `query_knowledge_base` e `find_similar_contracts` caem em fallback ILIKE/fingerprint
- **Análise passiva** envia `htmlContent` atual no body — server usa `params.htmlOverride` em vez do DB pra ver estado live
- **Custo do passive analysis controlado:** `dedupeKey = authorType + category + selectedText`; cap 50 unresolved AI comments/contrato; skip-no-change baseado em `ContractChangeLog`; `max_tokens` 1024 + `analysisInput` 8000 chars; prompt limita 3 findings/run. Cleanup: `cleanup-stale-ai-comments.ts`
- **Upload de imagens** em `/api/contracts/[id]/images`: 5MB max, JPEG/PNG/WebP. Requer `BLOB_READ_WRITE_TOKEN`
- **Certidões Infosimples são pagas:** ~R$ 0,04-0,06 por chamada. `code 603` "saldo insuficiente" vira `nao_emitida`. Sempre disparadas manualmente
- **Cron certidões:** Vercel Pro obrigatório. Sem ele, jobs `awaiting_portal` ficam eternos. Schedule `*/5min` em `vercel.json`
- **Anti-falso-negativo certidões:** categoria civel/trabalhista/fiscal/protesto/municipal/federal sem `site_receipts[0]` é sempre `failed`
- **Normalizers de certidões são frágeis:** Infosimples muda nomes de campo. Após primeira extração real em prod, salvar `resultData` como fixture novo + teste de regressão
- **IPTU Porto Alegre** sem cobertura Infosimples — `SkippedJob` com reason "sem cobertura, extrair manualmente"
- **Asaas sandbox rejeita docs de identidade** via API — usar `approveSandboxAccount` (guard interno rejeita em production)
- **Asaas split** rejeita wallet da própria org. Rejeita duplicatas. Max 10 entries. **`platformFeePercent` só gera split se `platformFeeWalletId` configurado**
- **Asaas `bankAccountInfo=PENDING`** não bloqueia recebimento real. Usar `general=APPROVED` como gate (API reportava PENDING mas pagamento creditou)
- **ClickSign 100% prod, nunca sandbox.** Custo R$ 1,50/signer real é aceitável em QA. v3 usa host `app.clicksign.com` (não `api.`) + auth via `?access_token=` na query (Bearer header retorna 401 enganoso)
- **Webhook ClickSign idempotente:** `close` pode reentregar; `findFirst { dealId, url }` antes de criar DealAttachment evita duplicatas
- **Forms públicos não requerem auth** — qualquer um com o link pode editar
- **Prisma migrations** rodam automático via `prisma migrate deploy` no build script
- **Deal NÃO tem `orgId` direto** — escopo via `pipeline.orgId`. `Contract` idem (via `deal.pipeline.orgId`). Cuidado em queries por org. Pra Contract importado (`templateId=null`) usar `deal.pipeline.orgId` em vez de `template.orgId` (este último seria null-deref)
- **Sync templates é manual:** mudanças em `templates/*.hbs` SÓ afetam contratos novos depois de `sync-templates.ts --apply` contra a DB de produção. `ContractTemplate.handlebarsSource` no DB é source-of-truth — filesystem é só pra dev
- **DocumentStyle default obrigatório** pra fluxo Handlebars: orgs precisam de uma row `isDefault=true`. Sem isso, `googleApplyStylePreset` é skip e GDocs nascem com Arial 11pt. Pra contratos importados: NUNCA aplicar (preserva layout original)
- **Default model do agent é Haiku 4.5** — ~3× mais barato que Sonnet pra tool-use. Override via `AgentConfig.model` ou `ANTHROPIC_MODEL`. System prompt usa `cache_control: ephemeral` (TTL 5min)
- **buildContextMessage usa markdown estruturado** (não JSON cru). Regras 8.1 e 8.2 do system prompt proíbem responder JSON ou citar outros contratos sem evidência ancorada
- **DELETE bloqueado por aprovação ou envelope ativo:** rotas DELETE retornam 409 quando há `status=aprovado` ou `Envelope status in ["closed","running"]`. Cancelar envelope antes pra liberar
- **Google OAuth Testing 7-day expiry:** `invalid_grant` quebra GDocs prod a cada ~7d enquanto consent screen estiver Testing. Mover pra "In production" no Cloud Console resolve permanente
- **Chrome MCP bloqueia accounts.google.com:** não tentar dirigir Google OAuth via MCP. Rodar script servidor + usuário completa manualmente
- **Resend sandbox bloqueia destinatários:** `EMAIL_FROM=onboarding@resend.dev` só envia pro dono. Convites/magic link silenciosamente bloqueados em prod até ter domínio verificado
