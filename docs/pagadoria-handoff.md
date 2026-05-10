# Handoff — Módulo Pagadoria (atualizado 2026-05-09 — Pagadoria v2 entregue)

Status: **v2 deployada em prod**. Wizard reusável `ChargeWizard` (3 modes), mapper imobiliária→comissionados, multi-corretora, magic link público, wizard draft, drawer de origem, validate por etapa, UI cleanup pós-feedback. Smoke estrutural OK em prod via Chrome MCP até Etapa 4 (smoke real R$ 5 cancelado por decisão do usuário pra não tocar cliente real do contrato).

Este doc consolida o trabalho feito, o estado atual, e o checklist para retomar. Manter atualizado conforme novas sessões avançam.

## v2 (2026-05-09) — sumário

Commits empilhados em master:
- `9a440762` feat(pagadoria): wizard v2 — mapper, multi-corretora, transparência, fallbacks
- `cfda756f` feat(pagadoria): magic link + wizard draft + drawer origem + validate por etapa + UI cleanup
- `72da91df` docs(claude.md): seção Pagadoria v2 + schemas críticos atualizados
- `1eb90cd9` test(pagadoria): unit tests matcher + validators (27/27)

Origem da v2: smoke E2E na venda Sandra Yamamoto (deal `cmosu2mze0005111ecs2bpi8j`) revelou que `comissionados[]` retornava vazio mesmo com 1 corretora declarada no CCV — schema mono-corretora `comissao.imobiliaria_*` não convertido em entrada de array. Casos reais inutilizáveis no wizard.

### Mudanças centrais

1. **Backend mapper** (`apps/web/src/app/api/deals/[dealId]/contract-data-summary/route.ts`)
   - `deriveComissionados()` converte `imobiliaria_*` → `comissionados[{source: "ccv.imobiliaria_principal"}]` quando array explícito vazio
   - `enrichWithMatch()` reusa `commissionados-matcher.ts` pra preencher `splitRecipientId` quando há recipient cadastrado por CPF/CNPJ ou nome

2. **Multi-corretora** (schema + form + templates + Gemini)
   - `comissao.comissionados[].papel` enum (captador/intermediador/indicador/imobiliaria_principal/outro)
   - `superRefine` no Zod: soma percentuais ≤ 100
   - `ComissaoConfigStep` UI com Percentual + Papel + soma visual com cores
   - Templates Handlebars `ccv_a_vista_v2.hbs` e `ccv_financiamento_v2.hbs` com `{{#if comissao.comissionados.length}}{{#each ...}}` + fallback `imobiliaria_*`. **Sync já rodado contra prod DB**
   - Prompt Gemini estendido com `papel` + `percentual`

3. **Hide-from-payer** (privacidade interna)
   - `splitJson.display.{hiddenRecipientIds, consolidationMap}` persistido
   - `generatePayerVisibleDescription()` em `lib/asaas/commission.ts` omite ocultos
   - SplitEditor: toggle por linha + select de consolidação
   - Asaas não expõe split → privacidade real intacta

4. **Rascunho `SplitRecipient`** com `pendingFields String[]`
   - Permite cadastrar inline com chave PIX/walletId vazios
   - `splitDispatcher` pula recipients pendentes/inativos com `failureReason` claro
   - `/settings/pagamentos/split-recipients` ganhou seção "⚠️ Pendentes de completar"

5. **Magic link público** pra completar cadastro
   - `SplitRecipient.completionToken/Exp` — JWT-HMAC `AUTH_SECRET`, 7d
   - `POST /api/financeiro/split-recipients/[id]/request-completion` envia email Resend
   - `/financeiro/completar-cadastro?token=` (sem auth, token = credencial)
   - `POST /api/public/split-recipients/complete` valida e marca active:true
   - **Limitação:** sem domínio Resend verificado, magic link não chega em terceiros (memo `feedback_resend_sandbox`)

