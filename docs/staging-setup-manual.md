# Staging — setup manual (Fase A + E)

Passos que precisam do **olavo** no console (não automatizam). Estimativa: ~3h ativas + 2h espera DNS.

---

## 1. DNS no registro.br (~30min ativos + 1-2h propagação)

Painel registro.br → `imobpro.ia.br` → editar zona DNS. Adicionar:

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| CNAME | `staging` | `cname.vercel-dns.com.` | 3600 |
| CNAME | `*.staging` | `cname.vercel-dns.com.` | 3600 |

Aguarda propagação (`dig staging.imobpro.ia.br` deve retornar o CNAME). Vercel verifica e emite cert SSL automático.

---

## 2. Neon branch staging (~5min)

Console Neon (projeto `wispy-tree-00688100`):
1. Branches → "Create branch"
2. Nome: `staging`
3. Parent: `main` (cópia point-in-time atual)
4. Copia schema + dados atuais (pode deletar dados depois com `reset-staging.ts`)
5. Anota:
   - `DATABASE_URL` (pooled, pra runtime)
   - `DIRECT_URL` (direct, pra migrations)

---

## 3. Vercel project novo (~15min)

Console Vercel:
1. **Add new project** → import `olavopitonjunior/contractmaker`
2. Nome: `contractmaker-staging`
3. **Production Branch:** `staging` (não master!)
4. **Build & Output:** mantém defaults (já configurados via `vercel.json`)
5. Após primeiro deploy: **Settings → Domains** → adiciona:
   - `staging.imobpro.ia.br`
   - `*.staging.imobpro.ia.br` (wildcard)

---

## 4. Google Cloud OAuth Client (~15min)

GCP Console → APIs & Services → Credentials:
1. **Create credentials → OAuth client ID** → tipo "Web application"
2. Nome: `Contractmaker Staging`
3. **Authorized JavaScript origins:**
   - `https://staging.imobpro.ia.br`
4. **Authorized redirect URIs:**
   - `https://staging.imobpro.ia.br/api/auth/callback/google`
5. Anota `Client ID` e `Client secret`.
6. OAuth consent screen continua em Testing — adiciona `olavo.piton@gmail.com` em Test users.

---

## 5. Asaas sandbox webhook (~10min)

Dashboard Asaas (sandbox.asaas.com):
1. Confirma subconta sandbox ativa (memória `project_asaas_production`)
2. Integrações → Webhooks → **Adicionar webhook**
3. URL: `https://staging.imobpro.ia.br/api/webhooks/asaas`
4. Eventos: marca os mesmos da conta prod (PAYMENT_*, TRANSFER_*, ACCOUNT_STATUS_UPDATED)
5. Token: gerar novo (use `openssl rand -hex 32`) → guarda como `ASAAS_WEBHOOK_TOKEN` staging

---

## 6. ClickSign webhook extra (~5min)

Dashboard ClickSign (app.clicksign.com):
1. Integrações → Webhooks → **Adicionar URL adicional**
2. URL: `https://staging.imobpro.ia.br/api/webhooks/clicksign`
3. Eventos: `close`, `auto_close`, `document_closed`, `cancel`, `auto_cancel`
4. HMAC secret: gerar novo → `CLICKSIGN_WEBHOOK_SECRET` staging

(Conta ClickSign é a mesma de prod — só registra webhook adicional pro endpoint staging.)

---

## 7. Resend sandbox (~5min)

Dashboard Resend:
1. API Keys → **Create API Key** → escopo `sending`
2. Nome: `staging`
3. Copia chave → `RESEND_API_KEY` staging
4. `EMAIL_FROM=onboarding@resend.dev` (sandbox dom only envia pro dono da conta)

---

## 8. Serasa sandbox (~10min)

Portal Serasa Experian → ambiente Sandbox:
1. Cadastra app `Contractmaker Staging` no portal de credenciamento
2. Anota `SERASA_CLIENT_ID` e `SERASA_CLIENT_SECRET`
3. `SERASA_BASE_URL=https://api.uat-tegra.serasaexperian.com.br` (sandbox endpoint)

