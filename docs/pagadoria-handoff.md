# Handoff — Módulo Pagadoria (2026-04-20)

Status: **bloqueado em setup de 2FA do admin em produção**. Próxima sessão precisa investigar por que `/api/security/2fa/setup` retorna 500 mesmo após copiar env vars de Preview → Production e fazer redeploy.

Este doc consolida todo o trabalho feito, o estado atual, e o checklist para retomar. Manter atualizado conforme novas sessões avançam.

---

## 1. Onde estamos

### 1.1 Fases concluídas

| Fase | Status | Commits principais |
|---|---|---|
| 1a — Security baseline (RBAC + 2FA + elevation + audit) | ✅ | 562d94ed, 6c3beb74 |
| 1b — Asaas client + KYC + cobrança | ✅ | 39b79ba0 |
| 2 — Módulo `/financeiro` + taxas + `/pay` público | ✅ | 8b6505ea |
| 3 — Transferências + dual approval + conciliação + relatórios | ✅ | 05ed8e49 |
| 4 — Polish (notif bell + devices UI + platform fee) | ✅ | 4ca02230 |
| QA UX Round 1 (preview Vercel) | ✅ (parcial — ver §2) | — |
| Fixes P0+P1 pós-QA 1 | ✅ | e6998da4 |
| Infra QA Round 2 (seed → preflight) | ✅ | 24de21ef, 13eb2481 |
| Helpers MCP Asaas + script setup automatizado | ✅ | 3083b48b, 3de7f143 |
| **QA UX Round 2 (produção)** | 🔴 **BLOQUEADO em setup 2FA** | — |

### 1.2 Branch + PR

- Branch: `feat/pagadoria-fase-1a-security`
- PR: #1 (github.com/olavopitonjunior/contractmaker/pull/1)
- **Merge status**: não mergeado — user mergeou ou deployou direto da branch para produção?
- Último commit: `3de7f143 feat(pagadoria): automatiza setup de QA via endpoints sandbox Asaas`

### 1.3 Deploys Vercel atuais

- **Production ativo agora**: `https://web-ol0dt8zcy-olavopiton-4477s-projects.vercel.app` (redeploy pós env fix)
- Production anterior: `web-7dcj1gra4-...` (antes do fix de env vars)
- Preview mais recente da branch: `web-98zp70fzm-...`

### 1.4 Estado do 1º QA (Claude Chrome contra preview)

Rodou em 2026-04-19 contra preview `web-nromndcww`. Resultado: **5 PASS + 2 FAIL + 9 BLOCKED + 1 PARCIAL**. BUG 2 (elevation no KYC upload) cascateou bloqueando 9 blocos.

- **5 fixes P0+P1** aplicados em `e6998da4`:
  1. Sidebar sem item "Financeiro" → adicionado
  2. KYC upload silenciava ELEVATION_REQUIRED → tratado + ElevationDialog renderizado
  3. MembersPageClient loop infinito de elevation → `pendingAction` persistido + ação retomada no `onSuccess`
  4. `/financeiro/*` sub-rotas sem KYC gate → layout server component + middleware `x-pathname` header
  5. Sidebar responsiva 375px → investigado, Shadcn já cobre via Sheet drawer

- Arquivos críticos desses fixes: [app-sidebar.tsx](../apps/web/src/components/layout/app-sidebar.tsx), [MembersPageClient.tsx](../apps/web/src/components/security/MembersPageClient.tsx), [OnboardingWizard.tsx](../apps/web/src/components/financeiro/onboarding/OnboardingWizard.tsx), [financeiro/layout.tsx](../apps/web/src/app/(dashboard)/financeiro/layout.tsx), [middleware.ts](../apps/web/src/middleware.ts).

- Segurança: TOTP secret `DYTDIQSEPQJE4GIB` e 2 recovery codes foram **vazados e sanitizados** do doc `docs/relatório QA`. 2FA do admin foi **resetado** via DELETE na tabela `TwoFactorSecret` nesta sessão (dia 2026-04-20).

### 1.5 Mudança de estratégia: pré-launch em produção