6. **Wizard draft** (salvar e retomar)
   - Model `CommissionChargeDraft { dealId, userId @@unique, state Json, expiresAt }` (30d)
   - `GET/POST/DELETE /api/deals/[id]/commission-charges/draft`
   - Wizard auto-aplica state no mount + toast "Continuando rascunho de…"
   - Submit final → `DELETE` automático
   - Cron diário 03:00 UTC: `/api/cron/drafts/cleanup`

7. **Drawer "De onde vieram esses valores?"** — botão `?` no header, render puro

8. **Validações por etapa** (transversal)
   - `lib/asaas/charge-validators.ts` puros (`validatePayer/Charge/Splits`)
   - `POST /api/deals/[id]/commission-charges/validate?step=...`
   - UI usa chips stateful client-side; endpoint serve fluxos automatizados

9. **UI cleanup pós-feedback** — wizard tinha texto demais
   - Banners 1 linha; microcopy de origem só quando relevante
   - Caixa azul Etapa 2: 4 linhas → 1
   - Parágrafo introdutório Etapa 3 → tooltip `(?)`
   - Memo `feedback_ui_density.md` pra próximas iterações

### Novas migrations (idempotentes)

- `20260509120000_charge_categorization_and_notif_prefs` — `categoryLabel` + 6 notify flags + `email`
- `20260509180000_pagadoria_v2_drafts_pending` — `pendingFields/completionToken/completionTokenExp`
- `20260509190000_commission_charge_draft` — model novo

### Pendências conhecidas (não-bloqueantes)

- **Wire validate na UI** — endpoint existe, wizard usa chips client-side. Marginal.
- **Smoke real R$ 5** — cancelado pra não tocar cliente real. Magic link bloqueado por Resend sandbox.
- **Resend domain** — `EMAIL_FROM=onboarding@resend.dev` só envia pro dono. Magic link, créditos a comissionados, etc. dependem de domínio verificado.

---

# Histórico (v1 — referência)

Status: **pronto para QA Round 2**. Ambiente de produção funcionando, 2FA do admin configurado, subconta sandbox aprovada, webhook cadastrado, Fase 5 (split multi-recipient) implementada e pushada.

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
| Fix env vars corrompidas (`\n` em Production) + 2FA destravado | ✅ | — (só Vercel dashboard) |
| Fix script orgMemberships + approve subconta sandbox | ✅ | 93c6acd6 |
| **Fase 5 — Split multi-recipient por cobrança** | ✅ | e1ed755a |
| **QA UX Round 2 (produção)** | 🟢 **DESBLOQUEADO — pronto pra rodar** | — |

### 1.2 Branch + PR

- Branch: `feat/pagadoria-fase-1a-security`
- PR: #1 (github.com/olavopitonjunior/contractmaker/pull/1)
- **Merge status**: não mergeado — mas deploys de `master` (production) usam os mesmos commits via push direto? Verificar se próximo deploy aplica as migrations novas (Fase 5 precisa da migration `20260420150000_add_split_recipient`).
- Último commit: `e1ed755a feat(pagadoria): split de pagamento multi-recipient (Fase 5)`

### 1.3 Deploys Vercel atuais

- **Production aliases estáveis**: `https://web-olavopiton-4477s-projects.vercel.app` (canonical), `web-git-master-...`, `web-zeta-three-4lyvmj9ut6.vercel.app`
- **Production deploy atual**: `web-qynrozzlo-...` (redeploy pós fix de env vars). Próximo deploy vai ser automático ao merge do `e1ed755a` em `master`.
- Preview da branch: deploy preview automático a cada push

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

## 2. Fix do 2FA 500 (resolvido)

### 2.1 Sintoma original

No deploy de produção, após login como `admin@contractmaker.com`:
- `/settings/seguranca` renderiza OK
- Clicar **Configurar 2FA** → abre dialog modal
- Clicar **Começar** dentro do dialog → QR **NÃO aparece**
- DevTools → Network: `POST /api/security/2fa/setup` retorna **500 com body vazio**

### 2.2 Root cause (identificado 2026-04-20 tarde)

