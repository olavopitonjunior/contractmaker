# Cronograma — Multitenant Refactor (Fase 0+1)

> **Tipo:** cronograma de implementação fase-a-fase com eng-weeks + paralelismo identificado.
> **Status:** derivado do PRD aprovado em [`docs/prd-multitenant-600.md`](./prd-multitenant-600.md) — 2026-05-16.
> **Premissa:** 1 eng senior dedicado em modo serial OU 2 engs em paralelo. Buffer 20% incluído nas projeções.

## Visão executiva

| Cenário | Eng-weeks brutas | Calendário (1 eng) | Calendário (2 engs paralelos) |
|---|---:|---:|---:|
| Fase 0 (4 frentes refactor) | 4.5-5.5 | 5-6 semanas | 2-3 semanas |
| Fase 1 (5 frentes feature) | 10-14 | 11-15 semanas | 6-9 semanas |
| **Fase 1f (audit expansion, adicionada 2026-05-17)** | **1.5-2** | **2 semanas** | **1.5 semanas (paralelo c/ 1e)** |
| **Total Fase 0+1+1f** | **16-21.5** | **18-23 semanas** | **9-13 semanas** |
| + Buffer 20% | | **22-28 semanas (~5-6.5 meses)** | **11-15 semanas (~3-3.5 meses)** |

Pré-go-live (rodando em paralelo desde D1, NÃO bloqueiam dev):
- Google OAuth Consent Screen "In Production" — 4-6 semanas calendário
- Acordo comercial ClickSign WL — 2-4 semanas
- DPO review LGPD + DPA — 1-2 semanas

## Diagrama Gantt (ASCII)

Cenário recomendado: **2 engs em paralelo**, ~12 semanas calendário com Fase 1f.

```
Semana            1     2     3     4     5     6     7     8     9    10    11    12
Eng 1 (lead)
  0a              ████░                                                                    PlatformConfig+Role
  0c              ░████░                                                                   SHARED_ORG_ID removal
  1a                          ████░░                                                       Subdomain+branding
  1d                                ██████░                                                Asaas markup
  1e                                            ████████████████████████                   Admin panel

Eng 2 (parallel)
  0b              ██████████░                                                              scopedPrisma+tests
  0d                          ██████████░                                                  PaymentProvider
  1b                                ████████████████████████░                              Google OAuth
  1c                                            ████████████████░                          ClickSign WL
  1f                                                              ░░██████████             Tenant audit expansion
                                                                  (espera 1e ≥50%)

Gates (paralelos)
  Google OAuth Verification ░░░░░░░░░░░░░░░░░░░░░░░                                        ~5w
  ClickSign WL contract                ░░░░░░░░░░                                          ~3w (após decisão)
  DPO LGPD                                       ░░░░░░░                                   ~2w
```

Legenda: `█` = trabalho ativo, `░` = aguardando (gate externo ou dependência)

## Critical path

```
0a (0.5w) → 0c (0.5w) → 1a (1.5w) → 1e (4w) → 1f (2w) = 8.5 weeks
                       ├→ 1b (5w paralelo) ──┘
                       ├→ 1c (4w paralelo) ──┤
                       └→ 1d (1.5w paralelo) ┘
```

Com 2 engs, critical path real é 0a → 0c → 1a → 1e → 1f (paralelo às últimas 2w de 1e) = **~7-8.5 semanas calendário** (assumindo gates externos não atrasam).

Com 1 eng, critical path soma serial: 0a + 0c + 0b + 0d + 1a + 1d + 1b + 1c + 1e + 1f ≈ **17-21 semanas calendário**.

---

## Fase 0 — Refactor (4 frentes paralelizáveis)

### Fase 0a — PlatformConfig + PlatformRole

