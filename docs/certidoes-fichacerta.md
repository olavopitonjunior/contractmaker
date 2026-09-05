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

## Disparo e runner (`lib/credit/fichacerta-runner.ts`, PR 6)

`POST /api/proposals/:id/credit/analysis` — gates na ordem: feature
`locacao.credito` + `kind === "locacao"` (403) → `PROPOSAL_SEND` (403) →
proposta viva (terminal exceto `completa` → 409) → conta conectada (**503
`notConfigured`**) → consentimento (`readCreditConsent`; **412
`requiresConsent`**) → pretendentes completos (`derivePretendentes` sobre o
dataJson com OCR aplicado; **422 `missing[]`**) → créditos pré-pagos (`GET
/credits`; **402**; API fora → 502) → **sob `withOrgBudgetLock("fichacerta",
orgId)`**: alvo já em andamento (`isInProgressBlocking`; **409**), teto
mensal (**402** + audit `CREDIT_BUDGET_EXCEEDED`), criação do
`CreditAnalysisRequest` + 1 `CertidaoJob` por pretendente. O lock é o mesmo
do Infosimples/ClickSign: dois cliques quase simultâneos criariam duas
solicitações reais, cobradas. Rótulo do job **sem nome de pessoa** (vai cru
para as pendências do Max).

`submitCreditRequest`: CAS `pending → submitting`; `createSolicitation` com o
1º pretendente; o id do pretendente vem de `getSolicitation` casado
**exatamente** por CPF/CNPJ (único da lista só quando a API não devolve
documento — nunca "o primeiro"); para os demais, **procura na solicitação
antes de `addApplicant`** (retry depois de queda de rede não adiciona ninguém
duas vezes); `requestReport`; jobs → `awaiting_portal` com
`resultData.numero_pedido = id da solicitação` — de propósito: é o que
`isInProgressBlocking` lê e o que o cron `poll-portal` já seleciona. Erros:
401/403 → `failed_permanent` + `reportCertidaoProblem`; 422/404 → `failed`;
5xx/rede → `api_error` + `nextRetryAt`, request volta a `pending` (cron
re-executa; "Atualizar" no card vira "Reenviar"). Uma falha definitiva também
fecha jobs que já estavam em `api_error`.

`reconcileCreditRequest`: `GET /report` (payload do webhook só como fallback)
→ pretendente concluído → job `success` (`normalizeFichaCertaLaudo`,
`updateKey` contra reentrega); em andamento → re-arma `expectedReadyAt`; >
`FICHACERTA_MAX_WAIT_MS` → `failed_permanent`; tudo terminal → PDF do laudo
**uma vez** (`ProposalAttachment { category: "laudo_credito", source:
"fichacerta" }`), `resultJson = parecer`, request `completed|failed`.

## Webhook (sem HMAC)

A Ficha Certa aceita **um webhook por conta** e não assina o payload. Antes de
cada entrega ela faz `POST token_url {username, password}` e manda o retorno
como `Authorization: Bearer …`. Nosso lado (PR 6): `/api/webhooks/fichacerta/{slug}/token`
valida `token_user/password` da conta e devolve um `access_token` HMAC curto
(`slug.exp.sig`, TTL `FICHACERTA_WEBHOOK_TOKEN_TTL_S`); o endpoint aceita esse
Bearer **ou** o `?k=` da URL. Rate limit **por slug da conta** (120/min), não
por IP: eles entregam de um pool compartilhado entre clientes deles. Slug
desconhecido → 404; sem auth → 401 auditado (`CREDIT_WEBHOOK_REJECTED`); toda
entrega auditada (`CREDIT_WEBHOOK_RECEIVED` com `via`, `bodyHash`, `known`);
**200 sempre depois de autenticar**, inclusive solicitação desconhecida
(`known:false`) — sem reentrega eterna. Payload = mesma forma do `GET /report`,
**só com o pretendente que concluiu**; nunca é aplicado às cegas: dispara
`reconcileCreditRequest` sob `waitUntil`. Idempotência por
`pretendenteUpdateKey` (solicitação, pretendente, última `data_atualizacao`).
Sem retry documentado → o cron `poll-portal` é obrigatório, não opcional.

## Conversão e negócio (PR 7)

`convertProposalToDeal` relinka o `CreditAnalysisRequest` (`proposalId` →
`dealId`, mantendo `proposalId`) junto dos jobs, e casa o PDF do laudo pela
`url` do blob (`ProposalAttachment` → `DealAttachment` copiado) em
`reportDealAttachmentId`. `Deal.complianceJson` recebe o `creditConsent`.
Card **"Análise de crédito (Ficha Certa)"** na aba Dados do negócio de locação
(`components/locacao/DealCreditAnalysisCard.tsx`, `GET
/api/deals/:dealId/credit-analysis`, projeção compartilhada em
`lib/credit/analysis-view.ts` — só o que a tela mostra, nunca `resultData`
cru): aparece quando há request OU no stage "Em Aprovação"; é **só leitura** +
"Aprovar ficha" (o card Serasa antigo, único lugar desse botão, está fora das
telas desde 02/09) + link "Analisar na proposta". Re-disparo pelo negócio está
fora do MVP.

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

## Operações (runbook)

- **Conectar a conta da imobiliária:** Configurações › Integrações › Ficha
  Certa (login/senha da API; ambiente produção ou homologação). A conexão
  valida com `GET /credits` e provisiona o webhook; o card mostra créditos e
  "webhook provisionado". Ligar a feature `locacao.credito` na org (default OFF).
- **Homologação:** `baseUrl = https://stage-api.fichacertadigital.com.br`;
  CPFs de teste com cenários (óbito, protestos, fraude, CPF suspenso, sem renda)
  estão na doc oficial. O webhook é 1 por conta — conta de homologação e de
  produção precisam ser contas distintas na Ficha Certa.
- **Laudo não chegou:** "Atualizar" no card (GET report agora); se o request
  ficou `pending` o botão vira "Reenviar" (retenta o envio). Cron
  `/api/cron/certidoes/poll-portal` fecha sozinho; > 72 h vira
  `failed_permanent` + problema no digest.
- **Webhook rejeitado (401 no audit):** o `token_user/password` ou o `?k=`
  gravados na Ficha Certa divergem da conta → "Reconectar" no card reprovisiona
  com os mesmos segredos.
- **Smoke sem credencial real:** conta SINTÉTICA na org de QA (script local,
  ver memória do épico) prova 404/401/200 do webhook e os gates até o 502 da
  API; o laudo voltando só se prova com credencial de homologação.
- Smoke da conta: `npx tsx scripts/fichacerta-smoke.ts --org <orgId>` (créditos + webhook cadastrado).
- Painel `/settings/certidoes` tem o card "Ficha Certa — mês".
- Pendências com ti@fichacerta.com.br: formato de `data_nascimento`/CPF, campo de finalidade, custo por produto, tabela `documento` do FC RENDA, conta de homologação separada da de produção (webhook é 1 por conta).
- Fora do MVP (declarado): reprocesso/reinclusão (`PUT report`), FC RENDA
  (comprovantes), re-disparo pelo negócio, link público do fiador.
