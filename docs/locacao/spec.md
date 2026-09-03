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
| Assinatura | `Envelope` XOR `contractId\|attachmentId`; `EnvelopeSigner.sourceKind`; `lib/clicksign/{executor,mapping,roles}.ts` | Reusável direto; roles nativos `lessor`/`lessee`/`surety`/`guarantor_spouse` em `roles.ts` (02/09/2026) |
| Banking (Asaas) | `lib/asaas/*` (30 arq.) + `/api/financeiro/*` (43 rotas) | `CommissionCharge.kind` **já inclui `"aluguel"`**. Split (asaas_wallet+pix_external), `AsaasTransfer.scheduledDate`, `BankReconciliation`, `DualApproval`, `/pay/[token]`, `OrgFinancialSettings.{finePercent,interestPercentMonth}`. **Sem recorrência** — só `installmentCount` |
| Agente IA | `lib/ai/{agent,tools,tool-handlers,google-tool-handlers,prompts,expert-context}.ts` + orchestrator LangGraph (`orchestrator/graph.ts`, `specialists/*`, `sentinel/policy-engine.ts`) | `AGENT_TOOLS: Anthropic.Tool[]` → add tool = entrada no array + handler + (se write) política sentinel |
| Newton | `lib/auth/api-token.ts`, `NewtonRequestsTab.tsx`, crons `api/cron/newton-requests`; `NewtonRequest{ask,targetType,status,events[]}` | Agente WhatsApp externo. `ask` freeform; status `open\|chasing\|awaiting_reply\|fulfilled\|cancelled`. **Sem** rota `/newton` org-wide |
| Certidões | `lib/certidoes/*` (planner/executor/endpoints/outcome-classifier) | Feito em 02/09/2026: `planCertidoesForDeal(..., { esteira: "locacao" })` lê `locatarios`/`garantia.fiador` (+ cônjuge)/`locadores`/`imovel`; alvos `locatario`/`fiador`/`conjuge_fiador`/`locador`; feature `locacao.certidoes` (default OFF); aba Certidões em `/locacao/deals/[id]` (03/09/2026, `LocacaoDealDetail` → `CertidoesTab esteira="locacao"`) |
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
- **`Guarantee`**: `orgId, leaseContractId, tipo(fiador|caucao|seguro_fianca|garantia_onerosa|propria), provider(credpago|garantti|creditas|porto|…), status, coberturaMeses, custoJson, externalRef, fiadorPartyJson?`.
- **`CreditAnalysis`**: `orgId, tenantId, leaseDealId, status(pendente|aprovado|aprovado_com_garantia|analise_manual|recusado), scoreBureau, scoreInterno?, decisionJson, shapJson?, openFinanceConsentId?, biometriaJson?`. Versionado por tentativa.
- **`Inspection`** (vistoria): `orgId, propertyId, leaseContractId?, tipo(entrada|saida|contra), tipoImovel, checklistJson, ambientes[](fotos,audio,descricaoIa,estado), comparacaoJson?, laudoPdfUrl, qrToken, envelopeId?(ClickSign), executorId`.
- **Fase 2/3:** `OpenFinanceConsent`, `WhatsAppConversation`/`WhatsAppMessage`, `DimobExport`, `RentReceipt`/`OwnerStatement`.