- **Eng-weeks:** 0.5-1
- **Calendário:** 0.5-1 semana
- **Dependências:** nenhuma (D1 start)
- **Paralelizável com:** 0b, 0c, 0d
- **Bloqueia:** 0c (audit precisa de tipo PlatformContext), 1e (admin precisa de PlatformRole), 1d (PlatformConfig schema)
- **Riscos:** nenhum — refactor mecânico
- **Status:** ✅ IMPLEMENTADO (2026-05-25), verificado contra a branch Neon staging. Pendente: commit num `feat/mt-0a-platform-config` a partir de `master` (hoje no working tree de `redesign/fase-b`).
- **Acceptance:**
  - [x] Migration `20260525170000_platform_role_config` aplica clean (idempotente, `migrate deploy` na staging)
  - [x] Singleton PlatformConfig populado via migration idempotente (`platform_config_singleton`, verificado)
  - [x] Script `grant-platform-role.ts olavo.piton@gmail.com super_admin` funciona (Olavo = super_admin na staging)
  - [x] Unit test `platform.test.ts`: user sem role → erro 403; com role → ok (5 testes verdes)
  - [x] `requirePlatformRole("support")` em `GET /api/admin/platform/whoami`

### Fase 0b — scopedPrisma + isolation test em CI

- **Eng-weeks:** 1.5-2
- **Calendário:** 2 semanas
- **Dependências:** nenhuma
- **Paralelizável com:** 0a, 0c, 0d
- **Bloqueia:** nada estrito; **gate de qualidade** pra todo merge futuro
- **Riscos:** overhead Prisma extension; medir p95 em benchmark antes de adoção wide
- **Acceptance:**
  - [ ] `lib/db/scoped-prisma.ts` exporta factory funcional
  - [ ] NON_TENANT_MODELS lista documentada com justificativa
  - [ ] `tenant-isolation.test.ts` cobre 8 rotas críticas (Seção 19.5 do relatório arquitetural)
  - [ ] `pnpm test:isolation` integrado em `.github/workflows` ou script de pre-commit
  - [ ] Snapshot manual: seed 2 orgs, login org A, tenta GET resource org B → 404
  - [ ] Benchmark p50/p95 antes vs depois da extension: regressão <5%

### Fase 0c — Eliminar SHARED_ORG_ID

- **Eng-weeks:** 0.5
- **Calendário:** 0.5 semana
- **Dependências:** 0a (audit context types), 0b (nice-to-have pra teste de regressão)
- **Paralelizável com:** 0d
- **Bloqueia:** 1a, 1b, 1c (lookups dependem)
- **Riscos:** webhook audit pode regredir se transição mal coordenada
- **Acceptance:**
  - [ ] Migration `auditlog_orgid_nullable` aplica
  - [ ] `apps/web/src/lib/security/audit.ts:173` aceita `orgId: null`
  - [ ] Webhook ClickSign E2E: payload com envelope real → audit registra `orgId=envelope.orgId`
  - [ ] Webhook órfão (envelope inexistente) → audit registra `orgId=null` + retorna `{ok:true, unknown_envelope:true}`
  - [ ] Scripts admin (`reset-system.ts`, `admin-create-member.ts`, `migrate-pipeline-stages.ts`, `seed-aditamento-templates.ts`) exigem `--orgId` flag
  - [ ] `grep -rn "SHARED_ORG_ID\|cmnt1ldo4000111bw4yo517k0" apps/web/src apps/web/scripts` retorna vazio

### Fase 0d — PaymentProvider interface

- **Eng-weeks:** 2
- **Calendário:** 2 semanas
- **Dependências:** nenhuma
- **Paralelizável com:** 0a, 0b, 0c
- **Bloqueia:** opcional para 1d (markup pode rodar direto em `lib/asaas`); preserva opcionalidade pra Celcoin
- **Riscos:** abstração over-engineered; manter MVP
- **Acceptance:**
  - [ ] `lib/payments/provider.ts` exporta interface `PaymentProvider`
  - [ ] `lib/payments/asaas/index.ts` exporta `AsaasProvider implements PaymentProvider`
  - [ ] `AsaasProvider.createCharge(...)` retorna mesmo shape que `createAsaasCharge` direto
  - [ ] Suite existente em `lib/asaas/__tests__/*` passa sem mudança
  - [ ] Documentação em `docs/payments-architecture.md`

---

