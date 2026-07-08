# QA E2E — Contrato de Administração de Locação + melhorias (PR #85)

**Ambiente:** `staging.imobpro.ia.br` (commit `821b8e8c`, deploy READY) · **Org:** Contractmaker Demo (`cmpx5swqs...`) · **Persona:** QA tester (jornada + fluxos + UX/UI) via `/chrome` + Neon SQL + API · **Data:** 2026-07-08 · **Login:** olavo.piton@gmail.com (owner)

## Setup aplicado
- `sync-templates.ts --apply --seed --update-metadata` → template `administracao_locacao` (handlebars, default) nas 3 orgs + sources locação v3 atualizados (Fase B).
- Cláusulas de locação: 10 presentes (tag `locacao`, groupCode NULL) — shape do fix `loadTopClauses` (Fase D).
- `/api/health/google-docs` → `ready:true`, OAuth válido. `/api/health` → ok (Redis/Upstash off — degradação menor).
- Migração `20260706100000_contract_islatest_per_kind` aplicada.

## Matriz de resultados

| Caso | Área | Veredito | Evidência |
|---|---|---|---|
| Q3.1 empty state aba Administração | Fase A4 | ✅ | Deep-link `?tab=administracao`; ícone + heading + explicação + CTA único |
| Q3.2 geração + conteúdo | Fase A2/A3/B | ✅✅ | Contrato de adm gerado: mandato CC 653-666; ADMINISTRADORA=org (legalName+CRECI+endereço, CNPJ omitido limpo); PROPRIETÁRIA=Helena qualificada; imóvel **sem** "localizado na , nº , /"; "aluguel de referência R$ 3.500,00"; 10 cláusulas |
| Q3.4 isolação das abas | Fase A1 | ✅✅ | Aba Contrato = "Locação residencial (E2E)" rascunho/15 comentários; aba Administração = "Administração de Locação" aprovado/2 comentários — instrumentos separados |
| Q4.1 gate de aprovação | Fase A | ✅ | `ApprovalReviewDialog` "1 aviso · 2 comentários", "Aprovar mesmo assim" → aprovado; **deal continuou em "Em contrato"** (não avançou funil) |
| Q4.2 dialog variante administração | Fase A4 | ✅✅ | Proprietário [Interessado/party] + Imobiliária [realestate, nome pré-preenchido] + Testemunha; **sem locatário** |
| Q4.3 envio real | Fase A | ✅ mapeamento / ⛔ send | Envelope DB com signers corretos (locador/party, imobiliaria/realestate, testemunha/witness), costCents=0; **ClickSign rejeitou (token de staging inválido — infra, não o PR)** |
| Q5.1 isLatest por kind | Fase A1 | ✅✅ | Mesmo deal: `contract` v1 isLatest=true **E** `administracao` v1 isLatest=true coexistindo; índice `(dealId,kind) WHERE isLatest` |
| Q5.2 fix aditamento | Fase A1 | ✅ (constraint) | Índice permite; 0 deals violando a invariante |
| Q6 regressão vendas | Fase A1 | ✅ | Board de vendas (7 stages) carrega normal; hardening kind não quebrou |
| Fase D cláusulas | Fase D | ✅ | 10 cláusulas locação com tag+groupCode NULL (carregáveis pelo expert-context) |
| Análise passiva locação-aware | Fase C | ✅ | Passiva flagou cláusula 7.1 (vigência) do contrato de adm — raciocínio sobre o termo, sem heurística de venda |

## Achados (bugs / UX-UI)

### 🔴 P1 — CTA "Enviar para assinatura" do banner do editor leva à tela de VENDAS
No contrato de administração aprovado, o banner do `ContractEditorPage` ("Contrato aprovado — Enviar para assinatura") navega para `/deals/[id]?tab=assinaturas` (**DealDetail de VENDAS**: timeline Form/Conf/Envio/Sign/Cobr/Pago, abas Certidões/Pagamentos/Newton, "Documentos avulsos"), em vez do fluxo de assinatura da administração. O fluxo correto (variante Proprietário+Imobiliária) está no `LeaseSignaturesTab` **abaixo** do editor. Há dois CTAs "Enviar para assinatura" competindo; o do topo (mais proeminente) está errado para locação/administração.
**Impacto:** operador cai no módulo de vendas; confusão/fluxo quebrado. **Recomendação:** no `LocacaoAdminContractTab`, suprimir/repontar o CTA do banner do `ContractEditorPage` (prop de callback/link para o `LeaseSignaturesTab` da própria aba), ou esconder o banner de assinatura do editor quando embutido em locação.

### 🟡 P2 — DealDetail de vendas conflaciona instrumentos ("Contratos (2 versões)")
A tela `/deals/[id]` (vendas) conta locação + administração como "2 versões" na aba Contratos — a query de contracts do DealDetail de vendas não filtra por `kind`. **Recomendação:** escopar por `kind="contract"` (ou separar por instrumento) na `(dashboard)/deals/[dealId]/page.tsx`.

### 🟡 P2 — Copy do ApprovalReviewDialog não é kind-aware
No contrato de administração, o aviso mostra "Configurações de multas e penalidades não preenchidas. Seção 8… step 7 (Comissão e Config)" — texto hardcoded do instrumento de locação (a Seção 8 da administração é Exclusividade). **Recomendação:** mensagem genérica ou kind-aware para administração.

### 🟡 P2 — Header do LeaseSignaturesTab não é variante-aware
Diz "Revise os signatários (locador, locatário, fiador e testemunhas)" também na administração (deveria ser proprietário + imobiliária). **Recomendação:** texto condicional ao `variant`.

### 🟡 P2 (achado da IA) — Cláusula 7.1 de vigência do template de administração
A análise passiva sinalizou: "vigência de 30 meses (01/07/2026 a 31/12/2028) + prorrogação automática 'enquanto vigorar a locação' cria indefinição". **Recomendação:** refinar a redação (prazo determinado × prorrogação atrelada) no `administracao_locacao_v1.hbs`.

### ⛔ Infra (não é o PR) — Token ClickSign do staging inválido
Envio real bloqueado por "Access Token inválido" (gotcha recorrente: staging usa token de prod). E5 (webhook close → `DealAttachment category="contrato_administracao_assinado"`) não pôde ser exercido — código deployado, mas precisa de token válido. Fix: re-adicionar `CLICKSIGN_API_TOKEN` no projeto staging (o usuário roda; não digito tokens).

## Não exercido ao vivo (coberto por unit tests + deploy)
- Q1 (form UX) / guarda de finalize ao vivo — coberto por 6 unit tests verdes + rota deployada (200); não drivado para não mutar deals de teste.
- Q2.3 quickChecksLocacao ao vivo (CPF inválido + caução 4 → comments) — coberto por 6 unit tests; passiva locação-aware confirmada no contrato de adm.
- Q3.3 banner orquestrador (stage Assinado/Cobrança) — não alcançado (deal em "Em contrato").

## Evidência
GIF da jornada: `qa-locacao-adm-contract-2026-07-08.gif` (37 frames). Screenshots por caso na sessão.
