# Contractmaker - Claude Code Context

## Visão geral

Plataforma de gestão de vendas e contratos imobiliários. Esteira: formulário público de vendas → Kanban de negócios → geração de contrato com IA → editor Google Docs embedado (TipTap como fallback) → export PDF/DOCX nativo do Drive → assinatura ClickSign. Módulo financeiro (Pagadoria) integrado com Asaas. Due diligence automática via Infosimples.

**Produção:** [https://imobpro.ia.br](https://imobpro.ia.br) (custom domain registrado em registro.br, deploy Vercel `prj_tkIfHl9chuVwZkNtHLAl5QXY2YOB`).

**Modo de operação atual:** single-tenant compartilhado — env `SHARED_ORG_ID=cmnt1ldo4000111bw4yo517k0` (org `default` / Contractmaker). Todo signup novo via `/api/auth/register` é criado como `OrgMembership { role: "member" }` dessa org. Olavo (`olavo.piton@gmail.com`) e admin (`admin@contractmaker.com`) são owners. Schema continua multitenant pra futuro.

## Tech stack

- **Framework:** Next.js 14 App Router · Vercel Pro
- **UI:** Tailwind v4 · Shadcn (new-york) · lucide-react · sonner
- **Auth:** NextAuth v5 + Prisma Adapter + Credentials (JWT session). 2FA TOTP (otplib v12), SessionElevation (sudo 15min), TrustedDevice (30d), AuditLog imutável.
- **DB:** PostgreSQL (Neon) + Prisma ORM. pgvector vector(1024) HNSW cosine pra RAG.
- **Editor:** Google Docs embedado (iframe + Drive/Docs API) com fallback TipTap v3 (ProseMirror) per-contract via `Contract.googleDocId`
- **Kanban:** @dnd-kit/core + @dnd-kit/sortable
- **AI:** Anthropic SDK (chat agent + análise + clausula generate) | Google GenAI (Gemini 2.5 Flash — OCR docs do form) | Voyage `law-2` 1024 dim — embeddings RAG
- **Pagamentos:** Asaas v3 (subconta white-label, KYC, splits multi-recipient, transferências PIX)
- **Templates:** Handlebars com helpers BR (`moeda`, `cpf`, `cnpj`, `cep`, `dataExtenso`, `extenso`, `numero`, `numeroExtenso`, `percentual`)
- **Certidões:** Infosimples REST v2 (~R$ 0,04-0,06 por chamada)
- **PDF:** puppeteer-core + @sparticuz/chromium (serverless-compatible)
- **DOCX:** html-to-docx
- **Storage:** @vercel/blob (primário) + S3 (fallback)
- **Forms:** React Hook Form + Zod
- **Cache/Rate-limit:** Upstash Redis

## Convenções

- Código em inglês. UI em português brasileiro.
- IDs: `cuid()` em models novos, `uuid()` em legados.
- Validação: Zod em todas APIs.
- Server Components por padrão; `"use client"` só quando necessário.
- Path alias `@/*` → `src/*`.

## Dados críticos

`DadosContrato` (TS): vendedores, compradores, imóveis, pagamento, comissão, config. **Mudanças aditivas só** — novos campos opcionais, nunca breaking. O form de vendas produz exatamente essa estrutura; Handlebars renderiza a partir dela. Campo `modalidade: "a_vista" | "financiamento"` decide o template.

## Templates v2 (CCV Zimmermann)

Dois templates ativos em `templates/`:
- **`ccv_a_vista_v2.hbs`** (15 cláusulas): sinal + saldo próprio · posse após pagamento integral · escritura pública.
- **`ccv_financiamento_v2.hbs`** (17 cláusulas): sinal + financiamento bancário · posse após registro · 45 dias úteis pra instrumento definitivo · cláusula 9.5 de rescisão por não obtenção do crédito.

Slots `<!-- CLAUSE_SLOT:Gx -->` no template marcam pontos de inserção das cláusulas variáveis do banco.

Template legado `contrato_compra_venda.hbs` continua deprecated (mantido pra contratos antigos).

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

**Pré-carregamento de contexto especialista** — antes do 1º turn LLM, `loadExpertContext` (`src/lib/ai/expert-context.ts`) busca top 3 contratos similares aprovados (`findSimilarContracts`), top 8 cláusulas mais usadas (filtra G4 fora de financiamento), templates ativos. Injeta como bloco markdown no prompt do user. Custo ~1.5k tokens upfront economiza 4-6k em iterações de tool-use porque o agente já abre conhecendo o padrão da org. Regra 0 do system prompt obriga uso desse contexto antes de editar.

**Budget per-contrato** — `src/lib/ai/budget.ts::assertContractBudget` é chamado antes de cada `messages.create` (chat e passive). Soma `AIUsage.totalTokens` filtrados por contractId; bloqueia se ≥ `CONTRACT_AI_TOKEN_BUDGET` (default 200_000). Chat retorna mensagem amigável; passive retorna `modelUsed: budget-exceeded` sem chamar Anthropic. Endpoint `GET /api/contracts/[id]/budget` retorna `{ spent, budget, pct, remaining, ok }` pra UI. Badge IA no header do contrato indica % consumida (cinza < 80%, âmbar 80-100%, vermelho ≥ 100%).

- **Consulta:** `query_clauses` (com groupCode/isVariable), `query_templates`, `explain_clause`
- **Edição:** `edit_contract_section`, `update_contract_data`, `insert_clause` (usa CLAUSE_SLOT:Gx), `remove_clause`
- **Análise:** `validate_contract`, `suggest_improvements`, `analyze_contradictions` (5 checks: matemática, qualificação, referência, prazos, cláusulas mutuamente exclusivas)
- **OCR:** `extract_document_data` (Anthropic — chat do editor; ≠ fluxo de form que usa Gemini)
- **Comentários:** `add_comment` valida selectedText no htmlContent antes de ancorar (anti-alucinação)
- **RAG:** `query_knowledge_base` (Voyage pgvector cosine; fallback ILIKE se VOYAGE_API_KEY ausente)
- **Aprendizado:** `find_similar_contracts` busca em `ContractMemory` por embedding ou fingerprint
- **Modo Propose** (NUNCA edita templates/biblioteca direto): `propose_new_clause` cria `ClauseProposal`, `propose_template_change` cria `TemplateSuggestion` com diffHunks. Rate limit 5 pendentes/org, 1/dia/template. Hunks são revalidados contra source atual antes de aplicar.
- **Design system:** `apply_style_preset`, `insert_image` (Vercel Blob, 5MB max)

System prompt (`src/lib/ai/prompts.ts`) tem 18 regras. Destaques: regra 10 obriga resposta em markdown `## Alterações Realizadas / ## Justificativa / ## Verificação`. Regra 10.1 proíbe tools de edição em perguntas informativas. Regra 11 prefere modo sugestão (track changes) a edição direta. Regra 13 obriga placeholders `[preencher X]` quando dados ausentes.

## Análise automática (passive)

`useAutoAnalyze.ts` no editor — aceita prop `mode: "tiptap" | "google_docs"`:
- **TipTap (legacy):** depende de `editor.getHTML()` + eventos `update`. Idle 30s, max-wait 60s.
- **Google Docs (atual):** sem editor JS — server lê `getDocPlainText` direto do Drive. On-mount dispara `trigger=open`; depois polling fixo de 90s (`GDOCS_REFRESH_MS`) re-dispara `trigger=edit`.
- **On-open:** `POST /api/contracts/[id]/auto-analyze { trigger: 'open' }` com Sonnet 4.5 (deep)
- **On-edit (debounced):** Haiku 4.5 (env `ANTHROPIC_PASSIVE_MODEL`)
- **Quick checks (zero LLM):** `src/lib/ai/quickChecks.ts` faz 4 checks deterministicos (soma de parcelas, CPF/CNPJ checksum, refs internas, duplicação de qualificação) antes do LLM.
- **Dedupe:** `ContractComment.dedupeKey` = hash FNV-1a de `authorType+selectedText+text`, com `@@unique([contractId, dedupeKey])`.
- **Backoff:** `lastAttemptAt` é setado ANTES da request (success ou erro). Sem isso, 503 do LLM em cascata fazia o gate de 90s nunca aplicar (retry a cada 5s).
- TipTap envia `htmlContent` atual no body; GDocs envia null e o server usa `params.htmlOverride` ou `getDocPlainText` quando `googleDocId` setado.

## Editor — Google Docs (padrão atual) e TipTap (legacy)

`ContractEditorPage.tsx` é o orquestrador: olha `contract.googleDocId` e renderiza `GoogleDocsEditor.tsx` (iframe Drive) OU `ContractEditor.tsx` (TipTap legacy). Header, banners, painéis (Comments/Suggestions/Versions/ChangeLog), Chat IA e ExportDialog são compartilhados — funcionam em ambos os modos.

**GDocs mode** (commit `5108961d`+):
- Iframe `https://docs.google.com/document/d/{id}/edit?embedded=true&rm=embedded`. Read-only via `/preview` quando `status=aprovado`.
- Botão "Compartilhar" no header monta `ShareDialog.tsx` que consome `GET/POST/DELETE /api/contracts/[id]/share` (Drive permissions API via owner OAuth). Adicionar email/role (writer/commenter/reader)/mensagem; lista pessoas com acesso; remoção individual. Funções em `lib/google/docs.ts`: `listDocPermissions` (filtra SA + GOOGLE_OWNER_EMAIL), `addDocPermission`, `removeDocPermission`. Bloqueia POST em contrato aprovado (só leitura existente sobrevive).
- Tools de edição em `lib/ai/google-tool-handlers.ts` (googleEditSection/InsertClause/RemoveClause/ApplyStylePreset/InsertImage/AddComment/ProposeSuggestion) usam helper `safeGoogleCall` — exceções da Drive/Docs API viram `{error, googleApiError:true}` em vez de derrubar o /chat com 500.
- Em GDocs, `propose_suggestion` é o DEFAULT do agente IA mesmo para verbos imperativos ("altere", "mude"). Pra forçar edição direta o usuário precisa dizer "aplique direto" / "faça já" / "sem revisão" (regex `FORCE_DIRECT_EDIT` em `agent.ts`). Razão: iframe Drive não permite undo do que a SA fez via API.
- Sem BubbleMenu / SearchReplace / FormatPainter — usuário usa as features nativas do Google Docs.
- Auto-save desligado (doc é fonte de verdade).
- Watch Drive em `/api/webhooks/google-drive` popula `ContractChangeLog` quando o usuário edita no iframe.
- `SuggestionsToolbar` monta acima do iframe quando há `ContractSuggestion` pending; aceitar/rejeitar via `PATCH /suggestions/[id]` aplica `replaceAllText`/`deleteContentRange`/`insertText` no doc.
- `CommentsPanel` mostra botão "+ Novo comentário" no header em GDocs; abre `AddCommentDialog` com prop `requireSelectedTextInput=true` (usuário cola/digita o trecho-âncora). POST `/comments` valida via `createAnchoredComment` no Drive — retorna 422 se trecho não existir (anti-fantasma).
- Banner amarelo `CloudOff` aparece quando `googleDocStatus.startsWith("error:")` — mostra causa truncada (240 chars) e indica fallback offline.
- Refresh da `SuggestionsToolbar` após chat IA: `ChatPanel.onChatTurnComplete` bumpa `commentsVersion` (key da toolbar). Antes precisava F5.

**TipTap (legacy):** `src/components/contracts/ContractEditor.tsx` com StarterKit v3 + Table resizable + Highlight + TextAlign + CharacterCount + Typography + TextStyle/Color/FontFamily + Image. BubbleMenu flutuante na seleção (Bold, Italic, Link, Highlight, Comentar, IA). Só monta em contratos sem `googleDocId` (criação anterior à migração ou falha em `createDocFromTemplate`).

Extensões customizadas em `src/lib/editor/`:
- `SearchReplace.ts` — Find/Replace via ProseMirror Decorations (Ctrl+F)
- `CommentMark.ts` — `<span data-comment-id>` com classe `comment-anchor`
- `SuggestionMark.ts` — `<ins>`/`<del>` com `{suggestionId, type, authorType}` pra track changes
- `PageBreakNode.ts` — quebra de página manual (Ctrl+Enter)
- `FontSize.ts` — atributo 8-72pt (Ctrl+Shift+. / ,)
- `LineHeight.ts` — atributo em paragraph/heading
- `TextTransform.ts` — destrutivo (upper/lower/title/sentence)
- `FormatPainter.ts` — copia/cola marks (Ctrl+Alt+C / V)

`ContractEditor` expõe handle via `forwardRef`: `applyCommentMark`, `applyCommentMarkByText` (usa `doc.descendants` pra ancorar IA sem seleção), `removeCommentMark`, `scrollToComment`, `focus`, `getHTML`, `getEditor`. Prop `onReady(editor)` chamada uma vez quando TipTap fica disponível.

Wrapper visual A4 em `globals.css`: `.a4-page { width: 794px; min-height: 1123px }`. Spellcheck PT-BR via `spellcheck="true" lang="pt-BR"`.

Z-index: `[data-radix-popper-content-wrapper] { z-index: 100 !important }` em `globals.css` faz dropdowns flutuarem acima da toolbar sticky.

## Comentários e track changes

Models: `ContractComment { authorType, severity: info|warning|error, anchorId, selectedText, parentId, dedupeKey }` e `ContractSuggestion { type: insertion|deletion|replacement, suggestionId, status: pending|accepted|rejected }`.

Endpoints: `GET/POST /api/contracts/[id]/comments`, `PATCH/DELETE/POST [...]/[commentId]`, `GET/POST /api/contracts/[id]/suggestions`, `PATCH/DELETE [...]/[suggestionId]`.

UI: `CommentsPanel.tsx` (Sheet lateral; CTA "+ Novo comentário" só em GDocs), `AddCommentDialog.tsx` (textarea de trecho editável quando `requireSelectedTextInput`), `SuggestionsToolbar.tsx` (barra âmbar com aceitar/rejeitar tudo + lista expansível com diff `originalText`/`newText`; aceita `mode="google_docs"` que faz accept via API sem editor).

Em GDocs, `add_comment` e `propose_suggestion` espelham no Drive Comments API via `googleAddComment` / `googleProposeSuggestion`. PATCH `/suggestions/[id]` em GDocs aplica a mudança no doc real (replaceAllText/insertText/deleteContentRange) e chama `resolveComment` pra fechar o thread espelhado. `googleProposeSuggestion` envolve `createAnchoredComment` em try/catch e retorna `{error}` em vez de throw — sem isso o agente derrubava o /chat com 500 quando o trecho-âncora não existia (commit `f8755984`).

## Etapa 0 — Upload + OCR de documentos

Form público (`/f/[token]`) começa em **Etapa 0 - Documentos** (8 etapas total, etapa 0 opcional). `STEP_LABELS` em `lib/forms/validation.ts`.

`components/forms/steps/DocumentosStep.tsx`: dropzone aceita JPG/PNG/WebP/GIF + PDFs até 10MB, max 15 arquivos. Resize client-side via `createImageBitmap` pra max 2000px (PDFs vão direto pro Gemini sem rasterizar). Pipeline: upload → OCR → atribuição → "Aplicar aos campos" preenche RHF respeitando `skipIfDirty`.

**OCR engine** (`lib/ai/ocr.ts::classifyAndExtract`): **uma única chamada Gemini 2.5 Flash** via `@google/genai`. Retorna `{tipo, campos, confidence}` em JSON combinado. Suporta imagens E PDFs nativos sem branching. Modelo override: env `GEMINI_OCR_MODEL`. Categorias: `rg | cpf | cnh | matricula | iptu | escritura | procuracao | comprovante_residencia | outro`.

**Custo estimado:** Gemini 2.5 Flash ~$0.30/MT input + $2.50/MT output ≈ **$0.01/form** (8 docs). 58% mais barato que Haiku 4.5.

Mapeamento `lib/forms/extracted-to-form.ts::mapExtractedToForm` chama `form.setValue` por campo; `suggestAssignment` matcha por CPF/nome (sem fallback "primeira pessoa = vendedor[0]" — docs sem match ficam `kind: "outro"`).

Persistência no Deal: ao finalize do form, `PATCH /api/forms/[token]/route.ts` copia FormAttachments → DealAttachments com extractedData inteiro (incluindo `assignment`). DealDetail tem aba "Documentos" que rematcheia atribuição contra vendedores/compradores finais.

`extract_document_data` (tool do agente do chat do editor) ainda usa **Anthropic Claude legacy**. Switch pra Gemini é isolado ao fluxo de upload do form.

## RAG — Base de conhecimento

`KnowledgeItem { id, orgId, category, title, content, chunkIndex, chunkTotal, parentId, tags, source, embedding vector(1024) }`. Embedding criado via migration SQL raw (Prisma não tem tipo `vector` nativo). HNSW index com `vector_cosine_ops`. Categorias: `legislation | model | rule | glossary`.

`src/lib/ai/embeddings.ts::embed/embedOne` chama Voyage `law-2`. `inputType` aceita `"document"` (indexação) ou `"query"` (busca). `isEmbeddingsConfigured()` retorna false se VOYAGE_API_KEY ausente.

Chunking ~800 tokens com overlap 100 (`src/lib/ai/chunking.ts`). Tool `query_knowledge_base` usa `$queryRawUnsafe` com operador `<=>`. Sem Voyage, fallback ILIKE.

UI `/settings/knowledge-base` com 5 tabs, filtro, "Testar RAG" mostrando similarity score. Upload PDF/DOCX roda OCR Gemini + chunking + embedding em background.

## Aprendizado (ContractMemory) e modo Propose

Hook fire-and-forget em `POST /api/contracts/[id]/approve` chama `createContractMemory(contractId)`. Salva summary (Haiku), dataFingerprint (modalidade, estado civil, faixa de valor), acceptedSuggestions, rejectedSuggestions, manualEdits, embedding. Incrementa `Clause.usageCount`.

Tool `find_similar_contracts` busca top-3 por embedding (Voyage) ou fingerprint (fallback). O agente cita "Em 3 contratos similares na sua organização, você costuma usar X".

**Modo Propose:**
- `ClauseProposal` → UI `/clauses/proposals`. Aprovar cria `Clause { source: "ai_proposal" }`.
- `TemplateSuggestion { diffHunks, evidence }` → UI `/templates/[id]/suggestions` com diff verde/vermelho. Aprovar aplica hunks e incrementa `templateVersion`. Hunks são revalidados (`before` ainda existe?) antes de aplicar.

## Design System (DocumentStyle)

Schema: `DocumentStyle { fontFamily, fontSizeBase, lineHeight, marginTopMm/Bottom/Left/Right, colorPrimary, colorAccent, headerHtml, footerHtml, pageNumbers, includeToc }`. UI `/settings/document-styles` com preview ao vivo.

Aplicação no export: `apps/web/src/app/api/contracts/[id]/export/route.ts` carrega o preset default da org e passa pra `exportPdf` em `lib/render/exporter.ts`. Puppeteer aplica `margin`, `headerTemplate`, `footerTemplate`, `displayHeaderFooter`. `<span class="pageNumber">/<span class="totalPages">` no footer default.

Sumário: `TableOfContents.tsx` lê `editor.state.doc` coletando headings.

## Certidões (Infosimples)

Disparo manual no Deal detail → aba "Certidões". Pipeline: client gera `batchId` UUID → `POST /api/deals/:id/certidoes` retorna 202 em <500ms e dispara `runBatch(batchId)` fire-and-forget → executor usa `pLimit(5)` com `Promise.allSettled` → cada job chama `callInfosimples(endpoint, args)`, normaliza, baixa PDF de `site_receipts[0]`, cria `DealAttachment { source: "infosimples" }` → client polla `GET /api/deals/:id/certidoes?batchId=...` cada 2s.

**Two-step portals (TJSP/TJRJ):** `pedido-*` retorna 200 → job vira `awaiting_portal` com `expectedReadyAt = now+1h (TJSP) / +24h (TJRJ)` → cron `/api/cron/certidoes/poll-portal` em `vercel.json` (`*/5min`) sweeps com `expectedReadyAt < now` e chama `obter-*`. `MAX_AGE = 14 dias` → `failed: "Timeout portal"`.

**Schema:** `CertidaoJob { dealId, batchId, endpoint, label, targetKind, targetIndex, requestPayload, status, resultCode, resultData, attachmentId, errorMessage, latencyMs, costCents, expectedReadyAt, retryCount, nextRetryAt, maxRetries (default 3), missingFields[], portalUrl }`. `DealAttachment.source = "manual" | "form_copy" | "infosimples"`.

**Estados semânticos** (`status` do CertidaoJob, classificados em `lib/certidoes/outcome-classifier.ts::classifyOutcome`):

| Status | Causa | Comportamento |
|---|---|---|
| `success` | code 200 + PDF anexado (categorias civel/trabalhista/fiscal/protesto/municipal/federal) | Verde, anexo no Deal |
| `informativo` | category `cadastro` ou `fgts` com code 200 | Label "Consulta informativa (não é certidão)" |
| `api_error` | 5xx/timeout Infosimples | Retry auto **30s/2min/10min** |
| `portal_unavailable` | code 615/665/666 | Retry auto **10min/30min/2h** |
| `rate_limited` | code 668 | Retry auto **30min/1h** |
| `data_missing` | code 606/612/613 | **Não retry** · destacar `missingFields[]` · CTA âmbar "Completar campos" |
| `data_invalid` | code 614 | **Não retry** · abrir EditPartyDialog |
| `failed_permanent` | retries esgotados ou code 602 (deprecated) | CTA "Abrir portal oficial" via `portalUrl` |
| `skipped` | dados faltando pré-dispatch | Card com `externalLink` se aplicável |

**Planner** (`lib/certidoes/planner.ts`) percorre vendedores/compradores/imóveis. Campos faltando geram `SkippedJob { reason, missingField }`. PF sem `data_nascimento` bloqueia PGFN/TJSP/Antecedentes PF. Imóvel SP sem `sql` bloqueia IPTU SP. RJ sem `inscricao_municipal` bloqueia ambos IPTU RJ. Comarca TJRJ via `lib/certidoes/comarcas-rj.ts` (fallback "Capital").

**Endpoints cobertos:** Federais (PGFN/CND PF+PJ, CNDT, TRF cert-unificada), trabalhistas regionais (TRT2/TRT15/TRT1/TRT4 CEAT), cíveis estaduais (TJSP 2-step, TJRJ 2-step até 8d úteis, TJRS 5 chamadas — civel/familia/falencia/exec patrimonial/exec fiscal), protestos SP (CENPROT — pede `uf: "SP"` no payload), municipais (IPTU SP via SQL, IPTU+CND RJ via inscricao_municipal). Receita CPF + Antecedentes PF (financiamento) entram automaticamente. CCIR/Matrícula ONR só via picker manual.

**Catálogo de endpoints** (`endpoints.ts`): `category`, `emitsPdf?`, `portalUrl?`, `expectedWaitMinutes?`. `CATEGORIES_REQUIRING_PDF` exportado.

**Normalizers** (`lib/certidoes/normalizers.ts`): 1 extractor por endpoint. **Fallback chains** de nomes de campo (ex: cndt tenta `normalizado_validade → validade → data_validade`). Codes 6xx geralmente viram `nao_emitida` (resultado válido, não erro). Testes vitest em `__tests__/normalizers.test.ts` + `planner.test.ts` (34 casos) com fixtures sanitizadas em `__fixtures__/`.

**Budget guard:** env `INFOSIMPLES_MONTHLY_BUDGET_CENTS` (default 5000 = R$ 50,00). `getMonthlySpend()` soma `CertidaoJob.costCents` do mês. POST retorna 402 se estouraria.

**Anti-falso-negativo:** executor força `status: "failed"` quando categoria `civel|trabalhista|fiscal|protesto|municipal|federal` retorna sem `site_receipts[0]` — independente de code/billable/situacao. Garante que card verde sempre tem PDF de lastro.

**Billing honesto:** executor respeita `resp.header.billable === false` (não cobra) e força `failed` quando `nao_emitida` sem anexo.

**Relatório PDF:** `POST /api/deals/:id/certidoes/report` renderiza `templates/relatorio_certidoes.hbs` via Handlebars+Puppeteer. Salva como `DealAttachment { category: "relatorio_certidoes" }`.

**Dashboard de qualidade:** `/settings/certidoes` mostra gasto/budget, taxa de sucesso, p50/p95 latência por endpoint, últimos erros.

**Gaps remanescentes** (Phase L+, ainda não cobertos): CNIB (indisponibilidade), ITR, TJMG/TJPR/TJES cível — só via `portalUrl` manual. Imóvel rural (CCIR) e Matrícula ONR estão no catálogo mas só disparam via picker. Casos especiais do Mapeamento_Certidoes seção 12 (estrangeiro, espólio, menor, divórcio, falência) → escopo futuro com flags condicionais no form.

## Pagadoria (módulo financeiro Asaas)

Documentação consolidada em [docs/pagadoria-handoff.md](docs/pagadoria-handoff.md) — sempre consultar antes de mexer.

Fases entregues:
- **1a Security:** RBAC (`CustomRole` + `PERMISSION.*`), 2FA, SessionElevation, TrustedDevice, AuditLog
- **1b Asaas + KYC:** `AsaasAccount` (apiKey AES-256-GCM + walletId + 4 status fields), upload docs multipart, `CommissionCharge` com status canônico (PENDING/RECEIVED/OVERDUE...), idempotência via `AsaasWebhookEvent.asaasEventId`
- **2 `/financeiro` + `/pay`:** dashboard KPIs, taxas configuráveis (`OrgFinancialSettings.finePercent/interestPercentMonth` com limites CDC), branding por org, página pública `/pay/[token]` com PII mascarada
- **3 Transferências + dual approval + conciliação + relatórios:** `AsaasTransfer` com preview de taxas + dual approval > `dualApprovalCapCents`, `BankReconciliation` auto-match via `externalReference`, 4 relatórios (recebíveis/aging/cashflow/inadimplentes)
- **4 Polish:** notif bell, devices UI, platform fee (`platformFeePercent` + `platformFeeWalletId`)
- **5 Split multi-recipient:** `SplitRecipient { orgId, label, walletId, active }`, CRUD em `/settings/pagamentos/split-recipients`. `composeSplits()` valida max 10 entries, sem duplicatas, sem wallet própria, soma `percentualValue ≤ 100`. Persistido em `CommissionCharge.splitJson`. 13 unit tests em `__tests__/commission-splits.test.ts`.

**QA infra:** preflight `GET /api/admin/preflight-qa` (30+ checks). Setup automatizado [apps/web/scripts/setup-pagadoria-qa.ts](apps/web/scripts/setup-pagadoria-qa.ts).

**Sandbox helpers:** `lib/asaas/sandbox.ts::approveSandboxAccount` força os 4 status pra APPROVED via `POST /v3/sandbox/myAccount/approve`. **Guard interno rejeita se `ASAAS_ENV=production`**.

**Webhook URL canônica:** `https://imobpro.ia.br/api/webhooks/asaas` (id `3bd623b8-ed2e-45d4-b201-648f46ee404b`).

## Observabilidade de IA (AIUsage)

Tabela `AIUsage` registra cada chamada IA: tokens, custo USD, latência, provider (anthropic/gemini/voyage), model, operation (`chat | passive_open | passive_edit | ocr_form | ocr_tool | embed_kb | embed_memory | embed_query | summarize_memory | clause_generate`), `toolsUsed[]`, `iterations`, sucesso/erro.

**Helper** `src/lib/ai/usage.ts`:
- `PRICING` — tabela hardcoded de 8 modelos (Claude Opus/Sonnet/Haiku, Gemini 2.5 Flash/Lite/2.0, Voyage law-2/v3). **Atualizar manual quando preços mudarem** (anthropic.com/pricing, ai.google.dev/pricing, voyageai.com/pricing). Última revisão: 2026-04-14.
- `calcCostUsd(model, prompt, completion, cacheRead, cacheWrite)` — modelo desconhecido retorna 0 silenciosamente.
- `recordAIUsage(params)` — fire-and-forget, nunca lança exceção, error message truncado em 500 chars.

Agente agrega tokens das N iterações em 1 record com `iterations=N` e `toolsUsed` deduplicado via Set.

**Dashboard:** `/settings/ai-usage` (`AIUsageClient.tsx`) — 4 KPI cards, line chart SVG inline, bar rows CSS, top 10 users/contratos. Filtros: 7d/30d/mês atual/anterior. API: `GET /api/ai-usage?from=YYYY-MM-DD&to=YYYY-MM-DD`.

## Aprovação de contrato

`POST /api/contracts/[id]/approve` valida + conta `ContractSuggestion` pendentes + `ContractComment` não-resolvidos (severity error). Se issues, retorna `{requiresReview, canForce, errorCount, warningCount, ...}`. Frontend abre `ApprovalReviewDialog` com botões "Revisar" / "Aprovar mesmo assim" (oculto se `canForce=false` por errors). Segunda chamada com `{force: true}` aprova.

Após aprovar, **contrato fica imutável**: chat/edição/comentários/versionamento bloqueados; API retorna 403 em POSTs.

## Fluxo principal

1. Form público `/f/{token}` (auto-save). **Etapa 0:** anexa docs (RG/CPF/CNH/matrícula/IPTU/comprovante) → OCR autopreenche.
2. Cria deal a partir do form → docs copiados pra `DealAttachments` agrupados por parte/imóvel.
3. "Confeccionar Contrato" → auto-detecta modalidade → renderiza template v2.
4. Edita no TipTap ou via chat IA. BubbleMenu, Find/Replace (Ctrl+F), Page Break (Ctrl+Enter). Análise passiva on-open + on-edit popula comentários laterais. Sugestões IA entram como track changes.
5. (Opcional) Aba "Certidões" → `ExtractCertidoesDialog` mostra plano + custo → batch fire-and-forget. "Gerar relatório" produz PDF de due diligence.
6. "Aprovar" → revisão pré-aprovação. Após aprovado, `createContractMemory` roda em background.
7. Export PDF/DOCX (com `DocumentStyle` default aplicado).

## Rotas públicas (sem auth)

- `/f/[token]` (form de vendas)
- `/api/forms/[token]` (auto-save) e subrotas attachments
- `/pay/[token]` (página de pagamento Asaas)
- `/login`, `/register`, `/forgot-password`, `/reset-password`
- `/logout` (faz cleanup completo: revoga elevation cookie, deleta DB sessions, audit log)
- `/privacy`, `/terms` (LGPD compliance)

## Export PDF/DOCX

**Chromium serverless:** `src/lib/render/exporter.ts::launchBrowser()` detecta env via `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME` e usa `@sparticuz/chromium` + `puppeteer-core`. Local: procura Chrome do sistema. **Sem fallback pra `puppeteer` full** (tenta baixar Chrome em runtime → quebra em serverless read-only).

`next.config.js::serverComponentsExternalPackages` inclui `@sparticuz/chromium` + `puppeteer-core` — Next.js deixa como `require` runtime em vez de bundlar.

**PDF margins:** Puppeteer é única fonte de verdade — defaults 30/25/35/25mm (esquerda maior pra encadernação). `wrapWithStyle()` NÃO injeta `@page { margin }` (briga com `page.pdf({ margin })`).

**DOCX preprocessing:** `html-to-docx` ignora CSS de classes. `htmlForDocx(html, style)` injeta estilos inline via regex (negative-lookahead pra evitar duplicação). Cover page achatada em paragrafos centralizados com `page-break-before: always`. `<hr>` vira `<p>— — —</p>`. **Limitações conhecidas:** drop cap, ornamentos SVG, marca d'água "MINUTA" e ligaturas não traduzem pra OOXML — perdidos na conversão. PDF preserva tudo.

**Storage dos exports** (`/api/contracts/[id]/export`): prioridade `BLOB_READ_WRITE_TOKEN` (Vercel Blob, URL pública direta, overwrite mesmo path) → `S3_BUCKET` → local `public/exports/` (só dev). Em serverless sem nenhum dos dois → erro explícito em PT-BR.

Puppeteer requer Vercel Pro (timeout 60s). CSS `@media print` em `globals.css` garante page breaks manuais no PDF.

## Alertas (gotchas)

- **Env vars Vercel:** sempre `printf '%s' 'value' | vercel env add NAME ENV` (single quotes, sem `\n`). `echo ... | vercel env add` insere `\n` literal e corrompe runtime (incidente 2026-04-20 bloqueou 2FA + Prisma + NextAuth). `vercel env pull` mostra `\n` escapado, mascarando a corrupção.
- **Logout completo:** sidebar usa `<Link href="/logout">` (não `signOut()` direto). A página `/logout` faz `POST /api/auth/logout` (revoga elevation, deleta sessions, audit) + `signOut`. `signOut()` direto deixa cookies persistentes (elevation, TrustedDevice).
- **Radix DropdownMenu + asChild:** `<DropdownMenuTrigger asChild>` envolvendo function component sem forwardRef formal pode falhar em recalcular position (popper fica em `translate(0, -200%)` offscreen). Dropdowns com side="top" no SidebarMenuButton têm esse bug — usar links diretos no footer.
- **Handlebars helpers em `src/lib/render/handlebars.ts`** são aditivos. Não alterar helpers existentes (quebra contratos antigos).
- **Marks customizadas (`CommentMark`, `SuggestionMark`)** persistem como HTML. Re-render do Handlebars sobrescreve — não regenerar editor a partir do template depois de edições.
- **`ContractEditor.tsx`**: preservar `forwardRef<ContractEditorHandle>` e prop `onReady(editor)`. `ContractEditorPage` depende disso pra `useAutoAnalyze` e ancoragem de comments IA — só em modo TipTap (sem `googleDocId`).
- **Watermark `[[WATERMARK_MINUTA]]`** vivia no topo dos templates GDocs com fontSize 96pt italic centro. `approve/route.ts` agora deleta o paragraph block inteiro via `deleteContentRange` (antes só fazia `replaceAllText` deixando o paragraph vazio com fontSize 96 — espaço gigante no topo do contrato aprovado). Para limpar contratos antigos: `apps/web/scripts/strip-watermark.ts --docId=<id>` (heurística: paragraph nos primeiros 3 blocks com fontSize≥48 + texto whitespace; aceita qualquer alignment). Templates atuais já estão limpos.
- **Contratos aprovados são imutáveis.** API retorna 403 em POSTs.
- **Templates e biblioteca de cláusulas:** agente NUNCA edita direto. Sempre via `propose_template_change` / `propose_new_clause` (revisão humana).
- **pgvector** exige Neon Standard+. Prisma não tem tipo `vector` — inserts/updates via `$executeRawUnsafe`, queries via `$queryRawUnsafe` com operador `<=>`.
- **`VOYAGE_API_KEY` opcional:** sem ele, `query_knowledge_base` e `find_similar_contracts` caem em fallback keyword/fingerprint. Não é erro.
- **Análise passiva** envia `htmlContent` atual no body — server usa `params.htmlOverride` em vez do DB pra ver estado live.
- **Custo do passive analysis controlado** (incidente cmons9hbh: 942 comments / $10 USD num só doc): `dedupeKey = authorType + category + selectedText` (não inclui phrasing da LLM); cap de 50 unresolved AI comments por contrato em `runPassiveAnalysis`; skip-no-change baseado em `ContractChangeLog` (se última validation foi após última edição → pula LLM); `max_tokens` 1024 + analysisInput 8000 chars; prompt limita 3 findings/run. Cleanup de duplicatas históricas: `apps/web/scripts/cleanup-stale-ai-comments.ts --apply --contractId=<id>`.
- **Upload de imagens** em `/api/contracts/[id]/images`: 5MB max, `ALLOWED_TYPES = [image/jpeg, image/png, image/webp]`. Requer `BLOB_READ_WRITE_TOKEN`.
- **Certidões Infosimples são pagas:** ~R$ 0,04-0,06 por chamada. `code 603` "saldo insuficiente" vira `nao_emitida` (resultado válido). Sempre disparadas manualmente — sem auto-extract no finalize do form.
- **Cron certidões:** Vercel Pro obrigatório. Sem ele, jobs `awaiting_portal` ficam eternos. Schedule `*/5min` em `vercel.json` cobre retry curto + portal poll.
- **Anti-falso-negativo certidões:** categoria `civel|trabalhista|fiscal|protesto|municipal|federal` sem `site_receipts[0]` é sempre `failed`, ignorando code/billable. Garante que cards verdes têm PDF de lastro.
- **Normalizers de certidões são frágeis:** Infosimples muda nomes de campo. Após primeira extração real em prod, salvar `resultData` real como fixture novo + teste de regressão.
- **IPTU Porto Alegre** sem cobertura Infosimples — `SkippedJob` com `reason: "sem cobertura, extrair manualmente"`.
- **Asaas sandbox rejeita docs de identidade** (RG/CNH/selfie) via API — usar `approveSandboxAccount` (guard interno: rejeita em production).
- **Asaas split** rejeita wallet da própria org (remanescente cai automaticamente nela). Rejeita duplicatas. Max 10 entries. **`platformFeePercent` só gera split se `platformFeeWalletId` configurado** — gap antigo com null no Zod schema do PATCH foi corrigido em Fase 5.
- **Asaas `bankAccountInfo=PENDING`** não bloqueia recebimento real. Usar `general=APPROVED` como gate (incidente 2026-04-27: API reportava PENDING mas pagamento real creditou normalmente).
- **Forms públicos não requerem auth** — qualquer um com o link pode editar.
- **`@tiptap/extension-search-and-replace` NÃO existe** no registro oficial. Custom em `lib/editor/SearchReplace.ts`.
- **Prisma migrations** rodam automaticamente via `prisma migrate deploy` no build script.
- **Deal NÃO tem `orgId` direto** — escopo via `pipeline.orgId`. `Contract` idem (via `deal.pipeline.orgId`). Cuidado em queries por org de `Deal`/`Contract`.

## Convenções específicas

- Idioma: código em inglês, UI em português brasileiro.
- Commits em português, mas keywords técnicos podem ficar em inglês.
- Migrations sempre via Prisma migrate (apps/web/prisma/migrations).
- pgvector em migrations SQL raw (não há equivalente Prisma).
- Mudanças aditivas em `DadosContrato` — campos opcionais novos OK, breaking não.
