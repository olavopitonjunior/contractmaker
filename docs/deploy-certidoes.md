# Deploy — Feature de Certidões via Infosimples

Passos de infraestrutura que o time precisa executar antes/durante o deploy da
feature de extração de certidões. Referencia o plano em
[.claude/plans/abundant-mixing-planet.md](../.claude/plans/abundant-mixing-planet.md).

## 1. Migration no banco

**Dev local** (se você roda um Postgres local ou branch de dev no Neon):

```bash
cd apps/web
npx prisma migrate deploy
```

Isso aplica `20260414120000_add_certidao_job` que:
- cria a tabela `CertidaoJob` com 22 colunas + 3 índices + 2 FKs
- adiciona `extractedData JSONB` e `source TEXT DEFAULT 'manual'` em `DealAttachment`

**Produção (Neon)**:

1. **Crie uma branch temporária do Neon** (fallback em caso de erro):
   ```
   neonctl branches create --name pre-certidoes-backup
   ```
2. Aponte `DATABASE_URL` local para prod e rode:
   ```bash
   DATABASE_URL=<prod-url> npx prisma migrate deploy
   ```
3. Verifique que a tabela existe:
   ```sql
   SELECT to_regclass('public."CertidaoJob"');
   ```
   Deve retornar `CertidaoJob`, não `null`.

A migration é **aditiva e idempotente** — nenhuma coluna existente é tocada.
Contratos e deals existentes continuam funcionando.

## 2. Variáveis de ambiente (Vercel)

No painel do projeto Vercel → Settings → Environment Variables, adicione em
**Production** (e Preview se quiser testar PRs):

| Nome | Valor | Obrigatório |
|---|---|---|
| `INFOSIMPLES_TOKEN` | token da sua conta Infosimples | ✅ — sem isso, a POST `/certidoes` retorna erro |
| `INFOSIMPLES_MONTHLY_BUDGET_CENTS` | `20000` (R$ 200,00) | ⚠ default 20000 (R$ 200) se ausente — fonte única em `lib/certidoes/budget.ts`, usada pelo executor, pelo monitor e pela API do dashboard |
| `CRON_SECRET` | `openssl rand -base64 32` | ⚠ recomendado — sem ele, qualquer um pode chamar o cron |

Obter `INFOSIMPLES_TOKEN`: cadastre em [infosimples.com](https://infosimples.com),
crie uma conta API, copie o token do painel. Planos começam em ~R$ 39/mês.

## 3. Vercel Cron

O [vercel.json](../apps/web/vercel.json) já declara o cron diário às 9h:

```json
{
  "crons": [
    { "path": "/api/cron/certidoes/poll-portal", "schedule": "*/5 * * * *" }
  ]
}
```

Vercel Cron é **free no plano Pro**. Se o projeto estiver no Hobby, o cron é
ignorado — os jobs `awaiting_portal` (TJSP/TJRJ) só serão polados quando você
chamar a rota manualmente (com curl + `CRON_SECRET`).

Primeiro deploy após adicionar o `vercel.json`: vá no dashboard Vercel →
Settings → Crons e confirme que o job apareceu.

**Teste manual do cron**:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-app>.vercel.app/api/cron/certidoes/poll-portal
```
Resposta esperada: `{"polled": 0, "success": 0, "failed": 0}` (se ainda não há
jobs em `awaiting_portal`).

## 4. Smoke test em staging

Antes de validar com deal real, rode um **deal de teste** em staging:

1. Crie formulário `[QA CERT] Teste`
2. Preencha 1 vendedor PF com **CPF válido** (use `529.982.247-25` — é válido mas
   pertence a ninguém) + **data de nascimento** (obrigatório p/ PGFN)
3. Preencha 1 imóvel em São Paulo com SQL `123.456.0789-0`
4. Finalize o form, abra o deal
5. Aba "Certidões" → botão "Extrair certidões"
6. Dialog deve mostrar ~9 jobs planejados, R$ 0,46 estimado
7. Confirme → UI deve atualizar em tempo real a cada 2s
8. **Esperado**: CND Federal, CNDT, TRF, 3× CEAT SP, CENPROT SP, IPTU SP
   todos `success`; TJSP `awaiting_portal`
9. Inspecione `CertidaoJob` no DB:
   ```sql
   SELECT endpoint, status, "resultCode", "latencyMs", "costCents"
   FROM "CertidaoJob"
   WHERE "dealId" = '<id>'
   ORDER BY "createdAt";
   ```
10. Botão "Gerar relatório" → baixe o PDF e confirme que abre

**Custo total do smoke test**: ~R$ 0,50. Budget mensal de R$ 50 comporta ~100
testes assim.

**Validação do dashboard**: abra `/settings/certidoes`. Deve mostrar:
- Gasto do mês: R$ 0,50
- Taxa de sucesso: ~89% (8/9, TJSP ainda aguardando)
- 1 job em "Aguardando portal"

## 5. Validação dos normalizers contra payloads reais

Os fixtures em [__fixtures__/](../apps/web/src/lib/certidoes/__fixtures__/) foram
escritos com base na documentação da Infosimples — **a primeira execução real em
produção vai revelar divergências de schema**.

Procedimento pós-smoke-test:

1. Rode 1 deal real por endpoint crítico (PGFN PF, CNDT, TRF, CEAT SP, CENPROT SP, IPTU SP)
2. Copie o `resultPayload` real do campo `CertidaoJob.resultData` (dev tools ou SQL)
3. Se o normalizer **não identificou a situação** (campo `situacao: "indeterminado"`),
   ajuste o extractor correspondente em [normalizers.ts](../apps/web/src/lib/certidoes/normalizers.ts)
4. Salve o payload real sanitizado como fixture nova e adicione um teste no
   [normalizers.test.ts](../apps/web/src/lib/certidoes/__tests__/normalizers.test.ts)

Fallback automático: se o extractor falhar em identificar a situação, a UI
mostra "Indeterminado" mas o PDF continua sendo salvo normalmente.

## 6. Checklist pré-deploy

- [ ] `npx tsc --noEmit` limpo
- [ ] `npx vitest run src/lib/certidoes` verde (34 testes)
- [ ] `npx next build` sem erros
- [ ] Migration aplicada no ambiente alvo
- [ ] `INFOSIMPLES_TOKEN` setado no Vercel
- [ ] `CRON_SECRET` setado no Vercel
- [ ] `vercel.json` commitado
- [ ] Smoke test do passo 4 OK
- [ ] `/settings/certidoes` acessível e mostrando dados

## 7. Rollback

Se precisar reverter:

1. **Código**: `git revert` dos commits da feature
2. **DB**: a migration é aditiva — pode deixar as colunas/tabela extras sem
   impacto (não há rollback destrutivo necessário). Para limpar completamente:
   ```sql
   DROP TABLE "CertidaoJob";
   ALTER TABLE "DealAttachment" DROP COLUMN "extractedData";
   ALTER TABLE "DealAttachment" DROP COLUMN "source";
   ```
3. **Env vars**: remover `INFOSIMPLES_TOKEN` não é necessário, apenas o código
   que o usa é removido
