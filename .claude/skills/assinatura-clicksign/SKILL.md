---
name: assinatura-clicksign
description: Assinatura digital ClickSign v3 — envelopes (contrato aprovado XOR anexo avulso), signers e sub-partes, diálogo de envio, webhook close, sync em 3 caminhos, custo/budget — e o fluxo de aprovação do contrato. Use ao mexer em lib/clicksign/*, executor.ts, envelopes.ts, SendEnvelopeDialog, signers-data, /approve, webhooks/clicksign ou qualquer coisa com envelope, signatário, testemunha ou PDF assinado.
---

# Assinatura digital (ClickSign v3) e aprovação

## Envelopes

Envelope vincula a UM de dois (CHECK XOR): Contract aprovado (`source="contract"`, `Envelope.contractId`) ou DealAttachment avulso (`source="attachment"`, `Envelope.attachmentId`).

**Caminho A — Contract aprovado:** `executor.ts::sendEnvelopeForContract` exige `status === "aprovado"`, gera PDF via `generateContractPdfBuffer` (Drive export se há `googleDocId`; Puppeteer + Handlebars fallback), signers via `dealDataToSigners(dataJson)`. `POST /api/contracts/[id]/envelopes`.

**Caminho B — DealAttachment avulso:** `sendEnvelopeForAttachment` baixa PDF via `downloadBufferFromUrl`, signers 100% do dialog. Não exige aprovação. `POST /api/deals/[dealId]/envelopes`. UI: aba Assinaturas → "+ Enviar documento da pasta". Use cases: aditivos, distratos, procurações, recibos.

**Helper `createEnvelopeFromBuffer`** (privado): budget check → upload snapshot → `prisma.envelope.create` → ClickSign API (createEnvelope → addDocument → addSigners → addRequirements → activate). Falha → `status: failed` + `deleteDraftEnvelope` best-effort.

**Listagem unificada:** `GET /api/deals/[dealId]/envelopes` retorna ambos com `subjectLabel` server-side. Hook `useDealEnvelopePolling(dealId)`. **Cancelamento:** `DELETE /api/deals/[dealId]/envelopes/[envelopeId]` (deal-level) ou `DELETE /api/contracts/[id]/envelopes/[envelopeId]` (legado).

**Custo:** `Envelope.costCents`. Budget mensal `getMonthlyBudgetCents()` soma `running + closed` do mês. POST retorna 402 se estouraria. ClickSign é **100% produção** (R$ 1,50/signer real é OK em QA).

## Diálogo de envio (`SendEnvelopeDialog.tsx`)

Linhas editáveis Nome/Email/CPF agrupadas por origem. Vendedor + Comprador titulares sempre signers; **Corretora(s) e Testemunhas opt-in**. Linhas com `addedDuringDialog=true` em aprovado mostram banner amarelo: aparecem só no certificado ClickSign, não no PDF congelado.

- **Múltiplos comissionados:** itera `comissao.comissionados[]` (canônico); array vazio → fallback hidrata 1 row do legado `imobiliaria_*`
- **Sub-partes:** cônjuge/procurador/representante usam o `sourceIndex` do titular + `subKind`; papel em `roles.ts`. **Opt-out** — ver memória `project_signers_subpartes_2026_07`
- **Submit:** `PATCH .../signers-data` (whitelist regex: contatos do titular e das sub-partes, `comissao.comissionados`, `testemunhas`) → `POST .../envelopes`. `SourceKind = vendedor|comprador|testemunha|corretora`

## Quirks v3 (memória `feedback_clicksign_v3_quirks`)

Host `app.clicksign.com` + `?access_token=` query (Bearer dá 401 enganoso); `documentation` com máscara (helper `formatCpfCnpj`); requirement `action="agree"`+`role` (mapping em `executor.ts::defaultRoleForSourceKind`); `communicate_by` removido — email via `signer.email`+`activateEnvelope`; status canônico em `/events` (não `/signers`); webhook sem `envelope.id` — lookup por `documentClicksignId === document.key`; match signer por key + fallback email lowercase (PATCH gera `remove+add_signer` com key novo).

## Webhook close

`https://imobpro.ia.br/api/webhooks/clicksign` valida HMAC-SHA256 (header `content-hmac` ou `x-clicksign-signature`). Eventos `close|auto_close|document_closed` disparam `downloadSignedPdf` fire-and-forget → `uploadBufferToStorage` (`envelopes/<id>/signed.pdf`) → grava `Envelope.signedDocumentUrl`. Cria DealAttachment automático (idempotente via `findFirst { dealId, url }`): `category="contrato_assinado"` (contract) ou `"documento_assinado"` (attachment), `source="clicksign_signed"`.

## Sync — 3 caminhos

Webhook (fast path 1-3s) · botão Atualizar `POST .../sync` (pulla /events, reconcilia signer-by-signer; `?debug=1` retorna shapes crus) · cron diário 06 UTC (`/api/cron/clicksign/sync-envelopes`, só envelope-level running→closed, redundância).

**Diagnostics admin:** `GET /api/admin/clicksign/{webhooks, webhook-attempts, envelope-events/[envelopeId]}`.

## Aprovação do contrato

`POST /api/contracts/[id]/approve` valida + conta `ContractSuggestion` pendentes + `ContractComment` não-resolvidos (severity error). Se issues: `{requiresReview, canForce, errorCount, warningCount}` → `ApprovalReviewDialog` ("Revisar" / "Aprovar mesmo assim" — oculto se `canForce=false`). Segunda chamada `{force: true}` aprova. GDocs: `runContractApproval` em `lib/contracts/approve-action.ts` faz `exportDocAsHtml` antes de `status=aprovado`, atualiza `htmlContent`, dispara `createContractMemory` fire-and-forget, auto-promove Deal pra "Enviado para assinatura".

**Aprovado = imutável:** chat/edição/comentários/versionamento bloqueados (403). `/auto-analyze` → 200 com `{findings:[], modelUsed:"approved"}`. **Exceção:** `PATCH /signers-data` (whitelist regex) aceita patch escopo restrito — campos só metadados pra ClickSign, não renderizados.
