# Staging — workflow operacional

Ambiente de homologação `staging.imobpro.ia.br` (Vercel project `contractmaker-staging`, branch git `staging`, Neon branch `staging`). Permite testar UI + integrações + crons + webhooks sem tocar dados/cobrança/assinatura reais.

## Promote staging → prod

```bash
# 1. Faz feature na sua branch
git checkout -b feat/nova-coisa master

# 2. Merge na staging primeiro
git checkout staging
git merge feat/nova-coisa
git push

# 3. Aguarda Vercel deploy + roda smoke test em https://staging.imobpro.ia.br
#    Confirma:
#    - Banner amarelo STAGING aparece
#    - Login funciona (magic link cai em olavo.piton@gmail.com via Resend sandbox)
#    - Feature nova funciona como esperado
#    - /api/health retorna { status: "ok", env: "staging" }

# 4. Abre PR staging → master
gh pr create --base master --head staging --title "Promote: nova coisa" --body "..."

# 5. Aplica label "staging-smoke-passed" manualmente (gate humano do CI):
gh pr edit <NUM> --add-label staging-smoke-passed

# 6. Merge — Vercel deploya prod automaticamente
```

## Hotfix direto pra prod

```bash
git checkout -b hotfix/critical master
# ... fix ...
git push -u origin hotfix/critical
gh pr create --base master --title "hotfix: ..."
# Merge → prod
# Depois cherry-pick na staging pra evitar drift:
git checkout staging
git cherry-pick <hotfix-sha>
git push
```

## Reset staging (wipe + re-seed)

```bash
STAGING_MODE=true \
STAGING_RESET_PASSWORD=<senha-do-env> \
DATABASE_URL=<staging-neon-url> \
pnpm tsx scripts/reset-staging.ts --yes --password=$STAGING_RESET_PASSWORD
```

Reinicia identidade de todas as tabelas. Re-roda `seed-staging` automaticamente. Login após reset: `olavo.piton@gmail.com` / `staging123`.

## Sync dados anonimizados de prod

```bash
STAGING_MODE=true \
DATABASE_URL_PROD=<prod-readonly-neon-url> \
DATABASE_URL=<staging-neon-url> \
pnpm tsx scripts/sync-prod-to-staging.ts --apply --since=30
```

- `--since=N` filtra orgs criadas/atualizadas nos últimos N dias (default 90).
- `--org=<id>` sincroniza só essa org.
- Sem `--apply` é dry run.
- CPF/email/telefone mascarados automaticamente (LGPD).
- Pula AuditLog, AIUsage, AsaasWebhookEvent.

## Cron toggles (UI)

`https://staging.imobpro.ia.br/settings/staging-crons` — owner-only.

Cada cron tem switch. Em staging: default OFF; só rodam os ligados na UI. Em prod a tela existe mas não tem efeito (todos os crons rodam sempre).

Crons marcados como **custo real** (badge vermelho) ligam APIs externas pagas — cuidado ao habilitar.

## ClickSign budget cap

Conta ClickSign é a mesma de prod (sem sandbox). Em staging:
- `Envelope.name` prefixado `[STAGING] `
- `CLICKSIGN_MONTHLY_BUDGET_CENTS=3000` (R$30/mês cap)
- Cada signer real custa R$1,50 — máximo ~20 signers/mês

Se estourar: `EnvelopeBudgetError` lançada. Aumentar cap via env (rebuild Vercel) ou esperar o mês virar.

## ClickSign multitenant (per-org)

Desde 2026-07, ClickSign é **per-org**: cada imobiliária conecta a própria conta em `/settings/signatures › Conexão` (token/webhook criptografados em `ClickSignAccount`, AES-256-GCM). O envio resolve a credencial via `resolveClickSignCreds(orgId)`:
- Org com conta conectada → usa a conta dela; webhook per-org em `/api/webhooks/clicksign/[slug]` (HMAC próprio).
- **Fallback global** (env `CLICKSIGN_API_TOKEN`/`CLICKSIGN_WEBHOOK_SECRET`) só pra org compartilhada legada (`SHARED_ORG_ID`); qualquer outra org sem conta **não envia** (409 `ClickSignNotConfiguredError`).