---

## 9. NFE Focus sandbox (~5min)

Dashboard Focus NFe → Tokens → criar token sandbox → `NFE_FOCUS_API_KEY` staging.

---

## 10. Upstash Redis staging (~5min)

Console Upstash:
1. **Create database** → free tier
2. Nome: `contractmaker-staging`
3. Region: us-east-1 (mesma do Vercel)
4. Copia `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`

---

## 11. Sentry (~10min, opcional)

sentry.io → New project:
1. Tipo: Next.js
2. Project name: `contractmaker-staging`
3. Copia DSN → `SENTRY_DSN` staging
4. Cria também `contractmaker-prod` se ainda não existir
5. Free tier 5k events/mês cobre os dois

---

## 12. Env vars no Vercel staging (~30min)

Vai em `contractmaker-staging` → Settings → Environment Variables. Cria pra ambiente **Production** (a "production" do projeto staging, não do prod):

```bash
# Domínio
ROOT_DOMAIN=staging.imobpro.ia.br
NEXTAUTH_URL=https://staging.imobpro.ia.br
PUBLIC_APP_URL=https://staging.imobpro.ia.br
STAGING_MODE=true
NEXT_PUBLIC_STAGING_MODE=true

# DB
DATABASE_URL=<Neon branch staging pooled>
DIRECT_URL=<Neon branch staging direct>

# Secrets NOVOS (não reusar de prod)
AUTH_SECRET=<openssl rand -base64 32>
CRON_SECRET=<openssl rand -base64 32>
MASTER_ENCRYPTION_KEY=<openssl rand -base64 32>
SUDO_TOKEN_SECRET=<openssl rand -base64 32>
CHALLENGE_TOKEN_SECRET=<openssl rand -base64 32>
TRUSTED_DEVICE_SECRET=<openssl rand -base64 32>
GOOGLE_WATCH_TOKEN=<openssl rand -hex 16>
STAGING_RESET_PASSWORD=<openssl rand -hex 16>

# Asaas
ASAAS_ENV=sandbox
ASAAS_API_KEY=<sandbox key>
ASAAS_WEBHOOK_TOKEN=<gerado no passo 5>
PLATFORM_WALLET_ID=<sandbox wallet>

# ClickSign (mesma conta prod, cap baixo)
CLICKSIGN_API_TOKEN=<prod>
CLICKSIGN_API_BASE_URL=https://app.clicksign.com/api/v3
CLICKSIGN_WEBHOOK_SECRET=<gerado no passo 6>
CLICKSIGN_MONTHLY_BUDGET_CENTS=3000

# AI (modelos baratos)
ANTHROPIC_API_KEY=<prod>
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_PASSIVE_MODEL=claude-haiku-4-5-20251001
GEMINI_API_KEY=<prod>
GEMINI_OCR_MODEL=gemini-2.5-flash
OCR_MODEL=gemini-2.5-flash
OCR_FALLBACK_CLAUDE_MODEL=claude-haiku-4-5-20251001
OCR_CLAUDE_FALLBACK_ENABLED=true
CCV_EXTRACTION_MODEL=gemini-2.5-flash
VOICE_EXTRACTION_MODEL=gemini-2.5-flash
VOYAGE_API_KEY=
CONTRACT_AI_TOKEN_BUDGET=50000

# Google OAuth (client staging)
GOOGLE_CLIENT_ID=<staging>
GOOGLE_CLIENT_SECRET=<staging>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<reusa prod ou cria novo>
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<reusa prod ou cria novo>
GOOGLE_DRIVE_FOLDER_ID=<pasta dedicada staging>

# Certidões
INFOSIMPLES_TOKEN=<prod>
INFOSIMPLES_MONTHLY_BUDGET_CENTS=500
INFOSIMPLES_PKCS=<prod>
INFOSIMPLES_GOVBR_CPF=<prod>
INFOSIMPLES_GOVBR_PASSWORD=<prod>
INFOSIMPLES_AUTH_MODE=<prod>
INFOSIMPLES_ONR_PKCS=<prod>
INFOSIMPLES_ONR_LOGIN=<prod>
INFOSIMPLES_ONR_SENHA=<prod>
INFOSIMPLES_ONR_AUTH_MODE=<prod>
CERTIDOES_FALLBACK_EMAIL=olavo.piton@gmail.com

# Serasa
SERASA_ENV=sandbox
SERASA_CLIENT_ID=<sandbox>
SERASA_CLIENT_SECRET=<sandbox>
SERASA_BASE_URL=https://api.uat-tegra.serasaexperian.com.br
SERASA_MONTHLY_BUDGET_CENTS=0

# Email (sandbox + override)
RESEND_API_KEY=<sandbox>
EMAIL_FROM=onboarding@resend.dev
EMAIL_REPLY_TO=olavo.piton@gmail.com
EMAIL_PROVIDER=resend
STAGING_EMAIL_OVERRIDE=olavo.piton@gmail.com
STAGING_EMAIL_OVERRIDE_DOMAIN=imobpro.ia.br
INVITE_APPROVER_EMAILS=olavo.piton@gmail.com
INVITE_NOTIFY_EMAILS=olavo.piton@gmail.com

# Storage (Vercel auto-cria BLOB_READ_WRITE_TOKEN do projeto staging)
S3_BUCKET=
AWS_REGION=<reusa ou vazio>
AWS_ACCESS_KEY_ID=<reusa ou vazio>
AWS_SECRET_ACCESS_KEY=<reusa ou vazio>

# Redis dedicado
UPSTASH_REDIS_REST_URL=<criado no passo 10>
UPSTASH_REDIS_REST_TOKEN=<criado no passo 10>
REDIS_KEY_PREFIX=staging:

# NFS-e
NFE_FOCUS_API_KEY=<sandbox passo 9>

# Newton — desabilitado em staging
NEWTON_DISABLED=true

# Superlógica benchmark (read-only)
SUPERLOGICA_APP_TOKEN=<reusa prod>

# Feature flags
ALLOW_SELF_REGISTER=true
DELEGATION_ENABLED=true
OCR_WORKER_CONCURRENCY=2
OCR_WORKER_MAX_PER_RUN=20
OCR_WORKER_PACE_MS=500

# Observability
SENTRY_DSN=<staging passo 11>
SENTRY_ENVIRONMENT=staging
```

