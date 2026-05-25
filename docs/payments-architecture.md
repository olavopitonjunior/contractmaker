# Arquitetura de Pagamentos — PaymentProvider (Fase 0d)

> **Status:** introduzido em 2026-05-25 (multitenant Fase 0d). **Provider único hoje: Asaas.**
> **Decisão:** NÃO migrar de Asaas agora — só introduzir o seam pra preservar opcionalidade. Reavaliar aos ~2k tenants ou R$ 5M/mês de TPV. Ver `memory/project_celcoin_migration_analysis.md` e Apêndice B do plano (`.claude/plans/voc-um-arquiteto-fuzzy-cook.md`).

## Por quê

Toda movimentação de dinheiro do produto passa por `lib/asaas/*` (chamadas diretas à API do Asaas). Sem uma camada de abstração, trocar/adicionar provedor (Celcoin, Pagar.me, …) custaria 3-4× mais — cada call-site teria que ser reescrito. A Fase 0d introduz **um seam** (`PaymentProvider`) sem mudar comportamento: o Asaas continua sendo o único provider, agora atrás de uma interface.

## Camadas

```
Código de domínio (charges-action, splitDispatcher, rotas /financeiro, ...)
        │  (migração incremental — ainda chamam lib/asaas direto hoje)
        ▼
lib/payments/                       ← SEAM (Fase 0d)
  ├── provider.ts      → interface PaymentProvider + PaymentProviderError
  ├── types.ts         → DTOs neutros (Charge, CreateChargeInput, Transfer, ...)
  ├── asaas-provider.ts→ AsaasProvider implements PaymentProvider
  └── index.ts         → getPaymentProvider({ apiKey, provider? })
        │  (delega, mapeia shapes Asaas ↔ neutros)
        ▼
lib/asaas/*                         ← wrappers de baixo nível da API Asaas (inalterados)
  payments.ts · customers.ts · transfers.ts · client.ts (asaasFetch) · ...
```

## A interface

`PaymentProvider` (`lib/payments/provider.ts`) cobre o **núcleo de movimentação de dinheiro** que qualquer provider precisa reimplementar:

- **Cobranças:** `createCharge` · `getCharge` · `cancelCharge` · `refundCharge`
- **Clientes:** `upsertCustomer` · `getCustomer`
- **Transferências:** `createTransfer` · `cancelTransfer`

Fora do v1 (provider-específico, adicionar quando houver 2º provider): onboarding/KYC de subconta, split dispatcher, reconciliação, webhooks.

Os DTOs (`lib/payments/types.ts`) são **neutros** — não vazam tipos do Asaas. `AsaasProvider` mapeia `AsaasPayment ↔ Charge`, `AsaasCustomer ↔ PaymentCustomer`, `AsaasTransfer ↔ Transfer`.

## Uso

```typescript
import { getPaymentProvider } from "@/lib/payments";
import { getAccountWithApiKey } from "@/lib/asaas/account";

const { apiKey } = await getAccountWithApiKey(accountId); // descriptografa AES-256-GCM
const payments = getPaymentProvider({ apiKey });

const charge = await payments.createCharge({
  customerId, billingType: "PIX", value: 1000, dueDate: "2026-06-01", splits,
});
```

A `apiKey` é por subconta (multi-account Asaas). O `provider` param default é `"asaas"`; o switch em `getPaymentProvider` é onde um provider futuro entra.

## Migração de callers (incremental, NÃO feito na 0d)

A Fase 0d entrega o seam + adapter + testes. Os call-sites existentes (`charges-action.ts`, `splitDispatcher.ts`, rotas) **continuam chamando `lib/asaas/*` direto** — migram pra `getPaymentProvider()` de forma incremental, sem big-bang. Nenhum teste existente de `lib/asaas` mudou.

## Quando adicionar um provider novo

1. Implementar `XProvider implements PaymentProvider` em `lib/payments/x-provider.ts`.
2. Mapear os shapes do provider ↔ DTOs neutros.
3. Adicionar o case no switch de `getPaymentProvider`.
4. Persistir a escolha por org (ex.: `Organization.preferredPaymentProvider`) — schema change futuro.
5. Cobranças em aberto NÃO migram entre providers (coexistem até vencer).