O webhook auto-provisionado aponta pra `NEXTAUTH_URL/api/webhooks/clicksign/{slug}` — garantir `NEXTAUTH_URL=https://staging.imobpro.ia.br` em staging, senão os eventos não chegam. Conectar exige `MASTER_ENCRYPTION_KEY` no ambiente.

## Migrations em build (Vercel)

O build roda `node scripts/vercel-migrate.mjs`, que só executa `prisma migrate deploy` quando `VERCEL_ENV=production` (deploy de prod do projeto), pulando em **preview**. O projeto `web` tem o `DATABASE_URL`/`DIRECT_URL` do escopo **Preview** apontando pro branch Neon de **staging** — então preview de PR nunca migra nem lê o banco de produção. (Contexto: incidente 2026-07-14 em que um preview migrou prod e travou os deploys.)

## Asaas sandbox

Subconta sandbox separada. Webhooks apontam pra:
- `https://staging.imobpro.ia.br/api/webhooks/asaas` (token novo `ASAAS_WEBHOOK_TOKEN`)
- `https://imobpro.ia.br/api/webhooks/asaas` (token original, prod)

Tokens HMAC diferentes garantem isolamento — se um chega no outro endpoint por engano, 401.

## Google OAuth (Testing mode)

OAuth Client separado `Contractmaker Staging` no GCP. Modo Testing → refresh tokens expiram a cada 7 dias. Quando login OAuth quebrar:
1. Vai no GCP Console → OAuth consent screen → confirma Testing
2. Re-faz login manual numa conta whitelistada (test users)
3. App refaz `refresh_token` automaticamente

Pra evitar: promove o OAuth client pra `In production` (precisa de Google review).

## Newton (WhatsApp) desabilitado

`NEWTON_DISABLED=true` em staging skipa `triggerNewtonForRequest`. Pedidos ficam `open` mas Newton nunca cobra. Audit log mostra "newton-disabled-staging".

Quer testar Newton de verdade? Rode container sidecar separado no VPS (`agentId=staging`) e tire `NEWTON_DISABLED`. Custo Z-API por número.

## Email override

`STAGING_EMAIL_OVERRIDE=olavo.piton@gmail.com` recebe todos os e-mails. Domínio interno `imobpro.ia.br` passa direto. Qualquer outro destinatário é redirecionado com prefixo `[STAGING]` no subject + original log.

## Health check

`https://staging.imobpro.ia.br/api/health` retorna:

```json
{
  "status": "ok",
  "env": "staging",
  "vercelEnv": "production",
  "asaasEnv": "sandbox",
  "dbConnected": true,
  "dbLatencyMs": 12,
  "redisConnected": true,
  "version": "abc1234",
  "branch": "staging",
  "rootDomain": "staging.imobpro.ia.br"
}
```

Aponte UptimeRobot ou similar pra esse endpoint, assert `status==="ok"`.

## Troubleshooting

**"Webhook não chega em staging"** — confere se foi cadastrado na conta sandbox (Asaas) ou se URL `staging.imobpro.ia.br` está no webhook config (ClickSign). DNS deve resolver: `dig staging.imobpro.ia.br`.

**"Migration não rodou"** — `pnpm prisma migrate status` na branch Neon staging. Vercel build roda `prisma migrate deploy` automático; se quebrou, ver build log.

**"Login não funciona"** — magic link cai no STAGING_EMAIL_OVERRIDE. Check Resend dashboard pra ver se enviou.

**"ClickSign budget estourado"** — aumenta `CLICKSIGN_MONTHLY_BUDGET_CENTS` no Vercel staging env e redeploy.

**"Neon branch desync"** — `pnpm prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url $DATABASE_URL_STAGING` mostra drift. Aplique manualmente ou rode CI weekly.

**"Cron toggle não pega"** — confere se `STAGING_MODE=true` está no Vercel staging env e o pod foi redeployado.