⚠️ **printf single quotes** quando setar via CLI Vercel — chaves com `$` precisam de aspas simples (memória `feedback_printf_single_quotes`).

---

## 13. Push da branch staging (~2min)

```bash
git checkout master
git pull
git checkout -b staging
git push -u origin staging
```

Vercel staging project começa o primeiro build → roda `prisma migrate deploy` na Neon branch staging → deploy inicial.

---

## 14. Seed inicial (~5min)

Depois do deploy, com env `DATABASE_URL` apontando pra Neon staging:

```bash
DATABASE_URL=<staging-neon-url> pnpm tsx scripts/seed-staging.ts --apply
```

Cria org `Contractmaker Demo` (subdomain `demo`), owner olavo, 5 imóveis, 3 contratos, 12 cobranças.

Login: `olavo.piton@gmail.com` / `staging123` em `https://demo.staging.imobpro.ia.br`.

---

## 15. Smoke test E2E (~20min)

Lista em [docs/staging-workflow.md](staging-workflow.md) na seção **Health check** + verificação manual:

1. `curl https://staging.imobpro.ia.br/api/health` → `{ status: "ok", env: "staging" }`
2. Login no `demo.staging.imobpro.ia.br` → magic link cai em olavo@gmail
3. Banner amarelo STAGING aparece
4. Criar imóvel novo → confere via `mcp__neon__run_sql` na branch staging
5. Tentar cron manual `curl https://staging.imobpro.ia.br/api/cron/rent/generate` → `{ skipped: "staging-disabled" }`
6. Ligar `rent/generate` em `/settings/staging-crons` → re-tentar manual → roda
7. Envelope ClickSign teste (1 signer fake) → confere `[STAGING]` prefix
8. `/api/admin/clicksign/webhook-attempts` → vê só eventos staging