## Fase 1 — Feature multi-tenant (5 frentes com dependências)

### Fase 1a — Subdomain per-tenant + BrandingSettings

- **Eng-weeks:** 1-1.5 (theming já existe — ver nota)
- **Calendário:** 1.5 semanas
- **Dependências:** 0c (SHARED_ORG_ID limpo)
- **Paralelizável com:** 1b, 1c, 1d (depois de iniciada)
- **Bloqueia:** 1e (admin panel cria orgs com subdomain)
- **Riscos:** wildcard SSL Vercel cap 10; ter Cloudflare backup pronto
- **Nota (2026-05-25):** o redesign `imobpro.ai` já criou o white-label theming via `[data-tenant]` em `globals.css:11` (tokens `--primary`/`--brand-accent`/serif definidos, dark-safe). `BrandingSettings` só popula esses CSS vars — não inventa tema. De-risca o lado visual de 1a.
- **Acceptance:**
  - [ ] Middleware extrai subdomain de host
  - [ ] Cache LRU 60s pra `Organization.subdomain → orgId`
  - [ ] Header `x-org-id` injetado em request quando subdomain match
  - [ ] `getUserOrg(userId, { hintOrgId })` valida membership
  - [ ] Local: `tenant.localhost:3000/pipeline` resolve org via middleware
  - [ ] Prod: `demo.imobpro.ia.br/login` resolve org "demo"
  - [ ] Apex (`imobpro.ia.br`) serve landing + login central sem injetar header
  - [ ] Reserved subdomains rejeitados em form admin (Zod)
  - [ ] BrandingSettings: logo + cor renderizados em UI da org

### Fase 1b — GoogleConnection per-org

- **Eng-weeks:** 3-4
- **Calendário:** 4-5 semanas
- **Dependências:** 0c (audit-safe); idealmente 1a (subdomain pro callback URL)
- **Paralelizável com:** 1c, 1d
- **Bloqueia:** nada estrito na Fase 1
- **Riscos:** OAuth Verification rejection (mitigação: 60d lead-time); refresh token expiry quebra org se cron falhar
- **Acceptance:**
  - [ ] `lib/google/connection.ts` exporta `getGoogleAuthForOrg(orgId)`
  - [ ] OAuth flow `/api/integrations/google/connect` (GET → URL com state JWT)
  - [ ] Callback `/api/integrations/google/callback` troca code → encrypted refresh_token persistido em `GoogleConnection`
  - [ ] `getDocsClient(orgId)` resolve `GoogleConnection` ou cai em fallback platform
  - [ ] Org legada (SHARED_ORG_ID) continua via fallback SA global — script seed cria row `connectionType=platform_fallback`
  - [ ] Cron Inngest `refresh-google-tokens` renova 1h antes de expiry
  - [ ] Status `EXPIRED` dispara notificação (email/in-app inicialmente)
  - [ ] UI `/settings/integrations/google` conectar/desconectar
  - [ ] **Gate externo**: Google OAuth Consent Screen "In Production" (4-6w paralelo)

### Fase 1c — ClickSignAccount per-org (híbrido WL/pool)

- **Eng-weeks:** 2-3
- **Calendário:** 3-4 semanas (espera comercial ~2w em paralelo)
- **Dependências:** 0c (webhook resolve via envelope.orgId)
- **Paralelizável com:** 1b, 1d
- **Bloqueia:** nada estrito na Fase 1
- **Riscos:** ClickSign comercial pode demorar; código entrega independente do acordo
- **Acceptance:**
  - [ ] Schema `ClickSignAccount` com `mode = "white_label" | "platform_pool"`
  - [ ] `lib/clicksign/client.ts:18 getToken(orgId?)` resolve apiKey by mode
  - [ ] `lib/clicksign/provisioning.ts` cria subaccount WL via API master
  - [ ] Webhook HMAC valida por subaccount.hmacSecret (WL) ou env global (pool)
  - [ ] Org legada vira mode=platform_pool via script seed
  - [ ] Org nova "Grande" → provisionamento WL em <60s
  - [ ] **Gate externo**: acordo comercial ClickSign WL fechado antes de ativar mode=white_label em produção

