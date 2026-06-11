# Kickoff Técnico — Fase 0 Multi-Tenant

> **Escopo:** checklist de pré-D1 + setup de ambiente pra começar a Fase 0 (refactor foundational) do plano multitenant 600 tenants.
> **Fonte:** `docs/prd-multitenant-600.md` + `docs/cronograma-multitenant-600.md`. Decisões em `.claude/plans/voc-um-arquiteto-fuzzy-cook.md`.
> **Data:** 2026-05-25. **Status do plano:** aprovado, zero implementação iniciada (74 models, nenhum dos planejados existe).

---

## 0. TL;DR — o que precisa estar pronto antes do D1

| # | Pré-requisito | Por quê | Bloqueia |
|---|---|---|---|
| P1 | **CI no GitHub Actions** (`.github/workflows/ci.yml`) | Hoje **não existe CI**. O gate da Fase 0b ("isolation test em CI") não tem onde rodar. | 0b, todo merge futuro |
| P2 | **Neon staging branch** | Migrations + isolation test + benchmark precisam de Postgres real isolado de prod (sem homolog). | 0a, 0b, 0c |
| P3 | **Seed de orgs sintéticas** (`scripts/seed-synthetic-orgs.ts`) | Isolation test e E2E two-org precisam de ≥2 orgs com dados. | 0b, 1a, 1e |
| P4 | **Branches por subfase** | 4 frentes paralelizáveis; evitar conflito no schema. | organização |
| P5 | **Gates externos disparados** (Google OAuth, ClickSign WL, DPO) | Levam 2-6 semanas; rodam em paralelo desde D1 pra não travar go-live da Fase 1. | go-live Fase 1 |

P1–P4 são bloqueantes do D1 técnico. P5 não bloqueia Fase 0 (só Fase 1), mas inicia agora.

---

## 1. Sequenciamento da Fase 0

```
D1 ─┬─ 0a PlatformConfig + PlatformRole (0.5-1w) ──┐
    │                                              ├─→ 0c Eliminar SHARED_ORG_ID (0.5w)
    ├─ 0b scopedPrisma + isolation CI (1.5-2w) ────┘   (0c depende de 0a: audit types)
    └─ 0d PaymentProvider interface (2w) ─────────────  (independente)
```

- **0a primeiro** (ou em paralelo no D1): destrava 0c (tipos de audit context) e 1d/1e.
- **0b** roda em paralelo, é o gate de qualidade — quanto antes verde, antes protege todo merge.
- **0c** começa quando 0a tiver os tipos de `PlatformContext`/audit prontos.
- **0d** totalmente independente, pode ser o trabalho do 2º eng desde o D1.
- **Caminho crítico Fase 0:** 0a → 0c ≈ 1-1.5 semana. 0b/0d correm ao lado.

---

## 2. P1 — Stand up CI (GitHub Actions) — ✅ ENTREGUE (2026-05-25)

**Antes:** sem `.github/workflows`. Runner é `vitest` (`apps/web/package.json`).

**Entregue:**
- **`.github/workflows/ci.yml`** — job `build-and-test` (Node 20, `npm install` espelhando o Vercel): `prisma generate` → `prisma:validate` → `typecheck` → `test`. Triggers: PR + push em `master`; `concurrency` cancela runs antigos.
- **`apps/web/package.json`** ganhou scripts `typecheck` (`tsc --noEmit`) e `prisma:validate` (`prisma validate`).
- `DATABASE_URL`/`ANTHROPIC_API_KEY`/`AUTH_SECRET` dummy no env do job — unit tests **mockam o Prisma inteiro** (`src/__tests__/setup.ts`), então não tocam DB nem APIs reais.

**Verificado local (verde):** `prisma validate` ✓ · `tsc --noEmit` exit 0 (zero erros) ✓ · `vitest run` **82 arquivos / 1004 testes** ✓.
> Nota Windows: localmente rodar `prisma generate --no-engine` antes do `tsc` (memória `feedback_prisma_generate_no_engine`); no CI Linux não há o EPERM.

**Falta (operacional, fora do código):**
- Criar o repo no GitHub com Actions habilitado e confirmar o run verde no 1º PR.
- **Branch protection** em `master`: exigir `build-and-test` verde pra merge.
- `isolation` job entra na **Fase 0b** (`test:isolation` contra Neon staging branch via secret `DATABASE_URL_STAGING`) — também gate de merge.

---

## 3. P2 — Neon staging branch — ✅ ENTREGUE (2026-05-25)

Sem homologação, mas Fase 0 mexe em schema/migrations → **não rodar contra prod**. Neon tem branching nativo. Operado via **Neon MCP** (escopo de usuário, OAuth).

