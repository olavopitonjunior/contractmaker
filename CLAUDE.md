# Contractmaker — Claude Code Context

## Visão geral

Plataforma de gestão de vendas e contratos imobiliários. Esteira: Lead/form público → Kanban → contrato (template **ou** upload) → editor Google Docs embedado → assinatura ClickSign → PDF assinado de volta na pasta. Pagadoria integrada com Asaas. Due diligence via Infosimples.

**Produção:** [imobpro.ia.br](https://imobpro.ia.br) (custom domain registro.br, Vercel `prj_tkIfHl9chuVwZkNtHLAl5QXY2YOB`). **Sem homologação** — E2E direto contra prod.

**Single-tenant compartilhado:** `SHARED_ORG_ID=cmnt1ldo4000111bw4yo517k0`. Signup novo via `/api/auth/register` → `OrgMembership { role: "member" }`. Olavo (`olavo.piton@gmail.com`) e `admin@contractmaker.com` são owners. Schema continua multitenant.

## Tech stack

- **Framework:** Next.js 14 App Router · Vercel Pro
- **UI:** Tailwind v4 · Shadcn (new-york) · lucide-react · sonner · RHF + Zod · @dnd-kit
- **Auth:** NextAuth v5 + Prisma Adapter + Credentials (JWT). 2FA TOTP, SessionElevation 15min, TrustedDevice 30d, AuditLog imutável
- **DB:** PostgreSQL (Neon) + Prisma. pgvector vector(1024) HNSW cosine pra RAG (SQL raw — Prisma não tem tipo `vector`)
- **Editor:** Google Docs embedado (iframe + Drive/Docs API) — fonte de verdade do texto
- **AI:** Anthropic SDK (chat/análise) · Gemini 2.5 Flash (OCR forms + extração CCV) · Voyage `law-2` 1024d (RAG)
- **Pagamentos:** Asaas v3 (subconta white-label, KYC, splits, PIX)
- **Assinatura:** ClickSign v3 — **100% produção** (R$ 1,50/signer real é OK em QA)
- **Templates:** Handlebars + helpers BR (`moeda`, `cpf`, `cnpj`, `cep`, `dataExtenso`, `extenso`, `numero`, `numeroExtenso`, `percentual`)
- **Certidões:** Infosimples REST v2 (~R$ 0,04-0,06/chamada)
- **PDF/DOCX:** `drive.files.export` nativo; puppeteer-core + html-to-docx fallback
- **Storage:** @vercel/blob (primário) + S3 (fallback). Upstash Redis pra rate-limit

## Convenções

- Código em inglês, UI em PT-BR. Commits em PT (keywords técnicos OK em EN)
- IDs: `cuid()` em models novos, `uuid()` em legados
- Validação Zod em todas APIs; Server Components por padrão; path alias `@/*` → `src/*`
- Migrations via `prisma migrate`; pgvector em SQL raw
- `DadosContrato` e Handlebars helpers (`src/lib/render/handlebars.ts`) são aditivos — não alterar existentes (quebra contratos antigos)

## Pontos de entrada do deal

`/pipeline` → dropdown "Novo negócio":

1. **Novo formulário (link público)** → `/forms/new` cria SalesForm + Deal vazio → token `/f/[token]` pro cliente preencher → finalize dispara `generateContractForDeal`
2. **Cadastro rápido com upload** → `/deals/new-from-upload`: corretor sobe CCV pronto (PDF/DOCX, ≤20MB) + stage destino. Pipeline: `uploadFileAsGoogleDoc` (Drive auto-converte) → Gemini extrai `DadosContrato` parcial → cria SalesForm `vinculado` + Deal + Contract `templateId=null` + DealAttachment `category=contrato_original, source=upload`. Editor abre direto

Contrato importado: `template === null`, UI mostra "Contrato importado", CTA "Abrir contrato", aba Dados ganha "Re-extrair dados".

## Pipeline kanban (7 stages)

| Pos | Nome | Cor | Auto-transição |
|---|---|---|---|
| 0 | Formulário | indigo | criação do deal |
| 1 | Confecção de Contrato | amber | `contract-generation.ts` após form completar |
| 2 | Enviado para assinatura | blue | `approve-action.ts` após `/approve` |
| 3 | Contrato assinado | sky | webhook ClickSign `close` (source=contract) |
| 4 | Cobrança emitida | purple | `charges-action.ts` após `commissionCharge.create` |
| 5 | Comissão paga | green | `mark-commission-paid` (terminal feliz) |
| 6 | Negócio perdido | red | `mark-lost` de qualquer não-terminal (terminal alt) |

Auto-transições têm guard `linearOrder.includes(currentStageName)` — webhook reentregue não regride deal já em stage posterior.

**Datas SLA** (5 ícones no card + timeline gauge no DealDetail): `SalesForm.createdAt` (form aberto) · `SalesForm.completedAt` · `MAX(Envelope.closedAt where source="contract")` · `MIN(CommissionCharge.createdAt)` · `Deal.commissionPaidAt`. `Deal.lostAt` + `lostReason` em terminal lost substitui timeline com banner vermelho.

**Endpoints manuais** (UI session-based):
- `POST .../mark-commission-paid` — aceita "Cobrança emitida" ou "Contrato assinado"
- `POST .../mark-lost` — Zod `{ reason, category? }`. Categorias: `desistencia | imovel_vendido | financiamento_negado | outro`. Bloqueia terminal
- `POST .../reopen` — sai de Lost, restaura stage anterior via `AuditLog DEAL_STAGE_CHANGE { kind:"lost", previousStageId }`. Fallback "Confecção de Contrato"
- `mark-signed` (legado Newton) aponta pra "Comissão paga". Aceita "Enviado para assinatura", "Contrato assinado" ou "Cobrança emitida"

**Stages migrados** via SQL data migration (`20260508150000_pipeline_stage_data_migration/`) idempotente — parking de positions ≥1000 contorna `@@unique([pipelineId, position])`. Auto-promote NÃO é retroativo: deals com `Envelope.closedAt` ou charge antes da migration ficam em stage anterior — drag-drop manual. Fallback: `scripts/migrate-pipeline-stages.ts --apply`.

## DadosContrato

TS: vendedores, compradores, imóveis, pagamento, comissão, config. Mudanças aditivas só. Fontes: form público (8 etapas) ou OCR de CCV via Gemini. `modalidade: "a_vista" | "financiamento"` decide o template.

## Templates v2 (CCV Zimmermann)

`templates/`:
- **`ccv_a_vista_v2.hbs`** (15 cláusulas): sinal + saldo próprio · posse após pagto integral · escritura pública
- **`ccv_financiamento_v2.hbs`** (17 cláusulas): sinal + financiamento · posse após registro · 45 dias úteis · 9.5 rescisão por não-obtenção do crédito

**Layout** (validado vs v1 Sandra Yamamoto): `<h1>INSTRUMENTO...</h1>` + `<h2>Modalidade: …</h2>` + separador `❦`. Sem cover-page. Bloco intermediadora: `{{#if comissao.comissionados.length}}` loop multi-corretora + fallback `{{#if (eq comissao.corretora_tipo_pessoa "fisica")}}`. Parcelas: à vista `{{this.letra}})`; financiamento `Parcela {{this.numero}}.` (`enrichContractData`). Slots `<!-- CLAUSE_SLOT:Gx -->` (HTML comments — Drive descarta).

**Sync DB obrigatório:** mudanças nos `.hbs` SÓ afetam contratos novos depois de `pnpm tsx apps/web/scripts/sync-templates.ts --apply`. `ContractTemplate.handlebarsSource` é source-of-truth. Flags `--seed`, `--update-metadata`.

**Default por (orgId, modalidade):** invariant — `POST/PATCH /api/templates` faz `updateMany { isDefault: false }` antes. UI `/templates` mostra "Padrão atual" + `_count.contracts` + Arquivados. Versão congela `templateId`.

**Engine:** `handlebars` (default, suporta loops/conditionals/slots) ou `google_docs` (`copyContractGoogleDoc` + `replacePlaceholdersInDoc` flat — NÃO suporta `{{#each}}`/`{{#if}}`).

**Preview:** `POST /api/templates/[id]/preview` renderiza contra `lib/templates/preview-sample-data.ts`, sobe via `uploadHtmlAsGoogleDoc`, cacheia `googleTemplateDocId` + `previewSourceHash` (zerado em PATCH quando `handlebarsSource` muda). Scripts: `audit-templates.ts` (read-only), `archive-legacy-templates.ts`.

## Banco de cláusulas (23 em 6 grupos)

G1 Sinal/arras (3) · G2 Imissão (4) · G3 Rescisão (4) · G4 Financiamento (4, obrigatório em financiamento) · G5 Comissão (3) · G6 Declarações (5). Cada cláusula tem `agentNotes` (orientação jurídica) e `groupCode`.

## Agente IA

`src/lib/ai/agent.ts` — loop tool-use (max 5 iterações). Tools em `tools.ts`, handlers em `tool-handlers.ts` + `google-tool-handlers.ts`. **Default model:** Haiku 4.5 (`claude-haiku-4-5-20251001`) — ~3× mais barato que Sonnet pra tool-use. Override: `AgentConfig.model` (DB) ou `ANTHROPIC_MODEL`. System prompt com `cache_control: ephemeral` (TTL 5min).

**Pré-carregamento de contexto** (`expert-context.ts::loadExpertContext`): top 3 contratos similares aprovados, top 8 cláusulas usadas (filtra G4 fora de financiamento), templates ativos. Markdown injetado antes do 1º turn (~1.5k tokens upfront economiza 4-6k em iterações). Regra 0 do system prompt obriga uso.

**Budget per-contrato** (`budget.ts::assertContractBudget`): antes de cada `messages.create`. Soma `AIUsage.totalTokens` por contractId; bloqueia se ≥ `CONTRACT_AI_TOKEN_BUDGET` (default 200k). `GET /api/contracts/[id]/budget`. Badge IA no header (cinza <80%, âmbar 80-100%, vermelho ≥100%).

**Tools (18):**
- **Consulta:** `query_clauses`, `query_templates`, `explain_clause`
- **Edição:** `edit_contract_section`, `update_contract_data`, `insert_clause`, `remove_clause`
- **Análise:** `validate_contract`, `suggest_improvements`, `analyze_contradictions`
- **OCR:** `extract_document_data` (Anthropic — diferente do form que usa Gemini)
- **RAG/Aprendizado:** `query_knowledge_base` (Voyage pgvector; fallback ILIKE), `find_similar_contracts` (embedding/fingerprint), `add_comment` (valida `selectedText`)
- **Propose** (NUNCA edita templates direto): `propose_new_clause` → `ClauseProposal`; `propose_template_change` → `TemplateSuggestion` com `diffHunks`. Rate limit 5 pendentes/org, 1/dia/template. Hunks revalidados antes de aplicar
- **Design:** `apply_style_preset`, `insert_image` (Vercel Blob, 5MB max)

System prompt (`prompts.ts`) tem 18 regras. Destaques: regra 10 obriga markdown estruturado (`## Alterações Realizadas / ## Justificativa / ## Verificação`); 10.1 proíbe edição em pergunta informativa; 11 prefere sugestão a edição direta; 13 obriga placeholders `[preencher X]` quando dados ausentes; 8.1/8.2 proíbem JSON cru e citação de outros contratos sem evidência ancorada.

**Em GDocs:** `propose_suggestion` é DEFAULT mesmo pra verbos imperativos. Force direta via "aplique direto"/"faça já"/"sem revisão" (regex `FORCE_DIRECT_EDIT`). Razão: iframe Drive não permite undo do que a SA fez.

## Análise automática (passive)

`useAutoAnalyze.ts` — server lê `getDocPlainText` direto do Drive (cliente não envia HTML). On-mount `trigger=open` (Sonnet 4.5 deep); polling 90s `GDOCS_REFRESH_MS` `trigger=edit` (Haiku 4.5 via `ANTHROPIC_PASSIVE_MODEL`).

- **Quick checks (zero LLM):** `quickChecks.ts` — soma de parcelas, CPF/CNPJ checksum, refs internas, duplicação de qualificação
- **Dedupe:** `ContractComment.dedupeKey = FNV-1a(authorType+selectedText+text)` + `@@unique([contractId, dedupeKey])`
- **Cap de custo:** 50 unresolved/contrato; skip-no-change via `ContractChangeLog`; `max_tokens` 1024 + `analysisInput` 8000 chars + 3 findings/run. Cleanup: `cleanup-stale-ai-comments.ts --apply --contractId=<id>`
- **Backoff:** `lastAttemptAt` setado ANTES da request

## Editor — Google Docs

`ContractEditorPage.tsx` orquestra: `GoogleDocsEditor.tsx` (iframe Drive) + header badges + Sheets (Comments/Versions/ChangeLog) + `SuggestionsToolbar` + ChatPanel + Export/ShareDialog. Sem editor JS local. Contratos sem `googleDocId` mostram banner com CTA pra recriar (legado pós-System Reset 2026-05-03).

**Pipelines:**
- **Criação (Handlebars):** `contract-generation.ts` → `renderContratoHTML` → `uploadHtmlAsGoogleDoc` (owner OAuth + share com SA) → `googleApplyStylePreset`
- **Import:** `contract-import.ts` → `uploadFileAsGoogleDoc` (Drive converte PDF/DOCX → Doc) → `extractCcvDataJson` → Contract `templateId: null`. NÃO aplica DocumentStyle
- **Versão `/version`:** `exportDocAsHtml` snapshot + `copyContractGoogleDoc` + reaplica DocumentStyle + novo watch
- **Aprovação `/approve`:** `exportDocAsHtml` antes de `status=aprovado`, atualiza `Contract.htmlContent` — snapshot pro `createContractMemory` indexar embedding

**GDocs runtime:**
- Iframe `https://docs.google.com/document/d/{id}/edit?embedded=true&rm=embedded`. Read-only `/preview` quando aprovado
- "Compartilhar" via `ShareDialog.tsx` consome `GET/POST/DELETE /api/contracts/[id]/share` (Drive permissions + owner OAuth). `lib/google/docs.ts` filtra SA + `GOOGLE_OWNER_EMAIL`. POST bloqueado em aprovado
- Tools usam `safeGoogleCall` — exceções viram `{error, googleApiError:true}`
- Auto-save desligado. Watch Drive em `/api/webhooks/google-drive` popula `ContractChangeLog`
- `SuggestionsToolbar` quando há pending; `PATCH /suggestions/[id]` aplica `replaceAllText`/`deleteContentRange`/`insertText` no doc real
- `CommentsPanel` "+ Novo comentário" com `requireSelectedTextInput=true` (POST valida via `createAnchoredComment`, 422 se trecho não existir)
- Banner `CloudOff` quando `googleDocStatus.startsWith("error:")` (causa truncada 240 chars)

Migração legada (raro): `apps/web/scripts/migrate-tiptap-to-gdocs.ts --dealId <id> --apply`. Z-index `[data-radix-popper-content-wrapper]{z-index:100!important}` em `globals.css` faz dropdowns flutuarem acima da toolbar sticky.

**Comentários e suggestions:** `ContractComment { authorType, severity, anchorId, selectedText, parentId, dedupeKey, resolved }` e `ContractSuggestion { type, suggestionId, status: pending|accepted|rejected }`. Endpoints `GET/POST /api/contracts/[id]/{comments,suggestions}` + `PATCH/DELETE`. Em GDocs, `add_comment` e `propose_suggestion` espelham no Drive Comments API; PATCH aplica no doc real e fecha thread.

## Etapa 0 form público — Upload + OCR

`/f/[token]` tem 8 etapas; etapa 0 opcional pra docs identificadores. `STEP_LABELS` em `lib/forms/validation.ts`. `DocumentosStep.tsx`: dropzone JPG/PNG/WebP/GIF + PDF até 10MB, max 15. Resize client `createImageBitmap` pra 2000px (PDFs direto).

**OCR engine** (`lib/ai/ocr.ts::classifyAndExtract`): uma chamada Gemini 2.5 Flash via `@google/genai` retorna `{tipo, campos, confidence}` JSON. Suporta imagens E PDFs. Override `GEMINI_OCR_MODEL`. Categorias: `rg|cpf|cnh|matricula|iptu|escritura|procuracao|comprovante_residencia|certidao_casamento|ficha_resumo|outro`. Custo ~$0.01/form (8 docs), 58% mais barato que Haiku 4.5 vision.

`mapExtractedToForm` chama `form.setValue` respeitando `skipIfDirty`; `suggestAssignment` matcha por CPF/nome (sem match → `kind: "outro"`). Ao finalize, `PATCH /api/forms/[token]` copia FormAttachments → DealAttachments com `extractedData` inteiro (incluindo `assignment`).

## Import de contrato

`POST /api/deals/import-contract` (multipart, `runtime: nodejs`, `maxDuration: 60`): `file` (PDF/DOCX, ≤20MB) + `title?`. Valida header binário (PDF magic `%PDF-1.` / ZIP magic `50 4B 03 04`) → Vercel Blob → cria SalesForm `vinculado` + Deal "Confecção de Contrato" + DealAttachment → `importContractFromFile` → audit `CONTRACT_IMPORT`.

`importContractFromFile`: `uploadFileAsGoogleDoc` → `watchFile` (best-effort) → `exportDocAsHtml` (snapshot em `Contract.htmlContent`) → `extractCcvDataJson` (Gemini, falha → `{}`) → atualiza `SalesForm.dataJson` → cria `Contract { templateId: null, googleDocId/Url, status: rascunho, version: 1 }` → atualiza Deal title/value via `deriveDealMetadata`.

**Re-extração:** `POST /api/contracts/[id]/re-extract` rebusca o anexo original e refaz Gemini. Botão "Re-extrair dados" quando `templateId=null`. Audit `CONTRACT_REEXTRACT`.

**Prompt CCV** (`lib/extraction/ccv-extractor.ts`): força `comissao.comissionados[]` array sempre + `pagamento.parcelas[]` sequencial. `comissao.corretora_*` mantido por retrocompat — `comissionados` é canônico. Heurística modalidade: `financiamento` quando há menção a financiamento bancário/FGTS/cessão de consórcio.

**`Contract.templateId` nullable:** código null-safe; orgId via `deal.pipeline.orgId`. `/render` e `/contract-pdf` erram quando `templateId === null` sem `googleDocId`.

## RAG

`KnowledgeItem { id, orgId, category, title, content, chunkIndex, chunkTotal, parentId, tags, source, embedding vector(1024) }`. HNSW index `vector_cosine_ops`. Categorias: `legislation | model | rule | glossary`.

`src/lib/ai/embeddings.ts::embed/embedOne` chama Voyage `law-2` (`inputType: "document"|"query"`). `isEmbeddingsConfigured()` checa `VOYAGE_API_KEY`. Chunking ~800 tokens overlap 100. `query_knowledge_base` usa `$queryRawUnsafe` com `<=>`. Sem Voyage, fallback ILIKE. UI `/settings/knowledge-base`: 5 tabs, filtro, "Testar RAG" com similarity. Upload PDF/DOCX roda OCR Gemini + chunking + embedding em background.

## ContractMemory + Propose

Hook fire-and-forget em `/approve` chama `createContractMemory(contractId)`: summary (Haiku), `dataFingerprint` (modalidade, estado civil, faixa de valor), acceptedSuggestions, rejectedSuggestions, manualEdits, embedding. Incrementa `Clause.usageCount`. `find_similar_contracts` busca top-3 por embedding (Voyage) ou fingerprint (fallback).

**Propose:** `ClauseProposal` → UI `/clauses/proposals` (aprovar cria `Clause { source: "ai_proposal" }`). `TemplateSuggestion { diffHunks, evidence }` → UI `/templates/[id]/suggestions` com diff verde/vermelho (aprovar aplica hunks + incrementa `templateVersion`; hunks revalidados — `before` ainda existe?).

Pra contratos importados (`templateId=null`), `diffManualEdits` retorna `[]` e `extractFingerprint` aceita `templateModalidade=null`.

## Design System (DocumentStyle)

`DocumentStyle { fontFamily, fontSizeBase, lineHeight, marginTopMm/Bottom/Left/Right, colorPrimary, colorAccent, headerHtml, footerHtml, pageNumbers, includeToc }`. UI `/settings/document-styles` com preview ao vivo.

**Preset default obrigatório** pra Handlebars: row `isDefault=true`. Em prod o "Padrão Zimmermann" (id `cmot43tt30001126r97zhcm3z`): EB Garamond, fontSizeBase 11, lineHeight 1.5, margens 30mm. Sem default, GDocs nascem Arial 11pt.

**Aplicação automática (Handlebars):** `contract-generation.ts` chama `googleApplyStylePreset` após upload (falha não bloqueia); `/version` reaplica após `copyContractGoogleDoc`. Via Docs API: `updateTextStyle` (font/size/cor), `updateParagraphStyle` (lineSpacing/alignment), `updateDocumentStyle` (margens).

**CENTER seletivo:** body `JUSTIFIED`. Centraliza apenas: HEADING_1 (sempre), **primeiro** HEADING_2 ("Modalidade: …"), parágrafos só com símbolos decorativos (regex `/^[❦◆◇●○•★※\s_*-]+$/`, length<10). Cláusulas em HEADING_2 ficam justified. **Contratos importados:** preset NÃO é aplicado.

Export PDF: `/api/contracts/[id]/export` carrega preset default da org → Puppeteer aplica `margin/headerTemplate/footerTemplate`. `<span class="pageNumber">/<span class="totalPages">` no footer default. GDocs mode usa `drive.files.export` nativo.

## Certidões (Infosimples)

Disparo manual no Deal → aba Certidões. Pipeline: client gera `batchId` UUID → `POST /api/deals/:id/certidoes` retorna 202 em <500ms e dispara `runBatch(batchId)` fire-and-forget → `pLimit(5)` com `Promise.allSettled` → cada job chama `callInfosimples`, normaliza, baixa PDF de `site_receipts[0]`, cria `DealAttachment { source: "infosimples" }` → client polla 2s.

**Two-step (TJSP/TJRJ):** `pedido-*` retorna 200 → job vira `awaiting_portal` com `expectedReadyAt = now+1h (TJSP) / +24h (TJRJ)` → cron `/api/cron/certidoes/poll-portal` (`*/5min` em `vercel.json`) sweeps com `expectedReadyAt < now`. `MAX_AGE = 14 dias` → `failed: "Timeout portal"`.

**Schema:** `CertidaoJob { dealId, batchId, endpoint, label, targetKind, targetIndex, requestPayload, status, resultCode, resultData, attachmentId, errorMessage, latencyMs, costCents, expectedReadyAt, retryCount, nextRetryAt, maxRetries (3), missingFields[], portalUrl }`.

**Estados** (`outcome-classifier.ts::classifyOutcome`):
- `success` (code 200 + PDF) → verde, anexo
- `informativo` (category `cadastro`/`fgts` code 200) → "Consulta informativa"
- `api_error` (5xx/timeout) → retry 30s/2min/10min
- `portal_unavailable` (615/665/666) → retry 10min/30min/2h
- `rate_limited` (668) → retry 30min/1h
- `data_missing` (606/612/613) → sem retry, `missingFields[]`, CTA "Completar campos"
- `data_invalid` (614) → sem retry, abrir EditPartyDialog
- `failed_permanent` (retries esgotados) → CTA "Abrir portal oficial" via `portalUrl`
- `skipped` (dados faltando pré-dispatch) → card com `externalLink` se aplicável

**Anti-falso-negativo:** categoria civel/trabalhista/fiscal/protesto/municipal/federal sem `site_receipts[0]` é sempre `failed`, ignorando code/billable. **Billing honesto:** respeita `resp.header.billable === false`.

**Planner** (`planner.ts`) percorre vendedores/compradores/imóveis. PF sem `data_nascimento` bloqueia PGFN/TJSP/Antecedentes PF. Imóvel SP sem `sql` bloqueia IPTU SP. RJ sem `inscricao_municipal` bloqueia ambos IPTU RJ. Comarca TJRJ via `comarcas-rj.ts` (fallback "Capital").

**Endpoints cobertos:** Federais (PGFN/CND PF+PJ, CNDT, TRF), trabalhistas (TRT2/15/1/4 CEAT), cíveis (TJSP/TJRJ 2-step, TJRS 5 chamadas), protestos SP (CENPROT), municipais (IPTU SP via SQL, IPTU+CND RJ via inscricao_municipal). Receita CPF + Antecedentes PF auto em financiamento. CCIR/Matrícula ONR só via picker manual.

**Catálogo** (`endpoints.ts`): `category`, `emitsPdf?`, `portalUrl?`, `expectedWaitMinutes?`. `CATEGORIES_REQUIRING_PDF` exportado. **Normalizers** com fallback chains de nomes. Codes 6xx geralmente viram `nao_emitida`.

**Budget guard** `INFOSIMPLES_MONTHLY_BUDGET_CENTS` (default 5000), POST retorna 402 se estouraria. **Relatório PDF:** `POST /api/deals/:id/certidoes/report` → `DealAttachment { category: "relatorio_certidoes" }`. **Dashboard `/settings/certidoes`:** gasto/budget, sucesso, p50/p95, últimos erros.

**Gaps:** CNIB, ITR, TJMG/TJPR/TJES cível — `portalUrl` manual. IPTU Porto Alegre sem cobertura. Casos especiais (estrangeiro, espólio, menor, divórcio, falência) → futuro.

## Assinatura digital (ClickSign v3)

Envelope vincula a UM de dois (CHECK XOR): Contract aprovado (`source="contract"`, `Envelope.contractId`) ou DealAttachment avulso (`source="attachment"`, `Envelope.attachmentId`).

**Caminho A — Contract aprovado:** `executor.ts::sendEnvelopeForContract` exige `status === "aprovado"`, gera PDF via `generateContractPdfBuffer` (Drive export se há `googleDocId`; Puppeteer + Handlebars fallback), signers via `dealDataToSigners(dataJson)`. `POST /api/contracts/[id]/envelopes`.

**Caminho B — DealAttachment avulso:** `sendEnvelopeForAttachment` baixa PDF via `downloadBufferFromUrl`, signers 100% do dialog. Não exige aprovação. `POST /api/deals/[dealId]/envelopes`. UI: aba Assinaturas → "+ Enviar documento da pasta". Use cases: aditivos, distratos, procurações, recibos.

**Helper `createEnvelopeFromBuffer`** (privado): budget check → upload snapshot → `prisma.envelope.create` → ClickSign API (createEnvelope → addDocument → addSigners → addRequirements → activate). Falha → `status: failed` + `deleteDraftEnvelope` best-effort.

**Listagem unificada:** `GET /api/deals/[dealId]/envelopes` retorna ambos com `subjectLabel` server-side. Hook `useDealEnvelopePolling(dealId)`. **Cancelamento:** `DELETE /api/deals/[dealId]/envelopes/[envelopeId]` (deal-level) ou `DELETE /api/contracts/[id]/envelopes/[envelopeId]` (legado).

**Custo:** `Envelope.costCents`. Budget mensal `getMonthlyBudgetCents()` soma `running + closed` do mês. POST retorna 402 se estouraria.

**Diálogo de envio (`SendEnvelopeDialog.tsx`):** linhas editáveis Nome/Email/CPF agrupadas por origem. Vendedor + Comprador titulares sempre signers; **Cônjuges, Corretora(s) e Testemunhas opt-in**. Linhas com `addedDuringDialog=true` em aprovado mostram banner amarelo: aparecem só no certificado ClickSign, não no PDF congelado.

- **Múltiplos comissionados:** itera `comissao.comissionados[]` (canônico); array vazio → fallback hidrata 1 row do legado `imobiliaria_*`
- **Cônjuges:** com `conjuge.nome` aparecem como sub-linha opt-in. `sourceIndex = idx + 1000`
- **Submit:** `PATCH /api/contracts/[id]/signers-data` (whitelist regex — emails, `conjuge.{email,nome,cpf,incluir_como_signatario}`, `comissao.comissionados`, `testemunhas`) → `POST /api/contracts/[id]/envelopes`. `SourceKind = "vendedor" | "comprador" | "testemunha" | "corretora"`

**Quirks v3 (prod 2026-05-08):**
1. `communicate_by` REMOVIDO no signer (422). Email automático via `signer.email` + `activateEnvelope`
2. `documentation` (CPF/CNPJ) exige máscara `123.456.789-00`/`12.345.678/0001-90`. Helper `formatCpfCnpj`
3. Requirement usa `action="agree"` + `role` (não `action="sign"`). Roles: `sign|buyer|seller|intervening|realestate|witness|consenting|attorney`. Mapping em `executor.ts::defaultRoleForSourceKind`
4. **Status em `/events`**, não `/signers`/`/requirements`. `listEnvelopeEvents` retorna histórico canônico (`name: sign|signature_started|refusal`, `data.signer.{key,email}`, `created`)
5. **Webhook v3 NÃO tem `envelope.id`** — só `event` + `document.{key,filename,path}`. Lookup local: `Envelope.documentClicksignId === payload.document.key`
6. **Match signer no sync /events:** ClickSign edita signer (PATCH) gerando `remove_signer + add_signer` com novo `signer.key`; DB local fica com key antigo. Match canônico por key, fallback por email lowercase
7. Host `app.clicksign.com` (não `api.`); auth via `?access_token=TOKEN` query string (Bearer header retorna 401 enganoso)

**Webhook close** (`https://imobpro.ia.br/api/webhooks/clicksign`): valida HMAC-SHA256 (header `content-hmac` ou `x-clicksign-signature`). Eventos `close|auto_close|document_closed` disparam `downloadSignedPdf` fire-and-forget → `uploadBufferToStorage` (`envelopes/<id>/signed.pdf`) → grava `Envelope.signedDocumentUrl`. Cria DealAttachment automático (idempotente via `findFirst { dealId, url }`): `category="contrato_assinado"` (contract) ou `"documento_assinado"` (attachment), `source="clicksign_signed"`.

**Sync — 3 caminhos:** webhook (fast path 1-3s) · botão Atualizar `POST .../sync` (pulla /events, reconcilia signer-by-signer; `?debug=1` retorna shapes crus) · cron diário 06 UTC (`/api/cron/clicksign/sync-envelopes`, só envelope-level running→closed, redundância).

**Diagnostics admin:** `GET /api/admin/clicksign/{webhooks, webhook-attempts, envelope-events/[envelopeId]}`.

## Pagadoria (Asaas)

Documentação consolidada em [docs/pagadoria-handoff.md](docs/pagadoria-handoff.md) — sempre consultar antes de mexer.

**Fases entregues:**
- **1a-1b Security + Asaas:** RBAC (`CustomRole`+`PERMISSION.*`), 2FA, SessionElevation, TrustedDevice. `AsaasAccount` (apiKey AES-256-GCM + walletId + 4 status fields), upload KYC multipart, `CommissionCharge` status canônico, idempotência via `AsaasWebhookEvent.asaasEventId`
- **2 `/financeiro` + `/pay`:** KPIs, taxas (`OrgFinancialSettings.finePercent/interestPercentMonth` com limites CDC), branding por org, `/pay/[token]` com PII mascarada
- **3 Transferências + conciliação + relatórios:** `AsaasTransfer` + dual approval > `dualApprovalCapCents`, `BankReconciliation` auto-match via `externalReference`, 4 relatórios
- **4 Polish:** notif bell, devices UI, platform fee (`platformFeePercent` + `platformFeeWalletId`)
- **5 Split multi-recipient:** `SplitRecipient { orgId, label, walletId, active }`, CRUD `/settings/pagamentos/split-recipients`. `composeSplits()`: max 10 entries, sem duplicatas, sem wallet própria, soma `percentualValue ≤ 100`. Persistido em `CommissionCharge.splitJson`. `platformFeePercent` só gera split se `platformFeeWalletId` configurado
- **Multi-account (2026-05-10):** N contas Asaas por org com seletor admin. `Organization.activeAsaasAccountId` define a conta default; `AsaasAccount.label/archivedAt` + `@index(orgId)` (não mais @unique). `OrgFinancialSettings`, `AsaasCustomer`, `CommissionCharge`, `AsaasTransfer`, `BankReconciliation`, `AsaasWebhookEvent` ganham `accountId` (persistido na criação). `AsaasAccountPermission { accountId, userId, capability }` libera 4 caps granulares: `view | create_charge | init_transfer | configure`. Owner bypassa. Helpers canônicos em `lib/asaas/account.ts` (`resolveAsaasAccount{hint→active→first_accessible}`, `getAccountWithApiKey`, `userHasAccountCapability`, `listAccessibleAccounts`). `requireAccountCapability` em `rbac/guard.ts`. `BANK_ACCOUNT_SWITCH` em `ElevationScope`. Endpoints `/api/financeiro/accounts/*` (CRUD + activate + permissions). UI `/settings/pagamentos/contas/*` com wizard reusado (`OnboardingWizard mode="newAccount"`). `<AccountSwitcher />` no layout `/financeiro/*` lê `?accountId=` do URL e dispara `/activate` (owner). Webhook `ACCOUNT_STATUS_UPDATED` automatiza refresh do KYC. **Cobranças em aberto NÃO migram** entre contas (paymentId/walletId são per-conta no Asaas — decisão consciente)

### v2 Wizard (2026-05-09)

**ChargeWizard:** 4 etapas reusadas em 3 modes (`commission_from_deal | avulsa_in_deal | avulsa_standalone`) com pré-preenchimento + chips stateful + drawer "De onde vieram" (botão `?`). `CommissionCharge.kind` + `categoryLabel String?` (texto livre filtrável). `OrgFinancialSettings.notify*` (6 flags: created/paid/overdue/dueSoon/admins/comissionados) + régua via `notifyChargeEvent`. Cron D-3 em `/api/cron/charges/due-soon` (12 UTC).

**Mapper imobiliária→comissionados[]:** `GET /api/deals/[id]/contract-data-summary` em `deriveComissionados()` converte `comissao.imobiliaria_*` (legado mono-corretora) numa entrada com `source: "ccv.imobiliaria_principal"` quando array vazio. Source values: `ccv.comissionados | ccv.imobiliaria_principal | manual`.

**Multi-corretora:** `comissao.comissionados[].papel: enum(captador|intermediador|indicador|imobiliaria_principal|outro)` + superRefine soma ≤ 100%. `ComissaoConfigStep` renderiza Percentual + Papel + soma visual. Templates `ccv_*_v2.hbs` ganharam `{{#if comissao.comissionados.length}}` loop com fallback `imobiliaria_*`.

**Hide-from-payer:** `splitJson.display.{hiddenRecipientIds,consolidationMap}`. `generatePayerVisibleDescription()` em `lib/asaas/commission.ts` gera `description` omitindo splits ocultos. Asaas não expõe split publicamente.

**Rascunho `SplitRecipient`:** `pendingFields String[]` permite cadastrar inline com PIX/walletId vazios → `active: false`. `splitDispatcher` pula criando `AsaasTransfer { status: "FAILED", failureReason: "Cadastro pendente..." }` — cobrança ainda emite. UI ganhou seção "⚠️ Pendentes" com botão `[Pedir dados]`.

**Magic link:** `completionToken/Exp` (JWT-HMAC `AUTH_SECRET`, 7d). `POST /api/financeiro/split-recipients/[id]/request-completion` envia email Resend. Página pública `/financeiro/completar-cadastro?token=` → `POST /api/public/split-recipients/complete` valida token, marca `active: true`, esvazia pendingFields. Token único por uso.

**Wizard draft:** `CommissionChargeDraft { dealId, userId @@unique, state Json, expiresAt }` (30d TTL). `POST/GET/DELETE /api/deals/[id]/commission-charges/draft`. Wizard auto-aplica state no mount + toast. Submit final → `DELETE`. Cron 03 UTC limpa expirados.

**Validate por etapa:** `POST .../commission-charges/validate?step=payer|charge|splits|all`. Funções puras em `lib/asaas/charge-validators.ts`. Chips stateful no client computam status localmente; endpoint serve pra Newton/Bearer.

**Trocar pra avulsa:** Banner "Sem comissionados no contrato" oferece `[Trocar para cobrança avulsa]` que muda `mode` preservando state via `onModeChange`.

**Endpoints v2:** `GET /api/deals/[id]/contract-data-summary` (readonly) · `POST .../commission-charges/validate?step=` · `GET/POST/DELETE .../commission-charges/draft` · `POST /api/financeiro/split-recipients/[id]/request-completion` · `POST /api/public/split-recipients/complete` · `GET /api/financeiro/categories?q=` (autocomplete) · `GET /api/financeiro/split-recipients/uncadastrados` · `POST .../bulk-import` · crons `/api/cron/charges/due-soon` (12 UTC) e `/api/cron/drafts/cleanup` (03 UTC)

**QA:** preflight `GET /api/admin/preflight-qa` (30+ checks). Setup `apps/web/scripts/setup-pagadoria-qa.ts`. Sandbox helper `lib/asaas/sandbox.ts::approveSandboxAccount` força 4 status pra APPROVED via `POST /v3/sandbox/myAccount/approve` — guard interno rejeita se `ASAAS_ENV=production`.

**Webhook:** `https://imobpro.ia.br/api/webhooks/asaas` (id `3bd623b8-ed2e-45d4-b201-648f46ee404b`). Conta PJ ativa em prod desde 2026-04-27. `bankAccountInfo=PENDING` não bloqueia recebimento — usar `general=APPROVED` como gate.

## Observabilidade IA (AIUsage)

`AIUsage`: tokens, custo USD, latência, provider (anthropic/gemini/voyage), model, operation, `toolsUsed[]`, `iterations`, sucesso/erro. Operations: `chat | passive_open | passive_edit | ocr_form | ocr_tool | extract_ccv_doc | embed_kb | embed_memory | embed_query | summarize_memory | clause_generate | doc_analysis`.

**Helper `src/lib/ai/usage.ts`:** `PRICING` hardcoded (Claude Opus/Sonnet/Haiku, Gemini 2.5 Flash/Lite/2.0, Voyage law-2/v3) — **atualizar manual** (última revisão 2026-04-14). `calcCostUsd(model, prompt, completion, cacheRead, cacheWrite)` retorna 0 pra modelo desconhecido. `recordAIUsage` é fire-and-forget, nunca lança, error truncado em 500 chars. Agente agrega N iterações em 1 record com `iterations=N` e `toolsUsed` deduplicado.

**Dashboard:** `/settings/ai-usage` (`AIUsageClient.tsx`) — 4 KPI cards, line chart SVG inline, bar rows CSS, top 10 users/contratos. Filtros: 7d/30d/mês atual/anterior. API: `GET /api/ai-usage?from=YYYY-MM-DD&to=YYYY-MM-DD`.

## Aprovação

`POST /api/contracts/[id]/approve` valida + conta `ContractSuggestion` pendentes + `ContractComment` não-resolvidos (severity error). Se issues: `{requiresReview, canForce, errorCount, warningCount, ...}`. Frontend abre `ApprovalReviewDialog` com "Revisar" / "Aprovar mesmo assim" (oculto se `canForce=false`). Segunda chamada com `{force: true}` aprova.

GDocs mode: `runContractApproval` em `lib/contracts/approve-action.ts` faz `exportDocAsHtml(googleDocId)` antes de `status=aprovado`, atualiza `Contract.htmlContent`, dispara `createContractMemory` fire-and-forget, e auto-promove o Deal pra "Enviado para assinatura".

**Aprovado = imutável:** chat/edição/comentários/versionamento bloqueados; API retorna 403 em POSTs. `/auto-analyze` retorna 200 com `{findings:[], modelUsed:"approved"}`. **Exceção:** `PATCH /signers-data` (whitelist regex) aceita patch escopo restrito mesmo em aprovado — campos não são renderizados no HTML/PDF (só metadados pra ClickSign).

## Mecanismos de delete (4 níveis)

Todos com auth + cross-org guard via `deal.pipeline.orgId` + audit log + bloqueio quando há `Envelope` em `closed`/`running` (409). GDocs vão pra lixeira do Drive (best-effort).

- `DELETE /api/contracts/[id]` (`VersionTimeline`) — versão específica. Cascata: ContractClause/Comment/Suggestion/ChangeLog/ChatSession/Envelope. Promove próxima se era `isLatest`. Bloqueia aprovado
- `DELETE /api/pipeline/deals/[dealId]/contracts` ("Excluir contratos") — todas Contract rows (mantém Deal+SalesForm). Sequencial trash dos GDocs
- `DELETE /api/deals/[dealId]/attachments/[attachmentId]` (ícone X) — anexo individual. `CertidaoJob.attachmentId` vira null
- `DELETE /api/pipeline/deals/[dealId]` ("Excluir negócio") — Deal completo. Cascata CertidaoJob → DealAttachment → Contract → Deal. SalesForm condicional via `?deleteForm=true`

Audit: `CONTRACT_DELETE`, `CONTRACT_DELETE_BULK`, `ATTACHMENT_DELETE`, `DEAL_DELETE`.

## Rotas públicas (sem auth)

- `/f/[token]` (form vendas) + `/api/forms/[token]` (auto-save) e subrotas attachments
- `/pay/[token]` (Asaas) · `/financeiro/completar-cadastro?token=` (split recipient magic link)
- `/login`, `/register`, `/forgot-password`, `/reset-password`, `/logout` (cleanup completo)
- `/privacy`, `/terms` (LGPD) · `/api/webhooks/{asaas,clicksign,google-drive}` (HMAC validado)

## Export PDF/DOCX

**Chromium serverless:** `lib/render/exporter.ts::launchBrowser()` detecta env via `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME` e usa `@sparticuz/chromium` + `puppeteer-core`. Local: Chrome do sistema. **Sem fallback `puppeteer` full** (tenta baixar Chrome em runtime → quebra em serverless). `next.config.js::serverComponentsExternalPackages` inclui ambos — Next deixa como `require` runtime.

- **PDF margins:** Puppeteer é única fonte de verdade — defaults 30/25/35/25mm. `wrapWithStyle()` NÃO injeta `@page { margin }`
- **DOCX:** `html-to-docx` ignora CSS de classes. `htmlForDocx(html, style)` injeta inline via regex. Limitações: drop cap, ornamentos SVG, marca d'água, ligaturas não traduzem pra OOXML — perdidos. PDF preserva
- **Storage:** prioridade `BLOB_READ_WRITE_TOKEN` → `S3_BUCKET` → local `public/exports/` (só dev). Sem nenhum em serverless: erro PT-BR
- **GDocs mode** (`googleDocId` set): `drive.files.export` nativo, ignora preset
- Puppeteer requer Vercel Pro (timeout 60s)

## Schemas críticos

- **`DealAttachment.source`:** `manual | form_copy | infosimples | upload | clicksign_signed`
- **`DealAttachment.category`:** `contrato_original | contrato_assinado | documento_assinado | relatorio_certidoes | rg | cpf | cnh | matricula | iptu | comprovante_residencia | escritura | procuracao | ...`
- **`Contract.templateId`** nullable. Null = importado, conteúdo no GDoc
- **`Envelope`** XOR: `contractId` ou `attachmentId`. `source: "contract" | "attachment"`
- **Deal NÃO tem `orgId` direto** — escopo via `pipeline.orgId`. Pra Contract importado (`templateId=null`) usar `deal.pipeline.orgId` (não `template.orgId` — null-deref)
- **`SplitRecipient.pendingFields String[]`** — quando não-vazio, `active: false` automaticamente; `splitDispatcher` pula com FAILED. Magic link via `completionToken/Exp` (JWT-HMAC 7d)
- **`CommissionCharge.kind`:** `commission | avulsa | aluguel | outros`. `categoryLabel String?` filtrável (avulsas)
- **`splitJson`:** `{ splits: AsaasSplit[], external: ExternalSplit[], display?: { hiddenRecipientIds, consolidationMap } }`. Display é puramente UI/descrição — Asaas não vê
- **`comissao.comissionados[]`** canônico (multi-corretora) com `papel`. Fallback `imobiliaria_*` mantido — `deriveComissionados` em `/contract-data-summary` sintetiza 1 entrada com `source: "ccv.imobiliaria_principal"` quando array vazio
- **`CommissionChargeDraft`** `(dealId, userId)` único, `expiresAt = +30d`, cron diário cleanup
- **`AsaasAccount.orgId`** **NÃO** é mais @unique — N contas por org permitidas. Tem `label`, `archivedAt` (soft delete), `@@index([orgId])`. Conta ativa via `Organization.activeAsaasAccountId` (FK SetNull)
- **`OrgFinancialSettings.accountId @unique`** — settings agora per-conta. `orgId` mantido como índice/conveniência mas NÃO é mais @unique. Cada conta tem suas próprias taxas/branding/notify*/platformFee
- **`AsaasCustomer @@unique([accountId, cpfCnpj])`** e `@@unique([accountId, asaasId])` — cliente é per-subconta no Asaas. Mesmo CPF pode existir em N contas
- **`CommissionCharge.accountId`** persistido na criação (FK Restrict). Webhook handler popula `AsaasWebhookEvent.accountId` via charge lookup. Trocar conta ativa NÃO afeta cobranças já emitidas
- **`AsaasAccountPermission { accountId, userId, capability }`** com cap em `view | create_charge | init_transfer | configure`. Owner bypassa implicitamente (não inserir rows). RBAC global ganhou 4 perms org-level: `ACCOUNT_CREATE/ACTIVATE/ARCHIVE/PERMISSIONS_MANAGE` (só owner herda; admin tem `false` explícito)

**Audit actions:** `DEAL_*`, `FORM_*`, `ATTACHMENT_*`, `CONTRACT_GENERATE/IMPORT/REEXTRACT/STATUS_UPDATE/APPROVE/DELETE/DELETE_BULK`, `ENVELOPE_CREATE/RESEND`, `CERTIDAO_BATCH_DISPATCH`, `KYC_*`, `CHARGE_*`, `TRANSFER_*`, `INTENT_*`, `CLICKSIGN_WEBHOOK_RECEIVED|REJECTED`, `SPLIT_RECIPIENT_*`, `ACCOUNT_CREATE/ACTIVATE/ARCHIVE/LABEL_UPDATE/PERMISSION_GRANT/PERMISSION_REVOKE`.

## Gotchas

- **Env vars Vercel:** `printf '%s' 'value' | vercel env add NAME ENV` com aspas SIMPLES (obrigatório quando valor tem `$` — chaves Asaas; aspas duplas causam shell expansion). `echo` insere `\n` literal e corrompe runtime. `vercel env pull` mostra `\n` escapado, mascarando. Scripts locais: `perl -pe 's/\\\\n"$/"/' .env.vercel-prod > .env.vercel-prod.clean`
- **Logout completo:** sidebar usa `<Link href="/logout">` (não `signOut()` direto) — `/logout` faz `POST /api/auth/logout` (revoga elevation, deleta sessions, audit) + `signOut`
- **Radix DropdownMenu + asChild** envolvendo function component sem forwardRef pode falhar a recalcular position em `side="top"` — usar links diretos
- **pgvector** exige Neon Standard+. Inserts/queries via `$executeRawUnsafe`/`$queryRawUnsafe` com `<=>`
- **`VOYAGE_API_KEY` opcional:** sem ele, `query_knowledge_base` e `find_similar_contracts` caem em fallback ILIKE/fingerprint
- **Análise passiva** envia `htmlContent` atual no body — server usa `params.htmlOverride` pra ver estado live
- **Upload de imagens** `/api/contracts/[id]/images`: 5MB max, JPEG/PNG/WebP. Requer `BLOB_READ_WRITE_TOKEN`
- **Cron certidões** requer Vercel Pro. Sem ele, `awaiting_portal` fica eterno. Schedule `*/5min` em `vercel.json`
- **Normalizers de certidões são frágeis:** Infosimples muda nomes de campo. Após primeira extração em prod, salvar `resultData` como fixture + teste de regressão
- **Asaas sandbox rejeita docs de identidade** via API — usar `approveSandboxAccount`. Split rejeita wallet própria, duplicatas, max 10
- **Prisma migrations** rodam via `prisma migrate deploy` no build. Mudanças em **dados** (rename, backfills) → migration SQL plain idempotente, roda automático
- **Auto-mode classifier bloqueia acesso direto a prod DB** (`prisma migrate dev`, scripts TS que conectam, leitura de `.env` com creds). Workaround canônico: SQL migration via `prisma migrate deploy`. Scripts TS são fallback emergencial
- **Auto-promote stage não é retroativo:** webhook ClickSign close OU charge antes da migration de stages = deal fica em stage anterior. Drag-drop manual
- **Google OAuth Testing 7-day expiry:** `invalid_grant` quebra GDocs prod a cada ~7d enquanto consent screen Testing. Mover pra "In production" no Cloud Console resolve permanente
- **Chrome MCP bloqueia accounts.google.com:** não tentar dirigir Google OAuth via MCP — rodar script servidor + usuário completa manual
- **Resend sandbox bloqueia destinatários:** `EMAIL_FROM=onboarding@resend.dev` só envia pro dono. Convites/magic link silenciosamente bloqueados até domínio verificado. **Magic link Pagadoria v2** cai nessa armadilha
- **Forms públicos não requerem auth** — qualquer um com o link pode editar