**Entidades Superlógica-parity (28/05) — agregadas à Fase 1:**
- **`PropertyOwnership`** (A1) — N:N owner↔property com `percentual` e `tipo` (3 valores).
- **`LeaseTenant`** (A2) — N:N tenant↔lease com `tipo` (`titular | solidario`).
- **`LeaseAngariador`** (A11) — corretor captador com comissão recorrente sobre aluguel: `{partyId, formaComissao(percentual|valor_fixo), percentual?, valorFixo?, mesesComissao Int?}` (null = "todo o contrato").
- **`Expense`** (A17 + D2) — despesa operacional first-class: `{type(iptu|condominio|seguro_incendio|seguro_fianca|juros|multa|honorarios|atualizacao_monetaria|custas|moratorios|taxa_locacao|outro), valor, dueDate, parcelaN, parcelaTotal, debitoDe(locatario|proprietario), creditoPara(proprietario|imobiliaria|fornecedor), rentChargeId?, fornecedorId?, status, paidAt}`.
- **`ChecklistTemplate` + `Checklist`** — modelos reusáveis ("Entrada", "Renovação", "Rescisão") + instância por contrato com `itensJson` (titulo, status, responsavel, concluidoAt). Status: `pendente | em_andamento | aguardando_aprovacao | concluido`.
- **`DebtAgreement`** — acordo de dívida (parcelamento de inadimplência): `{valorTotal, componentesJson(aluguel,multa,juros,honorarios,custas,atualizacao), parcelas, primeiraDataDue, status}`. Parcelas viram `RentCharge` com `kind="acordo"`.
- **`InsurancePolicy`** — apólice (seguro_incendio | seguro_fianca | conteudo | rd): `{seguradora, apoliceNumero, vigenciaInicio/Fim, premioMensal, responsavelPagamento(imobiliaria|locatario|proprietario, A14), coberturaJson, status, pdfUrl}`. Index `(orgId, vigenciaFim, status)` p/ dashboard "Seguros vencidos".
- **`Maintenance`** — solicitação de reparo: `{tipo, descricao, fornecedorId?, status(solicitada|em_andamento|concluida|cancelada), custoEstimado, custoFinal, debitoDe, expenseId?}`.

**Alterações em entidades da Fase 1 (delta Superlógica):**
- `LeaseContract` ganha campos fiscais/operacionais (§4.4) + relações `tenants[]`, `angariadores[]`, `expenses[]`, `checklists[]`, `debtAgreements[]`, `insurancePolicies[]`, `maintenances[]`; remove `tenantId` 1:1.
- `Property` ganha `tipoDimob`, ampliação de `kind`; remove `ownerId` 1:1 (vira `ownerships[]`).
- `RentCharge` ganha `kind` (`aluguel | acordo | extra | encargo`) + `debtAgreementId?` + status `repassada` (A18).
- `Guarantee` amplia `tipo` (7) + `caucaoSubtipo?`.
- `AsaasTransfer` ganha `nfseRequerida/nfseEmitida/nfseNumero/nfseUrl` (A16).

### 4.1 Discriminadores & DadosContrato
Novos `schemaType`: `locacao_residencial_v1`, `locacao_comercial_v1`, `locacao_temporada_v1`, `locacao_btr_v1`. Novos Zod schemas em `lib/forms/validation-locacao.ts` (espelhando `validation.ts`): `locador[]`, `locatario[]`, `imovel`(ref `Property`), `aluguel{valor,encargos,reajuste,vigencia,diaVencimento}`, `garantia{tipo,…}`, `vistoria_ref`. **Aditivo** — não toca `dadosContratoSchema` de venda.

Aditivos 2026-08 (form público decide administração/despesas e comissão): `aluguel.adm_imobiliaria` (bool; `false` explícito faz o contrato de locação NÃO nomear administradora), `aluguel.encargos_repasse` (`paga_e_retem|repasse_integral` → cláusula 9.1.2), `aluguel.taxa_admin_percent` (exposto na etapa 4), `aluguel.contas_consumo_individualizadas` + `aluguel.contas_no_condominio[]` (`agua|luz|gas` → cláusula 9.3), `config.clausula_rescisoria` (bool default true; `false` omite a 7.2 de multa por rescisão antecipada). Etapa 7 nova "Comissão" (token principal apenas): `comissao.taxa_locacao_percent` + `comissao.angariadores[]` com lookup/anti-duplicação no registry (`/api/forms/[token]/commissioners` serve as duas esteiras) e `CadastroRecebimento` compartilhado com venda (PIX/banco write-only; magic link "Pedir dados ao corretor" via `request-completion`).

**Ordem das etapas do formulário público (2026-09-03):** `0 Documentos · 1 Locatário(s) · 2 Locador(es) · 3 Imóvel · 4 Aluguel e Reajuste · 5 Garantia e Observações · 6 Comissão`. O locatário passou à frente do locador porque quem preenche costuma estar com o candidato à locação na frente — o locador já é conhecido do cadastro.