7 env vars de Production foram salvas com `\n` literal escapado entre aspas (`"value\n"`). No runtime `process.env.X`, o `\n` vira newline real, corrompendo:

- `DATABASE_URL\n` / `DIRECT_URL\n` — Prisma connection problems silenciosos
- `AUTH_SECRET\n` — NextAuth assinando JWT com secret diferente
- `NEXTAUTH_URL\n` — URL inválida + apontava para alias antigo (`web-zeta-three-...`)
- `ALLOW_SELF_REGISTER="true\n"` — código comparava `=== "true"` → virava `false`
- `OCR_ENABLED="false\n"`, `ANTHROPIC_MODEL="...\n"` — idem

### 2.3 Fix aplicado

1. `vercel env rm` das 7 vars em Production
2. Re-add via `vercel env add ... production < /tmp/envval_X.txt` (arquivo **sem** trailing newline — gravado via Node `fs.writeFileSync` que não adiciona `\n`)
3. `NEXTAUTH_URL` atualizada pra alias canônico estável: `https://web-olavopiton-4477s-projects.vercel.app`
4. Redeploy → `web-qynrozzlo-olavopiton-4477s-projects.vercel.app` (Ready)
5. User logou na UI, configurou 2FA, KYC, subconta sandbox aprovada via script (após fix do bug `orgMemberships` → commit `93c6acd6`)

### 2.4 Hipótese de origem do bug

Provavelmente ao copiar vars de Preview→Production numa sessão anterior, um `echo "$value" | vercel env add` adicionou `\n` no final de cada valor. `vercel env pull` depois escapa newlines reais como `\n` escapado no .env output, mascarando o problema até o runtime.

### 2.5 Lição aprendida

- Ao sincronizar env vars programaticamente: usar `printf "%s"` (não `echo`) ou gravar via Node `fs.writeFileSync` para evitar trailing newlines
- Script [apps/web/scripts/setup-pagadoria-qa.ts](../apps/web/scripts/setup-pagadoria-qa.ts) usa fallback ASaaS key starting with `$` — **não** exportar via `source < file` em bash (expansão quebra). Gravar variables via Node antes de spawnar o child process.

---

## 2B. Fase 5 — Split multi-recipient (commit e1ed755a)

Entregue nesta sessão como parte de "Verifique como está o cadastro para split de pagamento". Corrigiu dois gaps identificados na auditoria:

**Gap 1 — platformFeeWalletId órfão**: o campo existia em `OrgFinancialSettings` desde Fase 4 mas **nunca podia ser setado via UI** (omitido do `patchSchema` Zod em `/api/financeiro/settings`). Resultado: `platformFeePercent > 0` nunca gerava split real. Fechado: campo adicionado ao Zod schema + input na UI `/settings/pagamentos/taxas`.

**Gap 2 — Sem split multi-recipient**: único split possível era "taxa da plataforma pra master wallet". Sem suporte para corretora/vendedor/etc.

**Entregue:**

- Novo model Prisma `SplitRecipient` com `label, walletId, cpfCnpj, description, active`
- Migration `20260420150000_add_split_recipient` (aplica via `prisma migrate deploy` no próximo deploy)
- Nova página `/settings/pagamentos/split-recipients` (CRUD com Sheet form)
- Novas rotas API `GET/POST /api/financeiro/split-recipients` + `PATCH/DELETE /api/financeiro/split-recipients/[id]` (soft delete via `active=false`, guards `SPLIT_VIEW`/`SPLIT_CONFIGURE`)
- Componente reutilizável `components/financeiro/SplitEditor.tsx`
- Integração no form `/financeiro/cobrancas/nova` (switch "Aplicar split de pagamento" + preview em tempo real de rateio em R$)
- Função pública `composeSplits()` em [lib/asaas/commission.ts](../apps/web/src/lib/asaas/commission.ts) centraliza validação: max 10 entries, sem duplicatas de walletId, sem wallet da própria org, soma `percentualValue ≤ 100`, `percentualValue OR fixedValue > 0`
- 13 unit tests passando (`commission-splits.test.ts`)
- 3 AuditActions novos: `SPLIT_RECIPIENT_CREATED | UPDATED | DELETED`

