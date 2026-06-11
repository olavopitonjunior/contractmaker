# Handoff Multitenant → Fase 2 (Observability)

> **Escopo:** ponto de partida pra a PRÓXIMA sessão. Fase 0 (refactor) + Fase 1 (feature) estão **construídas e verificadas contra a Neon staging**. Este doc resume o estado, o que falta fechar (merges + gates externos), e o plano da Fase 2.
> **Data do handoff:** 2026-05-27. **Plano-mãe:** `docs/prd-multitenant-600.md` + `docs/cronograma-multitenant-600.md`. Memória: `project_multitenant_600_prd.md`.

---

## 1. Estado atual

### Fase 0 (refactor foundational) — ✅ MERGEADO em `redesign/fase-b`
- **0a** `PlatformRole`/`PlatformConfig`/`PlatformConfigHistory` + `requirePlatformRole` + `grant-platform-role.ts` + `/api/admin/platform/whoami`.
- **0b** `scopedPrisma(orgId)` (injeta orgId via DMMF; caveats findUnique/relation-scoped → RLS Fase 2) + harness DB-real (`vitest.isolation.config.ts`, `test:isolation`, `tenant-isolation.isolation.test.ts`).
- **0c** `AuditLog.orgId` nullable + webhook ClickSign sem `SHARED_ORG_ID` (6 sites limpos; grep vazio).
- **0d** `lib/payments/` — interface `PaymentProvider` + `AsaasProvider` (delega `lib/asaas`, não move) + factory.
- **infra** CI (`.github/workflows/ci.yml`) + `seed-synthetic-orgs.ts` + docs.

### Fase 1 (feature) — parcialmente mergeado + 2 PRs abertos
- **1a** subdomínio (`Organization.subdomain` + middleware `x-org-subdomain` + `getUserOrg(subdomainHint)`) + `BrandingSettings` (`[data-tenant]` CSS vars) — ✅ **MERGEADO** em redesign.
- **1d** Asaas subcontas-filhas (`AsaasAccount.parentAccountId`) + markup GLOBAL (`resolvePlatformFee` = PlatformConfig + override per-org) wired em charges-action/nova/validate — ✅ **MERGEADO** em redesign.
- **1e** painel `/admin/orgs` (list + create org transação + impersonation com cookie + `requireAuth` resolve org impersonada + banner) — 🔵 **PR #45** (base `redesign/fase-b`, OPEN).
- **1f + 1b + 1c** (aditivos) — 🔵 **PR #46** (base `feat/mt-1e-admin-orgs`, **stacked no #45**, OPEN):
  - 1f: `AuditLog` +entityId+impersonatedBy + free-text/filtros + export CSV + view per-user.
  - 1b: `GoogleConnection` + `getDriveClientForOrg`/`getDocsClientForOrg` (**fallback SA global**) + OAuth flow + settings page.
  - 1c: `ClickSignAccount` + `getClickSignForOrg` (**fallback pool global**).

### Infra de teste
- **Neon staging branch:** `staging-mt-fase0` (`br-empty-dust-any32pm0`) no projeto ContractMaker (`wispy-tree-00688100`). Todas as 8 migrations MT aplicadas. Orgs sintéticas `alpha`/`beta` seedadas (subdomains setados). Olavo = `super_admin` (PlatformRole) na staging.
- **`.env.staging`** em `apps/web/` (gitignored) com DATABASE_URL/DIRECT_URL da branch + `SYNTHETIC_SEED_ALLOWED=1`.
- Suíte: **1050 testes verdes**, typecheck limpo (no tip de cada PR).

### Migrations MT (ordem)
`20260525170000_platform_role_config` · `..180000_auditlog_orgid_nullable` · `..190000_org_subdomain_branding` · `20260526120000_asaas_parent_account` · `..130000_tenant_impersonation_session` · `20260527120000_auditlog_entityid_impersonatedby` · `..130000_google_connection` · `..140000_clicksign_account`.

---

## 2. Pré-requisitos pra retomar (fazer no início da próxima sessão)

### Merges (ordem)
1. Revisar + mergear **#45** (1e) → `redesign/fase-b`.
2. **#46** (fase1-close) auto-retargeta pra `redesign/fase-b` após #45 mergear (ou rebase). Revisar + mergear.
   - ⚠️ **Não squash-mergear stacked** de forma que feche o filho como CLOSED (memória `feedback_stacked_pr_squash_closes_dependents`) — usar merge commit.
3. Quando `redesign/fase-b` → `master`, o CI dispara (o `ci.yml` só roda em PR→master).

### Gates externos (disparar JÁ se ainda não — levam semanas; bloqueiam go-live)
- **Google OAuth Consent "In Production"** (~4-6 sem) — destrava o E2E real do 1b (hoje funciona em Testing só pro owner).
- **Acordo comercial ClickSign White Label** (~2-4 sem) — destrava provisionamento WL do 1c.
- **DPO/LGPD review** + DPA template (~1-2 sem).

### E2E de QA (quando os gates andarem)
Criar 2ª org pelo `/admin/orgs` → conectar Google (1b) → enviar contrato → markup no split (1d) → impersonar (1e) → exportar audit (1f). Ver `feedback_e2e_qa`.

---

## 3. Pendências/follow-ups carregados (não-bloqueantes)

