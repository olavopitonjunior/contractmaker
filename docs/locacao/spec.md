# Spec de Arquitetura — Módulo de Locação (Contractmaker / imobpro.ai)

**Versão:** 1.0 · **Data:** 2026-05-27 · **Autor:** arquitetura sênior (Claude) com Olavo Piton
**Status:** spec de arquitetura/infra — pronta para revisão técnica e início da Fase 1
**Input de produto:** `contractmaker-locacao-prd.md` (PRD de Locação, discovery v1)
**Contraparte de design:** [`docs/redesign-locacao-spec.md`](../redesign-locacao-spec.md) (PR #48) é o **source-of-truth de UI/UX** (workspace, telas, mapa de reuso do DS). Este documento é a contraparte de **arquitetura/infra** (schema, endpoints, recorrência, escala). As duas frentes são complementares e as branches serão unidas.

> Convenção: código em inglês, UI em PT-BR. Tudo aqui é **aditivo** — nada altera shapes de venda existentes (regra do `CLAUDE.md`: `DadosContrato` e helpers Handlebars são aditivos).

---

## 1. Objetivo & princípios

Estender a esteira **transacional** de venda para o ciclo **recorrente** de administração de aluguéis (residencial, comercial, temporada, BTR), competindo com Superlógica/Kenlo/Imobzi/QuintoAndar, em escala multitenant (600–2000 imobiliárias) reaproveitando ao máximo a base atual.

**Decisões travadas (27/05/2026):** (1) spec cobre **todas as fases** (1 detalhada, 2-3 arquitetadas como ganchos); (2) recorrência mensal via **scheduler interno (cron)** materializando cobranças sobre o `CommissionCharge`/Asaas existente; (3) assume a **fundação multitenant em curso** (subdomínio + subconta Asaas filha por org) como pré-requisito.

**Princípios:**
1. **Reuse-first, aditivo.** Locação entra por novos `schemaType`, novos templates, novas tools, novas entidades — sem tocar venda.
2. **Org-scoped por design.** Toda entidade nova carrega `orgId` direto (corrige a dor do `Deal`, que escopa via `pipeline.orgId`) + índice composto `(orgId, …)`. 1 subconta Asaas filha por imobiliária.
3. **Recorrência = motor próprio.** O ciclo de vida do aluguel (mensal, reajuste, rescisão proporcional) vive em entidades novas; Asaas é só liquidação/split/repasse.
4. **Dois sistemas de IA distintos** (ver §11): **Newton** (externo, WhatsApp, autônomo) ≠ **chat in-app** (editor de contrato).
5. **AI-first / operar por exceção** (alinhado ao design): fluxo padrão automático; gestor decide exceções em 1 clique.

---

## 2. Grounding (estado real verificado do código)

| Subsistema | Onde vive | Fato relevante p/ locação |
|---|---|---|
| Multitenant | `Organization{subdomain,customDomain,activeAsaasAccountId}`; resolução por host → `x-org-subdomain` no middleware | Fundação iniciada (Fase 1a/1b multitenant). `Deal` **não** tem `orgId` — escopo via `pipeline.orgId` |
| RBAC | `apps/web/src/lib/security/rbac/{permissions,roles,guard,check,platform}.ts`; `OrgMembership.role` + `CustomRole` + `scopeRestrictions` | Estender papéis + `PERMISSION.*` |
| Pipeline/Kanban | `Pipeline` + `PipelineStage{position @@unique}`; `Deal.stageId` | Auto-transições por código (`*-action.ts`) com guard `linearOrder.includes(...)` |
| Deal / Form / DadosContrato | `Deal.dataJson` + `SalesForm.schemaType="compra_venda_v1"` + Zod `dadosContratoSchema` em `lib/forms/validation.ts` | `schemaType` é o discriminador. `imoveis[]` é **inline** — não é entidade primária |
| Contrato | `Contract{templateId?,kind:"contract\|addendum\|distrato",googleDocId,status}` | `ContractTemplate{schemaType,modalidade,category,handlebarsSource,engine}` |
| Assinatura | `Envelope` XOR `contractId\|attachmentId`; `EnvelopeSigner.sourceKind`; `lib/clicksign/{executor,mapping,roles}.ts` | Reusável direto; faltam roles locador/locatário/fiador/garantidora |
| Banking (Asaas) | `lib/asaas/*` (30 arq.) + `/api/financeiro/*` (43 rotas) | `CommissionCharge.kind` **já inclui `"aluguel"`**. Split (asaas_wallet+pix_external), `AsaasTransfer.scheduledDate`, `BankReconciliation`, `DualApproval`, `/pay/[token]`, `OrgFinancialSettings.{finePercent,interestPercentMonth}`. **Sem recorrência** — só `installmentCount` |
| Agente IA | `lib/ai/{agent,tools,tool-handlers,google-tool-handlers,prompts,expert-context}.ts` + orchestrator LangGraph (`orchestrator/graph.ts`, `specialists/*`, `sentinel/policy-engine.ts`) | `AGENT_TOOLS: Anthropic.Tool[]` → add tool = entrada no array + handler + (se write) política sentinel |
| Newton | `lib/auth/api-token.ts`, `NewtonRequestsTab.tsx`, crons `api/cron/newton-requests`; `NewtonRequest{ask,targetType,status,events[]}` | Agente WhatsApp externo. `ask` freeform; status `open\|chasing\|awaiting_reply\|fulfilled\|cancelled`. **Sem** rota `/newton` org-wide |
| Certidões | `lib/certidoes/*` (planner/executor/endpoints/outcome-classifier) | Jobs reusáveis p/ certidões de locação (inquilino/fiador/imóvel) |
| RAG / Templates | Voyage `law-2` + `KnowledgeItem` pgvector; `scripts/sync-templates.ts` | Cláusulas como `KnowledgeItem category="clause"`; `.hbs` exigem `sync-templates --apply` em prod |
| Crons | root `vercel.json` `crons[]`, padrão `/api/cron/...` (requer Vercel Pro) | Adicionar crons de recorrência/régua/reajuste/repasse |

---

## 3. Reusa / Estende / Novo

- **Reusa integral:** NextAuth+2FA+SessionElevation+TrustedDevice; ClickSign (`Envelope`); Asaas (charge/split/transfer/reconciliation/dual-approval/public-link/budget); Infosimples (jobs); Google Docs; Handlebars engine; RAG/embeddings; AIUsage/budget; AuditLog.
- **Estende:** `Deal` (kind+atributos), `Contract` (templates locação), `DadosContrato` (schemaTypes), `EnvelopeSigner.sourceKind`, `CommissionCharge.kind="aluguel"` (já existe), RBAC, `Pipeline` (kind+stages), régua de cobrança, `NewtonRequest` (kinds tipados).
- **Novo:** `Property` (entidade primária c/ ciclo de vida), `LeaseContract`, `RentCharge`, `CreditAnalysis` + decision engine, `Guarantee`, `Inspection`, portais owner/tenant, clients birô/Open Finance/garantidoras, gerador DIMOB, conciliação multi-banco, **scheduler de recorrência**, inbox org-wide `/newton`.

---

## 4. Modelo de domínio novo (Prisma — esboços aditivos)

Org-scoped, `cuid()`, índices `(orgId, …)`. Campos ilustrativos (refinar na migration; migrations via SQL idempotente — **sem `migrate dev` em prod**).

- **`Property`** (imóvel primário): `orgId, ownerId, kind(apartamento|casa|comercial_sala|loja|galpao|terreno|temporada), status(disponivel|anunciado|em_negociacao|locado|manutencao|fora_catalogo), endereço estruturado, matricula, cartorio, inscricao_iptu, area, atributos Json, fotos[], descricaoIa, valorAluguelSugerido, captacaoEnvelopeId?`. Histórico via `LeaseContract[]`. OCR de matrícula reusa `lib/ai/ocr.ts` + Infosimples. O **status do imóvel é ortogonal ao funil** (não vira coluna de Kanban).
- **`PropertyOwner`** / **`Tenant`** (cadastros unificados PF/PJ, `(orgId, cpfCnpj)` @unique): dados bancários repasse, canal preferido, flags. Reaproveitam shape de `parteSchema`. `Tenant` pode reusar ficha entre locações.
- **`LeaseContract`** (contrato de locação — distinto do `Contract`/Google Doc, que é o instrumento): `orgId, propertyId, tenantId, contractId(FK instrumento), status(rascunho|assinatura|ativo|renovacao|rescisao|encerrado), valorAluguel, valorEncargos(iptu/condominio), diaVencimento, indiceReajuste(IGPM|IPCA|outro), vigenciaInicio, vigenciaFim, taxaAdminPercent, garantiaId?, repasseDia, repasseSplitJson`. 1:1 com o instrumento assinado.
- **`RentCharge`** (cobrança mensal — materializada pelo cron): `orgId, leaseContractId, competencia(YYYY-MM), dueDate, valorBase, encargos, multa, juros, status, commissionChargeId?(FK Asaas), repasseTransferId?(AsaasTransfer)`. **`@@unique([leaseContractId, competencia])`** (idempotência). Indexar por `(orgId, competencia)` — escala em §13.
- **`Guarantee`**: `orgId, leaseContractId, tipo(fiador|caucao|seguro_fianca|garantia_digital|propria), provider(credpago|garantti|creditas|porto|…), status, coberturaMeses, custoJson, externalRef, fiadorPartyJson?`.
- **`CreditAnalysis`**: `orgId, tenantId, leaseDealId, status(pendente|aprovado|aprovado_com_garantia|analise_manual|recusado), scoreBureau, scoreInterno?, decisionJson, shapJson?, openFinanceConsentId?, biometriaJson?`. Versionado por tentativa.
- **`Inspection`** (vistoria): `orgId, propertyId, leaseContractId?, tipo(entrada|saida|contra), tipoImovel, checklistJson, ambientes[](fotos,audio,descricaoIa,estado), comparacaoJson?, laudoPdfUrl, qrToken, envelopeId?(ClickSign), executorId`.
- **Fase 2/3:** `OpenFinanceConsent`, `WhatsAppConversation`/`WhatsAppMessage`, `DimobExport`, `RentReceipt`/`OwnerStatement`.

### 4.1 Discriminadores & DadosContrato
Novos `schemaType`: `locacao_residencial_v1`, `locacao_comercial_v1`, `locacao_temporada_v1`, `locacao_btr_v1`. Novos Zod schemas em `lib/forms/validation-locacao.ts` (espelhando `validation.ts`): `locador[]`, `locatario[]`, `imovel`(ref `Property`), `aluguel{valor,encargos,reajuste,vigencia,diaVencimento}`, `garantia{tipo,…}`, `vistoria_ref`. **Aditivo** — não toca `dadosContratoSchema` de venda.

### 4.2 Pipeline & Deal
`Deal.kind String @default("venda")` + `Pipeline.kind` + **pipeline de locação separado por org** (workspace dedicado, alinhado ao design — não estende o pipeline de venda). Auto-promote reusa o padrão `*-action.ts` com guard de ordem linear.

### 4.3 Stages de locação (dois planos)
- **(a) Esteira** = Kanban pré-contrato, 8 stages: `Lead → Visita agendada → Proposta → Análise de Crédito → Aprovação → Em Assinatura → Vistoria de entrada → Chaves entregues`. Gatilhos: proposta aceita, crédito aprovado, envelope ClickSign ativado/close, laudo assinado.
- **(b) Contratos ativos** = lifecycle pós-assinatura em `LeaseContract.status` (`ativo|renovacao|rescisao|encerrado`), **fora** do Kanban.

SLA por etapa reusa o padrão de marcos do `Deal`.

---

## 5. Multitenant & RBAC em escala
- Subconta Asaas filha por imobiliária (`AsaasAccount` N-por-org, `parentAccountId`, markup global). Onboarding KYC reusa `lib/asaas/kyc.ts`.
- Novos papéis e `PERMISSION.*`: `LEASE_*`, `PROPERTY_*`, `RENT_*`, `INSPECTION_*`, `CREDIT_ANALYSIS_*`, `OWNER_PORTAL_*`. Papéis: `gestor_locacao`, `gestor_financeiro`, `vistoriador`, `proprietario`, `inquilino`. Aprovação multinível de crédito = alçada por role + `DualApproval` (kind novo `CREDIT_APPROVAL`) + SessionElevation acima de teto.
- Portais owner/tenant = rotas autenticadas com escopo restrito (novo guard `requirePortalScope`).

---

## 6. Núcleo financeiro (recorrência interna + Asaas)
- **6.1 Scheduler de recorrência.** Cron novo `/api/cron/rent/generate` (mensal, ~`0 0 1 * *`, sharding por org). Para cada `LeaseContract` ativo: cria `RentCharge` da competência → cria `CommissionCharge{kind:"aluguel"}` via `charges-action.ts` → cobrança Asaas (PIX dinâmico default + boleto). Idempotência por `(leaseContractId, competencia)`.
- **6.2 Régua de cobrança.** Estende régua/notificações existentes (`notify*` em `OrgFinancialSettings`, cron `charges/due-soon`). Janelas configuráveis: D-3 lembrete · D+1 · D+5 formal · D+30 extrajudicial · D+60 acionamento de garantia. **Cada passo dispara um `NewtonRequest` tipado** (§11a). Multa 2% + juros 1%/mês via `finePercent`/`interestPercentMonth` (cap legal). Backing do `CollectionRulerEditor` do design.
- **6.3 Repasse ao proprietário.** `AsaasTransfer` (com `scheduledDate`) disparado no `RentCharge` pago (webhook) — deduz taxa admin, IRRF, encargos. `DualApproval` acima de `dualApprovalCapCents`. Split nativo (asaas_wallet) quando o proprietário tem wallet Asaas; `pix_external` (transfer pós-pagamento) caso contrário — ambos já em `splitDispatcher.ts`. Backing do `RepasseCard`.
- **6.4 Conciliação.** `BankReconciliation` auto-match por `externalReference` (já existe) p/ Asaas; **multi-banco via Open Finance** (Fase 2) reusa consentimento OF da análise de crédito.
- **6.5 DIMOB & informe.** Gerador anual TXT IN RFB 1.115/2010 + cron anual. Informe de rendimentos por proprietário. Botão "1 clique" no design.

---

## 7. Contrato, templates e assinatura
- Templates novos: `templates/locacao_{residencial,comercial,temporada}_v2.hbs` com cláusulas componíveis (garantia/índice/prazo/multa). Cláusulas no banco (`KnowledgeItem category="clause"`, novos `groupCode`). **Sync obrigatório** `sync-templates.ts --apply` pós-deploy (deploy do código ANTES do sync para não quebrar com "Missing helper").
- Geração reusa `contract-generation.ts` → `renderContratoHTML` → `uploadHtmlAsGoogleDoc` → `googleApplyStylePreset`. Novos `enrichContractData` bridges p/ campos de locação.
- ClickSign: estender `EnvelopeSigner.sourceKind` + `lib/clicksign/roles.ts` com `locador|locatario|fiador|garantidora`. Aditivos (troca de fiador/garantia/prazo) = `Contract.kind="addendum"`. Laudo de vistoria = `Envelope source="attachment"`.
- **Timeline compartilhada:** `RentalProgressTimeline` do design exige **parametrizar os nós** de `components/pipeline/DealProgressTimeline.tsx` (hoje hardcoded p/ venda) em `NodeDef[]`/preset (venda + locação) — refactor compartilhado, não uma flag `variant`.

---

## 8. Vistoria mobile (PWA)
PWA offline-first (Next/Tailwind; sem app nativo até Fase 3). Captura foto/vídeo/áudio; descrição automática e comparação entrada↔saída via agente Anthropic multimodal (tool `describe_inspection_media`). Laudo PDF (reusa `lib/render/exporter.ts` Puppeteer serverless) com QR de autenticidade → assinatura ClickSign. **Fase 1:** descrição básica. **Fase 2:** comparação automatizada.

---

## 9. Análise de crédito (faseada)
- **Fase 1:** 1 birô (Serasa via SOAWebservices/TecnoSpeed ou Infosimples) + **decision engine interno** (regras em código, configurável por org: renda×aluguel, restritivos, idade). Sem Open Finance, sem ML. `CreditAnalysis` persiste a decisão. Backing do `CreditDecisionCard` (semáforo + bullets).
- **Fase 2:** Open Finance (Pluggy/Belvo/Klavi, ITP regulado, consentimento CMN 4.949/21) + biometria/KYC (Unico/Caf/Idwall) + antifraude (device fingerprint/velocity) + **modelo proprietário** (LightGBM + OptBinning/WoE, SHAP em produção) servido por **serviço Python externo** (Lambda/serverless) via API — não há infra ML hoje. Decision engine → DMN (GoRules/Camunda) se a complexidade justificar. **Direito à explicação LGPD art.20** via SHAP em linguagem natural (preenche os bullets do `CreditDecisionCard`).
- **Fase 3:** rede de imobiliárias (histórico de inquilino com consentimento) realimenta o modelo.
- **Cardápio dinâmico de garantias** (Fase 2): apresenta só as adequadas ao score, custo total simulado (`GuaranteeMenu`).

---

## 10. Produtos financeiros & garantias
- **Fase 1:** ≥2 parceiros de garantia (CredPago + Porto) via API/handoff; seguro incêndio comissionado. `Guarantee` + clients.
- **Fase 2:** + Garantti/Creditas; antecipação de aluguel ao proprietário via FIDC parceiro (CashGO/Locapay); seguro residencial white-label.
- **Fase 3:** garantia locatícia **própria** (pricing por score interno, reasegurador), antecipação via FIDC próprio, home equity. Conformidade SUSEP via parceiro reasegurador.

---

## 11. Portais & os dois sistemas de IA

> Distinção crítica: a plataforma tem **dois** agentes. Não confundir.

- **Portais.** Proprietário (`/portal/owner`) e inquilino (`/portal/tenant`) — PWA, rotas autenticadas escopadas (novo guard `requirePortalScope`): carteira/extrato/repasse/antecipação/informe IR (proprietário); contrato/boletos/PIX/recibos/chamados (inquilino). Reusa shell público (`/f/[token]`, `/pay/[token]`) + branding tenant.
- **11a. Newton — WhatsApp-first (externo, autônomo).** Opera o canal WhatsApp com inquilino/proprietário (qualificação, cobrança, pedir docs) via API token. Estende o existente (`api-token.ts`, `NewtonRequestsTab.tsx`, crons `newton-requests`): **kinds tipados** de locação no `NewtonRequest` (`cobrar_aluguel`, `pedir_doc_renda`, `consentir_open_finance`(F2), `agendar_visita`, `agendar_vistoria`, `confirmar_renovacao`) reusando `status`/`events[]`; **inbox org-wide `/newton`** (rota nova). Guardrails p/ inquilino/proprietário: prompt restrito, sem tools de edição, budget de tokens por sessão (`budget.ts`).
- **11b. Chat in-app — editor de contrato (inline).** `ChatPanel`+`agent.ts`. Recebe as **novas tools** (em `AGENT_TOOLS[]` + `tool-handlers.ts`; writes registram política em `sentinel/policy-engine.ts`): `query_credit` (subtools birô/OF), `simulate_guarantee`, `calculate_readjustment` (IGPM/IPCA), `simulate_termination` (multa proporcional art.4 Lei 8.245), `generate_dimob`, `trigger_dunning`, `create_addendum`, `generate_income_report`, `describe_inspection_media`, `suggest_rent_price`. Reusa expert-context, modos Fast/Plan, AIUsage.

---

## 12. Compliance & reporting
LGPD (consentimento auditável OF/biometria/decisão automatizada; direito de acesso/explicação/revisão humana; base legal por finalidade); Lei 8.245/91 + 12.112/09 (templates/cláusulas/cálculos/prazos); DIMOB; informe de rendimentos; AuditLog imutável (novas actions `LEASE_*`, `RENT_*`, `INSPECTION_*`, `CREDIT_*`, `OWNER_*` em `lib/audit/actions.ts`); BI executivo/operacional (painel das métricas do §4 do PRD).

---

## 13. NFRs & escala (600–2000 orgs · 100k contratos · 50k pgtos/dia pico)
- **Recorrência em escala:** cron de geração com sharding por org/lote + fila (idempotente). `RentCharge` indexado/particionado por competência; arquivamento de competências antigas.
- Índices `(orgId, status)` nas entidades quentes; Kanban ≤3s com 200 contratos (paginação server-side).
- Análise de crédito ≤5min (birô ≤2s); geração de contrato ≤30s Fast / ≤2min Plan; WhatsApp ida-volta ≤5s.
- Rotação trimestral de chaves de parceiros (AES-256-GCM como Asaas). Failover ClickSign (D4Sign/ZapSign) e PSP secundário documentados como risco.
- Observabilidade: estende AIUsage + audit + dashboards de produto/modelo/financeiro; alertas (inadimplência, PSI fora de banda, parceiro com falha persistente).

---

## 14. Mapa Jornada → Superfície → Endpoint (contrato design ↔ infra)

Rotas concretas alinhadas ao PR #48. `agente`: Newton (N) ou chat in-app (C).

| Jornada (PRD §6) | Superfície / rota (design) | Entidade(s) | Endpoint(s) `/api/...` | Agente | Stage / evento |
|---|---|---|---|---|---|
| Captação do imóvel | `/locacao/imoveis`, `/locacao/imoveis/[id]` | `Property`, `Envelope`(captação) | `POST/GET/PATCH /api/locacao/properties[...]`; OCR matrícula | C (`suggest_rent_price`, descrição) | `Property.status` |
| Esteira lead→chaves | `/locacao/esteira` (Kanban) | `Deal(kind=locacao)`, `PipelineStage` | `/api/pipeline/...` + auto-transition actions | N (qualificar/agendar) | Esteira 0–7 |
| Análise de crédito | `CreditDecisionCard` | `CreditAnalysis`, `Guarantee` | `POST /api/locacao/credit-analysis`; `GET .../[id]` | C (`query_credit`, `simulate_guarantee`) | `Análise → Aprovação`; `CREDIT_*` |
| Geração de contrato | editor Google Docs + `ChatPanel` + `SendEnvelopeDialog` | `Contract`, `Envelope`, `EnvelopeSigner` | `contract-generation`; `POST /api/contracts/[id]/envelopes` | C (montar/editar) | `Em Assinatura`; `ENVELOPE_*` |
| Vistoria | `/vistoria/[os]` (PWA) | `Inspection`, `Envelope(attachment)` | `POST/PATCH /api/locacao/inspections[...]` | C (`describe_inspection_media`) | `Vistoria → Chaves`; `INSPECTION_*` |
| Operação mensal | `/locacao/financeiro` (`RentLedgerTable`,`RepasseCard`,`CollectionRulerEditor`) | `RentCharge`, `CommissionCharge`, `AsaasTransfer`, `BankReconciliation` | cron `rent/generate`; `/api/financeiro/*` (lente) | N (cobrar) | `RENT_*`, `TRANSFER_*` |
| Portal proprietário | `/portal/owner` (`OwnerStatementCard`) | `OwnerStatement`, `RentCharge`, antecipação(F2) | `GET /api/portal/owner/*` | N (dúvidas) | `OWNER_*` |
| Portal inquilino | `/portal/tenant` | `LeaseContract`, `RentCharge` | `GET /api/portal/tenant/*`; `/pay/[token]` | N guardrailed | — |
| Renovação/Rescisão | `/locacao/contratos` | `LeaseContract`, `Contract(addendum)` | `POST /api/locacao/leases/[id]/{renew,terminate}` | C (`calculate_readjustment`,`simulate_termination`,`create_addendum`) | `renovacao\|rescisao` |
| Inbox Newton | `/newton` (rota nova) | `NewtonRequest` | `GET /api/newton/requests` (org-wide, agregado) | N | `NEWTON_*` |
| Compliance/BI | dashboards | `DimobExport`, `AuditLog`, métricas | `GET /api/locacao/reports/*`; `generate_dimob` | C | — |

### 14.1 Contrato de campos por componente (design ↔ entidade) — HANDOFF AO DESIGNER

> Campos REAIS implementados na Fase 1 (`apps/web/prisma/schema.prisma` + `lib/forms/validation-locacao.ts`). Cada componente do `docs/redesign-locacao-spec.md` deve bindar nestes nomes. **Enums de status são fixos** (UI mapeia 1:1 em badge/cor).

| Componente (design) | Entidade | Campos que a tela consome | Enum de status (badge) |
|---|---|---|---|
| `PropertyCard` / `/locacao/imoveis` | `Property` | `kind`, `rua`/`numero`/`bairro`/`cidade`/`uf`/`cep`, `fotos[]`, `descricaoIa`, `valorAluguelSugerido`, `area`, `matricula` | `status`: `disponivel\|anunciado\|em_negociacao\|locado\|manutencao\|fora_catalogo` |
| `RentalKanbanCard` / `/locacao/esteira` | `Deal(kind=locacao)` + `Property` + `Tenant` | título, `Property` endereço, `Tenant.nome`, `aluguel.valor` (dataJson) | stage da Esteira (8 stages, §4.3) |
| `CreditDecisionCard` | `CreditAnalysis` | `scoreBureau`, `scoreInterno`, `decisionJson`, `shapJson` (bullets explicáveis, F2) | `status`: `pendente\|aprovado\|aprovado_com_garantia\|analise_manual\|recusado` |
| `GuaranteeMenu` | `Guarantee` | `tipo`, `provider`, `coberturaMeses`, `custoJson` | `status`: `pendente\|ativa\|acionada\|encerrada\|recusada` |
| `RentLedgerTable` | `RentCharge` | `competencia` (YYYY-MM), `dueDate`, `valorBase`, `encargos`, `multa`, `juros`, `paidAt` | `status`: `pendente\|emitida\|paga\|atrasada\|cancelada\|repassada` |
| `RepasseCard` | `LeaseContract` + `RentCharge` | `valorAluguel`, `taxaAdminPercent`, `valorEncargos`, `repasseDia`; bruto (`valorBase`) → deduções → líquido | `RentCharge.status` (acima); transfer via `repasseTransferId` |
| `CollectionRulerEditor` | `LeaseContract.config` + `NewtonRequest` | `config.multa_atraso_percent` (2), `config.juros_mensais_atraso` (1); cada passo dispara `NewtonRequest` tipado | — |
| `OwnerStatementCard` / `/portal/owner` | `PropertyOwner` + `RentCharge` | `PropertyOwner.nome`, agregado de `RentCharge` por competência (líquido), `canalPreferido` | — |
| `InspectionRoomChecklist` / `/vistoria/[os]` | `Inspection` | `tipo` (entrada/saida/contra), `ambientesJson[]` (`{ambiente,fotos[],audio,descricaoIa,estado}`), `checklistJson`, `laudoPdfUrl`, `qrToken` | `status`: `rascunho\|em_campo\|laudo_gerado\|assinatura\|concluida` |
| `RentalProgressTimeline` | — (componente) | nós parametrizados `NodeDef[]` — **refactor compartilhado** de `DealProgressTimeline.tsx` (§7) | — |

Notas de binding: valores monetários são `Float` (reais, não centavos) — formatar com `Intl`/helper `moeda`. `LeaseContract.indiceReajuste`: `IGPM\|IPCA\|outro`. `LeaseContract.status`: `rascunho\|assinatura\|ativo\|renovacao\|rescisao\|encerrado` (lifecycle pós-contrato, fora do Kanban).

---

## 15. Faseamento, dependências e triggers
- **Fase 1 (MVP / paridade):** cadastro imóveis+partes, pipeline/esteira, templates residencial+comercial, geração de contrato (chat in-app), ClickSign, vistoria PWA básica, repasse Asaas Split, régua WhatsApp/e-mail (Newton), conciliação Asaas, DIMOB, portal do proprietário, reajuste IGPM/IPCA, renovação/rescisão; crédito com 1 birô + regras simples; garantia ≥2 parceiros.
- **Fase 2 (diferenciação):** Open Finance, biometria/KYC, antifraude, modelo proprietário + SHAP, decision engine configurável, cardápio de garantias, portal do inquilino, WhatsApp end-to-end, vistoria comparativa, conciliação multi-banco; +Garantti/Creditas, antecipação FIDC parceiro, seguro residencial.
- **Fase 3 (embedded finance próprio):** garantia própria, antecipação FIDC próprio, home equity, BTR/Housi, rede de imobiliárias, i18n LatAm.
- **Dependências técnicas:** modelo ML depende de massa de `LeaseContract` acumulada; portal do inquilino pode iniciar antes do ML. **Triggers:** Fase 2 = 100 imobiliárias / R$100M VGL; Fase 3 = KS≥35 & AUC≥0.80.

---

## 16. Decisões em aberto & riscos
Decision engine interno→DMN; score externo→modelo próprio; exposição do agente a inquilino/proprietário (guardrails); particionamento de `RentCharge`; provedor Open Finance; provedor de garantia inicial. Riscos do PRD §14 com mitigação técnica (failover ClickSign/PSP, arquitetura modular OF, política de subscrição conservadora em garantia própria).

---

## 17. Verificação (executabilidade do spec)
1. **Cobertura PRD:** cada capability das §8.1–8.8 do PRD aparece aqui com decisão reusa/estende/novo + fase.
2. **Grounding:** cada "reusa X" cita arquivo/símbolo real (§2).
3. **Mapa §14** revisado lado-a-lado com o protótipo (PR #48) — toda tela tem backend e vice-versa.
4. **Spike Fase 1** (branch): migration aditiva `Property`+`LeaseContract`+`RentCharge` + 1 template sincronizado + 1 `RentCharge` gerado pelo scheduler criando cobrança Asaas em sandbox/QA, provando recorrência interna ↔ banking end-to-end. Validar via `/chrome` + screenshot.
5. `CLAUDE.md` ≤ 40k (hook `check-claude-md-size.mjs`).