O número da etapa é **identidade persistida**, não só posição na tela. Ele vive em `OrgFormSettings.locacaoCustomRequiredPaths[].step` e em `OrgFormSettings.participantVisibilityJson.locacao.<papel>[]`, e é referência cruzada entre `STEP_PATHS.locacao` e `DEFAULT_ROLE_STEPS` (`lib/forms/participant-visibility.ts`). Renumerar exige, no MESMO PR: as duas tabelas trocadas juntas, migration remapeando as duas colunas, e teste afirmando o par **papel→data-path** — nunca o índice, porque asserção por índice passa com as tabelas trocadas. Trocar só uma delas dá ao link público de um papel escopo de **escrita** sobre os dados do outro, em silêncio, para toda org que nunca configurou visibilidade. A coluna `locacaoStepSchemaVersion` marca o esquema de índices da linha (v1 = locador em 1; v2 = locatário em 1).

Enums ampliados após achados Superlógica live:
- **`Guarantee.tipo`** (A3, 7 valores): `caucionante | caucao | cessao_fiduciaria | fiador | seguro_fianca | titulo_capitalizacao | sem_garantia`.
- **`Guarantee.caucaoSubtipo`** (A4, quando `tipo=caucao`): `valor | veiculo | carta_fianca | imovel | outros`.
- **`Property.kind`** (A6, ~45 valores): Casa, Apartamento, Apt Duplex/Triplex, Cobertura, Garden, Loft, Studio, Kitnet, Penthouse, Flat, Sobrado, Casa em condomínio, Casa Assobradada, Casa comercial, Galpão, Sala comercial, Loja, Salão, Pavilhão, Box/Garagem, Conjunto, Andar corporativo, Edícula, Bangalô, Barracão, Chácara, Sítio, Rancho, Fazenda, Haras, Pousada, Hotel, Resort, Quiosque, Ponto, Ilha, Laje, Escritório, Consultório, Prédio, Terreno, Village, Outro.
- **`Property.tipoDimob`** (A15): `urbano | rural`.

### 4.2 Pipeline & Deal
`Deal.kind String @default("venda")` + `Pipeline.kind` + **pipeline de locação separado por org** (workspace dedicado, alinhado ao design — não estende o pipeline de venda). Auto-promote reusa o padrão `*-action.ts` com guard de ordem linear.

### 4.3 Stages de locação — 6 stages (D1, sem lead management)
- **(a) Esteira** = Kanban pré-contrato, **6 stages**: `Análise de Crédito → Aprovação → Confecção de Contrato → Em Assinatura → Vistoria de Entrada → Chaves Entregues`. Lead/Visita/Proposta ficam **fora do Kanban** (diretriz do usuário, 28/05): captação de imóvel em `/locacao/imoveis` e qualificação por WhatsApp via Newton. Gatilhos (padrão `*-action.ts`):
  - **Análise → Aprovação:** `CreditAnalysis.status="aprovado"` ou `"aprovado_com_garantia"`
  - **Aprovação → Confecção:** operador clica "Confeccionar contrato" (sem auto)
  - **Confecção → Em Assinatura:** `Envelope (source=contract)` ativado no ClickSign
  - **Em Assinatura → Vistoria:** webhook ClickSign `close`
  - **Vistoria → Chaves:** `Inspection.status="laudo_gerado"` + envelope do laudo assinado
  - **Chaves → LeaseContract:** operador clica "Entregar chaves" → cria `LeaseContract status=ativo` + 1ª `RentCharge` da competência via rent-scheduler
- **(b) Contratos ativos** = lifecycle pós-assinatura em `LeaseContract.status` (`ativo|renovacao|rescisao|encerrado`), **fora** do Kanban.

SLA por etapa reusa o padrão de marcos do `Deal`.

### 4.4 Configurações fiscais e operacionais do `LeaseContract` (achados Superlógica live A7-A13)
A inspeção do form HTML do wizard "Novo contrato" do Superlógica (28/05) expôs configurações por contrato que o spec inicial não cobria — todas críticas pra cálculo de repasse, DIMOB e UX comercial:

