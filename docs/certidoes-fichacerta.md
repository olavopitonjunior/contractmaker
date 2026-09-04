# Análise de crédito — Ficha Certa Digital (2026-09)

Terceiro provider via `CertidaoJob.provider="fichacerta"`, usado na **proposta de
locação** (pré-Deal). Doc oficial: https://doc-api.fichacertadigital.com.br/
(Postman, sem schema formal — os tipos em `lib/fichacerta/types.ts` são todos
opcionais de propósito; as fixtures em `lib/certidoes/__tests__/fixtures/fichacerta-*.json`
quebram cedo se a forma mudar).

## Modelo deles × nosso

| Ficha Certa | Contractmaker |
|---|---|
| Solicitação (1 locação: imóvel + valores) | `CreditAnalysisRequest` (`externalId` = id da solicitação, único por `(orgId, provider)`) |
| Pretendente (INQUILINO, FIADOR, CONJUGE_INQUILINO, CONJUGE_FIADOR, OUTROS=PJ) | `CertidaoJob` (1 por pretendente; `targetKind` locatario/conjuge_locatario/fiador/conjuge_fiador; `resultData.pretendente_id`) |
| Produto por pretendente (1 FC REPORT, 9 FC SCORE, 4 FC EMPRESA) | `FichaCertaAccount.products` (PF) / fixo 4 (PJ) |
| `POST /report` (assíncrono) → webhook | job `awaiting_portal` → webhook `/api/webhooks/fichacerta/{slug}` ou cron `poll-portal` (`GET /report`) |
| `GET /report/download` (PDF) | `ProposalAttachment { category: "laudo_credito", source: "fichacerta" }` |
| `GET /credits` | pré-check antes do disparo (402 sem crédito) |

## Conta POR IMOBILIÁRIA (`FichaCertaAccount`)

Molde da `ClickSignAccount`: login/senha da API e os segredos do webhook cifrados
(AES-256-GCM, `lib/security/crypto.ts`). **Não há token global no `.env`** —
org sem conta não tem análise de crédito (fail-closed). Card em
**Configurações › Integrações** (`components/settings/FichaCertaAccountCard.tsx`,
rotas `GET/POST/DELETE /api/settings/fichacerta` e `POST .../test`, só owner/admin).

Conectar (`lib/fichacerta/connect.ts`): valida com `GET /credits` → gera/reusa
`webhookSlug`, `token_user`/`token_password` e `?k=` → `POST /solicitation/report/webhook`
(best-effort; o card mostra "não provisionado" e "Reconectar") → upsert cifrado.
Reconectar reusa slug e segredos (a config lá fora continua válida).

## Webhook (sem HMAC)

A Ficha Certa aceita **um webhook por conta** e não assina o payload. Antes de
cada entrega ela faz `POST token_url {username, password}` e manda o retorno
como `Authorization: Bearer …`. Nosso lado (PR 6): `/api/webhooks/fichacerta/{slug}/token`
valida `token_user/password` da conta e devolve um `access_token` HMAC curto
(`FICHACERTA_WEBHOOK_TOKEN_TTL_S`); o endpoint aceita esse Bearer **ou** o `?k=`
da URL. Payload = mesma forma do `GET /report`, **só com o pretendente que
concluiu**. Idempotência por `pretendenteUpdateKey` (solicitação, pretendente,
última `data_atualizacao`). Sem retry documentado → depois de todo webhook,
reconciliar com `GET /report`; o cron `poll-portal` é obrigatório, não opcional.

## Normalização (`lib/fichacerta/normalize.ts`)

`com_restricao` se qualquer bloco de restrição (`restricoes_financeiras`,
`situacao_cpf`, `suspeita_obito`) vier `icon: "negativo"`; `sem_restricao` se
todos positivo/neutro; `indeterminado` se ausentes/nulos. Compatibilidade de
renda e `parecer_sistemico` (score_fc, parecer, recomendações) vão em
`detalhes`/`raw`, não mudam a situação. Ambientes: produção
`api.fichacertadigital.com.br`, homologação `stage-api.…` (CPFs de teste com
cenários na doc). Freios da plataforma: `FICHACERTA_MONTHLY_BUDGET_CENTS`
(default R$ 3.000), `FICHACERTA_MAX_WAIT_MS` (72h em `awaiting_portal`).

## Audit actions

`CREDIT_ANALYSIS_DISPATCH | CREDIT_CONSENT_GIVEN | CREDIT_WEBHOOK_RECEIVED | CREDIT_WEBHOOK_REJECTED | CREDIT_ACCOUNT_CONNECTED | CREDIT_ACCOUNT_DISCONNECTED | CREDIT_BUDGET_EXCEEDED`

## Operações

- Smoke da conta: `npx tsx scripts/fichacerta-smoke.ts --org <orgId>` (créditos + webhook cadastrado).
- Painel `/settings/certidoes` tem o card "Ficha Certa — mês".
- Pendências com ti@fichacerta.com.br: formato de `data_nascimento`/CPF, campo de finalidade, custo por produto, tabela `documento` do FC RENDA, conta de homologação separada da de produção (webhook é 1 por conta).
