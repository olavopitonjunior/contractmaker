# Incident Response Runbook

5 cenários de incidente comuns no módulo Pagadoria com sintomas, queries SQL pra investigar, comandos de mitigação e comunicação com cliente.

---

## Cenário 1: Webhook silencioso por > 1h

**Sintoma:**
- `/settings/operacoes` mostra "Último webhook recebido: 2h atrás"
- Cobranças PENDING não estão virando RECEIVED mesmo após pagamento

**Investigação:**

```sql
-- Quantos webhooks chegaram nas últimas 24h por evento?
SELECT event, COUNT(*) FROM "AsaasWebhookEvent"
WHERE "receivedAt" > NOW() - INTERVAL '24 hours'
GROUP BY event ORDER BY 2 DESC;

-- Há eventos não processados?
SELECT id, "asaasEventId", event, "receivedAt", "processingError"
FROM "AsaasWebhookEvent"
WHERE "processedAt" IS NULL OR "processingError" IS NOT NULL
ORDER BY "receivedAt" DESC LIMIT 20;
```

**Mitigação por causa raiz:**

| Causa | Diagnóstico | Comando |
|---|---|---|
| Asaas instável | `https://status.asaas.com` vermelho | Aguardar — Asaas reenvia automaticamente |
| Webhook desativado no painel | `curl /v3/webhooks \| jq '.data[].enabled'` | Reativar no painel ou `PUT /v3/webhooks/{id}` |
| Token mismatch | Header `asaas-access-token` não bate | Conferir `ASAAS_WEBHOOK_TOKEN` no Vercel = token cadastrado no painel |
| Vercel deploy fail | Vercel dashboard mostra deploy com erro | Redeploy ou rollback |
| Rate limit interno | `/api/webhooks/asaas` retornando 429 | Conferir Upstash quota; subir limit se necessário |

**Recovery manual:**

```bash
# Forçar cron de retry imediato
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://web-olavopiton-4477s-projects.vercel.app/api/cron/webhooks/retry-orphaned
```

**Comunicação com cliente:**
> "Estamos com instabilidade na confirmação automática de pagamentos. Seu pagamento foi recebido com sucesso no Asaas — vamos atualizar o status manualmente nas próximas X horas. Sem prejuízo financeiro."

---

## Cenário 2: Asaas instável (cobrança rejeitada)

**Sintoma:**
- Toast vermelho "Método de cobrança indisponível para esta subconta" ou "No momento, não será possível emitir/atualizar cobranças"
- Múltiplos clientes reportam ao mesmo tempo

**Investigação:**

```bash
# Health da Asaas
curl https://status.asaas.com/api/v2/status.json

# Ping da nossa subconta
curl -H "access_token: $ASAAS_API_KEY" https://api.asaas.com/v3/myAccount/status
```

**Mitigação:**

1. Se `/v3/myAccount/status` retorna `general: APPROVED` mas cobranças falham → instabilidade Asaas, aguardar
2. Se status mudou para `BLOCKED` ou `BLOCKED_BY_ASAAS` → contatar suporte Asaas urgente
3. Cliente sem saber esperar: orientar a tentar em 30min; se persistir, gerar cobrança manualmente no painel Asaas e marcar como "external" no DB

**Comunicação:**
> "Provedor Asaas com instabilidade temporária. Sua cobrança não pôde ser gerada automaticamente. Por favor, tente novamente em alguns minutos."

---

## Cenário 3: Subconta cliente bloqueada por suspeita de fraude

**Sintoma:**
- Asaas status muda para `BLOCKED` em `/v3/myAccount/status`
- Email da Asaas pedindo documentação adicional
- Cobranças param de emitir

**Investigação:**

```bash
# Status detalhado
curl -H "access_token: $SUBACCOUNT_KEY" https://api.asaas.com/v3/myAccount/status

# Histórico de mudanças (cliente vê no email)
# Não há endpoint API — só painel Asaas
```

**Mitigação:**

1. **Não tente desbloquear pelo código** — Asaas exige resposta humana ao email deles
2. Cliente precisa:
   - Responder email da Asaas com documentação solicitada (geralmente: comprovante origem dos recursos, contrato com pagador)
   - Aguardar análise (até 5 dias úteis)