| Item | Origem | Nota |
|---|---|---|
| Job `isolation` no `ci.yml` + secret `DATABASE_URL_STAGING` | 0b | CI roda `test:isolation` contra staging |
| Migração incremental dos call-sites Google (`getDriveClient` → `getDriveClientForOrg`) | 1b | hoje aditivo; migrar por contrato/export quando o per-org for default |
| Migração dos call-sites ClickSign pro `getClickSignForOrg` | 1c | idem |
| E2E do markup global antes de configurar fee em prod | 1d | toca cobrança real |
| Edge case: super_admin sem org própria → 400 antes da impersonação | 1e | Olavo tem org, não afeta agora |
| metadata free-text no audit (tsvector/GIN) | 1f | hoje free-text é ILIKE em action/resource/resourceType |
| per-action `impersonatedBy` em TODOS os audits | 1f | coluna existe; populada nos endpoints de impersonação + export; wiring por-ação é follow-up |

---

## 4. Fase 2 — Observability super-admin + Budget enforcement (escopo)

Detalhe completo: `docs/prd-multitenant-600.md` seção "Fase 2.0" + Apêndice C do plano. Resumo:

### Schema novo
- **`AIMessageFeedback`** — feedback de IA híbrido: thumbs inline (`up`/`down`/reason) por `ChatMessage` + survey 1-5★ em milestone (CONTRACT_APPROVED / ENVELOPE_CLOSED / COMMISSION_PAID / 20-turns). FK opcional pra `AIUsage`.
- **`AlertRule`** — `type` (ai_budget_pct/infosimples/whatsapp/error_rate/latency_p95) + threshold + channels + `cooldownMins`.
- **`TenantBillingSnapshot`** — agregação diária por org/mês (aiCostUsd, infosimples, whatsapp, envelope, storage, total).
- **`TenantQuotaPolicy`** (planejado) — `chat_default_model`, `passive_analysis_model`, budgets mensais (ai/infosimples/whatsapp), tier.

### UI super-admin (apex, gated `requirePlatformRole` — reusa o padrão de `/admin/orgs`)
- `/admin/observability` — overview cross-tenant (spend hoje/mês, top 10, erros, latência p95) + drill-down `/admin/tenants/[orgId]/observability`.
- `/admin/quality` — distribution up/down × model/operation + worst-rated + reasons.
- `/admin/alerts` — CRUD de AlertRule.

### Budget enforcement tiered (`lib/quotas/enforcement.ts`)
`checkQuota(orgId, kind, costCents)` → tiers: **<80% ok · 80% warning** (notif) **· 100% throttle** (Plan vai pra fila lenta; Fast segue) **· 150% hard-block** (402, exceto ações críticas: aprovar contrato/finalizar deal/webhook close). Integrar em chat IA / Infosimples / WhatsApp antes de cada chamada.

### UX de coleta de feedback IA
Thumbs inline em `ChatMessage.tsx` (👍 sem fricção; 👎 abre popover reason) + `MilestoneSurveyModal`. `POST /api/chat/feedback`.

### Crons novos (Inngest — adoção de Inngest também é Fase 2)
`tenant-billing-snapshot` (daily) · `alert-evaluator` (5min) · `quality-aggregator` (daily).

### Também herdado pra Fase 2 (do relatório original)
- **Inngest** pra webhooks/crons com `concurrency_key=orgId` (quebra picos).
- **RLS POC** em ~12 tabelas hot (backstop do scopedPrisma — ver caveats do 0b).
- **Cloudflare R2** migration (storage com signed URLs).
- **`AuditLog`/`AIUsage` partição** declarativa por mês.

---

## 5. Pré-D1 da Fase 2 + sequenciamento

1. **Base:** branch `feat/mt-2.0-*` a partir de `redesign/fase-b` **após** #45/#46 mergearem (senão stacka).
2. **Eng-weeks:** ~14-19 (cronograma). Ordem sugerida:
   - 2a `AIMessageFeedback` (schema + thumbs inline + milestone) — destrava o quality dashboard.
   - 2b `/admin/observability` (overview + drill-down) — reusa `AIUsage` (já existe) + PlatformRole gate.
   - 2c budget enforcement tiered + `TenantQuotaPolicy`.
   - 2d `AlertRule` + alert-evaluator + `/admin/alerts`.
   - 2e `TenantBillingSnapshot` cron + UI.
   - 2f quality dashboard `/admin/quality`.
3. **Não-gated:** Fase 2 inteira é interna (super-admin) — **sem gate externo**. Pode rodar em paralelo aos gates do 1b/1c.
4. **Verificação:** typecheck + suíte + migrations na staging + (se possível) seed de AIUsage/feedback sintético pros dashboards.

---

## 6. Como retomar (resumo pra colar na 1ª mensagem da próxima sessão)

> "Retomar multitenant na Fase 2 (observability). Estado em `docs/kickoff-multitenant-fase2.md`: Fase 0+1 construídas/verificadas; PRs #45 (1e) e #46 (1f/1b/1c) abertos pra mergear; staging branch `staging-mt-fase0` no Neon (MCP conectado) com alpha/beta seedados. Começar por 2a (AIMessageFeedback) numa branch nova de `redesign/fase-b` após os PRs mergearem."
