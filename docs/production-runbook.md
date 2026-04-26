# Production Migration Runbook

Passo-a-passo para sair do sandbox Asaas e processar a primeira cobrança real.

---

## Pré-requisitos

- [ ] Todos os PRs do roadmap (1A, 1B, 2, 3) mergeados em master
- [ ] Conta Vercel com acesso ao projeto `web` em `olavopiton-4477s-projects`
- [ ] CLI Vercel autenticada localmente (`vercel whoami`)
- [ ] CLI GitHub (`gh`) autenticada
- [ ] Acesso ao painel `https://www.asaas.com` (produção, não sandbox)

---

## 1. Criar conta Asaas produção (Dia 0, ~15min)

1. Acesse `https://www.asaas.com/cadastro` e crie conta como Pessoa Física com seu email/CPF.
2. Confirme email recebido pela Asaas.
3. **Não** marque "Quero receber pagamentos para minha empresa" se for usar como subaccount white-label master pelo Contractmaker.

## 2. KYC do admin (Dia 0, ~10min preenchimento + 1-3 dias úteis aprovação)

No painel Asaas após login:

1. Configurações → Documentos → submeter:
   - **Identificação:** CNH frontal + verso, OU RG frontal + verso, OU CNH digital
   - **Selfie** segurando o documento de identificação
   - **Comprovante de endereço** (≤90 dias): conta de luz/água/gás/telefone, fatura cartão, contrato locação
2. Configurações → Conta bancária — cadastrar conta de saque (PIX ou banco com CPF batendo do KYC)
3. Configurações → Informações comerciais — preencher (CPF, telefone, endereço)
4. Aguardar aprovação por email da Asaas. **Tempo médio 1-3 dias úteis.** Não há aceleração.

## 3. Criar subaccount white-label (Dia 4, ~30min)

> Pré-requisito: KYC do passo 2 aprovado (status `general: APPROVED` em `/v3/myAccount/status`).

A primeira subaccount será **a sua própria** (você é o primeiro cliente piloto). Todos os contratos/cobranças que você gerar vão por essa subaccount.

1. Pegue a Master API Key da conta produção:
   - Painel Asaas → Configurações → Integrações → API
   - Copie a key (começa com `$aact_prod_…`)

2. Use o script de setup adaptado para produção:
   ```bash
   cd apps/web
   ASAAS_ENV=production \
   ASAAS_API_KEY='$aact_prod_xxxxx' \
   pnpm tsx scripts/setup-pagadoria-qa.ts \
     --env=production \
     --email=admin@contractmaker.com \
     --webhook-token=$(openssl rand -hex 32) \
     --skip-approve
   ```
   Flags importantes:
   - `--env=production` desabilita o approve-sandbox (requer aprovação humana)
   - `--skip-approve` é redundante mas explícito
   - `--webhook-token` é o token compartilhado entre Asaas e nosso handler

3. **Subir documentação da subaccount no painel Asaas web** (sem bypass — em produção precisa upload real):
   - Login na conta da subaccount (use a apiKey gerada — alguns painéis aceitam)
   - Configurações → Documentos → upload mesmo dos documentos do passo 2
   - Aguardar aprovação (1-3 dias úteis novamente)

4. Confirmar status APPROVED:
   ```bash
   curl -H "access_token: $SUBACCOUNT_API_KEY" https://api.asaas.com/v3/myAccount/status
   ```

## 4. Cadastrar webhook em produção (Dia 4 após subaccount aprovada, ~5min)

1. Painel Asaas (master) → Configurações → Integrações → Webhooks → Novo webhook
2. Preencher:
   - **URL:** `https://web-olavopiton-4477s-projects.vercel.app/api/webhooks/asaas`
   - **Email:** seu email
   - **Token:** o token gerado no passo 3 (`--webhook-token`)
   - **Eventos:** marque todos os PAYMENT_* e TRANSFER_*
   - **Send Type:** Sequentially (recomendado)
   - **Enabled:** sim

3. Verifique que o webhook foi cadastrado:
   ```bash
   curl -H "access_token: $MASTER_API_KEY" https://api.asaas.com/v3/webhooks
   ```

## 5. Trocar env vars no Vercel (Dia 4, ~10min — CRÍTICO)