3. Enquanto bloqueado: cliente NÃO consegue emitir nem receber. Cobranças PENDING ficam em limbo.

**Comunicação:**
> "Sua subconta foi temporariamente bloqueada pela Asaas para validação de origem dos recursos. Verifique seu email ([cliente@]) para resposta com a documentação solicitada. Estimativa de retorno: 3-5 dias úteis após resposta."

---

## Cenário 4: 2FA do cliente perdido (sem recovery codes)

**Sintoma:**
- Cliente reporta "perdi acesso ao Google Authenticator" e "também perdi os recovery codes"
- Não consegue logar

**Mitigação (apenas admin pode executar):**

1. **Verifique a identidade do cliente** por canal alternativo (email, ligação) — nunca confie só no email/telefone que mandou a mensagem
2. Use o admin override:

```sql
-- Desabilitar 2FA do user específico (CUIDADO)
DELETE FROM "TwoFactorSecret" WHERE "userId" = '<userId>';

-- Loga no AuditLog (já é registrado pelo trigger)
INSERT INTO "AuditLog" (...) VALUES (
  'admin_override',
  '2FA_DISABLE',
  '<adminUserId>',
  ...
);
```

3. Avisar cliente para:
   - Logar imediatamente
   - Reativar 2FA
   - **Salvar recovery codes desta vez** em gerenciador de senhas

**Prevenção:** todo onboarding deve forçar download de recovery codes antes de continuar.

**Comunicação:**
> "Removemos o 2FA da sua conta após confirmar sua identidade. Faça login agora e reative o 2FA imediatamente. Salve os recovery codes em gerenciador de senhas (LastPass, 1Password, Bitwarden)."

---

## Cenário 5: Transfer FAILED em massa

**Sintoma:**
- `/settings/operacoes` mostra muitos transfers FAILED com `origin: split_dispatch`
- `failedSplitsRetryable > 5`
- Beneficiários reclamando de não receber

**Investigação:**

```sql
-- Agrupar por failureReason pra identificar padrão
SELECT
  COALESCE("failureReason", 'unknown') as reason,
  COUNT(*) as count
FROM "AsaasTransfer"
WHERE status = 'FAILED'
  AND origin = 'split_dispatch'
  AND "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY reason
ORDER BY count DESC;
```

**Causas comuns:**

| Reason contém… | Diagnóstico | Mitigação |
|---|---|---|
| "Saldo insuficiente" | Subconta sem saldo no momento do dispatch | Cron retry-orphaned (3am) tenta novamente após saldo cair (D+1 boleto) |
| "Endereço PIX inválido" | Chave PIX do recipient não existe mais | Avisar cliente — desativar recipient antigo, criar novo |
| "Limite de transferência" | Asaas limita PIX em ~R$ 50k/dia em sandbox/início | Cliente pede aumento via painel Asaas |
| Rate limit HTTP | Muitas chamadas simultâneas | Adicionar delay entre dispatches (futuro) |

**Recovery:**

```bash
# Retry manual em batch via UI (cobranca a cobrança)
# Ou via API direto:
for transfer_id in $(...); do
  curl -X POST -H "Cookie: $SESSION_COOKIE" \
    https://web-olavopiton-4477s-projects.vercel.app/api/financeiro/transfers/$transfer_id/retry
done
```

**Comunicação (com beneficiários afetados):**
> "Identificamos que sua transferência de [data] não foi processada por [motivo]. Vamos refazer o pagamento até [prazo]. Se preferir, podemos enviar via outro método. Confirme com [contato]."

---

## Geral — checklist após qualquer incidente

- [ ] Logar tudo no `AuditLog` (já automático na maioria das ações admin)
- [ ] Atualizar este runbook se descobrir novo cenário
- [ ] Postmortem em `docs/incidents/YYYY-MM-DD-<slug>.md` se durou > 1h
- [ ] Comunicar resolução ao cliente afetado
- [ ] Verificar se há mudança de código necessária pra prevenir reincidência
