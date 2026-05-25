# Redesign imobpro.ai — Relatório de bugs & UX findings

Relatório vivo, mantido em paralelo ao redesign. Bugs **funcionais** e **UX findings**
descobertos durante a varredura visual e o QA. Correções funcionais **não** entram no
mesmo PR do redesign — abrir issue/PR separado para não misturar refactor visual com fix
de lógica.

Severidade: 🔴 alta · 🟡 média · 🔵 baixa/cosmético

---

## Rebrand — pendências conhecidas (dívida do passe Fase 0)

Strings de marca "Contractmaker" ainda visíveis, deixadas para o passe da área dona
(evita tocar texto legal/identificadores de risco fora de contexto):

| # | Superfície | Item | Sev | Decisão |
|---|---|---|---|---|
| R1 | `/terms`, `/privacy` | Nome "Contractmaker" no corpo do texto legal + e-mails `@contractmaker.com.br` | 🟡 | **Requer decisão jurídica** — nome da entidade no ToS/Privacidade. Não trocar sem confirmar razão social/domínio de contato. |
| R2 | E-mails (`lib/email/templates/*`, subjects) | "Contractmaker" em magic-link, reset, convite, footer | 🟡 | Rebrand no passe de e-mail (templizar marca). Footer `shared.tsx` é 1 ponto central. |
| R3 | Financeiro (onboarding, OnboardingWizard) | "...pelo Contractmaker" em body | 🔵 | Passe Financeiro (Fase B). |
| R4 | `lib/security/totp.ts` `ISSUER` | Label "Contractmaker" no app autenticador | 🔵 | Trocar afeta só **novos** enrolamentos 2FA; cuidado p/ não confundir quem já cadastrou. Avaliar. |
| R5 | Identificadores técnicos | `admin@contractmaker.com` (login real de owner), `contractmaker:cookie-consent:v1` (storage key), User-Agent strings | — | **NÃO trocar.** Quebra login/consent/integrações. Documentado como intencional. |

Já rebrandado na Fase 0: sidebar, 4 telas de auth (login/register/forgot/reset),
metadata titles (template `%s · imobpro.ai`), label de taxas, footer da tela pública de
pagamento.

---

## Bugs funcionais

| # | Superfície | Sintoma | Sev | Status |
|---|---|---|---|---|
| B1 | Build / `lib/certidoes` | `master` com build quebrado: `planner.ts` usava `TargetKind` `conjuge_vendedor`/`procurador_vendedor`/`representante_vendedor` mas `types.ts` **commitado** não os declarava. `tsc` local passava (working tree tinha o fix não-commitado), mas `next build` falhava — os **2 últimos deploys de produção do master erraram** e prod ficou no build anterior (`0a18d5af`). Descoberto ao subir o preview do redesign. | 🔴 | **Resolvido 2026-05-23** — commit `48ccc1dc` no master commita o conjunto de certidões pendente (type-clean). |

---

## UX findings

| # | Superfície | Sintoma | Sev | Proposta |
|---|---|---|---|---|
| UX1 | Wizard de cobrança | Densidade de texto alta (banners + microcopy + helpers) — já anotado na memória `feedback_ui_density` | 🟡 | Reduzir explicações, mover detalhe p/ tooltip. Entra no redesign do ChargeWizard (Fase B). |

---

## Notas de ambiente (não-bugs, mas footguns)

- **Caminho real do repo:** `C:\Users\User\Projetos Web\Contractmaker` (working dir oficial
  da sessão). Existe uma **cópia incompleta no OneDrive** (`...\OneDrive\Desktop\Projetos
  Web\Contractmaker`) sem `.git` e com `public/` vazia — ignorar. Ver memória
  `feedback_onedrive_git_footgun`.
