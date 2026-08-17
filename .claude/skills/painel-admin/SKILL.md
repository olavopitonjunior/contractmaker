---
name: painel-admin
description: Painel super-admin de tenants do Contractmaker (criação de orgs, gestão de módulos, impersonation) e o RBAC de plataforma (PlatformRole). Use ao mexer em app/admin/*, api/admin/*, ou ao gatear ações de super-admin.
---

# Painel super-admin

Telas/rotas para staff da plataforma (cross-tenant), separadas do dashboard das orgs.

## RBAC de plataforma — `lib/security/rbac/platform.ts`
- `requirePlatformRole(userId, role)` lança `PlatformRoleRequiredError`. Roles: `super_admin`, `support`, `billing`.
- **Convenção de gate**: `support` LÊ (GET), `super_admin` ESCREVE (POST/PATCH).
- **`/api/admin/platform/whoami` já existe** na staging — não re-portar.
- **Seed pra QA**: `scripts/grant-platform-role.ts` concede PlatformRole a um usuário.

## Superfícies (cherry-pick de `origin/feat/mt-1e-admin-orgs`)
- `app/admin/orgs/page.tsx` + `AdminOrgsClient.tsx` — lista orgs com KPIs.
- `app/api/admin/orgs/route.ts` — GET (support+) lista; POST (super_admin) cria org (pipeline + 7 stages + brandingSettings). **Estendido** com `modules` opcionais na criação.
- `app/api/admin/orgs/[orgId]/impersonate/route.ts` + `components/admin/ImpersonationBanner.tsx`.
- **NÃO portar**: Google OAuth per-org, ClickSign white-label, schema de plataforma (já na staging).

## Trânsito cross-tenant (super_admin opera qualquer tenant)

Um super_admin entra em qualquer org **como o dono dela** — não por membership real.

- **Seam de identidade** — `lib/auth/impersonation.ts`. Cookie `mt_impersonate=<orgId>` + row `TenantImpersonationSession` (TTL **8h**, `IMPERSONATION_TTL_SECONDS`). `getImpersonationFor(adminId)` revalida PlatformRole + sessão ativa **a cada request** (cookie sozinho não vale) e devolve `{ orgId, ownerUserId }`. `RAW_PATH_PREFIXES` (`/admin`, `/api/admin`, `/api/me`, `/api/security`, `/api/auth`) NUNCA sofrem overlay — é o que permite sair da impersonation e mexer na própria conta.
- **Onde o overlay é aplicado** (não espalhar em call-site novo — use estes):
  - `lib/auth/context.ts::requireAuth` e `lib/api/require-auth.ts::requireApiAuth` → `ctx.userId`/`actor.effectiveUserId` viram o **dono do tenant**, `org` vem explícita da impersonation, e o admin real fica em `impersonatedByUserId`. Só sessão web — bearer é máquina, nunca sofre overlay.
  - `lib/modules/page-guard.ts` (`requireModulePage`/`requireFeaturePage`/`requireAnyFeaturePage`) → devolve `userId` efetivo.
  - `getUserOrg` (resolução de org) e `requireOrgAdmin`.
- **Por que identidade efetiva e não "overlay de permissão"**: `getEffectivePermissions(userId, orgId)` é `null` sem membership → `can()`/`requirePermission` negavam tudo dentro do tenant. Com o dono como ator, RBAC/escopo por corretor/notificações resolvem sozinhos.
- **Auditoria** — `audit()` (lib/security/audit.ts) chama `getImpersonationAuditMeta()` e carimba `metadata.impersonated/impersonatedBy/impersonationSessionId` em TODO log escrito sob impersonation (o `userId` gravado é o dono). Sem isso a ação do staff ficava indistinguível da do cliente.
- **Elevação (2FA sudo)** — `requireElevation` aceita o JWT do **admin real** quando há impersonation ativa: a elevação é emitida em `/api/security` (path cru), então nunca pertenceria ao dono.
- **Frontend** — `components/admin/TenantSwitcher.tsx` no header do dashboard (montado em `(dashboard)/layout.tsx` só pra `super_admin`): busca + 1 clique → `POST .../impersonate` (motivo default) → reload. Item "minha org" → `DELETE` encerra. Trocar A→B encerra as sessões abertas antes de abrir a nova.

## Gestão de módulos por tenant
- `app/api/admin/orgs/[orgId]/modules/route.ts`:
  - `GET` (support) → `{ catalog: MODULE_CATALOG, current: getOrgModules(orgId) }`.
  - `PATCH` (super_admin) → `prisma.orgModule.upsert({ where:{ orgId_module } })`, validar `isValidModule` + flags contra catálogo, `audit(..., "ORG_MODULES_UPDATED")`.
- `app/admin/orgs/[orgId]/modules/page.tsx` — toggle por módulo + accordion de switches por sub-função, dirigido por `MODULE_CATALOG`.
- Na criação de tenant: criar pipeline `kind:"locacao"` **só se** locação ON.

## Audit
Registrar `ORG_MODULES_UPDATED` em `lib/audit/actions.ts` (lista canônica exigida pelo CLAUDE.md) antes de usar.