### Fase 1d — Asaas markup global

- **Eng-weeks:** 1-1.5
- **Calendário:** 1.5 semanas
- **Dependências:** 0a (PlatformConfig schema), 0d (PaymentProvider — opcional)
- **Paralelizável com:** 1a, 1b, 1c
- **Bloqueia:** nada estrito na Fase 1
- **Riscos:** mudança de markup retroativa quebra DRE; aplicação prospectiva mandatória
- **Acceptance:**
  - [ ] `AsaasAccount.parentAccountId` field + relation self
  - [ ] `lib/asaas/platform-fee.ts` resolve markup com cache LRU 60s
  - [ ] `composeSplits` injeta split markup ao final do array userSplits
  - [ ] PATCH `/api/admin/platform-config` grava snapshot em `PlatformConfigHistory`
  - [ ] Cobranças emitidas mantêm `splitJson` congelado (não retroativo)
  - [ ] Validação `sum ≤ 100%` continua passando após injeção do markup

### Fase 1e — Painel /admin/orgs

- **Eng-weeks:** 3-4
- **Calendário:** 4 semanas
- **Dependências:** 0a (PlatformRole), 1a (subdomain pra criação), idealmente 1b/1c prontos pra surface health
- **Paralelizável com:** nada na Fase 1 (último a entrar)
- **Bloqueia:** rollout pra 1º tenant alpha
- **Riscos:** impersonation precisa de audit rigoroso; PlatformRole leak = catástrofe
- **Acceptance:**
  - [ ] User sem PlatformRole → GET `/api/admin/orgs` → 403
  - [ ] Super-admin lista orgs com KPIs (users, deals/mês, contratos/mês, AI spend)
  - [ ] POST `/api/admin/orgs` cria org em transação 8-passos (descritos no PRD)
  - [ ] Org nova "demo" subdomain → 1min após criação `https://demo.imobpro.ia.br/login` aceita owner via magic link
  - [ ] POST `/api/admin/orgs/[orgId]/impersonate` cria `TenantImpersonationSession`
  - [ ] AuditLog ganha `impersonatedBy` nullable
  - [ ] Banner persistente "Modo super-admin" quando logado com PlatformRole
  - [ ] POST `/api/admin/orgs/[orgId]/suspend` muda `Organization.status=SUSPENDED`
  - [ ] **Gate externo**: DPO review LGPD + DPA atualizado antes de aceitar 1º tenant não-Olavo

### Fase 1f — Tenant Audit UI expansion (adicionada 2026-05-17)

- **Eng-weeks:** 1.5-2
- **Calendário:** 2 semanas
- **Dependências:** 1e (`AuditLog.impersonatedBy` é adicionado lá; 1f estende com `entityId` + `metadataTsv` + UI/filtros)
- **Paralelizável com:** 1e (último 50% pode rodar em paralelo se a coluna `impersonatedBy` for entregue cedo)
- **Bloqueia:** nada estrito; entrega audit robusto pro tenant desde 1º release
- **Riscos:** GIN index em jsonb_to_tsvector pode crescer ~10% do tamanho da tabela; benchmark p95 antes de gate
- **Acceptance:**
  - [ ] Migration `auditlog_search` aplica (entityId + impersonatedBy + metadataTsv tsvector + 3 índices)
  - [ ] API `/api/security/audit-log` aceita `q`, `resourceType`, `entityId`, `impersonatedBy` mantendo backward-compat
  - [ ] Free-text "joão" retorna AuditLogs com metadata contendo "João" em <500ms p95
  - [ ] `POST /api/security/audit-log/export { format }` síncrono ≤1k rows, assíncrono Inngest >1k com Notification + link R2
  - [ ] Rate limit 5 exports/hora/user funcionando
  - [ ] `/settings/seguranca/audit-log/users/[userId]` carrega timeline + sumário 30d em <2s
  - [ ] Coluna "Impersonado por" visível quando aplicável; click leva ao perfil super-admin

---

## Equipe e alocação