- **`regimeIr`** (A7) — retenção de IR sobre aluguel: `nao_retem | retem_sem_controle | retem_imobiliaria | retem_inquilino`. Afeta o cálculo do líquido repassado e o código no TXT DIMOB.
- **`repasseGarantido`** (A8) — produto premium: imobiliária paga proprietário mesmo se inquilino não pagar. `nao | alguns_meses | todo_contrato` + `repasseGarantidoMeses Int?` + `repasseGarantidoEscopo` (`boleto | aluguel | aluguel_ir | garantidos`). **Diferente de `Guarantee`** (que protege contra inadimplência); isto é garantia COMERCIAL da imobiliária.
- **`repasseTipo`** (A9) — `dias_uteis_apos | dias_corridos_apos | dia_fixo` + `repasseDia Int`.
- **`regimeCobranca`** (A10) — `mes_vencido | mes_a_vencer`. Define quando emitir o boleto: D-1 da competência ou D+30.
- **`isencaoMultaMeses Int?`** (A12) — janela inicial sem multa rescisória.
- **`enderecoCobrancaTipo`** (A13) — `imovel | locatario | outro` + `enderecoCobrancaJson?` override.
- **`emitirNfse Boolean`** (A16) — gera NFS-e por repasse (ver §7.5).
- **`finalidade`** (A5) — `residencial | nao_residencial | comercial | industria | temporada | por_encomenda | mista`.

### 4.5 Múltiplos proprietários e múltiplos locatários (achados A1, A2)
Confirmado em prod (contrato real com 4 proprietários × 25% + 2 locatários solidários):
- **`PropertyOwnership`** N:N (substitui `Property.ownerId` 1:1): `{propertyId, ownerId, percentual Float, tipo: "proprietario_principal" | "proprietario" | "beneficiario"}`. Soma de `percentual` por `propertyId` = 100 (refine Zod).
- **`LeaseTenant`** N:N (substitui `LeaseContract.tenantId` 1:1): `{leaseContractId, tenantId, tipo: "titular" | "solidario"}`. Múltiplos locatários respondem solidariamente pela dívida (Lei 8.245 art.2).
- Repasse divide proporcionalmente entre proprietários por `percentual`; cada beneficiário pode ter wallet Asaas própria (split nativo) ou `pix_external`.

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
- **6.6 Despesas operacionais (`Expense`, A17/D2).** Entidade first-class — base da contabilidade do contrato. `type` (12 valores) + parcelamento (`parcelaN/Total`) + `debitoDe/creditoPara` definem quem paga e quem recebe. Quando `rentChargeId` setado, a despesa aparece NO boleto do locatário; quando débito é do proprietário/imobiliária, deduz no repasse (§6.3). Sem essa entidade, o ledger do contrato fica incompleto (IPTU parcelado 10x, condomínio variável, taxa de locação à vista, etc.). Endpoints CRUD em `/api/locacao/expenses/...`.
- **6.7 Acordos de dívida (`DebtAgreement`).** Parcelamento de inadimplência: aluguel atrasado + multa + juros + honorários + atualização monetária + custas processuais (breakdown em `componentesJson`). Cada parcela vira `RentCharge { kind:"acordo", debtAgreementId }` — entra na cobrança Asaas normalmente. Status: `ativo | concluido | quebrado | cancelado`. Quebrado = inadimplência no próprio acordo, dispara ação extra-judicial.
- **6.8 Apólices de seguro (`InsurancePolicy`, A14).** Apólice ativa por contrato ou imóvel; tipos: `seguro_incendio`, `seguro_fianca`, `conteudo`, `rd`. Vencimento em `vigenciaFim` alimenta dashboard "Seguros vencidos / Próx. 60d". `responsavelPagamento` (`imobiliaria | locatario | proprietario`) define quem é cobrado pelo prêmio (cria `Expense` recorrente se `imobiliaria`/`locatario`; gestão direta se `proprietario`).
- **6.9 Manutenções (`Maintenance`).** Solicitação de reparo no imóvel: tipo, descrição, fornecedor, status, custo. Quando `debitoDe` setado e `status="concluida"`, cria `Expense` vinculada (`expenseId`). Lista no detalhe do imóvel e do contrato.
- **6.10 Angariador (`LeaseAngariador`, A11).** Corretor captador recebe comissão recorrente sobre aluguel: `formaComissao` (percentual ou valor fixo) × `mesesComissao` (1-12 ou todo o contrato). Cada `RentCharge` paga gera split adicional pro angariador (via `splitJson`); deduz do repasse ao proprietário. Modelado como entidade própria (não array em `comissionados[]`) porque tem ciclo de vida distinto (pode mudar/encerrar antes do contrato).