**Entregue:**
- Projeto Neon: **ContractMaker** = `wispy-tree-00688100` (us-east-1). Branch de prod = `production` (`br-super-wildflower-anrm19we`).
- Branch staging criada: **`staging-mt-fase0`** = `br-empty-dust-any32pm0` (fork de production, dados copiados).
- **`apps/web/.env.staging`** criado (DATABASE_URL pooled + DIRECT_URL direct + `SYNTHETIC_SEED_ALLOWED=1`). Gitignored via `.env.staging*` no `.gitignore`. Carregar: `set -a; source apps/web/.env.staging; set +a`.
- `prisma migrate deploy` aplicado na staging — 1 migration pendente (`20260525160000_envelope_signer_role_group`) aplicada; schema completo do repo agora na staging.
- Seed rodado → **alpha + beta** com fixture completa (verificado via Neon MCP: cada org com 1 member, 7 stages, 3 deals, 2 leads, 1 asaas, 3 audits).

**Gotcha resolvido (engine Prisma):** `prisma generate --no-engine` (usado pra destravar o tsc no Windows) gera client modo Accelerate → scripts de runtime (seed/tsx) quebram com `P6001 "URL must start with prisma://"`. Pra rodar seed/tests-com-DB localmente, gerar o client **com engine** (`npx prisma generate` normal; pare o `next dev` antes pra evitar EPERM no rename). Ver memória `feedback_prisma_generate_no_engine`.

**Falta (operacional):** pôr a connection string da staging como secret `DATABASE_URL_STAGING` no GitHub (pro job `isolation` da Fase 0b).

**Reset barato:** se um teste sujar a branch → `mcp__neon__reset_from_parent` (re-sincroniza com production) ou recriar.

---

## 4. P3 — Seed de orgs sintéticas — ✅ ENTREGUE (2026-05-25)

**Entregue: `apps/web/scripts/seed-synthetic-orgs.ts`** (padrão dos scripts existentes: `arg()`/`flag()`, dry-run default).

- Flags: `--apply`, `--orgs N` (default 2: `alpha`,`beta`), `--deals N` (3), `--leads N` (2), `--password`.
- Por org (ids determinísticos `seed_<slug>_*`, tudo **upsert** → idempotente): `Organization`, owner `User` (bcrypt, login real), `OrgMembership(owner)`, `Pipeline` + 7 stages canônicos, N `Deal` espalhados pelos stages, N `Lead`, 1 `Contract` (rascunho, `templateId=null`), 1 `AsaasAccount` placeholder (chave NÃO-real, status APPROVED), 3 `AuditLog` de amostra.
- **Guard anti-prod (verificado):** dry-run não escreve nada; `--apply` **recusa** se `NODE_ENV=production` OU se `SYNTHETIC_SEED_ALLOWED !== "1"`. Imprime o `DB host` antes de qualquer escrita.

**Verificado local:** dry-run roda limpo (exit 0); `--apply` sem o env **abortou antes de escrever**.
> ⚠️ **O `.env` local aponta pro Neon de PROD** (`ep-bitter-wildflower-...neon.tech`). Por isso o guard é crítico. Setar `SYNTHETIC_SEED_ALLOWED=1` **apenas** no `.env.staging` (com a connection string da branch Neon `staging-mt-fase0`). Nunca em prod.

**Uso (na staging):**
```bash
# com .env.staging carregado (DATABASE_URL=staging + SYNTHETIC_SEED_ALLOWED=1)
npx tsx scripts/seed-synthetic-orgs.ts            # dry-run primeiro
npx tsx scripts/seed-synthetic-orgs.ts --apply    # persiste alpha + beta
```

Esse script é a fixture base do `tenant-isolation.test.ts` (0b).

---

## 5. P4 — Branches por subfase

Branchear de `master` (não de `redesign/fase-b`, que é trabalho de UI não relacionado):

| Branch | Subfase | Owner sugerido |
|---|---|---|
| `feat/mt-0a-platform-config` | 0a — PlatformConfig + PlatformRole + `requirePlatformRole` | Eng 1 |
| `feat/mt-0b-scoped-prisma` | 0b — `lib/db/scoped-prisma.ts` + isolation test + CI | Eng 1 (após 0a) |
| `feat/mt-0c-kill-shared-org` | 0c — 5 sites SHARED_ORG_ID + audit nullable | Eng 1 |
| `feat/mt-0d-payment-provider` | 0d — `lib/payments/provider.ts` + `AsaasProvider` | Eng 2 |