> ⚠️ **Use `printf "%s"` ou `fs.writeFileSync` — NUNCA `echo`** (incidente 2026-04-20: `\n` corrompido bloqueou 2FA + Prisma + NextAuth por horas).

```bash
cd apps/web

# Remova as antigas (sandbox)
vercel env rm ASAAS_ENV production
vercel env rm ASAAS_API_KEY production
vercel env rm ASAAS_WEBHOOK_TOKEN production

# Re-adicione com printf (evita trailing newline)
printf "%s" "production" | vercel env add ASAAS_ENV production
printf "%s" '$aact_prod_xxxxx' | vercel env add ASAAS_API_KEY production
printf "%s" "$WEBHOOK_TOKEN" | vercel env add ASAAS_WEBHOOK_TOKEN production
```

Confirme que não há `\n` ao final:
```bash
vercel env pull .env.prod.tmp --environment=production
grep -E '\\n"$|\n"$' .env.prod.tmp && echo "CORROMPIDO" || echo "OK"
rm .env.prod.tmp
```

## 6. Redeploy produção (Dia 4, ~3min)

```bash
# Pega o deploy mais recente
vercel ls web | head -3

# Redeploy do master commit atual
vercel redeploy <production-url> --target=production
```

Aguarde Status `Ready` (~1-2min).

## 7. Rodar verify-production-ready.ts (Dia 4, ~30s)

```bash
cd apps/web

# Pega env vars de prod localmente (cuidado — não commitar)
vercel env pull .env.prod.tmp --environment=production

# Roda checklist
ASAAS_ENV=production \
DATABASE_URL=$(grep '^DATABASE_URL=' .env.prod.tmp | cut -d= -f2- | sed 's/^"//;s/"$//') \
ASAAS_API_KEY=$(grep '^ASAAS_API_KEY=' .env.prod.tmp | cut -d= -f2- | sed 's/^"//;s/"$//') \
... [outras env vars] \
npx tsx scripts/verify-production-ready.ts \
  --base-url=https://web-olavopiton-4477s-projects.vercel.app

# Limpa
rm .env.prod.tmp
```

Esperado: **0 críticos**. Warnings são aceitáveis (revisar caso a caso).

## 8. Smoke test cobrança real (Dia 4, ~10min)

Logado em prod:

1. Crie 1 contrato real seu mesmo (sua casa/apto) — passo completo do form ao approve
2. Aprove o contrato
3. Gere cobrança Deal-based de **R$ 1,00 PIX** com vencimento hoje
4. Pague via app bancário real (Asaas vai gerar QR PIX válido)
5. Aguarde 30-60s — webhook chega + status vira "Recebida"
6. Verifique em `/settings/operacoes`:
   - Webhook recente listado
   - 0 errors em últimos 7d
   - Saldo Asaas atualizou (~R$ 0,98 após taxa Asaas R$ 0,02)

## 9. Smoke split PIX externo (Dia 5, ~15min)

1. Cadastre `SplitRecipient` PIX com sua chave pessoal de outro banco
2. Gere cobrança R$ 50 com 30% pra esse PIX
3. Pague de novo
4. Verifique em `/settings/operacoes`:
   - 1 transfer DONE
   - `lastObservedPixFeeCents` atualizado para o valor real cobrado pela Asaas

## 10. Marcar como produção live (Dia 5)

1. Atualizar `docs/pagadoria-handoff.md` com data + commit do go-live
2. Salvar logs do dashboard em screenshot pra evidência
3. Comunicar status no canal interno

---

## Rollback (se algo der errado)

Se qualquer passo de 5-10 falhar, voltar para sandbox:

```bash
# 1. Reverter env vars
printf "%s" "sandbox" | vercel env add ASAAS_ENV production
printf "%s" '$aact_hmlg_xxxxx' | vercel env add ASAAS_API_KEY production
# ASAAS_WEBHOOK_TOKEN pode permanecer — não dói

# 2. Redeploy
vercel redeploy <url> --target=production

# 3. Investigar o problema antes de tentar de novo
```

Cobranças reais já criadas **não são afetadas** pelo rollback (continuam ativas na Asaas), mas novas cobranças voltam pro sandbox.