---

## 7. Contrato, templates e assinatura
- Templates novos: `templates/locacao_{residencial,comercial,temporada}_v2.hbs` com cláusulas componíveis (garantia/índice/prazo/multa). Cláusulas no banco (`KnowledgeItem category="clause"`, novos `groupCode`). **Sync obrigatório** `sync-templates.ts --apply` pós-deploy (deploy do código ANTES do sync para não quebrar com "Missing helper").
- Geração reusa `contract-generation.ts` → `renderContratoHTML` → `uploadHtmlAsGoogleDoc` → `googleApplyStylePreset`. Novos `enrichContractData` bridges p/ campos de locação.
- ClickSign: `EnvelopeSigner.sourceKind` aceita `locador|locatario|fiador` e `lib/clicksign/roles.ts` mapeia para as qualificações nativas `lessor|lessee|surety` (+ `guarantor_spouse` para o cônjuge do fiador) — feito em 02/09/2026; `garantidora` segue pendente. Aditivos (troca de fiador/garantia/prazo) = `Contract.kind="addendum"`. Laudo de vistoria assina JUNTO com o contrato no mesmo envelope: `EnvelopeDocument kind="attachment"` via `inspectionIds` em `POST /api/contracts/[id]/envelopes` (a ClickSign cobra por signatário, não por documento). Laudo avulso continua possível via `sendEnvelopeForAttachment`. Laudo feito fora do sistema entra por `POST /api/locacao/inspections/[id]/laudo/upload` (`Inspection.laudoOrigem="externo"`, status vai direto a `laudo_gerado`).
- **Timeline compartilhada:** `RentalProgressTimeline` do design exige **parametrizar os nós** de `components/pipeline/DealProgressTimeline.tsx` (hoje hardcoded p/ venda) em `NodeDef[]`/preset (venda + locação) — refactor compartilhado, não uma flag `variant`.

