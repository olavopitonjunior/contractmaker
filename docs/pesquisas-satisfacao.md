# Pesquisas de Satisfação (NPS/CSAT) — handoff

Feature completa em produção desde 2026-07-24 (PRs #172 núcleo · #179 WhatsApp · #180 resumo IA · #181 default ON). O CLAUDE.md está no teto de 40k — este doc é a referência.

## Conceito central: LOTES imutáveis

- Cada `SurveyTemplate` é um **lote**: `questionsJson` NUNCA recebe PATCH (só `name/description/status`). "Editar perguntas" = `POST /api/surveys/templates/[id]/new-version` → nova row na mesma `familyId`, `version+1`, relatório zerado.
- Invariante no banco: índice único parcial `SurveyTemplate_familyId_isLatest_unique` (1 `isLatest` por org+família — padrão do `Contract`).
- Relatórios agregam SEMPRE por `templateId` (lote). Lotes não se consolidam; o seletor em `/pesquisas/relatorios` escolhe família + versão.
- `SurveyAutomation` aponta pra **família** (`templateFamilyId`); o dispatch resolve o `isLatest` na hora — nova versão redireciona os próximos envios sem tocar na automação.

## Models (prisma/schema.prisma)

`SurveyTemplate` (lote) · `SurveyAutomation` (regra: orgId+dealKind+triggerStageName, audience[], channel, reminderOffsetsDays) · `SurveyInvite` (token opaco 30d, `dedupeKey @unique` = `${dealId}:${templateId}:${role}:${contato}`, status pending|sent|responded|expired|optout|failed) · `SurveyResponse` (`inviteId @unique` = idempotência; `npsScore`/`csatScore` derivados pra agregação SQL).

## Motor de disparo

- **Hook primário**: `queueSurveyDispatch(dealId, stageName)` (waitUntil) após cada `audit(DEAL_STAGE_CHANGE)` — 9 call-sites (drag, auto-promotes, mark-*, reopen, regress, aprovar-ficha, mark-signed).
- **Cron de reconciliação** `/api/cron/surveys/dispatch` (15min): varre `Deal.stageEnteredAt > now-48h`, re-tenta invites `failed` e WhatsApp `pending` (deferidos pela janela), expira vencidos e cancela NewtonRequests `[survey_*` não-terminais >24h.
- Dedupe é atômico no banco — hook+cron concorrentes nunca duplicam.
- Dispatch e reminders checam a feature por org: **desligar a feature para o motor**, não só a UI.

## Canais (`lib/surveys/channels.ts`)

- **email**: `sendEmail` com branding da org; opt-out no rodapé.
- **whatsapp** (via Newton): cria `NewtonRequest` one-shot com `dedupeTag @unique` (`[survey_invite][id]` / `[survey_reminder][id][n]`); o `ask` instrui o agente a mandar UMA mensagem e marcar `fulfilled`. Telefone: partes usam `mobile_phone` (`telefone` legado) → `normalizeBrPhone` → E.164 sem `+`. **Janela 7h–22h SP**: fora dela o envio fica `deferred` (invite pending; cron envia quando abrir). **Fallback automático pra email** quando inviável (Newton OFF, sem deal, telefone inválido). Gate: `vendas.newton`/`locacao.newton` (default OFF).
- **manual**: gera link copiável (`/s/[token]`).

## Régua

Reminders D+offsets da automação (default 2/5) — cron diário 13 UTC, mesmo canal do envio original, param em responded/optout/expired; falha de reminder não rebaixa o invite. Pós-resposta (waitUntil): sino + email de **alerta de detrator** (`nps<=6 || csat<=2`) pro corretor do deal. Opt-out (email footer + link na página pública) suprime automáticos por email E telefone; envio manual segue permitido.

## Resumo IA (`lib/surveys/summary.ts`)

Botão no relatório (mín. 3 respostas de texto — `SUMMARY_MIN_TEXT_RESPONSES`). Haiku, cap 100 respostas/24k chars, **`redactPii` mascara CPF/CNPJ/telefone/email antes do prompt**. Cache por hash sha256 em `settingsJson.aiSummary` — sem resposta nova, zero custo. Guard de budget mensal de IA da org (402). Operation `survey_summary` no AIUsage (~US$ 0,002/geração).

## Gating e UI

`vendas.pesquisas`/`locacao.pesquisas` — **default ON** desde #181 (org desliga via override no /admin). Sidebar grupo "Pesquisas" (Modelos + Relatórios); builder wizard em `/pesquisas/nova`; dialog de automação por família na listagem; aba "Pesquisas" em DealDetail e LocacaoDealDetail (deep-link `?tab=pesquisas`).

## Operação / troubleshooting

- **WhatsApp não sai**: conferir (1) feature Newton ligada pra org, (2) telefone da parte com DDD no form, (3) horário 7h-22h SP, (4) envs `NEWTON_SIDECAR_URL/TOKEN` no Vercel (prod tem; **staging NÃO tem** — lá WhatsApp nunca entrega, por design), (5) `NewtonRequest` com a tag no inbox do Newton.
- **Invite `failed`**: cron re-tenta a cada 15min enquanto o token vale (30d). Reenvio manual na aba do deal.
- **Relatório "zerou"**: provavelmente criaram nova versão — o lote anterior segue disponível no seletor de versões.
- Audit actions: `SURVEY_*` em `lib/security/audit.ts`.