Decisão tomada em 2026-04-20 ([commit 13eb2481](https://github.com/olavopitonjunior/contractmaker/commit/13eb2481)): abandonar seed endpoint + preview + KYC bypass. A aplicação é **pré-launch** (sem usuários reais). QA Round 2 roda em **production real** com Asaas sandbox usando KYC real do admin.

Vantagens:
- URL estável (prod domain)
- Sem preview protection
- Testa fluxo Asaas real (não bypass de DB)
- Zero código de seed/bypass em produção

### 1.6 Infra automatizada criada (commit 3de7f143)

Derivada da descoberta via MCP Asaas sobre endpoints sandbox:

- [apps/web/src/lib/asaas/sandbox.ts](../apps/web/src/lib/asaas/sandbox.ts) — `approveSandboxAccount`, `confirmSandboxPayment`, `overdueSandboxPayment` (guard `ASAAS_ENV !== "production"`)
- [apps/web/src/lib/asaas/webhooks.ts](../apps/web/src/lib/asaas/webhooks.ts) — CRUD de `/v3/webhooks` + `upsertWebhookByUrl` idempotente
- [apps/web/scripts/setup-pagadoria-qa.ts](../apps/web/scripts/setup-pagadoria-qa.ts) — 1 comando: cadastra webhook + aprova subconta sandbox + sincroniza DB
- [apps/web/src/app/api/admin/preflight-qa/route.ts](../apps/web/src/app/api/admin/preflight-qa/route.ts) — endpoint autenticado com 30+ checks de env/DB/Asaas/Resend/Upstash/deals
- [apps/web/src/lib/dev/preflight.ts](../apps/web/src/lib/dev/preflight.ts) — helper puro que roda os checks

### 1.7 MCP Asaas instalado

Commit do plan: `3083b48b` / config: `~/.claude.json` escopo user.

```
claude mcp list | grep asaas
# asaas: https://docs.asaas.com/mcp (HTTP) - ✓ Connected
```

Tools disponíveis:
- `list-specs`, `list-endpoints`, `search-endpoints`, `get-endpoint` — discovery
- `search`, `fetch` — guias
- `execute-request` — executa HTTP (HAR) — precisa token Asaas em header `access_token`

Endpoints descobertos durante a sessão:
- `POST /v3/sandbox/myAccount/approve` — aprova subconta sandbox (body `{}`)
- `POST /v3/sandbox/payment/{id}/confirm` — simula recebimento
- `POST /v3/sandbox/payment/{id}/overdue` — força OVERDUE
- `POST /v3/webhooks` — cadastra webhook com body `WebhookConfigSaveRequestDTO`
- `GET /v3/myAccount/status` — health check dos 4 status da subconta

---

## 2. Bug atual (bloqueante para QA Round 2)

### 2.1 Sintoma

No deploy de produção, após login como `admin@contractmaker.com`:
- `/settings/seguranca` renderiza OK
- Clicar **Configurar 2FA** → abre dialog modal
- Clicar **Começar** dentro do dialog → QR **NÃO aparece**
- DevTools → Network: `POST /api/security/2fa/setup` retorna **500 com body vazio**

### 2.2 O que foi investigado nesta sessão

- ✅ DB de prod foi consultado, confirmado que o endpoint **não chegou a criar** o `TwoFactorSecret` row → erro é antes do Prisma
- ✅ `TwoFactorSecret` antigo do admin foi deletado no DB prod (estava migrado do QA preview com `enabled=true`)
- ✅ **Causa encontrada (primeira hipótese):** apenas `AUTH_SECRET` e `NEXTAUTH_URL` estavam setadas em Production Vercel. Env vars críticas (`MASTER_ENCRYPTION_KEY`, `CHALLENGE_TOKEN_SECRET`, `SUDO_TOKEN_SECRET`, `TRUSTED_DEVICE_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `ASAAS_*`, `UPSTASH_*`, `BLOB_READ_WRITE_TOKEN`) faltavam → `encryptTotpSecret` joga `Error("MASTER_ENCRYPTION_KEY ausente")`.
- ✅ Todas as **13 env vars foram copiadas de Preview → Production** via `vercel env add ... production --force`
- ✅ **Redeploy disparado**: `web-ol0dt8zcy-olavopiton-4477s-projects.vercel.app`
- 🔴 **User testou após redeploy → continua 500 body vazio**

### 2.3 Hipóteses não investigadas

**Ordem de prioridade (próxima sessão atacar nesta ordem):**

1. **Deploy ainda não terminou**: verificar status do `web-ol0dt8zcy-...` em `vercel.com/olavopiton-4477s-projects/web/deployments` (Ready/Error/Building). Se está Building, aguardar.

2. **Browser cache**: mesmo após redeploy, Vercel production URL pode servir bundle antigo para sessão cache-persistente. Pedir ao user: Ctrl+Shift+R ou aba anônima.

3. **Migration pendente**: o build de prod roda `prisma migrate deploy` mas pode ter falhado silenciosamente. Verificar `_prisma_migrations` em prod: precisa ter todas as migrations do `apps/web/prisma/migrations/`. Especialmente as da fase 1a que criaram `TwoFactorSecret`, `SessionElevation`, etc.

4. **Outro erro no endpoint pós env vars setadas**: puxar logs do **deploy novo** (`web-ol0dt8zcy-...`) especificamente:
   ```
   vercel logs web-ol0dt8zcy-olavopiton-4477s-projects.vercel.app
   ```
   Filtrar por `2fa/setup` e ver o stack trace real.

5. **Admin user ausente em prod**: na sessão anterior confirmei que existe (`cmnt1lcsm000011bwjcenbzs4`). Mas worth re-confirmar via preflight.

6. **requireAuth failing**: `ctx.userEmail` pode vir undefined se session callback não estiver injetando corretamente. Ver [lib/auth/context.ts](../apps/web/src/lib/auth/context.ts).

7. **@next/env escape do `$`**: lembrar que `ASAAS_API_KEY` começa com `$aact_hmlg...`. Em dev isso precisa de escape no .env. **Em Vercel env vars NÃO precisa de escape** (não passa por dotenv-expand). Confirmado — mas worth double check que o valor sincronizado NÃO tem `\$` literal.

### 2.4 Ação recomendada primeira na próxima sessão

**Rodar o preflight pela UI autenticada.** Ele faz 30+ checks e aponta exatamente o que está errado. É o próprio endpoint que criamos nesta sessão.

Via DevTools Console logado em prod:
```javascript
fetch('/api/admin/preflight-qa', { credentials: 'include' })
  .then(r => r.json())
  .then(r => console.log(JSON.stringify(r, null, 2)))
```

Deve retornar um objeto com `blockersCount`, `warningsCount`, e array `checks` com severidade por categoria.

---

## 3. Checklist — próxima sessão

### 3.1 Setup MCPs (sessão nova)

- [ ] Abrir Claude Code em sessão nova (`/clear` ou fechar/abrir)
- [ ] Confirmar MCPs disponíveis: `claude mcp list` deve listar `asaas` + (opcionalmente) `neon`
- [ ] Se quiser instalar MCP Neon para acesso direto ao DB: `claude mcp add neon npx "@neondatabase/mcp-server-neon" start --scope user`. Precisa `NEON_API_KEY` configurada
- [ ] (Opcional) Adicionar token Asaas como header no config: ver [seção 6](#6-referências-de-configuração)

### 3.2 Diagnosticar o bug 500 no `/api/security/2fa/setup`

Em ordem:

1. [ ] Verificar status do deploy `web-ol0dt8zcy-...` via `vercel ls web --prod`
2. [ ] Se Ready → `vercel logs web-ol0dt8zcy-olavopiton-4477s-projects.vercel.app 2>&1 | grep -A 20 '2fa/setup'` — achar stack trace
3. [ ] Em browser, em aba anônima nova, logar como admin → DevTools → Network → rodar preflight:
   ```javascript
   fetch('/api/admin/preflight-qa', { credentials: 'include' }).then(r=>r.json()).then(r=>console.log(JSON.stringify(r,null,2)))
   ```
4. [ ] Se preflight retorna blockers: resolver cada um + redeploy
5. [ ] Se preflight OK mas 2FA ainda falha: checar migrations prod via Prisma CLI:
   ```bash
   cd apps/web
   vercel env pull .env.prod.tmp --environment=production
   DATABASE_URL=... npx prisma migrate status
   ```
6. [ ] Validar que `TwoFactorSecret` existe como tabela em prod

### 3.3 Após destravar 2FA do admin

1. [ ] Setup 2FA completo em `/settings/seguranca` (QR → app autenticador → recovery codes → salvar num gerenciador de senhas)
2. [ ] `/financeiro/onboarding` → preencher dados + upload docs → status `AWAITING_APPROVAL`

### 3.4 Rodar setup automatizado (seção E do checklist)

```bash
cd apps/web
vercel env pull .env.production.local --environment=production

DOTENV_CONFIG_PATH=.env.production.local \
npx tsx -r dotenv/config scripts/setup-pagadoria-qa.ts \
  --app-url https://web-ol0dt8zcy-olavopiton-4477s-projects.vercel.app \
  --email admin@contractmaker.com
```

Esperado:
- Cadastra webhook no Asaas sandbox
- Aprova subconta sandbox via `POST /v3/sandbox/myAccount/approve`
- Atualiza AsaasAccount.status → APPROVED
- Health check via `GET /v3/myAccount/status`

### 3.5 Preflight final + QA

1. [ ] `fetch('/api/admin/preflight-qa')` → confirmar `{ok: true, blockersCount: 0}`
2. [ ] Copiar URL de prod e `publicLinkToken` / `dualApprovalId` necessários
3. [ ] Colar [docs/claude-chrome-qa-pagadoria-uxui.md](claude-chrome-qa-pagadoria-uxui.md) no Claude Chrome, substituir `{PROD_URL}`
4. [ ] Rodar os 17 blocos, consolidar bugs no relatório

### 3.6 Cleanup (pós-QA)

- Cancelar cobranças `[QA UX]` via UI
- Rejeitar dual approval pendente
- Reverter branding se alterado
- **NÃO** mexer na subconta Asaas nem no admin user (ficam prontos para próximos QAs)

---

## 4. Credenciais e URLs (reference card)

### Produção
- URL atual: `https://web-ol0dt8zcy-olavopiton-4477s-projects.vercel.app`
- Admin login: `admin@contractmaker.com` / `E2EtestPwd!2026`
- 2FA: **resetado, precisa configurar de novo**

### Vercel
- Team: `olavopiton-4477s-projects`
- Project: `web`
- Dashboard: https://vercel.com/olavopiton-4477s-projects/web
- Env vars URL: https://vercel.com/olavopiton-4477s-projects/web/settings/environment-variables

### GitHub
- Repo: `olavopitonjunior/contractmaker`
- Branch: `feat/pagadoria-fase-1a-security`
- PR: https://github.com/olavopitonjunior/contractmaker/pull/1

### Asaas
- Ambiente: sandbox (`ASAAS_ENV=sandbox`)
- Dashboard: https://sandbox.asaas.com
- API key: começa com `$aact_hmlg_` (166 chars) — conta pessoal do user (ver DEC-2026-004 no plano)

### Neon (DB)
- Console: https://console.neon.tech
- Preview e Production **compartilham o mesmo DB branch** (confirmado via queries nesta sessão)

---

## 5. Comandos úteis

### Puxar env vars production para debug
```bash
cd apps/web
vercel env pull .env.prod.tmp --environment=production
# usar .env.prod.tmp para debug local
rm .env.prod.tmp  # sempre limpar depois
```

### Ver logs do deploy atual
```bash
vercel logs web-ol0dt8zcy-olavopiton-4477s-projects.vercel.app 2>&1 | grep -iE "2fa|error|500" | head -30
```

### Listar deployments
```bash
vercel ls web | head -10
```

### Redeploy forçado
```bash
vercel redeploy <url-do-deploy-atual> --target=production --no-wait
```

### Conectar ao Prisma DB de prod (cuidado)
```bash
cd apps/web
DATABASE_URL=$(grep '^DATABASE_URL=' .env.prod.tmp | cut -d= -f2- | sed 's/^"//;s/"$//') \
  node -e "
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const u = await p.user.findUnique({ where: { email: 'admin@contractmaker.com' } });
  console.log(u);
  await p.\$disconnect();
})();
"
```

---

## 6. Referências de configuração

### MCPs configurados
Arquivo: `~/.claude.json` (escopo user)

```json
{
  "mcpServers": {
    "asaas": {
      "type": "http",
      "url": "https://docs.asaas.com/mcp"
    }
  }
}
```

Para adicionar token Asaas (persiste em toda conversa futura — considerar se vale):
```json
{
  "mcpServers": {
    "asaas": {
      "type": "http",
      "url": "https://docs.asaas.com/mcp",
      "headers": {
        "access_token": "$aact_hmlg_..."
      }
    }
  }
}
```

### Env vars em Production (estado após fix desta sessão)

Setadas e verificadas:
- `AUTH_SECRET`, `NEXTAUTH_URL` (já estavam)
- `MASTER_ENCRYPTION_KEY` (44 chars base64)
- `CHALLENGE_TOKEN_SECRET`, `SUDO_TOKEN_SECRET`, `TRUSTED_DEVICE_SECRET` (64 chars hex cada)
- `RESEND_API_KEY`, `EMAIL_FROM`
- `ASAAS_API_KEY`, `ASAAS_ENV`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_MAX_TRANSFER_VALUE`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `BLOB_READ_WRITE_TOKEN`
- `DATABASE_URL`, `DIRECT_URL` (sempre estiveram — shared com Preview)

**Não verificado explicitamente**:
- `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `VOYAGE_API_KEY`, `INFOSIMPLES_TOKEN` — opcionais, sem elas outras features degradam mas Pagadoria funciona
- `ALLOW_SELF_REGISTER` — pode estar ausente
- `CRON_SECRET` — pode estar ausente

O preflight vai reportar todos.

---

## 7. Decisões arquiteturais relevantes (do plano principal)

Consultar [C:\Users\User\.claude\plans\memoized-herding-panda.md](../../../C:/Users/User/.claude/plans/memoized-herding-panda.md) para full context. Sumário:

- **DEC-2026-001**: manter Next 14 (não subir para 15) — skipped CVEs registradas
- **DEC-2026-002**: npm (não pnpm como inicialmente no plano)
- **DEC-2026-003**: otplib v12 (v13 é ESM-only e quebrou com Next 14)
- **DEC-2026-004**: sandbox Asaas em conta PF pessoal do owner. Ao migrar para prod real → trocar ASAAS_API_KEY + orgs precisam refazer KYC
- **DEC-2026-005**: `$` no início de valores .env precisa escape com `\$` em dev (dotenv-expand). Em Vercel env vars NÃO precisa.

---

## 8. Arquivos criados/modificados nesta sessão

### Código
- `apps/web/src/lib/asaas/sandbox.ts` (novo)
- `apps/web/src/lib/asaas/webhooks.ts` (novo)
- `apps/web/scripts/setup-pagadoria-qa.ts` (novo)
- `apps/web/src/app/api/admin/preflight-qa/route.ts` (novo)
- `apps/web/src/lib/dev/preflight.ts` (novo)
- `apps/web/src/middleware.ts` (removido seed exclusion)
- `apps/web/.env.example` (removido `SEED_ADMIN_TOKEN`)
- Deletados: `apps/web/src/app/api/admin/seed-pagadoria-qa/`, `apps/web/src/lib/dev/seedPagadoriaQa.ts`

### Docs
- `docs/pre-qa-checklist.md` (atualizado — setup 35min → 15min)
- `docs/claude-chrome-qa-pagadoria-uxui.md` (atualizado — removida seção seed, added preflight)
- `docs/relatório QA` (sanitizado — TOTP secret + recovery codes removidos)
- `docs/pagadoria-handoff.md` (este arquivo)

### Config externa (não versionada)
- `~/.claude.json` — MCP Asaas adicionado em escopo user
- Vercel Production env vars — 13 vars copiadas de Preview
- DB de prod — `TwoFactorSecret` do admin deletado (reset 2FA)

---

**Última atualização:** 2026-04-20, sessão Claude Code com auto-memory. Próximo agent: comece rodando o preflight ou olhando logs do deploy atual.