### 7.5 NFS-e por repasse (A16)
O Superlógica tem aba "Notas fiscais" no módulo de Repasses — cada repasse ao proprietário pode requerer NFS-e (Nota Fiscal de Serviço Eletrônica) emitida pela imobiliária, distinta do DIMOB anual. Adicionar campos a `AsaasTransfer` (ou wrapper `Repasse`):
- `nfseRequerida Boolean` (deriva de `LeaseContract.emitirNfse` no momento do repasse)
- `nfseEmitida Boolean`
- `nfseNumero String?` / `nfseUrl String?` (PDF da NF emitida pelo município)
- Endpoint `POST /api/locacao/transfers/[id]/nfse` dispara emissão (provider varia por município — São Paulo via SOAWebservices, etc.; cada município tem um provider municipal). Falha → `notification` ao gestor, repasse não é bloqueado.

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
- **11c. Newton-executor — HITL via `ActionIntent` (D3, diretriz "Newton executa ações").** Newton não só enfileira pedidos (§11a) — também **executa ações** com escopo por papel via `OrgMembership.role`/`CustomRole.scopeRestrictions`. Infra existente (`lib/api/intents.ts`, `lib/api/intent-executors/index.ts`, `auth-or-bearer.ts`) é estendida com 3 executors novos:

  | Ação | Endpoint | Executor (`lib/api/intent-executors/`) | HITL? | PERMISSION |
  |---|---|---|---|---|
  | Cobrar aluguel atrasado (régua) | `POST /api/locacao/rent-charges/[id]/remind` | `dunning.ts` | **Não** (régua auto) | `RENT_REMIND` |
  | Pedir docs (renda/RG/comprov.) | `POST /api/newton/requests {kind:"pedir_doc_renda"}` | (existe — só tipar kind) | Não | `NEWTON_REQUEST_CREATE` |
  | Agendar visita/vistoria | `POST /api/locacao/inspections` | `schedule-inspection.ts` | HITL se conflito agenda | `INSPECTION_CREATE` |
  | Lançar despesa (OCR Gemini foto IPTU) | `POST /api/locacao/expenses {ocrPhotoUrl}` | `create-expense.ts` | **HITL** (operador confirma OCR) | `EXPENSE_CREATE` |

  Escopo por papel: **Newton-as-tenant** = só `RENT_REMIND`/`NEWTON_REQUEST_CREATE` (responde inquilino); **Newton-as-owner** = leitura de extratos + `RENT_REMIND` indireto; **Newton-as-operator** = tudo acima com HITL nos writes. Token Bearer carrega `actorRole`; cada executor chama `requireScope(actor, PERM)` antes de rodar. Falha → `ActionIntent.status="rejected"` + audit.

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
| Esteira crédito→chaves | `/locacao/esteira` (Kanban 6 stages) | `Deal(kind=locacao)`, `PipelineStage` | `/api/pipeline/...` + auto-transition actions | N (qualificar/agendar) | Esteira 0–5 |
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
| `RentalKanbanCard` / `/locacao/esteira` | `Deal(kind=locacao)` + `Property` + `Tenant` | título, `Property` endereço, `Tenant.nome`, `aluguel.valor` (dataJson) | stage da Esteira (**6 stages**, §4.3) |
| `CreditDecisionCard` | `CreditAnalysis` | `scoreBureau`, `scoreInterno`, `decisionJson`, `shapJson` (bullets explicáveis, F2) | `status`: `pendente\|aprovado\|aprovado_com_garantia\|analise_manual\|recusado` |
| `GuaranteeMenu` | `Guarantee` | `tipo`, `provider`, `coberturaMeses`, `custoJson` | `status`: `pendente\|ativa\|acionada\|encerrada\|recusada` |
| `RentLedgerTable` | `RentCharge` | `competencia` (YYYY-MM), `dueDate`, `valorBase`, `encargos`, `multa`, `juros`, `paidAt` | `status`: `pendente\|emitida\|paga\|atrasada\|cancelada\|repassada` |
| `RepasseCard` | `LeaseContract` + `RentCharge` | `valorAluguel`, `taxaAdminPercent`, `valorEncargos`, `repasseDia`; bruto (`valorBase`) → deduções → líquido | `RentCharge.status` (acima); transfer via `repasseTransferId` |
| `CollectionRulerEditor` | `LeaseContract.config` + `NewtonRequest` | `config.multa_atraso_percent` (2), `config.juros_mensais_atraso` (1); cada passo dispara `NewtonRequest` tipado | — |
| `OwnerStatementCard` / `/portal/owner` | `PropertyOwner` + `RentCharge` | `PropertyOwner.nome`, agregado de `RentCharge` por competência (líquido), `canalPreferido` | — |
| `InspectionRoomChecklist` / `/vistoria/[os]` | `Inspection` | `tipo` (entrada/saida/contra), `ambientesJson[]` (`{ambiente,fotos[],audio,descricaoIa,estado}`), `checklistJson`, `laudoPdfUrl`, `qrToken` | `status`: `rascunho\|em_campo\|laudo_gerado\|assinatura\|concluida` |
| `RentalProgressTimeline` | — (componente) | nós parametrizados `NodeDef[]` — **refactor compartilhado** de `DealProgressTimeline.tsx` (§7) | — |

Notas de binding: valores monetários são `Float` (reais, não centavos) — formatar com `Intl`/helper `moeda`. `LeaseContract.indiceReajuste`: `IGPM\|IPCA\|outro`. `LeaseContract.status`: `rascunho\|assinatura\|ativo\|renovacao\|rescisao\|encerrado` (lifecycle pós-contrato, fora do Kanban).

### 14.2 Mapa Superlógica → Contractmaker (paridade UI/UX)