### Cenário A — 1 eng senior dedicado

| Semana | Atividade |
|---:|---|
| 1 | 0a + 0c (em sequência) |
| 2-3 | 0b |
| 4-5 | 0d |
| 6 | 1a |
| 7 | 1d |
| 8-12 | 1b (com OAuth Verification rodando paralelo) |
| 13-15 | 1c |
| 16-19 | 1e |

**Total: 19 semanas calendário + 20% buffer = ~23 semanas (~5.5 meses)**

### Cenário B — 2 engs paralelos (recomendado)

| Semana | Eng 1 (lead) | Eng 2 (parallel) |
|---:|---|---|
| 1 | 0a + 0c | 0b |
| 2 | (review 0b) | 0b conclui + 0d início |
| 3 | 1a | 0d conclui |
| 4 | 1d | 1b início |
| 5-7 | 1e início (admin scaffold + impersonatedBy field) | 1b conclui |
| 8-9 | 1e continua | 1c |
| 10 | 1e conclui + integração | 1c conclui + 1f início (com `impersonatedBy` já disponível) |
| 11-12 | smoke E2E + cleanup | 1f conclui (audit expansion + export + per-user view) |

**Total: 12 semanas calendário + 20% buffer = ~14-15 semanas (~3.5 meses)**

### Cenário C — equipe maior (3+ engs)

Não recomendado pra Fase 0+1 — comunicação overhead come o ganho de paralelismo. Esperar Fase 2 (que tem muito mais frentes independentes).

---

## Gates externos (rodam em paralelo, fora do caminho crítico de dev)

### Gate 6: Google OAuth Verification

- **Owner:** Olavo
- **Quando iniciar:** D1 (assim que repo de prod tem privacy policy + ToS URLs ativos)
- **Duração:** 4-6 semanas calendário (Google review time varia)
- **Bloqueia:** ativar 1º tenant não-legada em Fase 1b (sem isso, refresh token expira 7d — memória `feedback_oauth_testing_7d`)
- **Critério de sucesso:** OAuth Consent Screen status = "In Production" no Google Cloud Console
- **Tasks:**
  - [ ] Privacy Policy URL acessível em prod
  - [ ] Terms of Service URL acessível em prod
  - [ ] Logo do app
  - [ ] Demo video (se escopo restrito)
  - [ ] Submeter pra App Verification

### Gate 7: Acordo comercial ClickSign White Label

- **Owner:** Olavo
- **Quando iniciar:** D1 (paralelo a dev da 1c)
- **Duração:** 2-4 semanas calendário
- **Bloqueia:** ativar mode=white_label em produção (código fica pronto independente)
- **Critério de sucesso:** contrato assinado com pricing tier-based aceitável vs ~R$ 75/conta/mês default
- **Negociação alvo:** volume agregado, sem mensalidade por subaccount inativa
- **Tasks:**
  - [ ] Reunião comercial ClickSign
  - [ ] Proposta volume-based
  - [ ] Revisão contratual

### Gate 8: DPO review LGPD + DPA

- **Owner:** Olavo + advogado LGPD
- **Quando iniciar:** semana 5-6 (quando arquitetura cristalizada o suficiente pra review)
- **Duração:** 1-2 semanas
- **Bloqueia:** aceitar 1º tenant não-Olavo em produção
- **Critério de sucesso:** parecer favorável + DPA template aprovado pra incluir no Termo de Uso
- **Tasks:**
  - [ ] Mapear sub-operadores (Anthropic, Google, Asaas, ClickSign, Infosimples, Vercel, Neon, Voyage, Resend, R2)
  - [ ] DPA boilerplate
  - [ ] Privacy Policy revisão LGPD-compliant
  - [ ] DSR endpoints planejados (Fase 3, mas designar quem responde manualmente até lá)

---

## Verificação final (gate antes de fechar Fase 0+1)

Conforme Seção 29 do relatório arquitetural — 5 checkpoints pré-merge:

