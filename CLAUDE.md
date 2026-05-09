# Contractmaker — Claude Code Context

## Visão geral

Plataforma de gestão de vendas e contratos imobiliários. Esteira: Lead/form público → Kanban → contrato (gerado por template **ou** importado por upload) → editor Google Docs embedado → assinatura ClickSign → PDF assinado de volta na pasta. Módulo financeiro (Pagadoria) integrado com Asaas. Due diligence automática via Infosimples.

**Produção:** [imobpro.ia.br](https://imobpro.ia.br) (custom domain registro.br, Vercel `prj_tkIfHl9chuVwZkNtHLAl5QXY2YOB`). **Sem homologação** — E2E roda direto contra prod.

**Single-tenant compartilhado:** `SHARED_ORG_ID=cmnt1ldo4000111bw4yo517k0`. Signup novo via `/api/auth/register` → `OrgMembership { role: "member" }`. Olavo (`olavo.piton@gmail.com`) e `admin@contractmaker.com` são owners. Schema continua multitenant.

## Tech stack

- **Framework:** Next.js 14 App Router · Vercel Pro
- **UI:** Tailwind v4 · Shadcn (new-york) · lucide-react · sonner · React Hook Form + Zod · @dnd-kit
- **Auth:** NextAuth v5 + Prisma Adapter + Credentials (JWT). 2FA TOTP, SessionElevation (15min), TrustedDevice (30d), AuditLog imutável
- **DB:** PostgreSQL (Neon) + Prisma. pgvector vector(1024) HNSW cosine pra RAG (SQL raw — Prisma não tem tipo `vector`)
- **Editor:** Google Docs embedado (iframe + Drive/Docs API) — fonte de verdade do texto
- **AI:** Anthropic SDK (chat/análise) | Gemini 2.5 Flash (OCR forms + extração CCV) | Voyage `law-2` 1024d (RAG)
- **Pagamentos:** Asaas v3 (subconta white-label, KYC, splits, PIX)
- **Assinatura:** ClickSign v3 — **100% produção** (R$ 1,50/signer real é OK em QA)
- **Templates:** Handlebars + helpers BR (`moeda`, `cpf`, `cnpj`, `cep`, `dataExtenso`, `extenso`, `numero`, `numeroExtenso`, `percentual`)
- **Certidões:** Infosimples REST v2 (~R$ 0,04-0,06/chamada)
- **PDF/DOCX:** `drive.files.export` nativo; puppeteer-core + html-to-docx só fallback raro pra contracts órfãos
- **Storage:** @vercel/blob (primário) + S3 (fallback). Upstash Redis pra rate-limit

## Convenções

- Código em inglês, UI em PT-BR. Commits em PT (keywords técnicos OK em EN)
- IDs: `cuid()` em models novos, `uuid()` em legados
- Validação Zod em todas APIs; Server Components por padrão; path alias `@/*` → `src/*`
- Migrations via `prisma migrate`; pgvector em SQL raw
- `DadosContrato`: mudanças aditivas só, novos campos opcionais
- Handlebars helpers (`src/lib/render/handlebars.ts`) são aditivos — não alterar existentes (quebra contratos antigos)

## Pontos de entrada do deal

`/pipeline` → dropdown "Novo negócio":

1. **Novo formulário (link público)** → `/forms/new` cria SalesForm + Deal vazio → token `/f/[token]` pro cliente preencher → finalize dispara `generateContractForDeal` (Handlebars + GDoc)
2. **Cadastro rápido com upload** → `/deals/new-from-upload`: corretor sobe CCV pronto (PDF/DOCX, ≤20MB) e seleciona stage destino (Confecção de Contrato · Enviado para assinatura · Contrato assinado). Pipeline: `uploadFileAsGoogleDoc` (Drive auto-converte) → Gemini extrai `DadosContrato` parcial → cria SalesForm `vinculado` + Deal na stage escolhida + Contract `templateId=null` + DealAttachment `category=contrato_original, source=upload`. Editor abre direto

Contrato importado: `template === null` (UI mostra "Contrato importado"), CTA do header é "Abrir contrato", aba Dados ganha "Re-extrair dados".

## Pipeline kanban (7 stages)

| Pos | Nome | Cor | Auto-transição |
|---|---|---|---|
| 0 | Formulário | indigo | criação do deal |
| 1 | Confecção de Contrato | amber | `contract-generation.ts` após form completar |
| 2 | Enviado para assinatura | blue | `approve-action.ts` após `/approve` |
| 3 | Contrato assinado | sky | webhook ClickSign `close` (source=contract) |
| 4 | Cobrança emitida | purple | `charges-action.ts` após `commissionCharge.create` |
| 5 | Comissão paga | green | botão `mark-commission-paid` (terminal feliz) |
| 6 | Negócio perdido | red | botão `mark-lost` de qualquer não-terminal (terminal alt) |

Auto-transições têm guard `linearOrder.includes(currentStageName)` — webhook reentregue não regride deal já em stage posterior. Hooks específicos: form `completedAt` em `forms/[token]/route.ts`, `approve-action.ts:200+`, webhook ClickSign close em `webhooks/clicksign/route.ts:185+`, `charges-action.ts:280+`.

**Datas SLA** (visíveis em 5 ícones compactos no card e timeline horizontal com gauge no DealDetail):
- `SalesForm.createdAt` → form aberto
- `SalesForm.completedAt` → form completo (setado no finalize quando `status` entra em `completo`/`vinculado`)
- `MAX(Envelope.closedAt where source="contract")` → contrato assinado
- `MIN(CommissionCharge.createdAt)` → cobrança gerada
- `Deal.commissionPaidAt` → comissão paga (manual via botão)
- `Deal.lostAt` + `Deal.lostReason` → terminal lost (banner vermelho substitui timeline)

**Endpoints manuais (UI session-based, sem Bearer twin):**
- `POST /api/pipeline/deals/[dealId]/mark-commission-paid` — aceita origem "Cobrança emitida" ou "Contrato assinado" (fallback caso charge tenha sido gerada fora do sistema)
- `POST /api/pipeline/deals/[dealId]/mark-lost` — Zod body `{ reason, category? }`. Categorias: `desistencia | imovel_vendido | financiamento_negado | outro`. Bloqueia se já terminal. `MarkLostDialog.tsx` pede causa+detalhes
- `POST /api/pipeline/deals/[dealId]/reopen` — sai de "Negócio perdido", restaura stage anterior via lookup do último `AuditLog DEAL_STAGE_CHANGE { kind:"lost" }` com `previousStageId` no metadata. Fallback "Confecção de Contrato"

`mark-signed` (legado Newton + UI) agora aponta pra "Comissão paga" (Concluído fundido). Aceita origens "Enviado para assinatura", "Contrato assinado" ou "Cobrança emitida".

**Stages em prod** são migrados via SQL data migration (`migrations/20260508150000_pipeline_stage_data_migration/`) que roda automaticamente no `prisma migrate deploy`. Idempotente — usa parking de positions ≥1000 pra contornar `@@unique([pipelineId, position])`. Script `apps/web/scripts/migrate-pipeline-stages.ts --apply` existe como fallback manual de emergência mas não é o caminho canônico.

**Hooks históricos:** deals que tiveram `Envelope.closedAt` populado **antes** da migration criar a stage "Contrato assinado" continuam visualmente em "Enviado para assinatura" — auto-promote não é retroativo. Mover manualmente via drag-drop.

## DadosContrato

TS: vendedores, compradores, imóveis, pagamento, comissão, config. Mudanças aditivas só. Duas fontes: form público (8 etapas manuais) ou OCR de CCV inteiro via Gemini. Campo `modalidade: "a_vista" | "financiamento"` decide o template.

## Templates v2 (CCV Zimmermann)

`templates/`:
- **`ccv_a_vista_v2.hbs`** (15 cláusulas): sinal + saldo próprio · posse após pagto integral · escritura pública
- **`ccv_financiamento_v2.hbs`** (17 cláusulas): sinal + financiamento · posse após registro · 45 dias úteis · 9.5 rescisão por não-obtenção do crédito

**Layout** (validado contra v1 Sandra Yamamoto):
- `<h1>INSTRUMENTO PARTICULAR DE COMPROMISSO DE VENDA E COMPRA</h1>` + `<h2>Modalidade: …</h2>` + separador `❦`. Sem cover-page
- Bloco intermediadora com branch `{{#if (eq comissao.corretora_tipo_pessoa "fisica")}}`
- Parcelas: à vista usa `{{this.letra}})`; financiamento usa `Parcela {{this.numero}}.`. `enrichContractData` adiciona em `contract-generation.ts`
- Slots `<!-- CLAUSE_SLOT:Gx -->` (HTML comments — Drive descarta no import)

**Sync DB obrigatório:** mudanças nos `.hbs` SÓ afetam contratos novos depois de `pnpm tsx apps/web/scripts/sync-templates.ts --apply`. `ContractTemplate.handlebarsSource` no DB é source-of-truth. Flags: `--seed`, `--update-metadata`.

**Default por (orgId, modalidade):** invariant — `POST/PATCH /api/templates` faz `updateMany { isDefault: false }` antes. UI `/templates` mostra "Padrão atual" + `_count.contracts` + Arquivados. Versionamento congela `templateId`.

**Engine:** `handlebars` (default, suporta loops/conditionals/slots) ou `google_docs` (`copyContractGoogleDoc` + `replacePlaceholdersInDoc` flat — NÃO suporta `{{#each}}`/`{{#if}}`).

**Preview embedado:** `POST /api/templates/[id]/preview` renderiza contra `lib/templates/preview-sample-data.ts`, sobe via `uploadHtmlAsGoogleDoc`, cacheia `googleTemplateDocId` + `previewSourceHash` (zerado em PATCH quando `handlebarsSource` muda).

Scripts: `audit-templates.ts` (read-only), `archive-legacy-templates.ts` (idempotente, dry-run default).

## Banco de cláusulas (23 em 6 grupos)

| Grupo | Tema | Qtd |
|---|---|---|
| G1 | Sinal, arras e início de pagamento | 3 |
| G2 | Imissão na posse | 4 |
| G3 | Rescisão e condição resolutiva | 4 |
| G4 | Financiamento e registro (obrigatório em financiamento) | 4 |
| G5 | Comissão de corretagem | 3 |
| G6 | Declarações e disposições especiais | 5 |

Cada cláusula tem `agentNotes` (orientação jurídica pra IA) e `groupCode`.

## Agente IA

`src/lib/ai/agent.ts` — loop tool-use (max 5 iterações). Tools em `tools.ts`, handlers em `tool-handlers.ts` + `google-tool-handlers.ts`.

**Default model:** Haiku 4.5 (`claude-haiku-4-5-20251001`) — ~3× mais barato que Sonnet pra tool-use. Override: `AgentConfig.model` (DB) ou `ANTHROPIC_MODEL`. System prompt com `cache_control: ephemeral` (TTL 5min).

**Pré-carregamento de contexto** (`expert-context.ts::loadExpertContext`): top 3 contratos similares aprovados, top 8 cláusulas usadas (filtra G4 fora de financiamento), templates ativos. Markdown injetado antes do 1º turn LLM (~1.5k tokens upfront economiza 4-6k em iterações). Regra 0 do system prompt obriga uso.

**Budget per-contrato** (`budget.ts::assertContractBudget`): antes de cada `messages.create`. Soma `AIUsage.totalTokens` por contractId; bloqueia se ≥ `CONTRACT_AI_TOKEN_BUDGET` (default 200k). `GET /api/contracts/[id]/budget`. Badge IA no header (cinza <80%, âmbar 80-100%, vermelho ≥100%).

**Tools (18):**
- Consulta: `query_clauses`, `query_templates`, `explain_clause`
- Edição: `edit_contract_section`, `update_contract_data`, `insert_clause`, `remove_clause`
- Análise: `validate_contract`, `suggest_improvements`, `analyze_contradictions`
- OCR: `extract_document_data` (Anthropic — diferente do form que usa Gemini)
- Comentários: `add_comment` valida `selectedText`
- RAG: `query_knowledge_base` (Voyage pgvector cosine; fallback ILIKE)
- Aprendizado: `find_similar_contracts` (`ContractMemory` por embedding ou fingerprint)
- Modo Propose (NUNCA edita templates direto): `propose_new_clause` → `ClauseProposal`; `propose_template_change` → `TemplateSuggestion` com `diffHunks`. Rate limit 5 pendentes/org, 1/dia/template. Hunks revalidados antes de aplicar
- Design: `apply_style_preset`, `insert_image` (Vercel Blob, 5MB max)

System prompt (`prompts.ts`) tem 18 regras. Destaques: regra 10 obriga markdown estruturado (`## Alterações Realizadas / ## Justificativa / ## Verificação`); 10.1 proíbe edição em pergunta informativa; 11 prefere sugestão a edição direta; 13 obriga placeholders `[preencher X]` quando dados ausentes; 8.1/8.2 proíbem JSON cru e citação de outros contratos sem evidência ancorada.

**Em GDocs:** `propose_suggestion` é DEFAULT mesmo pra verbos imperativos. Force direta via "aplique direto"/"faça já"/"sem revisão" (regex `FORCE_DIRECT_EDIT`). Razão: iframe Drive não permite undo do que a SA fez.

## Análise automática (passive)

`useAutoAnalyze.ts` — server lê `getDocPlainText` direto do Drive. On-mount: `trigger=open`. Polling 90s (`GDOCS_REFRESH_MS`): `trigger=edit`. Cliente não envia HTML.

- **On-open:** Sonnet 4.5 (deep)
- **On-edit:** Haiku 4.5 (env `ANTHROPIC_PASSIVE_MODEL`)
- **Quick checks (zero LLM):** `quickChecks.ts` — soma de parcelas, CPF/CNPJ checksum, refs internas, duplicação de qualificação
- **Dedupe:** `ContractComment.dedupeKey = FNV-1a(authorType+selectedText+text)` + `@@unique([contractId, dedupeKey])`
- **Cap de custo:** 50 unresolved AI comments/contrato; skip-no-change via `ContractChangeLog`; `max_tokens` 1024 + `analysisInput` 8000 chars + 3 findings/run no prompt. Cleanup: `cleanup-stale-ai-comments.ts --apply --contractId=<id>`
- **Backoff:** `lastAttemptAt` setado ANTES da request

## Editor — Google Docs

`ContractEditorPage.tsx` orquestra: `GoogleDocsEditor.tsx` (iframe Drive) + header com badges + Sheets (Comments/Versions/ChangeLog) + `SuggestionsToolbar` + ChatPanel + Export/ShareDialog. Sem editor JS local. Contratos sem `googleDocId` mostram banner com CTA pra recriar (caso raro/legado pós-System Reset 2026-05-03).

**Pipeline criação (Handlebars):** `contract-generation.ts` → `renderContratoHTML(template, dataJson)` → `uploadHtmlAsGoogleDoc({htmlContent, name})` em `lib/google/upload-rendered-html.ts` (owner OAuth + share com SA) → `googleApplyStylePreset(docId, preset)`.

**Pipeline import:** `lib/services/contract-import.ts` → `uploadFileAsGoogleDoc({buffer, sourceMime})` em `lib/google/upload-file-as-gdoc.ts` (Drive converte PDF/DOCX → Doc nativo) → `extractCcvDataJson` (Gemini) → cria Contract `templateId: null`. **NÃO aplica DocumentStyle** (preserva layout original).

**Versionamento `/api/contracts/[id]/version`:** `exportDocAsHtml` (snapshot) + `copyContractGoogleDoc` + reaplica DocumentStyle + registra novo watch.

**Aprovação `/approve`:** `exportDocAsHtml` antes de `status=aprovado`, atualiza `Contract.htmlContent` no DB — snapshot final pro `createContractMemory` indexar embedding sobre o texto correto.

**GDocs runtime:**
- Iframe `https://docs.google.com/document/d/{id}/edit?embedded=true&rm=embedded`. Read-only via `/preview` quando aprovado
- "Compartilhar" via `ShareDialog.tsx` consome `GET/POST/DELETE /api/contracts/[id]/share` (Drive permissions API + owner OAuth). `lib/google/docs.ts` filtra SA + `GOOGLE_OWNER_EMAIL`. POST bloqueado em aprovado
- Tools `lib/ai/google-tool-handlers.ts` (`googleEditSection/InsertClause/RemoveClause/ApplyStylePreset/InsertImage/AddComment/ProposeSuggestion`) usam `safeGoogleCall` — exceções viram `{error, googleApiError:true}`
- Auto-save desligado. Watch Drive em `/api/webhooks/google-drive` popula `ContractChangeLog`
- `SuggestionsToolbar` aparece quando há `ContractSuggestion` pending; `PATCH /suggestions/[id]` aplica `replaceAllText`/`deleteContentRange`/`insertText` no doc real
- `CommentsPanel` CTA "+ Novo comentário" com `requireSelectedTextInput=true` (POST `/comments` valida via `createAnchoredComment`, retorna 422 se trecho não existir)
- Banner amarelo `CloudOff` quando `googleDocStatus.startsWith("error:")` (causa truncada 240 chars)

Migração legada (raro): `apps/web/scripts/migrate-tiptap-to-gdocs.ts --dealId <id>`. Dry-run default; `--apply` persiste.

Z-index `[data-radix-popper-content-wrapper] { z-index: 100 !important }` em `globals.css` faz dropdowns flutuarem acima da toolbar sticky.

**Comentários e suggestions:** `ContractComment { authorType, severity, anchorId, selectedText, parentId, dedupeKey, resolved }` e `ContractSuggestion { type, suggestionId, status: pending|accepted|rejected }`. Endpoints `GET/POST /api/contracts/[id]/{comments,suggestions}` + `PATCH/DELETE [...]/[id]`. UI: `CommentsPanel.tsx`, `AddCommentDialog.tsx`, `SuggestionsToolbar.tsx`. Em GDocs, `add_comment` e `propose_suggestion` espelham no Drive Comments API; PATCH `/suggestions/[id]` aplica no doc real e fecha thread espelhado.

## Etapa 0 form público — Upload + OCR

`/f/[token]` tem 8 etapas; etapa 0 opcional pra docs identificadores (RG/CPF/CNH/matrícula/IPTU/comprovante). `STEP_LABELS` em `lib/forms/validation.ts`.

`components/forms/steps/DocumentosStep.tsx`: dropzone JPG/PNG/WebP/GIF + PDF até 10MB, max 15. Resize client `createImageBitmap` pra 2000px (PDFs vão direto).

**OCR engine** (`lib/ai/ocr.ts::classifyAndExtract`): uma chamada Gemini 2.5 Flash via `@google/genai` retorna `{tipo, campos, confidence}` JSON combinado. Suporta imagens E PDFs. Override `GEMINI_OCR_MODEL`. Categorias: `rg | cpf | cnh | matricula | iptu | escritura | procuracao | comprovante_residencia | certidao_casamento | ficha_resumo | outro`. Custo ~$0.01/form (8 docs), 58% mais barato que Haiku 4.5 vision.

`mapExtractedToForm` chama `form.setValue` por campo respeitando `skipIfDirty`; `suggestAssignment` matcha por CPF/nome (sem fallback "primeira pessoa = vendedor[0]" — sem match vai pra `kind: "outro"`).

Persistência: ao finalize, `PATCH /api/forms/[token]` copia FormAttachments → DealAttachments com `extractedData` inteiro (incluindo `assignment`).

## Import de contrato

`POST /api/deals/import-contract` (multipart, `runtime: nodejs`, `maxDuration: 60`):
- `file` (PDF/DOCX, ≤20MB) + `title` opcional
- Valida header binário (PDF magic `%PDF-1.` / ZIP magic `50 4B 03 04`)
- Sobe pro Vercel Blob → cria SalesForm `vinculado` + Deal "Confecção de Contrato" + DealAttachment `category=contrato_original, source=upload` → chama `importContractFromFile` → audit `CONTRACT_IMPORT`

`importContractFromFile`: `uploadFileAsGoogleDoc` → `watchFile` (best-effort) → `exportDocAsHtml` (snapshot inicial em `Contract.htmlContent`) → `extractCcvDataJson` (Gemini, falha vira `{}`) → atualiza `SalesForm.dataJson` → cria `Contract { templateId: null, googleDocId/Url, status: rascunho, version: 1 }` → atualiza Deal title/value via `deriveDealMetadata`.

**Re-extração:** `POST /api/contracts/[id]/re-extract` rebusca `DealAttachment { category=contrato_original, source=upload }` e refaz Gemini. Atualiza SalesForm + Contract. Botão "Re-extrair dados" no header da aba Dados quando `templateId=null`. Audit `CONTRACT_REEXTRACT`.

**Prompt CCV** (`lib/extraction/ccv-extractor.ts`): força `comissao.comissionados[]` array sempre + `pagamento.parcelas[]` sequencial. `comissao.corretora_*` mantido por retrocompat — `comissionados` é canônico. Heurística modalidade: `financiamento` quando há menção a financiamento bancário/FGTS/cessão de consórcio.

**`Contract.templateId` é nullable:** código que tocava `contract.template.X` usa null-safe; orgId via `deal.pipeline.orgId`. `/render` e `/contract-pdf` retornam erro explícito quando `templateId === null` sem `googleDocId`.

## RAG

`KnowledgeItem { id, orgId, category, title, content, chunkIndex, chunkTotal, parentId, tags, source, embedding vector(1024) }`. HNSW index `vector_cosine_ops`. Categorias: `legislation | model | rule | glossary`.

`src/lib/ai/embeddings.ts::embed/embedOne` chama Voyage `law-2`. `inputType` aceita `"document"` ou `"query"`. `isEmbeddingsConfigured()` checa `VOYAGE_API_KEY`. Chunking ~800 tokens overlap 100 (`chunking.ts`). Tool `query_knowledge_base` usa `$queryRawUnsafe` com `<=>`. Sem Voyage, fallback ILIKE.

UI `/settings/knowledge-base` com 5 tabs, filtro, "Testar RAG" mostrando similarity. Upload PDF/DOCX roda OCR Gemini + chunking + embedding em background.

## ContractMemory + Propose

Hook fire-and-forget em `/approve` chama `createContractMemory(contractId)`: summary (Haiku), `dataFingerprint` (modalidade, estado civil, faixa de valor), acceptedSuggestions, rejectedSuggestions, manualEdits, embedding. Incrementa `Clause.usageCount`.

`find_similar_contracts` busca top-3 por embedding (Voyage) ou fingerprint (fallback). Agente cita "Em 3 contratos similares na sua organização, você costuma usar X".

**Propose:**
- `ClauseProposal` → UI `/clauses/proposals`. Aprovar cria `Clause { source: "ai_proposal" }`
- `TemplateSuggestion { diffHunks, evidence }` → UI `/templates/[id]/suggestions` com diff verde/vermelho. Aprovar aplica hunks + incrementa `templateVersion`. Hunks revalidados (`before` ainda existe?)

Pra contratos importados (`templateId=null`), `diffManualEdits` retorna `[]` e `extractFingerprint` aceita `templateModalidade=null`.

## Design System (DocumentStyle)

`DocumentStyle { fontFamily, fontSizeBase, lineHeight, marginTopMm/Bottom/Left/Right, colorPrimary, colorAccent, headerHtml, footerHtml, pageNumbers, includeToc }`. UI `/settings/document-styles` com preview ao vivo.

**Preset default obrigatório** pra Handlebars: row `isDefault=true`. Em prod o "Padrão Zimmermann" (id `cmot43tt30001126r97zhcm3z`): EB Garamond, fontSizeBase 11, lineHeight 1.5, margens 30mm. Sem default, GDocs nascem com Arial 11pt.

**Aplicação automática (Handlebars):**
- `contract-generation.ts` chama `googleApplyStylePreset` após upload (falha não bloqueia)
- `/version` reaplica após `copyContractGoogleDoc`
- Via Docs API: `updateTextStyle` (font/size/cor), `updateParagraphStyle` (lineSpacing/alignment), `updateDocumentStyle` (margens)

**CENTER seletivo:** body `JUSTIFIED`. Centraliza apenas: HEADING_1 (sempre), **primeiro** HEADING_2 ("Modalidade: …"), parágrafos só com símbolos decorativos (regex `/^[❦◆◇●○•★※\s_*-]+$/`, length<10). Cláusulas em HEADING_2 ficam justified. Padrão dá 3 centers + body justified.

**Contratos importados:** preset NÃO é aplicado.

Export PDF: `/api/contracts/[id]/export` carrega preset default da org → Puppeteer aplica `margin/headerTemplate/footerTemplate`. `<span class="pageNumber">/<span class="totalPages">` no footer default. GDocs mode usa `drive.files.export` nativo.

## Certidões (Infosimples)

Disparo manual no Deal → aba Certidões. Pipeline: client gera `batchId` UUID → `POST /api/deals/:id/certidoes` retorna 202 em <500ms e dispara `runBatch(batchId)` fire-and-forget → `pLimit(5)` com `Promise.allSettled` → cada job chama `callInfosimples`, normaliza, baixa PDF de `site_receipts[0]`, cria `DealAttachment { source: "infosimples" }` → client polla a cada 2s.

**Two-step (TJSP/TJRJ):** `pedido-*` retorna 200 → job vira `awaiting_portal` com `expectedReadyAt = now+1h (TJSP) / +24h (TJRJ)` → cron `/api/cron/certidoes/poll-portal` (`*/5min` em `vercel.json`) sweeps com `expectedReadyAt < now`. `MAX_AGE = 14 dias` → `failed: "Timeout portal"`.

**Schema:** `CertidaoJob { dealId, batchId, endpoint, label, targetKind, targetIndex, requestPayload, status, resultCode, resultData, attachmentId, errorMessage, latencyMs, costCents, expectedReadyAt, retryCount, nextRetryAt, maxRetries (3), missingFields[], portalUrl }`.

**Estados** (`outcome-classifier.ts::classifyOutcome`):

| Status | Causa | Comportamento |
|---|---|---|
| `success` | code 200 + PDF (civel/trabalhista/fiscal/protesto/municipal/federal) | Verde, anexo no Deal |
| `informativo` | category `cadastro`/`fgts` com code 200 | "Consulta informativa" |
| `api_error` | 5xx/timeout | Retry 30s/2min/10min |
| `portal_unavailable` | code 615/665/666 | Retry 10min/30min/2h |
| `rate_limited` | code 668 | Retry 30min/1h |
| `data_missing` | code 606/612/613 | Sem retry · `missingFields[]` · CTA "Completar campos" |
| `data_invalid` | code 614 | Sem retry · abrir EditPartyDialog |
| `failed_permanent` | retries esgotados | CTA "Abrir portal oficial" via `portalUrl` |
| `skipped` | dados faltando pré-dispatch | Card com `externalLink` se aplicável |

**Anti-falso-negativo:** categoria civel/trabalhista/fiscal/protesto/municipal/federal sem `site_receipts[0]` é sempre `failed`, ignorando code/billable. **Billing honesto:** respeita `resp.header.billable === false`.

**Planner** (`planner.ts`) percorre vendedores/compradores/imóveis. PF sem `data_nascimento` bloqueia PGFN/TJSP/Antecedentes PF. Imóvel SP sem `sql` bloqueia IPTU SP. RJ sem `inscricao_municipal` bloqueia ambos IPTU RJ. Comarca TJRJ via `comarcas-rj.ts` (fallback "Capital").

**Endpoints cobertos:** Federais (PGFN/CND PF+PJ, CNDT, TRF), trabalhistas (TRT2/TRT15/TRT1/TRT4 CEAT), cíveis (TJSP/TJRJ 2-step, TJRS 5 chamadas), protestos SP (CENPROT), municipais (IPTU SP via SQL, IPTU+CND RJ via inscricao_municipal). Receita CPF + Antecedentes PF auto em financiamento. CCIR/Matrícula ONR só via picker manual.

**Catálogo** (`endpoints.ts`): `category`, `emitsPdf?`, `portalUrl?`, `expectedWaitMinutes?`. `CATEGORIES_REQUIRING_PDF` exportado. **Normalizers** (`normalizers.ts`) com fallback chains de nomes de campo. Codes 6xx geralmente viram `nao_emitida`.

**Budget guard:** `INFOSIMPLES_MONTHLY_BUDGET_CENTS` (default 5000). POST retorna 402 se estouraria.

**Relatório PDF:** `POST /api/deals/:id/certidoes/report` renderiza `templates/relatorio_certidoes.hbs` → `DealAttachment { category: "relatorio_certidoes" }`.

**Dashboard:** `/settings/certidoes` mostra gasto/budget, taxa de sucesso, p50/p95 latência, últimos erros.

**Gaps:** CNIB, ITR, TJMG/TJPR/TJES cível — só `portalUrl` manual. IPTU Porto Alegre sem cobertura. Casos especiais (estrangeiro, espólio, menor, divórcio, falência) → escopo futuro.

## Assinatura digital (ClickSign v3)

Envelope vincula a UM de dois: Contract aprovado (`source="contract"`) ou DealAttachment avulso (`source="attachment"`). Schema: `Envelope.contractId String?` + `attachmentId String?` + CHECK XOR.

**Caminho A — Contract aprovado:** `lib/clicksign/executor.ts::sendEnvelopeForContract` exige `status === "aprovado"`, gera PDF via `generateContractPdfBuffer` (Drive export quando há `googleDocId`; Puppeteer + Handlebars como fallback), monta signers via `dealDataToSigners(dataJson)`. Endpoint `POST /api/contracts/[id]/envelopes`.

**Caminho B — DealAttachment avulso:** `sendEnvelopeForAttachment` baixa PDF via `downloadBufferFromUrl`, signers vêm 100% do dialog. Não exige aprovação. Endpoint `POST /api/deals/[dealId]/envelopes`. UI: aba Assinaturas → "+ Enviar documento da pasta" → `SendAttachmentEnvelopeDialog`. Use cases: aditivos, distratos, procurações, recibos.

**Helper `createEnvelopeFromBuffer`** (privado): budget check → upload snapshot → `prisma.envelope.create` → ClickSign API (createEnvelope → addDocument → addSigners → addRequirements → activate). Falha → `status: failed` + `deleteDraftEnvelope` best-effort.

**Listagem unificada:** `GET /api/deals/[dealId]/envelopes` retorna ambos com `subjectLabel` server-side. Hook `useDealEnvelopePolling(dealId)`. Hook contract-level `useEnvelopePolling(contractId)` continua existindo.

**Cancelamento:** `DELETE /api/deals/[dealId]/envelopes/[envelopeId]` (deal-level) ou `DELETE /api/contracts/[id]/envelopes/[envelopeId]` (legado, só contract-based).

**Webhook close (URL canônica `https://imobpro.ia.br/api/webhooks/clicksign`):**
- Valida HMAC-SHA256 (header `content-hmac` ou `x-clicksign-signature`)
- Eventos `close|auto_close|document_closed` disparam `downloadSignedPdf` fire-and-forget → `uploadBufferToStorage` (`envelopes/<id>/signed.pdf`) → grava `Envelope.signedDocumentUrl`
- **Cria DealAttachment automático:** `category="contrato_assinado"` (source contract) ou `"documento_assinado"` (source attachment). `source="clicksign_signed"`. Idempotente: `findFirst { dealId, url }` antes de criar

**Custo:** `Envelope.costCents`. Budget mensal `getMonthlyBudgetCents()` somando `running + closed` do mês. POST retorna 402 se estouraria.

**Diálogo de envio (`SendEnvelopeDialog.tsx`):** linhas editáveis Nome/E-mail/CPF agrupadas por origem. Vendedor + Comprador titulares são sempre signers; **Cônjuges, Corretora(s) e Testemunhas são opt-in** via checkbox. Linhas com `addedDuringDialog=true` em contrato aprovado mostram banner amarelo: aparecem só no certificado ClickSign, **não no PDF do contrato congelado**.

- **Múltiplos comissionados:** itera `comissao.comissionados[]` (canônico); array vazio → fallback hidrata 1 row do legado `imobiliaria_*` (templates antigos continuam consumindo)
- **Cônjuges:** com `conjuge.nome` preenchido aparecem como sub-linha opt-in. `sourceIndex = idx + 1000` (convenção, sem unique constraint)
- **Submit:** `PATCH /api/contracts/[id]/signers-data` (whitelist regex — emails das partes, `vendedores/compradores.<i>.conjuge.{email,nome,cpf,incluir_como_signatario}`, `comissao.comissionados`, `testemunhas`) → `POST /api/contracts/[id]/envelopes`. `SourceKind = "vendedor" | "comprador" | "testemunha" | "corretora"`

**Quirks v3 (caçados em prod 2026-05-08):**
1. `communicate_by` REMOVIDO no signer (422 "communicate_by não está disponível"). Email automático via `signer.email` + `activateEnvelope`
2. `documentation` (CPF/CNPJ) exige máscara `123.456.789-00`/`12.345.678/0001-90`. Helper `formatCpfCnpj` em `envelopes.ts`
3. Requirement de assinatura usa `action="agree"` + `role` (não `action="sign"`). Roles: `sign | buyer | seller | intervening | realestate | witness | consenting | attorney`. Mapping em `executor.ts::defaultRoleForSourceKind`
4. **Status em `/events`**, não `/signers`/`/requirements`. `listEnvelopeEvents` retorna histórico canônico (`name: sign|signature_started|refusal`, `data.signer.{key,email}`, `created`)
5. **Webhook v3 NÃO tem `envelope.id`** — só `event` + `document.{key,filename,path}`. Lookup local: `Envelope.documentClicksignId === payload.document.key`. Bug ficou meses oculto retornando `{ok:true,ignored:true}` silencioso
6. **Match signer no sync /events:** ClickSign edita signer (PATCH) gerando `remove_signer + add_signer` com novo `signer.key`; DB local fica com key antigo. Match canônico por key, fallback por email lowercase
7. Host `app.clicksign.com` (não `api.`); auth via `?access_token=TOKEN` query string (Bearer header retorna 401 enganoso)

**Sync — 3 caminhos:**
- **Webhook** (`POST /api/webhooks/clicksign`, fast path 1-3s)
- **Botão Atualizar** → `POST /api/contracts/[id]/envelopes/[envelopeId]/sync` pulla /events e reconcilia signer-by-signer. `?debug=1` retorna shapes crus
- **Cron diário** (`/api/cron/clicksign/sync-envelopes` 06:00 UTC) compara só envelope-level (running → closed), redundante mas mantido como suspensórios

**Diagnostics admin:** `GET /api/admin/clicksign/{webhooks, webhook-attempts, envelope-events/[envelopeId]}`.

## Pagadoria (Asaas)

Documentação consolidada em [docs/pagadoria-handoff.md](docs/pagadoria-handoff.md) — sempre consultar antes de mexer.

Fases entregues:
- **1a Security:** RBAC (`CustomRole` + `PERMISSION.*`), 2FA, SessionElevation, TrustedDevice, AuditLog
- **1b Asaas + KYC:** `AsaasAccount` (apiKey AES-256-GCM + walletId + 4 status fields), upload docs multipart, `CommissionCharge` com status canônico (PENDING/RECEIVED/OVERDUE...), idempotência via `AsaasWebhookEvent.asaasEventId`
- **2 `/financeiro` + `/pay`:** dashboard KPIs, taxas configuráveis (`OrgFinancialSettings.finePercent/interestPercentMonth` com limites CDC), branding por org, `/pay/[token]` com PII mascarada
- **3 Transferências + dual approval + conciliação + relatórios:** `AsaasTransfer` com preview de taxas + dual approval > `dualApprovalCapCents`, `BankReconciliation` auto-match via `externalReference`, 4 relatórios (recebíveis/aging/cashflow/inadimplentes)
- **4 Polish:** notif bell, devices UI, platform fee (`platformFeePercent` + `platformFeeWalletId`)
- **5 Split multi-recipient:** `SplitRecipient { orgId, label, walletId, active }`, CRUD `/settings/pagamentos/split-recipients`. `composeSplits()`: max 10 entries, sem duplicatas, sem wallet própria, soma `percentualValue ≤ 100`. Persistido em `CommissionCharge.splitJson`. **`platformFeePercent` só gera split se `platformFeeWalletId` configurado**

**QA:** preflight `GET /api/admin/preflight-qa` (30+ checks). Setup `apps/web/scripts/setup-pagadoria-qa.ts`. Sandbox helper `lib/asaas/sandbox.ts::approveSandboxAccount` força os 4 status pra APPROVED via `POST /v3/sandbox/myAccount/approve` — **guard interno rejeita se `ASAAS_ENV=production`**.

**Webhook:** `https://imobpro.ia.br/api/webhooks/asaas` (id `3bd623b8-ed2e-45d4-b201-648f46ee404b`).

**Conta PJ ativa em prod desde 2026-04-27.** `bankAccountInfo=PENDING` não bloqueia recebimento — usar `general=APPROVED` como gate.

## Observabilidade IA (AIUsage)

`AIUsage`: tokens, custo USD, latência, provider (anthropic/gemini/voyage), model, operation, `toolsUsed[]`, `iterations`, sucesso/erro.

**Operations:** `chat | passive_open | passive_edit | ocr_form | ocr_tool | extract_ccv_doc | embed_kb | embed_memory | embed_query | summarize_memory | clause_generate | doc_analysis`.

**Helper `src/lib/ai/usage.ts`:**
- `PRICING` hardcoded (Claude Opus/Sonnet/Haiku, Gemini 2.5 Flash/Lite/2.0, Voyage law-2/v3). **Atualizar manual quando preços mudarem.** Última revisão 2026-04-14
- `calcCostUsd(model, prompt, completion, cacheRead, cacheWrite)` — modelo desconhecido → 0
- `recordAIUsage(params)` — fire-and-forget, nunca lança, error truncado em 500 chars

Agente agrega tokens das N iterações em 1 record com `iterations=N` e `toolsUsed` deduplicado via Set.

**Dashboard:** `/settings/ai-usage` (`AIUsageClient.tsx`) — 4 KPI cards, line chart SVG inline, bar rows CSS, top 10 users/contratos. Filtros: 7d/30d/mês atual/anterior. API: `GET /api/ai-usage?from=YYYY-MM-DD&to=YYYY-MM-DD`.

## Aprovação

`POST /api/contracts/[id]/approve` valida + conta `ContractSuggestion` pendentes + `ContractComment` não-resolvidos (severity error). Se issues: `{requiresReview, canForce, errorCount, warningCount, ...}`. Frontend abre `ApprovalReviewDialog` com botões "Revisar" / "Aprovar mesmo assim" (oculto se `canForce=false`). Segunda chamada com `{force: true}` aprova.

GDocs mode: `runContractApproval` em `lib/contracts/approve-action.ts` faz `exportDocAsHtml(googleDocId)` antes de `status=aprovado`, atualiza `Contract.htmlContent` no DB, dispara `createContractMemory` fire-and-forget, e auto-promove o Deal pra stage "Enviado para assinatura".

**Aprovado = imutável:** chat/edição/comentários/versionamento bloqueados; API retorna 403 em POSTs. `/auto-analyze` retorna 200 com `{findings:[], modelUsed:"approved"}`. **Exceção:** `PATCH /signers-data` (whitelist regex) aceita patch escopo restrito mesmo em aprovado — campos não são renderizados no HTML/PDF (só metadados pra ClickSign).

## Mecanismos de delete (4 níveis)

Todos com auth + cross-org guard via `deal.pipeline.orgId` + audit log + bloqueio quando há `Envelope` em `closed`/`running` (409). GDocs vão pra lixeira do Drive (best-effort).

| Endpoint | UI | O que apaga |
|---|---|---|
| `DELETE /api/contracts/[id]` | Lixeira em `VersionTimeline` | Versão específica. Cascata: ContractClause/Comment/Suggestion/ChangeLog/ChatSession/Envelope. Promove próxima se era `isLatest`. Bloqueia aprovado |
| `DELETE /api/pipeline/deals/[dealId]/contracts` | "Excluir contratos" no header | Todas Contract rows (mantém Deal+SalesForm). Sequencial trash dos GDocs |
| `DELETE /api/deals/[dealId]/attachments/[attachmentId]` | Ícone X em DealAttachment | Anexo individual. Best-effort `@vercel/blob.del()`. CertidaoJob.attachmentId vira null |
| `DELETE /api/pipeline/deals/[dealId]` | "Excluir negócio" no header | Deal completo. Cascata CertidaoJob → DealAttachment → Contract → Deal. SalesForm condicional via `?deleteForm=true` |

Audit: `CONTRACT_DELETE`, `CONTRACT_DELETE_BULK`, `ATTACHMENT_DELETE`, `DEAL_DELETE`.

## Rotas públicas (sem auth)

- `/f/[token]` (form de vendas) + `/api/forms/[token]` (auto-save) e subrotas attachments
- `/pay/[token]` (Asaas)
- `/login`, `/register`, `/forgot-password`, `/reset-password`, `/logout` (cleanup completo)
- `/privacy`, `/terms` (LGPD)
- `/api/webhooks/{asaas,clicksign,google-drive}` (HMAC validado)

## Export PDF/DOCX

**Chromium serverless:** `lib/render/exporter.ts::launchBrowser()` detecta env via `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME` e usa `@sparticuz/chromium` + `puppeteer-core`. Local: Chrome do sistema. **Sem fallback `puppeteer` full** (tenta baixar Chrome em runtime → quebra em serverless read-only).

`next.config.js::serverComponentsExternalPackages` inclui `@sparticuz/chromium` + `puppeteer-core` — Next.js deixa como `require` runtime.

**PDF margins:** Puppeteer é única fonte de verdade — defaults 30/25/35/25mm. `wrapWithStyle()` NÃO injeta `@page { margin }`.

**DOCX:** `html-to-docx` ignora CSS de classes. `htmlForDocx(html, style)` injeta inline via regex. Limitações: drop cap, ornamentos SVG, marca d'água "MINUTA", ligaturas não traduzem pra OOXML — perdidos. PDF preserva.

**Storage:** prioridade `BLOB_READ_WRITE_TOKEN` → `S3_BUCKET` → local `public/exports/` (só dev). Em serverless sem nenhum: erro explícito PT-BR.

**GDocs mode** (`googleDocId` set): `drive.files.export` nativo, ignora preset (estilo já aplicado no doc).

Puppeteer requer Vercel Pro (timeout 60s).

## Schemas críticos

- **`DealAttachment.source`:** `manual | form_copy | infosimples | upload | clicksign_signed`
- **`DealAttachment.category`:** `contrato_original | contrato_assinado | documento_assinado | relatorio_certidoes | rg | cpf | cnh | matricula | iptu | comprovante_residencia | escritura | procuracao | ...`
- **`Contract.templateId`** nullable. Null = importado, conteúdo no GDoc
- **`Envelope`** XOR: `contractId` ou `attachmentId`. `source: "contract" | "attachment"`
- **Deal NÃO tem `orgId` direto** — escopo via `pipeline.orgId`. `Contract` idem. Pra Contract importado (`templateId=null`) usar `deal.pipeline.orgId` (não `template.orgId` — null-deref)

**Audit actions:** `DEAL_*`, `FORM_*`, `ATTACHMENT_*`, `CONTRACT_GENERATE/IMPORT/REEXTRACT/STATUS_UPDATE/APPROVE/DELETE/DELETE_BULK`, `ENVELOPE_CREATE/RESEND`, `CERTIDAO_BATCH_DISPATCH`, `KYC_*`, `CHARGE_*`, `TRANSFER_*`, `INTENT_*`, `CLICKSIGN_WEBHOOK_RECEIVED|REJECTED`.

## Gotchas

- **Env vars Vercel:** sempre `printf '%s' 'value' | vercel env add NAME ENV` (single quotes, sem `\n`). `echo` insere `\n` literal e corrompe runtime. `vercel env pull` mostra `\n` escapado, mascarando. Pra scripts locais: `perl -pe 's/\\\\n"$/"/' .env.vercel-prod > .env.vercel-prod.clean`
- **printf single quotes obrigatório** quando o valor tem `$` (chaves Asaas): aspas duplas causam shell expansion e corrompem
- **Logout completo:** sidebar usa `<Link href="/logout">` (não `signOut()` direto) — `/logout` faz `POST /api/auth/logout` (revoga elevation, deleta sessions, audit) + `signOut`
- **Radix DropdownMenu + asChild** envolvendo function component sem forwardRef pode falhar a recalcular position em `side="top"` no SidebarMenuButton — usar links diretos
- **Marks customizadas (`CommentMark`, `SuggestionMark`)** persistem como HTML. Re-render do Handlebars sobrescreve — não regenerar editor a partir do template depois de edições
- **pgvector** exige Neon Standard+. Inserts via `$executeRawUnsafe`, queries via `$queryRawUnsafe` com `<=>`
- **`VOYAGE_API_KEY` opcional:** sem ele, `query_knowledge_base` e `find_similar_contracts` caem em fallback ILIKE/fingerprint
- **Análise passiva** envia `htmlContent` atual no body — server usa `params.htmlOverride` em vez do DB pra ver estado live
- **Upload de imagens** `/api/contracts/[id]/images`: 5MB max, JPEG/PNG/WebP. Requer `BLOB_READ_WRITE_TOKEN`
- **Cron certidões** requer Vercel Pro. Sem ele, jobs `awaiting_portal` ficam eternos. Schedule `*/5min` em `vercel.json`
- **Normalizers de certidões são frágeis:** Infosimples muda nomes de campo. Após primeira extração real em prod, salvar `resultData` como fixture + teste de regressão
- **Asaas sandbox rejeita docs de identidade** via API — usar `approveSandboxAccount`
- **Asaas split** rejeita wallet da própria org, rejeita duplicatas, max 10 entries
- **Webhook ClickSign idempotente:** `close` pode reentregar; `findFirst { dealId, url }` antes de criar DealAttachment
- **Prisma migrations** rodam via `prisma migrate deploy` no build script. Pra mudanças que envolvem **dados** (rename de stages, backfills, etc), criar migration SQL plain idempotente em vez de script TS standalone — roda automático no deploy e sobrevive a re-execução
- **Auto-mode classifier bloqueia acesso direto a prod DB** — `prisma migrate dev`, `tsx scripts/que-conecta-na-DB.ts`, leitura de `.env` com creds. Workaround canônico: empacotar mutation em SQL migration que vai pelo `prisma migrate deploy` (path autorizado). Scripts TS de mutation viram fallback emergencial só
- **Auto-promote stage não é retroativo:** webhook ClickSign close OU criação de charge antes da migration de stages = deal fica visualmente em stage anterior. Mover via drag-drop manual
- **Google OAuth Testing 7-day expiry:** `invalid_grant` quebra GDocs prod a cada ~7d enquanto consent screen estiver Testing. Mover pra "In production" no Cloud Console resolve permanente
- **Chrome MCP bloqueia accounts.google.com:** não tentar dirigir Google OAuth via MCP. Rodar script servidor + usuário completa manual
- **Resend sandbox bloqueia destinatários:** `EMAIL_FROM=onboarding@resend.dev` só envia pro dono. Convites/magic link silenciosamente bloqueados em prod até ter domínio verificado
- **Forms públicos não requerem auth** — qualquer um com o link pode editar