| Superlógica | Contractmaker | Notas |
|---|---|---|
| Dashboard `/imobiliaria` (cards de cobranças/garantias/seguros/checklist/reajuste/vencimentos/repasses/despesas) | `/locacao` (§17.5) | Cards equivalentes, queries agregadas por orgId |
| Sidebar: Contratos · Receitas · Despesas · Financeiro · Owli · Apps · Empresa | Sidebar global + sub-nav `/locacao/*` (D4) | Não duplicamos `/financeiro` — Locação é lente |
| `/imobiliaria/contratos/index` (lista) | `/locacao/contratos` (lifecycle ativo) + `/locacao/esteira` (Kanban pré-contrato) | Split entre Kanban e lista, alinhado ao design (PR #48) |
| `/imobiliaria/contratos/id/{id}` (detalhe c/ seções colapsáveis) | `/locacao/contratos/[id]` | Espelha: Contrato + Repasses + Despesas + Cobranças + Checklists + Vistorias + Envelopes + Manutenções + Acordos + Seguros + Reajuste |
| `/imobiliaria/imoveis/index` + detalhe | `/locacao/imoveis` + `/locacao/imoveis/[id]` | `Property` + `PropertyOwnership` |
| `/imobiliaria/pessoas` (dashboard) | Pessoas unificadas venda+locação — decisão Fase 1.5 | Reaproveitar `Lead`/`PropertyOwner`/`Tenant` |
| `/imobiliaria/despesas/index` | `/locacao/despesas` | `Expense` |
| `/imobiliaria/repasses/index` | `/locacao/repasses` (lente sobre `AsaasTransfer`) | NFS-e (§7.5), simular, agrupado |
| `/imobiliaria/seguroincendio` | `/locacao/imoveis` + `InsurancePolicy` | Aba dedicada à apólice |
| `/imobiliaria/checklists/pendentes` | `/locacao/contratos?checklists=pendentes` | Filtro no listing + sino do dashboard |
| `/imobiliaria/contratos/reajuste` | `/locacao/contratos?reajuste=mes` + chat in-app tool `calculate_readjustment` | Índices via API automática |
| Owli (app mobile locatário) | `/portal/tenant` (PWA) | Não duplicamos app nativo |
| PJ Bank (split + boletos) | Asaas (já temos split nativo + Asaas Account multi-conta) | Não trocar |
| Sistema de Filiais multi-CNPJ | `Organization` (1 filial = 1 org) | Não criar `Branch` |
| Acordos (dropdown na cobrança) | `DebtAgreement` (§6.7) + parcelas `RentCharge.kind="acordo"` | Modelado |
| "Cobrança extra" (botão no contrato) | `RentCharge.kind="extra"` ou `Expense.type="taxa_locacao"` (A17) | Ambos suportados |
| Documentos (Espelho/Etiqueta/Endereçamento) | `/api/contracts/[id]/export` (já existe p/ venda) | Reusar com template locação |
| Wizard "Novo contrato" passo 3 (garantia 7 tipos) | `Guarantee.tipo` enum 7 valores + `caucaoSubtipo` | A3/A4 |

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

### 17.5 Dashboard operacional `/locacao` — cards & queries
Espelho do Superlógica §3 (renomeando contextualmente). Endpoint `GET /api/locacao/dashboard` retorna agregado por orgId, cacheável 60s no Upstash.

| Card | Query (agregada) |
|---|---|
| **Cobranças do mês** | `RentCharge` da competência: `% paid` (count paid / count total), liquidadas, a vencer, atrasadas |
| **Garantias vencidas** | `Guarantee.coberturaMeses` expirando no mês / próx. 60d / sem garantia |
| **Seguros vencidos** | `InsurancePolicy.vigenciaFim` no mês / vencidos / próx. 60d / imóveis sem apólice ativa |
| **Taxa adm** | média + total mensal de `LeaseContract.taxaAdminPercent * valorAluguel` |
| **Checklists pendentes** | `Checklist.status IN ('pendente','aguardando_aprovacao')` count |
| **Reajuste** | `LeaseContract.dataProximoReajuste` no mês corrente |
| **Vencimentos** | `LeaseContract.vigenciaFim` no mês corrente (renovação) |
| **Repasses** | `RentCharge.status="paga"` sem `repasseTransferId` setado — hoje/atrasados |
| **Despesas** | `Expense.status="pendente"` com `dueDate ≤ hoje` / atrasadas |
| **Repasse garantido** (A8) | `LeaseContract.repasseGarantido != "nao"` ativos — alerta gestor sobre exposição |