1. **Tenant isolation test** (`pnpm test:isolation`) verde em CI; falha bloqueia merge.
2. **Manual two-org E2E**: super-admin cria org alpha e beta com subdomains; owners independentes operam sem cross-leak; tentativa cross-org via deep link → 404.
3. **ClickSign webhook E2E**: payload com envelope alpha → audit registra `orgId=alpha.id`.
4. **Asaas markup split**: cobrança alpha → `splitJson.splits` inclui markup `[{ walletId: parentWalletId, percentualValue: PlatformConfig.defaultPlatformFeePercent }]`.
5. **Impersonation audit**: super-admin impersona alpha → AuditLog `impersonatedBy=adminUserId, userId=alpha-owner.id`.
6. **Org legada continua operando**: smoke test produção em /pipeline, /contracts/[id], gerar contrato (fallback SA global).
7. **Migrations** `prisma migrate deploy` clean no preview Vercel.
8. **`grep -rn "SHARED_ORG_ID" apps/web`** → vazio.
9. **Audit free-text search** (`/api/security/audit-log?q=texto`) p95 <500ms até 1M rows; export CSV 10k rows em <30s.

---

## Riscos e mitigações no cronograma

| Risco | Probabilidade | Impacto cronograma | Mitigação |
|---|---|---|---|
| OAuth Verification rejeitada | Baixa-Média | +4-8 semanas | 60d lead-time D1; backup caminho C (fallback platform 30d) |
| ClickSign comercial não conversável | Média | Fase 1c valida só código; sem ativação prod | Híbrido tier-based; código entrega independente |
| Prisma extension overhead inaceitável | Baixa | +1-2 semanas redesign | Benchmark D1 da Fase 0b; aceita >5% só com PR explícito |
| Subdomain SSL cap Vercel | Média (após 10 tenants) | +1 semana migração Cloudflare | Setup Cloudflare for SaaS preventivo se >5 tenants |
| Migration `auditlog_orgid_nullable` em DB cheio | Baixa | +0.5 semana janela | Idempotente; aplica sem lock |
| Impersonation bug = catastrofe | Baixa | Indeterminado | Audit obrigatório em todos os endpoints; teste unit pra `impersonatedBy` |
| Eng senior fica doente | n/a | +50-100% calendário se 1 eng | Cenário B (2 engs) recomendado por isso |

---

## Pós Fase 1 — Roadmap referencial (não escopo deste cronograma)

Após gate verde da Fase 1+1f, abrir PRDs próprios:

| Fase | Conteúdo | Eng-weeks | Calendário |
|---|---|---:|---:|
| **2.0** (expandida em 2026-05-17) | TenantQuotaPolicy + Inngest queues + R2 + RLS POC + **observability super-admin completo** (AIMessageFeedback thumbs+milestone, /admin/observability cross-tenant + drill-down, /admin/quality básico, AlertRule + alert-evaluator, budget enforcement tiered 80/100/150%, TenantBillingSnapshot) | 14-19 | 3-4 meses |
| 3 | MCP per-tenant + WhatsApp + Push PWA + Custom Fields + DSR | 12-18 | 3-4 meses |

**Total roadmap até MVP escalável produção:** ~7-10 meses calendário a partir de D1.

Detalhes da Fase 2.0 expandida em [PRD multitenant-600 §"Fase 2.0"](./prd-multitenant-600.md#fase-20--super-admin-observability-detalhado-substitui-fase-2-high-level) e Apêndice C do plan file `voc-um-arquiteto-fuzzy-cook.md`.

---

## Next steps

Pré-D1:
1. Owner da Fase 0+1 designado (sugestão: Olavo lead + 1 eng senior contratado paralelo).
2. Branches criadas: `feat/multitenant-0a-platform-config`, `feat/multitenant-0b-scoped-prisma`, etc. (1 PR por fase).
3. Sandbox staging DB Neon branch criado pra tests E2E sem afetar prod.
4. Gates externos (6, 7, 8) iniciados em paralelo.
5. Kickoff técnico revisando este cronograma + PRD.

D1 da implementação:
- 0a + 0b + 0d kickoff (paralelos) se Cenário B.
- 0a + 0c kickoff (serial) se Cenário A.
