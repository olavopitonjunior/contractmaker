---
name: modulo-locacao
description: Mapa do módulo de LOCAÇÃO do Contractmaker (rotas, APIs, schema, discriminadores, gating). Use ao mexer em qualquer superfície de locação — pipeline, ADM (contratos/cobranças/repasses/despesas/vistorias/seguros/pessoas), crons, ou ao gatear locação por tenant.
---

# Módulo Locação

Aditivo sobre venda. Discriminadores: `Deal.kind="locacao"`, `Pipeline.kind="locacao"`, `SalesForm.schemaType` começa com `"locacao"`.

## Superfícies
- **Pipeline comercial**: `(dashboard)/pipeline/locacao/page.tsx` (6 stages).
- **ADM** (páginas): `(dashboard)/locacao/**` — dashboard, imoveis, contratos, cobrancas, repasses, despesas, vistorias, seguros, pessoas/*, newton. **`locacao/layout.tsx` já existe** (é o ponto de guard server-side do módulo).
- **APIs**: 29 rotas em `app/api/locacao/*`.
- **Componentes**: `components/locacao/*`. **Lib**: `lib/locacao/*` (rent-scheduler, dunning, repasse-simulator, validators, route-helpers, executors).
- **Schema**: 14 models (Property, LeaseContract, RentCharge, PropertyOwner, Tenant, Expense, Inspection, Guarantee, etc.).
- **Crons**: `api/cron/locacao/newton/{check-late-payments,check-readjustments}`.

## Seam único de auth/gating — `ensureLocacaoAccess`
`lib/locacao/route-helpers.ts:22` — **28 das 29** rotas de locação passam por aqui. É o lugar para `assertModuleEnabled(org.id, "locacao")` (cobre todas de uma vez) e para sub-funções via parâmetro `feature?: FeatureKey` → `assertFeatureEnabled`.
- Mapear features: `rent-charges/*`→`locacao.cobrancas`, `repasses/*`→`locacao.repasses`, `expenses/*`→`locacao.despesas`, `inspections/*`→`locacao.vistorias`, `insurance/*`→`locacao.seguros`.
- **Exceção (29ª rota)**: `api/locacao/forms/[token]/route.ts` é PÚBLICA (sem auth, por token) — não passa pelo seam. Gating: na criação do form (rota autenticada herda o gate) + no preenchimento público resolver `salesForm.orgId` e, se locação OFF, responder "indisponível".

## Gating de crons
Crons iteram orgs e **não** checam módulo por padrão. Dentro do loop: `if (!isModuleEnabled(await getOrgModules(orgId), "locacao")) continue;`.

## `LOCACAO_SIMPLIFIED_MODE` ≠ entitlement
A flag env `LOCACAO_SIMPLIFIED_MODE` (`lib/env/flags.ts`/`staging.ts`) controla a **profundidade** da UI de locação (esteira simplificada vs ADM completa) para quem **tem** o módulo. É **ortogonal** ao entitlement por-tenant (`OrgModule`). NÃO confundir os dois eixos: o entitlement diz "a org tem locação?"; a flag diz "mostro a ADM completa ou só a esteira?".

## Geração de contrato
`generateLocacaoContractForDeal` em `lib/services/contract-generation.ts:1039` (call-site `api/locacao/forms/[token]`). Tem `assertModuleEnabled(orgId,"locacao")` no topo.
