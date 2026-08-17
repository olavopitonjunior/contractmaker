---
name: certidoes
description: Due diligence via Infosimples e Serasa — CertidaoJob, batch/planner, two-step de portal (TJSP/TJRJ/ONR), classificação de outcome, budget guard e circuit breaker, anti-falso-negativo, endpoints por UF/município. Use ao mexer em lib/certidoes/*, CertidaoJob, planner.ts, outcome-classifier, endpoints.ts, cron poll-portal, /settings/certidoes, aba Certidões do deal, ou qualquer código Infosimples/Serasa/CENPROT/ONR.
---

# Certidões (Infosimples + Serasa)

Disparo manual no Deal → aba Certidões. `POST /api/deals/:id/certidoes` 202 + dispara `runBatch` fire-and-forget → `pLimit(5)` → cada job: `callInfosimples`, normaliza, baixa PDF de `site_receipts[0]`, cria `DealAttachment { source:"infosimples" }`. Front: `useCertidoesBatch` polla enquanto há job ativo.

**Two-step (TJSP/TJRJ/TJMS/TRF3/ONR):** `pedido-*` 200 → `awaiting_portal` → cron `poll-portal` chama o `obter` via `buildObterArgs` (e-SAJ: `pedido_data` **ISO** — `normalizePedidoData`, senão 607; TRF3 `numero_certidao`+`trim`). `decideObterOutcome`: conta/integração → falha já; transitório → 3×; senão reagenda até `maxPortalWaitMs` (TJSP **7d**, TJRJ 14d) → `failed_permanent`+`portalUrl`. **620 "já existe"** → `recoverOriginalProtocol` (parte+tipo) → `awaiting_portal`; senão `duplicate_pending`.

**Schema:** `CertidaoJob` (campos em `prisma/schema.prisma`) — chaves: `batchId`, `targetKind/targetIndex`, `status`, `resultCode`, `retryCount`/`maxRetries` (3), `missingFields[]`, `portalUrl`.

**Estados** (`outcome-classifier.ts::classifyOutcome`) — `success`/`informativo`/`api_error`/`portal_unavailable`(615/665/666)/`rate_limited`(668)/`data_missing`(606/612/613, `missingFields[]`)/`data_invalid`(614)/`failed_permanent`(esgotado, `portalUrl`)/`duplicate_pending`(620)/`skipped`. Backoffs nas memórias `certidoes_retry_backoffs`, `certidoes_estados_ricos`.

**Anti-falso-negativo:** exige-PDF sem `site_receipts[0]` → `failed`; negativa informativa exige evidência de ausência (600 cru → retry→falha #67); billing respeita `header.billable===false`. Memória `certidoes_falso_negativo`.

**Planner** (`planner.ts`): vendedores/compradores/imóveis + diligenciados (tier **padrao** #66: pré-marcados; comprador segue opcional). PF sem `data_nascimento` bloqueia PGFN/TJSP/Antecedentes.

**Endpoints:** Federais (PGFN/CNDT/TRF), trabalhistas (CEAT), cíveis (TJSP/TJRJ 2-step, TJRS), E-Proc SP, protestos CENPROT (SP + Nacional, GOV.BR). Antecedentes PF auto em financiamento.

**Imóvel (Phase L):** matrícula ONR/ARISP 2-step (`requiresOnrAuth`/`onrActive`, `INFOSIMPLES_ONR_*`, saldo próprio; normalizer expõe ônus), IPTU/CND municipal por `UF|cidade` (`MUNICIPAL_BY_KEY`; SP `sql`/RJ `inscricao` ok, BH `identificador`+datas), CCIR. Renderizam no grupo "Imóvel:". **Curitiba** = CND por contribuinte → pessoa (`MUNICIPAL_PESSOA_BY_KEY`). Ver memória `project_certidoes_onr_imovel`.

**Catálogo** (`endpoints.ts`): `category`/`emitsPdf?`/`portalUrl?`/`CATEGORIES_REQUIRING_PDF`. Normalizers; 6xx→`nao_emitida`.

**Budget guard** `INFOSIMPLES_MONTHLY_BUDGET_CENTS` (5000): POST 402 + o **cron** checa antes de cada chamada + **circuit breaker** (603 → para).

**Problemas + UX:** falha terminal → sino + digest; painel `/settings/certidoes`; aba com régua 3 cores, IA on-demand, ZIP dedupe+`%PDF`. Memória `project_certidoes_overhaul_2026_05`. Mapa por portal: [docs/certidoes-known-issues.md](../../../docs/certidoes-known-issues.md).

**Gaps** (portal manual): CNIB, ITR, TJMG/TJPR/TJES cível, IPTU Vitória/CG.

**Cron:** requer Vercel Pro. Sem ele, `awaiting_portal` fica eterno. Schedule `*/5min` em `vercel.json`.

## Serasa Experian (2026-05)

Segundo provider via `CertidaoJob.provider="serasa"` (5 endpoints PF+PJ + vínculos; gate LGPD por deal `Deal.complianceJson.serasaConsent`). Detalhes em [docs/certidoes-serasa.md](../../../docs/certidoes-serasa.md).
