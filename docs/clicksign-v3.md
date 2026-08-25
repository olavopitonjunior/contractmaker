# Assinatura digital — ClickSign v3

Detalhe operacional extraído do `CLAUDE.md` em 2026-08-25, quando o arquivo
estourou o limite de 40k. Nada foi perdido: o `CLAUDE.md` mantém os invariantes
que mordem e aponta para cá.

**100% produção.** Não existe sandbox neste fluxo — R$ 1,50 por signer é real, em
QA também. Ver a memória `project-clicksign-sem-freio-staging`: staging envia
assinatura de verdade, sem teto.

## O vínculo do envelope

Envelope vincula a UM de dois (CHECK XOR):

- **Contract aprovado** — `source="contract"`, `Envelope.contractId`
- **DealAttachment avulso** — `source="attachment"`, `Envelope.attachmentId`

### Caminho A — Contract aprovado

`executor.ts::sendEnvelopeForContract` exige `status === "aprovado"`, gera PDF via
`generateContractPdfBuffer` (Drive export quando há `googleDocId`; Puppeteer +
Handlebars como fallback) e monta signers com `dealDataToSigners(dataJson)`.
Endpoint: `POST /api/contracts/[id]/envelopes`.

### Caminho B — DealAttachment avulso

`sendEnvelopeForAttachment` baixa o PDF com `downloadBufferFromUrl`; os signers
vêm 100% do dialog. **Não exige aprovação.** Endpoint:
`POST /api/deals/[dealId]/envelopes`. UI: aba Assinaturas → "+ Enviar documento
da pasta". Use cases: aditivos, distratos, procurações, recibos.

### O helper e o lock que não é de orçamento

`createEnvelopeFromBuffer` (privado): upload do snapshot → `prisma.envelope.create`
→ ClickSign API (`createEnvelope` → `addDocument` → `addSigners` →
`addRequirements` → `activate`). Falha → `status: failed` + `deleteDraftEnvelope`
best-effort.

O `withOrgBudgetLock` que envolve o create continua ali **apesar do nome**: ele
serializa o re-check "1 envelope ativo por contrato". Sem ele, dois envios
paralelos do mesmo contrato criam 2 envelopes — cobrança dobrada.

## Listagem, cancelamento e custo

`GET /api/deals/[dealId]/envelopes` retorna os dois tipos com `subjectLabel`
resolvido no servidor. Hook `useDealEnvelopePolling(dealId)`.

Cancelamento: `DELETE /api/deals/[dealId]/envelopes/[envelopeId]` (deal-level) ou
`DELETE /api/contracts/[id]/envelopes/[envelopeId]` (legado).

**Custo:** `Envelope.costCents` é ESTIMATIVA INTERNA (tabela em
`lib/clicksign/costs.ts`, nunca conferida com o plano real) — telemetria, não
aparece em tela e não barra nada.

**Não existe orçamento mensal.** O `getMonthlyBudgetCents` foi removido em 08/2026
por recusar envio com valor inventado. **402 hoje significa limite do PLANO da
conta ClickSign**, classificado a partir da recusa dela em `lib/clicksign/quota.ts`
(`isPlanQuotaError` → `EnvelopePlanLimitError`, `code: CLICKSIGN_PLAN_LIMIT`). Todo
4xx de envio loga o corpo cru como `[clicksign] falha 4xx`.

## Diálogo de envio (`SendEnvelopeDialog.tsx`)

Linhas editáveis Nome/Email/CPF agrupadas por origem. Vendedor e Comprador
titulares são sempre signers; **Corretora(s) e Testemunhas são opt-in**.

Linhas com `addedDuringDialog=true` num contrato aprovado mostram banner amarelo:
elas aparecem só no certificado ClickSign, **não** no PDF congelado.

- **Múltiplos comissionados:** itera `comissao.comissionados[]` (canônico); array vazio → fallback hidrata 1 row do legado `imobiliaria_*`.
- **Sub-partes:** cônjuge/procurador/representante usam o `sourceIndex` do titular + `subKind`; papel em `roles.ts`. **Opt-out** — ver [[project_signers_subpartes_2026_07]].
- **Submit:** `PATCH .../signers-data` (whitelist regex: contatos do titular e das sub-partes, `comissao.comissionados`, `testemunhas`) → `POST .../envelopes`. `SourceKind = vendedor|comprador|testemunha|corretora`.

## Quirks da v3

Memória [feedback_clicksign_v3_quirks]. Cada um destes já custou tempo:

- Host `app.clicksign.com` + `?access_token=` **na query**. Bearer devolve 401 enganoso.
- `documentation` vai **com máscara** (helper `formatCpfCnpj`).
- Requirement usa `action="agree"` + `role` (mapping em `executor.ts::defaultRoleForSourceKind`).
- `communicate_by` foi removido — e-mail sai via `signer.email` + `activateEnvelope`.
- Status canônico vive em `/events`, **não** em `/signers`.
- Webhook não traz `envelope.id` — o lookup é por `documentClicksignId === document.key`.
- Match de signer por key, com fallback para e-mail lowercase: um PATCH gera `remove+add_signer` com key novo.

## Webhook de fechamento

`https://imobpro.ia.br/api/webhooks/clicksign`, valida HMAC-SHA256 (header
`content-hmac` ou `x-clicksign-signature`).

Eventos `close|auto_close|document_closed` disparam `downloadSignedPdf`
fire-and-forget → `uploadBufferToStorage` (`envelopes/<id>/signed.pdf`) → grava
`Envelope.signedDocumentUrl`.

Cria DealAttachment automático, idempotente via `findFirst { dealId, url }`:
`category="contrato_assinado"` (contract) ou `"documento_assinado"` (attachment),
`source="clicksign_signed"`.

## Sync — três caminhos

1. **Webhook** — fast path, 1-3s.
2. **Botão Atualizar** — `POST .../sync` puxa `/events` e reconcilia signer a signer. `?debug=1` devolve os shapes crus.
3. **Cron diário 06 UTC** — `/api/cron/clicksign/sync-envelopes`, só envelope-level `running→closed`. Redundância.

## Diagnostics admin

`GET /api/admin/clicksign/{webhooks, webhook-attempts, envelope-events/[envelopeId]}`.
