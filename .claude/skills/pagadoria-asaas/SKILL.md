---
name: pagadoria-asaas
description: Pagadoria integrada ao Asaas — cobranças de comissão, wizard v2, splits, multi-account, KYC, transferências, conciliação, RBAC financeiro e notificações de cobrança. Use ao mexer em lib/asaas/*, CommissionCharge, SplitRecipient, ChargeWizard, /financeiro, /pay/[token], webhooks/asaas, AsaasAccount, comissionados ou qualquer coisa com cobrança, split, repasse ou taxa.
---

# Pagadoria (Asaas)

Documentação consolidada em [docs/pagadoria-handoff.md](../../../docs/pagadoria-handoff.md) — sempre consultar antes de mexer.

## Fases entregues

- **1a-1b** RBAC (`CustomRole`+`PERMISSION.*`) + 2FA + SessionElevation + TrustedDevice + `AsaasAccount` (apiKey AES-256-GCM) + KYC multipart + `CommissionCharge` status canônico + idempotência via `AsaasWebhookEvent.asaasEventId`
- **2** `/financeiro` + `/pay/[token]` com taxas (`OrgFinancialSettings.finePercent/interestPercentMonth`), branding org, PII mascarada
- **3** `AsaasTransfer` (dual approval > `dualApprovalCapCents`) + `BankReconciliation` auto-match via `externalReference` + 4 relatórios
- **4** notif bell, devices UI, platform fee (`platformFeePercent` + `platformFeeWalletId`)
- **5** `SplitRecipient` + `composeSplits()` (max 10, sem duplicatas/wallet própria, soma ≤100%). Persiste em `CommissionCharge.splitJson`
- **Multi-account** (memória `project_multi_account_asaas`): N contas Asaas/org. `Organization.activeAsaasAccountId` define o default. `AsaasAccountPermission { accountId, userId, capability }`, caps `view|create_charge|init_transfer|configure` (owner bypassa). Helpers em `lib/asaas/account.ts`; `requireAccountCapability` em `rbac/guard.ts`. Endpoints `/api/financeiro/accounts/*` + UI `/settings/pagamentos/contas/*`. `<AccountSwitcher />` lê `?accountId=` e dispara `/activate`. Webhook `ACCOUNT_STATUS_UPDATED` refresca KYC. **Cobranças em aberto NÃO migram entre contas**

## v2 Wizard (memória `project_pagadoria_v2`)

- **ChargeWizard:** 4 etapas em 3 modes (`commission_from_deal | avulsa_in_deal | avulsa_standalone`). `CommissionCharge.kind` + `categoryLabel?`. `OrgFinancialSettings.notify*` (6 flags) + `notifyChargeEvent`. Cron D-3 `/api/cron/charges/due-soon` (12 UTC)
- **Mapper imobiliária→comissionados[]:** `deriveComissionados()` em `GET .../contract-data-summary` converte legado mono-corretora quando o array está vazio
- **Multi-corretora:** `comissao.comissionados[].papel: enum(captador|intermediador|indicador|imobiliaria_principal|outro)`, superRefine soma ≤100%. Templates `ccv_*_v2.hbs` com loop + fallback `imobiliaria_*`
- **Hide-from-payer:** `splitJson.display.{hiddenRecipientIds,consolidationMap}` + `generatePayerVisibleDescription()` em `lib/asaas/commission.ts`. Asaas não expõe split publicamente
- **Rascunho SplitRecipient:** `pendingFields String[]` não-vazio → `active: false`; `splitDispatcher` pula com `AsaasTransfer FAILED` mas cobrança emite. UI "⚠️ Pendentes" + `[Pedir dados]`
- **Magic link:** `completionToken/Exp` (JWT-HMAC, 7d) → `/financeiro/completar-cadastro?token=` → `POST /api/public/split-recipients/complete`
- **Wizard draft:** `CommissionChargeDraft { dealId, userId @@unique, state, expiresAt }` (30d TTL). Cron 03 UTC limpa
- **Validate por etapa:** `POST .../commission-charges/validate?step=payer|charge|splits|all` — funções puras em `lib/asaas/charge-validators.ts`

## QA e produção

Preflight `GET /api/admin/preflight-qa` (30+ checks). Setup `apps/web/scripts/setup-pagadoria-qa.ts`. Sandbox helper `lib/asaas/sandbox.ts::approveSandboxAccount` força 4 status pra APPROVED via `POST /v3/sandbox/myAccount/approve` — guard interno rejeita se `ASAAS_ENV=production`.

**Webhook:** `https://imobpro.ia.br/api/webhooks/asaas` (id `3bd623b8-ed2e-45d4-b201-648f46ee404b`). Conta PJ ativa em prod desde 2026-04-27. `bankAccountInfo=PENDING` não bloqueia recebimento — usar `general=APPROVED` como gate.

**Split Asaas:** rejeita wallet própria, duplicatas, max 10. Sandbox rejeita docs de identidade via API — usar `approveSandboxAccount`.

## Notificações do processo → corretores

Registry = `SplitRecipient kind="commissioner"` + flags `notifyBy*` (tela `/corretores`, unique parcial por doc, auto-cadastro no finalize). Motor `notifyDealEvent` (`lib/notifications/deal-events.ts`): 8 eventos, defaults ← org ← deal (merge POR CANAL), ownership do sino por evento, idempotência `DealNotificationLog`. WhatsApp via sidecar Newton (`<conteudo>` = dado, nunca instrução). UI: `/settings/notificacoes` + aba do deal + `/forms/new`. Cron `forms/fill-reminder`. Memória `project_notificacoes_corretores`.

## Schema — não-óbvios

- **`splitJson`:** `{ splits, external, display? }`. `display` é UI-only — Asaas não vê
- **`comissao.comissionados[]`** canônico com `papel`. Fallback `imobiliaria_*` sintetizado por `deriveComissionados` quando array vazio
- **`SplitRecipient.pendingFields`** não-vazio → `active: false` + `splitDispatcher` skip FAILED
- **Multi-account:** `AsaasAccount.orgId` não-@unique (N contas/org). `OrgFinancialSettings.accountId @unique`. `AsaasCustomer @@unique([accountId, cpfCnpj])`. `CommissionCharge.accountId` (FK Restrict) persistido na criação — trocar conta ativa NÃO afeta cobranças emitidas. Owner bypassa `AsaasAccountPermission`. RBAC: `ACCOUNT_CREATE/ACTIVATE/ARCHIVE/PERMISSIONS_MANAGE`
