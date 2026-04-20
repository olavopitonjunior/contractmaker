# Checklist pré-QA — Módulo Pagadoria

Siga este roteiro **antes de acionar o QA UX/UI via Claude Chrome**. Cobre todos os blockers operacionais identificados para evitar interrupção durante o QA.

**Tempo estimado total:** ~35 min (primeira vez). Próximos QAs pulam A-D e vão direto para E-F.

---

## A. Merge + deploy em produção (10 min)

1. [ ] Abrir PR `#1` (branch `feat/pagadoria-fase-1a-security`) no GitHub
2. [ ] Conferir que CI está verde (checks Vercel + lint)
3. [ ] Fazer **merge** (preferência: squash para history limpa)
4. [ ] Ir em Vercel → Deployments e aguardar deploy de `master` ficar **Ready** (verde) — ~2-3 min
5. [ ] Copiar a URL de produção (domínio custom ou `<project>.vercel.app`)

**Se o deploy falhar:**
- Clicar no deploy → "Build Logs"
- Erros comuns: env var ausente em build time, migration Prisma falhando
- Reportar o erro para iterar

---

## B. Env vars em production no Vercel (5 min)

Ir em `https://vercel.com/<team>/<project>/settings/environment-variables`. Em **Production environment**, conferir que cada item abaixo está setado:

### Obrigatórias (blocker do preflight se faltar)

- [ ] `DATABASE_URL` — Neon production branch, com `?sslmode=require`
- [ ] `DIRECT_URL` — mesmo que DATABASE_URL mas sem pooling (para migrations)
- [ ] `AUTH_SECRET` — `openssl rand -base64 32`
- [ ] `NEXTAUTH_URL` — URL de produção completa (`https://seu-domínio.com`)
- [ ] `ASAAS_API_KEY` — sandbox pessoal. ⚠️ escapar `$` como `\$aact_hmlg_...`
- [ ] `ASAAS_ENV=sandbox`
- [ ] `ASAAS_WEBHOOK_TOKEN` — `openssl rand -hex 32` (guardar para C.2)
- [ ] `MASTER_ENCRYPTION_KEY` — `openssl rand -base64 32`
- [ ] `CHALLENGE_TOKEN_SECRET` — `openssl rand -hex 32`
- [ ] `TRUSTED_DEVICE_SECRET` — `openssl rand -hex 32`
- [ ] `SUDO_TOKEN_SECRET` — `openssl rand -hex 32`
- [ ] `RESEND_API_KEY` — do dashboard Resend
- [ ] `EMAIL_FROM` — ex: `no-reply@seu-dominio.com` (domínio deve estar verificado no Resend)

### Recomendadas (warning do preflight se faltar — não bloqueia)

- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — rate limit persistente em serverless
- [ ] `BLOB_READ_WRITE_TOKEN` — uploads de logo + documentos
- [ ] `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `VOYAGE_API_KEY` — se quiser testar features fora do Pagadoria

### ⚠️ Após mudanças em env vars

**Redeploy obrigatório:** Vercel não injeta env vars novas em deploys já buildados. Ir em Deployments → último deploy de `master` → menu `⋯` → **Redeploy** (use existing build cache).

---

## C. Asaas sandbox setup (10 min)

1. [ ] Acessar `https://sandbox.asaas.com` com a conta pessoal
2. [ ] Menu → **Integrações** → **API** → confirmar que a master key exibida é **a mesma** do env var `ASAAS_API_KEY`
3. [ ] Menu → **Integrações** → **Webhooks** → **Novo webhook**:
   - **URL:** `https://<seu-domínio>/api/webhooks/asaas`
   - **Token:** mesmo valor de `ASAAS_WEBHOOK_TOKEN`
   - **Eventos:** marcar **todos** os `PAYMENT_*` e `TRANSFER_*`
   - **Status:** Ativo
   - Salvar
4. [ ] Testar webhook: Asaas oferece "Enviar teste" — clicar. No Contractmaker, `/api/webhooks/asaas` deve receber 200 OK (ver Vercel Logs)

---

## D. Primeiro login + KYC real (10 min)

