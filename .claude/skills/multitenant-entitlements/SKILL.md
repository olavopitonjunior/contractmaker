---
name: multitenant-entitlements
description: Como funcionam os módulos habilitáveis por tenant (Vendas/Locação) no Contractmaker — catálogo, leitura, guards e enforcement. Use ao tocar em lib/modules/*, gating por módulo/feature, sidebar condicional, ou ao adicionar uma nova sub-função.
---

# Multitenant — entitlements de módulos (Vendas / Locação)

O sistema é modularizado em **módulos contratados por tenant**: `vendas` e `locacao`. Cada módulo tem **sub-funções** (features) que podem ser ligadas/desligadas por org. Tudo gira em torno de `apps/web/src/lib/modules/`.

## Arquivos
- `catalog.ts` — **SINGLE SOURCE OF TRUTH**. Client-safe (a sidebar importa). Define `MODULE`, `FEATURE`, `MODULE_CATALOG`, e helpers puros (`isValidModule`, `featureModule`, `featureDefault`, `moduleDef`).
- `read.ts` — server. `getOrgModules(orgId)` (envolto em `React.cache` → dedupe por request). Retorna `{ enabled, features }` resolvendo defaults do catálogo. **Fail-open**: org sem row → defaults do catálogo. `isModuleEnabled` / `isFeatureEnabled`.
- `guard.ts` — server. `assertModuleEnabled(orgId, module)` / `assertFeatureEnabled(orgId, feature)` lançam `ModuleDisabledError { status:403, code:"MODULE_DISABLED" }`. Espelha `PermissionDeniedError` (`lib/security/rbac/guard.ts`) — capturar no mesmo handler.
- `resolve.ts` — discriminadores (`moduleForDealKind`, `moduleForSchemaType`, `getPipelineByKind`).

## Regras de ouro
1. **Defaults moram no código (catálogo), nunca no banco.** A coluna `OrgModule.featureFlags` é `@default("{}")`; ausência de chave → default do catálogo em runtime. Adicionar sub-função = editar SÓ `catalog.ts`, sem migração de dados. (Gotcha: memória `feedback_prisma_array_default_drift`.)
2. **`OrgModule.module` é string validada por `isValidModule`** — nunca FK pro catálogo.
3. **Chave de módulo `"vendas"` ≠ `Pipeline.kind` (`"venda"`, singular).** O mapeamento vive em `resolve.ts::getPipelineByKind`.
4. **`getOrgModules` é cacheado por request** (`React.cache`) — um toggle no painel admin reflete só no **próximo** request. Aceitável.
5. **Fail-open** entre a migration (P1) e o enforcement (P4): org sem row vê tudo, não derruba staging.

## Onde aplicar enforcement
- **Sidebar**: `components/layout/app-sidebar.tsx` — campo `requires?: ModuleKey | FeatureKey` no `NAV`, filtrado antes do render.
- **Páginas**: layouts server (`(dashboard)/locacao/layout.tsx`) com `assertModuleEnabled` + `redirect`.
- **APIs locação**: seam único `ensureLocacaoAccess` (`lib/locacao/route-helpers.ts`).
- **APIs venda**: topo de `api/pipeline/*`.
- **Crons**: filtrar org no loop (`if (!isModuleEnabled(...)) continue`).
- **Middleware NÃO** (é edge, sem Prisma) — bloqueio é sempre server-side.

## Painel
Toggle em `/admin/orgs/[orgId]/modules` → `PATCH /api/admin/orgs/[orgId]/modules` (`upsert` OrgModule, gate super_admin, audit `ORG_MODULES_UPDATED`).
