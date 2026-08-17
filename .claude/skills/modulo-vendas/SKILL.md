---
name: modulo-vendas
description: Mapa do módulo de VENDAS do Contractmaker (pipeline, deals, form público, certidões, pagadoria) e a regra crítica de filtrar pipeline por kind. Use ao mexer em superfícies de venda ou ao gatear vendas por tenant.
---

# Módulo Vendas

Negócio em produção. Discriminadores: `Deal.kind="venda"`, `Pipeline.kind="venda"` (**singular**), `SalesForm.schemaType` NÃO começa com `"locacao"`.

## Superfícies
- **Pipeline**: `(dashboard)/pipeline/page.tsx` (7 stages); `(dashboard)/deals/[dealId]`.
- **Form público**: `app/f/[token]` (7 etapas) + `api/forms/[token]`.
- **APIs**: `api/pipeline/*`, `api/deals/*`.
- **Certidões**: `api/deals/[dealId]/certidoes/*` (Infosimples/Serasa).
- **Pagadoria/comissão**: `api/deals/[dealId]/commission-charges/*`, `lib/asaas/*`.
- **Geração de contrato**: `generateContractForDeal` em `lib/services/contract-generation.ts:719` (call-site `api/forms/[token]`).

## ⚠️ Regra crítica: NUNCA `pipeline.findFirst` sem `kind`
Uma org pode ter pipelines de venda E locação. `findFirst({ where:{ orgId } })` pode pegar o pipeline ERRADO. Sempre use `getPipelineByKind(orgId, "vendas")` (`lib/modules/resolve.ts`) — que mapeia `"vendas"`→`Pipeline.kind="venda"`. Call-sites historicamente sem filtro (corrigidos): `pipeline/route.ts:16`, `pipeline/deals/route.ts:37`/`:111`, `contract-generation.ts:951`. **Preservar os `include` originais** de cada call-site.

## Gating por tenant
`assertModuleEnabled(auth.org.id, "vendas")` no topo de `api/pipeline/route.ts`, `api/pipeline/deals/route.ts`, `generate-contract/route.ts`. Sub-funções: `vendas.certidoes`, `vendas.pagadoria`, `vendas.form_publico`.

## Infra compartilhada (não é "de venda")
Auth/RBAC, Google Docs (`lib/google`), Handlebars (`lib/render`), ClickSign (`lib/clicksign`), Asaas (`lib/asaas`), storage, IA (`lib/ai`), DealAttachment, settings, templates. Não gatear por módulo.