1. [ ] Acessar URL de produção, login como `admin@contractmaker.com` / `E2EtestPwd!2026`
2. [ ] Se 2FA ainda não configurado: ir em `/settings/seguranca` → clicar **Configurar 2FA**:
   - Escanear QR code com Google Authenticator / Authy / 1Password
   - Digitar o código de 6 dígitos
   - **Guardar os 10 recovery codes** em local seguro (não no docs/ versionado!)
3. [ ] Ir em `/financeiro/onboarding`:
   - Escolher PF ou PJ
   - Preencher dados (CPF/CNPJ pessoal ou da empresa-teste)
   - Submit com elevation (senha + TOTP)
4. [ ] Upload dos 4-5 documentos pedidos (fotos ou PDFs de qualquer doc de teste — sandbox aceita quase tudo)
5. [ ] Status vira `AWAITING_APPROVAL`
6. [ ] Voltar ao dashboard Asaas sandbox → **Minha Conta** (ou **Contas** se houver subcontas) → aprovar manualmente a subconta criada
7. [ ] No Contractmaker, voltar em `/financeiro/onboarding` → clicar **Atualizar status** → deve virar `APPROVED` → redireciona para `/financeiro`

**Dica para cobertura do Bloco 5b (cobrança from Deal):** ter pelo menos **1 deal com contrato aprovado** no DB. Se ainda não tem, criar um via `/forms/new` → formulário → aprovar contrato gerado.

---

## E. Preflight (30s)

Ainda logado como admin, abrir DevTools (F12) → **Console** → colar:

```javascript
fetch('/api/admin/preflight-qa', { credentials: 'include' })
  .then(r => r.json())
  .then(r => { console.log(JSON.stringify(r, null, 2)); return r; })
```

**Esperado:**

```json
{
  "ok": true,
  "blockersCount": 0,
  "warningsCount": 0, // ou poucos (com explicação)
  "checks": [...],
  "deployment": {
    "vercelEnv": "production",
    "commitSha": "...",
    "branch": "master"
  }
}
```

**Se `ok: false` (há `blockers`):**
- Cada entry em `checks` com `severity: "blocker"` lista o que está faltando
- Resolver cada blocker (voltar aos passos B/C/D conforme a categoria)
- Re-rodar o preflight até `ok: true`

**Se `ok: true` mas há warnings:**
- OK para prosseguir. Anotar os warnings no relatório final do QA
- Exemplos típicos: Upstash não configurado (rate limit in-memory), sem deals aprovados (Bloco 5b fica sem cobertura)

---

## F. QA (90-120 min)

1. [ ] Abrir Claude Chrome (no browser)
2. [ ] Colar o prompt `docs/claude-chrome-qa-pagadoria-uxui.md` completo
3. [ ] Substituir `{PROD_URL}` pelo URL de produção real
4. [ ] Deixar o QA rodar autônomo pelos 17 blocos
5. [ ] Acompanhar em paralelo — intervir se travar em step específico

---

## G. Pós-QA (10 min)

1. [ ] Salvar o relatório final completo em `docs/relatório QA UX.md` (ou nome similar)
2. [ ] Revisar bugs encontrados e priorizar (P0/P1/P2)
3. [ ] **Cleanup via UI** (ver seção Cleanup no prompt):
   - Cancelar cobranças `[QA UX]` PENDING
   - Rejeitar dual approval pendente do Bloco 12
   - Remover presets de desconto `[QA UX]` criados no Bloco 8
4. [ ] **Não tocar** na subconta Asaas nem no user admin — ficam prontos para próximos QAs
5. [ ] Se encontrou bugs P0/P1, criar plano de fix antes do próximo QA

---

## Dicas gerais

- Se o preflight retornar erro em **algum passo mesmo após B/C/D completos**: conferir que o deploy current está com o código que contém o endpoint (commit da branch mergeado em master). Pode ser necessário redeploy.
- Se 2FA do admin foi perdido: há script de emergência em `apps/web/scripts/` ou consulte o owner — nunca deixar o admin sem 2FA em produção.
- Para QAs futuros, pular A-D (já prontos) e começar direto em E (preflight) + F (QA).

---

**Próximos QAs:** este doc é atemporal — use como referência operacional toda vez que for rodar QA UX/UI. Atualizar aqui se surgir novo blocker recorrente.
