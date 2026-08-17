# Contractmaker — Claude Code Context

## Visão geral

Plataforma de gestão de vendas e contratos imobiliários. Esteira: Lead/form público → Kanban → contrato (template **ou** upload) → editor Google Docs embedado → assinatura ClickSign → PDF assinado de volta na pasta. Pagadoria integrada com Asaas. Due diligence via Infosimples.

**Produção:** [imobpro.ia.br](https://imobpro.ia.br) (custom domain registro.br, Vercel `prj_tkIfHl9chuVwZkNtHLAl5QXY2YOB`).

**Staging:** [staging.imobpro.ia.br](https://staging.imobpro.ia.br) (Vercel `contractmaker-staging`, branch+Neon `staging`). Flag `STAGING_MODE=true` ativa gates (crons OFF, Asaas sandbox, ClickSign cap, Resend→owner). Workflow: feature → `staging` → smoke → PR pra `master` (label `staging-smoke-passed`). Detalhes em [docs/staging-workflow.md](docs/staging-workflow.md).

**Single-tenant compartilhado:** `SHARED_ORG_ID=cmnt1ldo4000111bw4yo517k0`. Signup novo via `/api/auth/register` → `OrgMembership { role: "member" }`. Olavo (`olavo.piton@gmail.com`) e `admin@contractmaker.com` são owners. Schema continua multitenant.

## Roteamento — invoque a skill antes de mexer

Este arquivo é um índice. O detalhe de cada módulo vive em skills que carregam sob demanda (`.claude/skills/`, versionadas no git).

| Se o assunto é… | Invoque |
|---|---|
| Agente IA, tools, chat, prompts, RAG/pgvector, KnowledgeItem, cláusulas, AIUsage, auto-analyze, budget de tokens | `agente-ia` |
| Editor GDocs, iframe Drive, comentários/suggestions, templates `.hbs`, sync-templates, DocumentStyle, export PDF/DOCX, import de CCV | `editor-gdocs` |
| Envelope, signatário, testemunha, ClickSign, `/approve`, PDF assinado | `assinatura-clicksign` |
| Cobrança, comissão, split, repasse, Asaas, `/financeiro`, KYC, wizard | `pagadoria-asaas` |
| Infosimples, Serasa, CertidaoJob, ONR, CENPROT, aba Certidões | `certidoes` |
| Pipeline/deal/form de venda, gating por `kind` | `modulo-vendas` |
| Locação: ADM, contratos, cobranças, vistorias, seguros | `modulo-locacao` |
| Módulos habilitáveis por tenant, entitlements | `multitenant-entitlements` |
| `/admin/*`, PlatformRole, impersonation | `painel-admin` |
| Model/campo novo, migration, backfill | `schema-migrations-prisma` |

Grafo do código em `graphify-out/` (AST local, 0 tokens): `graphify explain "<símbolo>"` e `graphify path "<A>" "<B>"` antes de varrer arquivos.

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
- **CLAUDE.md ≤ 16k char** (validado por `apps/web/scripts/check-claude-md-size.mjs` via hook PostToolUse). Estourar = mover detalhe pra uma skill em `.claude/skills/`, `MEMORY.md` ou `docs/`

## Pontos de entrada do deal

`/pipeline` → dropdown "Novo negócio":

1. **Novo formulário (link público)** → `/forms/new` cria SalesForm + Deal vazio → token `/f/[token]` pro cliente preencher → finalize dispara `generateContractForDeal`
2. **Cadastro rápido com upload** → `/deals/new-from-upload`: corretor sobe CCV pronto (PDF/DOCX, ≤20MB) + stage destino. Pipeline: `uploadFileAsGoogleDoc` (Drive auto-converte) → Gemini extrai `DadosContrato` parcial → cria SalesForm `vinculado` + Deal + Contract `templateId=null` + DealAttachment `category=contrato_original, source=upload`. Editor abre direto

Contrato importado: `template === null`, UI "Contrato importado", aba Dados ganha "Re-extrair dados".

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
- `POST .../mark-lost` — Zod `{ reason, category? }` (`desistencia|imovel_vendido|financiamento_negado|outro`). Bloqueia terminal
- `POST .../reopen` — sai de Lost, restaura stage via `AuditLog DEAL_STAGE_CHANGE { kind:"lost", previousStageId }`; fallback "Confecção de Contrato"
- `mark-signed` (legado Newton) → "Comissão paga"; aceita os 3 stages intermediários

## DadosContrato

TS: vendedores, compradores, imóveis, pagamento, comissão, config. Mudanças aditivas só. Fontes: form público (7 etapas) ou OCR de CCV via Gemini. `modalidade: "a_vista" | "financiamento"` decide o template.

## Etapa 0 form público — Upload + OCR

`/f/[token]` 7 etapas (etapa 0 opcional pra docs). Etapa 7 = **Comissão + Testemunhas + Observações gerais** (texto livre; vai pro resumo e é lido pela IA como DADO cercado em `<observacoes_form>`, nunca instrução — o form é anônimo). Configurações contratuais saíram daqui → aba Configurações do contrato. `DocumentosStep.tsx`: dropzone imagens+PDF ≤10MB, resize client 1500px. **OCR on-demand:** upload NÃO enfileira (`awaiting_user`); extração só via botão "Extrair com IA" → `/retry`; cache SHA-256/org → `ready`. Map server→card: `lib/forms/attachment-status.ts`. **OCR** (`lib/ai/ocr.ts::classifyAndExtract`): Gemini 2.5 Flash retorna `{tipo, campos, confidence}`, aceita imagem+PDF. Categorias: `rg|cpf|cnh|matricula|iptu|escritura|procuracao|comprovante_residencia|certidao_casamento|ficha_resumo|outro`. ~$0.01/form. `mapExtractedToForm` respeita `skipIfDirty`; `suggestAssignment` matcha CPF/nome. Finalize copia FormAttachments → DealAttachments com `extractedData`.

## Mecanismos de delete (4 níveis — memória `project_delete_mechanisms`)

Todos com auth + cross-org guard via `deal.pipeline.orgId` + audit + bloqueio quando há `Envelope closed/running` (409). GDocs vão pra lixeira do Drive.

- `DELETE /api/contracts/[id]` — versão específica (cascata Clause/Comment/Suggestion/ChangeLog/ChatSession/Envelope; promove próxima se `isLatest`; bloqueia aprovado)
- `DELETE /api/pipeline/deals/[dealId]/contracts` — todas Contract rows (mantém Deal+SalesForm)
- `DELETE /api/deals/[dealId]/attachments/[attachmentId]` — anexo individual (`CertidaoJob.attachmentId` vira null)
- `DELETE /api/pipeline/deals/[dealId]` — Deal completo (cascata CertidaoJob → Attachment → Contract → Deal). SalesForm via `?deleteForm=true`

## Rotas públicas (sem auth)

- `/f/[token]` (form vendas) + `/api/forms/[token]` (auto-save) e subrotas attachments
- `/pay/[token]` (Asaas) · `/financeiro/completar-cadastro?token=` (split recipient magic link)
- `/login`, `/register`, `/forgot-password`, `/reset-password`, `/logout` (cleanup completo)
- `/privacy`, `/terms` (LGPD) · `/api/webhooks/{asaas,clicksign,google-drive}` (HMAC validado)

## Locação

Módulo de aluguéis aditivo sobre vendas — jornada de geração em paridade (dropdown 4 entradas, etapa 0 OCR, links por parte, análise de crédito Serasa em "Em Aprovação", perdido/aging). Detalhes: skills `modulo-locacao`/`modulo-vendas` + [docs/locacao/spec.md](docs/locacao/spec.md). Newton (WhatsApp) ≠ chat in-app.

## Schemas críticos

Não-óbvios (enums e structure: ver `prisma/schema.prisma`):

- **`Contract.templateId` nullable** — null = importado, conteúdo no GDoc. `/render` e `/contract-pdf` erram sem `googleDocId`
- **`Envelope`** XOR: `contractId` ou `attachmentId` (`source: "contract" | "attachment"`)
- **Deal NÃO tem `orgId` direto** — escopo via `pipeline.orgId`. Pra Contract importado usar `deal.pipeline.orgId` (não `template.orgId`)
- **`splitJson`:** `{ splits, external, display? }`. `display` é UI-only — Asaas não vê
- **`comissao.comissionados[]`** canônico com `papel`. Fallback `imobiliaria_*` sintetizado por `deriveComissionados` quando array vazio
- **`SplitRecipient.pendingFields`** não-vazio → `active: false` + `splitDispatcher` skip FAILED. Magic link via `completionToken/Exp` (JWT-HMAC 7d)
- **Multi-account:** `AsaasAccount.orgId` não-@unique (N contas/org). `OrgFinancialSettings.accountId @unique`. `AsaasCustomer @@unique([accountId, cpfCnpj])`. `CommissionCharge.accountId` (FK Restrict) persistido na criação — trocar conta ativa NÃO afeta cobranças emitidas

**Audit actions:** lista canônica em `lib/audit/actions.ts` (prefixos `DEAL_*`/`FORM_*`/`ATTACHMENT_*`/`CONTRACT_*`/`ENVELOPE_*`/`CERTIDAO_*`/`KYC_*`/`CHARGE_*`/`TRANSFER_*`/`CLICKSIGN_*`/`SPLIT_RECIPIENT_*`/`ACCOUNT_*`).

## Gotchas

- **Radix DropdownMenu + asChild** envolvendo function component sem forwardRef pode falhar a recalcular position em `side="top"` — usar links diretos
- **pgvector** exige Neon Standard+. Inserts/queries via `$executeRawUnsafe`/`$queryRawUnsafe` com `<=>`
- **`VOYAGE_API_KEY` opcional:** sem ele, `query_knowledge_base` e `find_similar_contracts` caem em fallback ILIKE/fingerprint
- **Cron certidões** requer Vercel Pro. Sem ele, `awaiting_portal` fica eterno. Schedule `*/5min` em `vercel.json`
- **Prisma migrations** rodam via `prisma migrate deploy` no build. Mudanças em dados (rename, backfills) → migration SQL plain idempotente
- **Auto-promote stage não é retroativo:** webhook ClickSign close OU charge antes da migration = deal fica em stage anterior. Drag-drop manual
- **Split Asaas:** rejeita wallet própria, duplicatas, max 10. Sandbox rejeita docs de identidade via API — usar `approveSandboxAccount`
- **Form público é anônimo até o envio; depois fecha.** Gate em `lib/forms/form-gate.ts`: `completedAt != null && reopenedAt == null` → só membro da org (checa OrgMembership, não só sessão). Discrimina por `completedAt`, NÃO por `status` (deal de import nasce `vinculado` e nunca vira `completo`). Vale pras 2 esteiras (`/api/forms/[token]` e `/api/locacao/forms/[token]`) + subtoken/anexos/from-main. Reabrir: `POST .../lock {locked:false,reopen:true}`. Anexos já vistos seguem acessíveis (URL pública do Blob)
- **Puppeteer** requer Vercel Pro (timeout 60s); sem `BLOB_READ_WRITE_TOKEN`/`S3_BUCKET` em serverless o export erra
- **Operacionais em memória**: ver `MEMORY.md` (OAuth 7d, printf, env pull, Resend sandbox, Handlebars shadowing, timezone, PowerShell)