**Gaps remanescentes (fora de escopo Fase 5)**:

- Validação de walletIds contra Asaas (hoje aceita qualquer string — se walletId inválido, Asaas rejeita no create-payment)
- Split em cobranças vindas de Deal (`/api/deals/[dealId]/commission-charges`) ainda não aceita `customSplits` — só a avulsa
- `walletId` é imutável após criado (precisa criar novo recipient pra trocar)

---

## 3. Checklist — próxima sessão

### 3.1 Setup MCPs (sessão nova)

- [ ] Abrir Claude Code em sessão nova (`/clear` ou fechar/abrir)
- [ ] Confirmar MCPs disponíveis: `claude mcp list` deve listar `asaas` + (opcionalmente) `neon`
- [ ] Se quiser instalar MCP Neon para acesso direto ao DB: `claude mcp add neon npx "@neondatabase/mcp-server-neon" start --scope user`. Precisa `NEON_API_KEY` configurada
- [ ] (Opcional) Adicionar token Asaas como header no config: ver [seção 6](#6-referências-de-configuração)

### 3.2 Confirmar que Fase 5 chegou em prod

Após o push do commit `e1ed755a`, Vercel vai buildar e aplicar a migration `20260420150000_add_split_recipient` automaticamente.

1. [ ] Ir em `vercel.com/olavopiton-4477s-projects/web/deployments` e aguardar o deploy de master ficar **Ready**
2. [ ] Abrir `/settings/pagamentos/split-recipients` e confirmar que a página carrega (não 404/500)
3. [ ] Preflight de novo: `fetch('/api/admin/preflight-qa',{credentials:'include'}).then(r=>r.json()).then(r=>console.log(JSON.stringify(r,null,2)))` → `{ok: true}`

### 3.3 Rodar QA Round 2 via Claude Chrome

1. [ ] Abrir o arquivo **local** `docs/qa-round-2-prompt.md` (gitignored, tem URL já substituída)
2. [ ] Copiar o conteúdo completo (676 linhas)
3. [ ] Colar no Claude Chrome ativo em prod
4. [ ] Deixar rodar os 17 blocos autônomos. Ficar de plantão para:
   - Confirmar pagamentos sandbox via `POST /v3/sandbox/payment/{id}/confirm` (Blocos 7/11)
   - Forçar OVERDUE via `POST /v3/sandbox/payment/{id}/overdue` (Bloco 11)
   - Debug em tempo real via `vercel logs` se travar

### 3.4 Testar split de pagamento (Fase 5 nova)

Fluxo E2E no sandbox:

1. [ ] `/settings/pagamentos/split-recipients` → cadastrar 2 recipients (ex: `[QA] Corretora` + `[QA] Vendedor`) com walletIds reais de outras subcontas sandbox
2. [ ] (Opcional) `/settings/pagamentos/taxas` → setar `platformFeePercent=5%` + `platformFeeWalletId` da master wallet
3. [ ] `/financeiro/cobrancas/nova` → criar cobrança PIX ativando split (ex: 60% Corretora, 30% Vendedor, 5% plataforma auto, 5% remanescente na subconta)
4. [ ] Conferir `CommissionCharge.splitJson` persistido no DB
5. [ ] `confirmSandboxPayment(paymentId)` → conferir aba "Splits" no dashboard Asaas

### 3.5 Cleanup (pós-QA)

- Cancelar cobranças `[QA UX]` via UI
- Rejeitar dual approval pendente
- Desativar SplitRecipients de teste (`[QA] ...`) via UI
- Reverter branding se alterado
- **NÃO** mexer na subconta Asaas nem no admin user (ficam prontos para próximos QAs)

---

## 4. Credenciais e URLs (reference card)

### Produção
- URL canonical estável: `https://web-olavopiton-4477s-projects.vercel.app`
- Deploy atual (pós-fix env): `https://web-qynrozzlo-olavopiton-4477s-projects.vercel.app`
- Admin login: `admin@contractmaker.com` / `E2EtestPwd!2026`
- 2FA: **configurado nesta sessão (2026-04-20)** — user deve ter salvo TOTP secret + 10 recovery codes em gerenciador de senhas

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
vercel logs web-qynrozzlo-olavopiton-4477s-projects.vercel.app 2>&1 | grep -iE "error|500" | head -30
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

## 8. Arquivos criados/modificados por sessão

### Sessões anteriores (infra QA + setup)
- `apps/web/src/lib/asaas/sandbox.ts` (novo)
- `apps/web/src/lib/asaas/webhooks.ts` (novo)
- `apps/web/scripts/setup-pagadoria-qa.ts` (novo)
- `apps/web/src/app/api/admin/preflight-qa/route.ts` (novo)
- `apps/web/src/lib/dev/preflight.ts` (novo)
- `apps/web/src/middleware.ts` (removido seed exclusion)
- `apps/web/.env.example` (removido `SEED_ADMIN_TOKEN`)
- Deletados: `apps/web/src/app/api/admin/seed-pagadoria-qa/`, `apps/web/src/lib/dev/seedPagadoriaQa.ts`

### Sessão 2026-04-20 tarde (fix env + Fase 5)

**Código — Fase 5 split multi-recipient (commit `e1ed755a`):**
- `apps/web/prisma/migrations/20260420150000_add_split_recipient/migration.sql` (novo)
- `apps/web/prisma/schema.prisma` (+ model `SplitRecipient` + relation em `Organization`)
- `apps/web/src/app/api/financeiro/split-recipients/route.ts` (GET/POST novo)
- `apps/web/src/app/api/financeiro/split-recipients/[id]/route.ts` (PATCH/DELETE novo)
- `apps/web/src/app/(dashboard)/settings/pagamentos/split-recipients/page.tsx` + `SplitRecipientsClient.tsx` (novos)
- `apps/web/src/components/financeiro/SplitEditor.tsx` (novo, reutilizável)
- `apps/web/src/lib/asaas/commission.ts` (nova função pública `composeSplits` + validações)
- `apps/web/src/lib/asaas/__tests__/commission-splits.test.ts` (novo, 13 tests)
- `apps/web/src/app/api/financeiro/charges/nova/route.ts` (aceita `customSplits[]`)
- `apps/web/src/app/api/financeiro/settings/route.ts` (fecha gap — `platformFeeWalletId` no Zod)
- `apps/web/src/lib/financeiro/fees.ts` (+ `platformFeeWalletId` no type)
- `apps/web/src/app/(dashboard)/settings/pagamentos/taxas/page.tsx` (input de walletId)
- `apps/web/src/app/(dashboard)/financeiro/cobrancas/nova/page.tsx` (switch + SplitEditor integrado)
- `apps/web/src/app/(dashboard)/settings/page.tsx` (botão "Destinatários de split")
- `apps/web/src/lib/security/audit.ts` (+ 3 AuditActions)

**Fix script Prisma (commit `93c6acd6`):**
- `apps/web/scripts/setup-pagadoria-qa.ts` (`memberships` → `orgMemberships`)

**Docs:**
- `docs/pagadoria-handoff.md` (atualizado para refletir estado pós-fix + Fase 5)
- `docs/qa-round-2-prompt.md` (gerado, gitignored — PROD_URL substituído)
- `.gitignore` (+ `docs/qa-round-*-prompt.md`)

### Config externa (não versionada)
- `~/.claude.json` — MCP Asaas adicionado em escopo user
- Vercel Production env vars — 7 vars recriadas sem trailing newline; `NEXTAUTH_URL` apontando pra alias canônico estável
- DB de prod — `TwoFactorSecret` do admin deletado → reconfigurado pelo user via UI

---

**Última atualização:** 2026-04-20 (sessão tarde). Próximo agent: rodar preflight em prod, confirmar deploy de `e1ed755a` aplicou migration `SplitRecipient`, depois colar `docs/qa-round-2-prompt.md` no Claude Chrome pra QA Round 2.
