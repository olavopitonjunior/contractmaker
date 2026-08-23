# Staging — workflow operacional

Ambiente de homologação `staging.imobpro.ia.br` (Vercel project `contractmaker-staging`, branch git `staging`, Neon branch `staging`). Permite testar UI + integrações + crons + webhooks sem tocar dados/cobrança/assinatura reais.

## Promote staging → prod

```bash
# 1. Faz feature na sua branch
git checkout -b feat/nova-coisa master

# 2. Abre PR da feature PARA staging.
#    NÃO faça `git checkout staging && git merge && git push`: o
#    `staging-ci.yml` roda o gate de lint só em `pull_request`, então um merge
#    direto entra sem ser lintado e o problema só aparece no PR de promoção,
#    num diff staging→master enorme.
gh pr create --base staging --head feat/nova-coisa

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

# Gate humano: hotfix pula a homologação em staging, então precisa do label
# de escape (o CI bloqueia sem ele). Aplicar é uma decisão consciente e fica
# registrada na timeline do PR com autor e horário:
gh pr edit <NUM> --add-label hotfix-sem-smoke

# Merge → prod
# Depois cherry-pick na staging pra evitar drift:
git checkout staging
git cherry-pick <hotfix-sha>
git push
```

`hotfix-sem-smoke` dispensa o **smoke**, nunca a **validação**: typecheck e testes
são do `ci.yml`, rodam em todo PR pra master e não têm label que os pule.

## O gate de master

Dois workflows, com papéis separados, ambos em **todo** PR com base `master`:

| Workflow | Job | O que exige | Escape |
| --- | --- | --- | --- |
| `ci.yml` | `typecheck + unit` | prisma validate + tsc + vitest | nenhum |
| `promote-to-prod.yml` | `Require smoke/hotfix label` | `staging-smoke-passed` se o head for `staging`; `hotfix-sem-smoke` caso contrário | o label é o escape |

As duas exigências de label são disjuntas de propósito: `hotfix-sem-smoke` **não**
satisfaz um PR vindo de `staging`, senão viraria um bypass do smoke no fluxo de
todo dia.

Até 2026-08-19 o job de label tinha `if: github.head_ref == 'staging'`. Num PR de
qualquer outra branch ele era **pulado** — e o GitHub conta job pulado como
sucesso pra branch protection. Ou seja: o gate humano que existia pra proteger
master era justamente o que deixava `hotfix/*` entrar sem aprovação manual
nenhuma. (A validação em si nunca esteve descoberta: o `ci.yml` sempre rodou em
todos.) O `if:` foi removido; o que era um pulo virou uma exigência diferente.

`promote-to-prod.yml` também tinha um job `validate` idêntico ao do `ci.yml` —
mesmos env, mesmos steps. Foi removido: dobrava o tempo de CI sem acrescentar
sinal. Este workflow é só o gate humano.

> O gate humano (`promote-to-prod.yml`) só dispara em `pull_request`. Push direto
> em `master` não passa por ele. O `ci.yml` até roda em `push: [master]`, mas aí
> o commit já entrou — ele reporta, não barra. Quem fecha essa porta é a branch
> protection exigindo PR.

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

## ClickSign em staging — SEM cap

Conta ClickSign é a mesma de prod (sem sandbox). Em staging o único gate é
cosmético: `Envelope.name` prefixado `[STAGING] `.

**Não há mais teto de envio.** Até 08/2026 existia `CLICKSIGN_MONTHLY_BUDGET_CENTS=3000`,
que a plataforma comparava com um custo estimado por uma tabela de preços
chutada no código — ele barrava envio com valor inventado (o caso que motivou a
remoção: "R$ 93 de R$ 100" numa conta cujo plano estava intacto). A env não é
mais lida por ninguém.

Consequência prática: **cada envio de staging consome um envelope real do plano
ClickSign, cobrado.** Não há freio automático — não faça smoke de assinatura em
lote. O único bloqueio possível agora é o da própria ClickSign, quando o plano
acaba (`EnvelopePlanLimitError`, HTTP 402 — ver `lib/clicksign/quota.ts`).

## ClickSign multitenant (per-org)

Desde 2026-07, ClickSign é **per-org**: cada imobiliária conecta a própria conta em `/settings/signatures › Conexão` (token/webhook criptografados em `ClickSignAccount`, AES-256-GCM). O envio resolve a credencial via `resolveClickSignCreds(orgId)`:
- Org com conta conectada → usa a conta dela; webhook per-org em `/api/webhooks/clicksign/[slug]` (HMAC próprio).
- **Fallback global** (env `CLICKSIGN_API_TOKEN`/`CLICKSIGN_WEBHOOK_SECRET`) só pra org compartilhada legada (`SHARED_ORG_ID`); qualquer outra org sem conta **não envia** (409 `ClickSignNotConfiguredError`).

O webhook auto-provisionado aponta pra `NEXTAUTH_URL/api/webhooks/clicksign/{slug}` — garantir `NEXTAUTH_URL=https://staging.imobpro.ia.br` em staging, senão os eventos não chegam. Conectar exige `MASTER_ENCRYPTION_KEY` no ambiente.

## Migrations em build (Vercel)

Quem migra é o **`build:deploy`**, e é pra ele que o `buildCommand` do `vercel.json` aponta. Ele roda `node scripts/vercel-migrate.mjs`, que só executa `prisma migrate deploy` quando `VERCEL_ENV=production` (deploy de prod do projeto) — pulando em **preview**, em **development** e fora do Vercel. Escape hatch: `FORCE_MIGRATE=1`.

`npm run build` (sem sufixo) **não migra**, de propósito: antes migrava, e um build na máquina de alguém aplicava migration contra o banco que o `.env` daquela pasta apontasse (issue #375).

O projeto `web` tem o `DATABASE_URL`/`DIRECT_URL` do escopo **Preview** apontando pro branch Neon de **staging** — então preview de PR nunca migra nem lê o banco de produção. (Contexto: incidente 2026-07-14 em que um preview migrou prod e travou os deploys.)

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

`NEWTON_DISABLED=true` em staging skipa `triggerNewtonForRequest` (hoje: envio de pesquisa por WhatsApp e cancelamento de lembrete legado). Audit log mostra "newton-disabled-staging". Desde 2026-07-25 criar pedido no inbox não dispara nada nem em prod — ver [docs/newton-integration.md §0](newton-integration.md).

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

**"ClickSign sem envelopes disponíveis" (402)** — é o plano da CONTA ClickSign que acabou, não um teto da plataforma (esse não existe mais). Verifique o plano no painel da ClickSign. O corpo cru da recusa fica no log do Vercel como `[clicksign] falha 4xx`.

**"Neon branch desync"** — `pnpm prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url $DATABASE_URL_STAGING` mostra drift. Aplique manualmente ou rode CI weekly.

**"Cron toggle não pega"** — confere se `STAGING_MODE=true` está no Vercel staging env e o pod foi redeployado.