`infra/ci-setup` (P1) e `chore/seed-synthetic-orgs` (P3) podem ser PRs pequenos que entram antes/junto do 0b.

**Nota OneDrive:** confirmar que o repo de trabalho (`C:\Users\User\Projetos Web\Contractmaker`) está **fora** do OneDrive sincronizado antes de criar branches — `.git` some sem aviso em pasta sincronizada.

---

## 6. P5 — Gates externos (disparar no D1, rodam em paralelo)

Não bloqueiam a Fase 0, mas têm lead time longo e bloqueiam go-live da Fase 1:

| Gate | Lead time | Ação no D1 | Bloqueia |
|---|---|---|---|
| **Google OAuth Consent "In Production"** | 4-6 semanas | Submeter verification (privacy/terms URLs já existem em `/privacy`,`/terms`); preparar logo + demo | 1b (GoogleConnection per-org) |
| **Acordo comercial ClickSign WL** | 2-4 semanas | Abrir conversa comercial (volume agregado + tier híbrido WL/pool) | 1c (ClickSignAccount) |
| **DPO review LGPD + DPA template** | 1-2 semanas | Enviar modelo controlador/operador + lista de sub-operadores pra revisão | go-live Fase 1 |

---

## 7. Checklist de prontidão pré-D1

Confirmar TODOS antes de abrir o 1º PR de código:

- [x] **`.github/workflows/ci.yml` criado** + scripts `typecheck`/`prisma:validate` — verde local (1004 testes) ✅
- [x] **`scripts/seed-synthetic-orgs.ts` criado** com guard anti-prod (`SYNTHETIC_SEED_ALLOWED=1`) — dry-run + bloqueio verificados ✅
- [x] **Neon branch `staging-mt-fase0` criada** (`br-empty-dust-any32pm0`, fork de production) ✅
- [x] **`prisma migrate deploy` aplicado clean na staging** (schema completo do repo) ✅
- [x] **`seed-synthetic-orgs.ts --apply` criou alpha + beta na staging** (fixture verificada via Neon MCP) ✅
- [x] **`apps/web/.env.staging` criado** (gitignored) com DATABASE_URL/DIRECT_URL/`SYNTHETIC_SEED_ALLOWED=1` ✅
- [ ] Repo confirmado fora do OneDrive sincronizado (`.git` íntegro via `gh api`)
- [ ] CI rodando no GitHub e verde no 1º PR (Actions habilitado)
- [ ] Branch protection em `master` exige `build-and-test` verde
- [ ] Secret `DATABASE_URL_STAGING` no GitHub (connection string da staging) — pro job `isolation` da 0b
- [ ] 4 branches de subfase criadas de `master`
- [ ] Gates externos P5 disparados (3 e-mails/tickets enviados)
- [ ] Owner definido por subfase (1 ou 2 engs — ver cenários no cronograma)

---

## 8. Verificação end-to-end do kickoff

Antes de declarar Fase 0 "started", validar a esteira completa numa branch descartável:

1. **CI roda:** abrir PR trivial → `typecheck` + `unit` verdes em <5min.
2. **Migration na staging:** aplicar a migration `auditlog_orgid_nullable` (primeira da 0c) → `prisma migrate status` clean.
3. **Seed:** `seed-synthetic-orgs.ts --apply` → query confirma 2 orgs com pipelines + deals.
4. **Isolation skeleton:** escrever o `tenant-isolation.test.ts` cobrindo 1 rota (`/api/pipeline/deals`), rodar contra staging → org A login não vê resource de org B (404). Depois expandir pras 8 rotas na 0b.
5. **Anti-prod guard:** rodar `seed-synthetic-orgs.ts` com `DATABASE_URL` de prod → recusa com erro claro.

Com esses 5 verdes, o D1 da Fase 0 está liberado.

---

## 9. Riscos do kickoff

| Risco | Mitigação |
|---|---|
| Testes chamam APIs reais (Asaas/ClickSign cobram) | Mockar todos os provedores no CI; isolation test só toca DB |
| `scopedPrisma` adiciona overhead que regride p95 | Benchmark antes/depois na 0b (acceptance <5%); aplicar RLS só em ~12 tabelas hot |
| Migration na staging diverge de prod | SQL idempotente + `migrate diff` no CI; aplicar staging→prod só após Fase 0 redonda |
| OneDrive corrompe `.git`/`.env` durante o sprint | Repo fora do OneDrive; `.env.staging` em pasta não-sincronizada |
| Gate externo (Google/ClickSign) atrasa Fase 1 | Disparados no D1; Fase 0 não depende deles |
