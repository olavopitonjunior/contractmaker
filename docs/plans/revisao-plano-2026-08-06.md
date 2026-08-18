# Revisão crítica do plano — 2026-08-06

Revisão do plano "Formulários, Propostas e SLA/Relatórios" contra o código em
`master` (3e2363c). Três seções: (a) problemas/regressões que o plano não
previu, (b) melhorias de execução adotadas, (c) oportunidades novas priorizadas.
Itens marcados **[ADOTADO]** foram incorporados na execução; **[REGISTRO]** são
apenas registro (mudam escopo — não executados).

---

## (a) Problemas e desvios encontrados vs o código atual

### Fase 1

1. **1.1 já está meio implementada.** O seletor de modalidade na etapa Pagamento
   existe desde 2026-07-30 (`components/forms/steps/PagamentoStep.tsx` +
   `lib/forms/payment-seed.ts`): cards "À vista"/"Financiamento", semeadura de
   parcelas por modalidade, derivação a partir de parcelas p/ forms antigos e
   confirmação antes de re-semear. O que restava (e foi feito): o `superRefine`
   de consistência, o wrapper `deriveCategory` com a escolha humana como prior,
   a correção do CLAUDE.md e a tabela de testes 6×3.
2. **O call-site da seleção não é `contract-generation.ts:848`.** A derivação de
   categoria acontece DENTRO de `selectTemplateForDeal`
   (`lib/contracts/template-category.ts:136`), que `contract-generation` chama.
   O wrapper foi plugado ali — efeito idêntico, um único ponto.
3. **`superRefine` da modalidade tem falso-positivo em forms legados.**
   `step5Schema.modalidade` tem `.default("a_vista")`; um form de financiamento
   anterior a 2026-07-30, nunca reaberto, parseia como `a_vista` + parcela de
   financiamento e ganharia o issue. Mitigação: a validação do finalize é
   **informativa** (não bloqueia — `api/forms/[token]/route.ts:235-255`) e a
   mensagem manda conferir a etapa Pagamento, que corrige o dado. Aceito o
   ruído residual (população encolhendo; OCR/voz/CCV gravam explícito).
4. **`NovaPropostaDialog.tsx` não existe mais.** A criação de proposta virou
   página (`ProposalForm.tsx` + `lib/proposals/form-data.ts`, com
   build/parse inversos). Todos os pontos de 1.2/1.3 sobre o "dialog" foram
   aplicados na página.
5. **1.3 também está meio implementada.** `buildProposalDataJson` já grava
   `garantia = { tipo, provider, caucao_meses, fiador }` no shape canônico, com
   UI condicional (caução → nº aluguéis; seguro/título/digital → provedora;
   fiador → PF/PJ + nome + doc), e `deriveTemplateFacts`/`matchCriteria` já
   funcionam pra proposta. O que faltava (e foi feito): prazo em meses + data
   pretendida de entrada, os dot-paths canônicos pro convert, e a derivação da
   string humana (`locacao.garantia`/`locacao.prazo_meses`/
   `locacao.data_entrada`) que os `{{#if locacao.*}}` dos templates já esperam.
   Com a string derivada no build, **os .hbs de locação não precisaram de bloco
   novo de garantia** — menos risco que reescrever template.
6. **A etapa de locação "Confirmação" foi removida em 2026-07-30**
   (`validation-locacao.ts:370-375`). As observações gerais de locação foram
   pra `GarantiaStep` (última etapa do wizard), com o rótulo da etapa ajustado.
7. **`convert.ts` não precisa "semear" observações.** A conversão copia o
   `dataJson` verbatim pro SalesForm; gravando `observacoes` na raiz do
   dataJson da proposta, o zero-redigitação sai por construção. Nenhuma mudança
   no convert.
8. **1.4 tem QUATRO gates, não um.** Além do builder
   (`form-summary.ts:237`), há guards hard `kind !== "venda"` /
   `schemaType !== "compra_venda_v1"` nas rotas `form-summary/pdf` e
   `form-summary/send` e em `generateFormSummaryPdf`/mailer. Todos foram
   ajustados juntos (senão o builder novo devolvia seções e a rota devolvia
   400).

### Fase 2

9. **`POST /api/proposals/[id]/signers` JÁ EXISTE** com outra semântica:
   adiciona signatário ao envelope ClickSign **em curso** (fix de contato
   errado em envelope `running`, 2026-08-04). O plano mandava 409 em
   `enviada/entregue/visualizada` — isso **removeria** uma feature em produção.
   Decisão: mesclar — statuses com envelope vivo mantêm o caminho atual;
   statuses de pré-envio/parada criam linha `ProposalSigner` (o que o plano
   queria).
10. **`convert.ts` não consome `CONVERTABLE_STATUSES`** — o gate real é
    `status === "completa"` + `allowUnsigned` (`convert.ts:64`). O bug A do
    plano se manifesta na UI/rota; o fix de sets do plano está correto, mas o
    teste de paridade precisa cobrir o executor também.
11. **`refusedBy` existe no schema (`schema.prisma:3270`) e NÃO é persistido**
    pelo hook (`onProposalEnvelopeRefused` só grava `refusedAt`). Confirma o
    plano; o campo já viaja no sino.
12. **Nome real do helper é `loadScopedProposalSigner`** (não
    `loadScopedPlanSigner`) e ele carrega `EnvelopeSigner` — o "fallback
    EnvelopeSigner→ProposalSigner" do plano precisa ser construído nele.
13. **Offsets deslocados** (sem impacto de mérito): `deleteMany` do
    `runClickSignEnvelope` em `send-execute.ts:390-391`; `deadlineAt` da 2ª via
    em `:778`; loop do aceite em `:259-299`; `onProposalEnvelopeRefused` em
    `:124-165`; polling da lista em `ProposalsListClient.tsx:72-77`;
    case cancel/deadline em `webhook-process.ts:418-425`.
14. Confirmados pelo código, como o plano previa: ausência de guard de status
    em `sendVendedorEnvelopeLocked` (o guard vive só na rota); `from` hardcoded
    `"rascunho"` em `status.ts:105`; labels homônimos ("Aguardando vendedor")
    pros dois statuses; EVENT_LABEL com 10 chaves órfãs e os 5
    `chained_envelope2_*` reais sem label; nenhum hook de proposta em
    cancel/deadline; `plannedProposalCostCents`/`plannedAcceptanceCostCents`
    já existem em `cost.ts`.

### Fase 3

15. **São 19 write-points de `stageEnteredAt`, não 17.** Extras: o soft-delete →
    "Arquivado" (`api/deals/[dealId]/route.ts:271`) e a duplicação
    mark-lost/mark-signed/reopen nos DOIS namespaces (7 rotas, não 3). Linhas
    citadas no plano estão quase todas deslocadas (ver PR da Fase 3).
16. **O "RISCO Nº 1 — transação aninhada" não existe hoje**: nenhum write-point
    roda dentro de `$transaction` (o único `create` dentro de tx é
    `convert.ts:185`, coberto pela auto-cura). O param `tx` do `moveDealStage`
    continua valendo como válvula de futuro, mas a auditoria prévia é trivial.
17. **O fim do `Date.now()` no browser já aconteceu**: `KanbanCard` recebe
    `nowMs` serializado do server (`page.tsx:308`) com o workaround do React
    #418 documentado. O critério de aceite do 3.3 vira "manter", não "criar";
    o que segue valendo é mover a DERIVAÇÃO de status SLA pro servidor.
18. **`recharts`/`papaparse` confirmados** como dependências (o plano já dizia).
19. **`DEAL_NOTIF_EVENTS` vive em `lib/notifications/deal-events-shared.ts`**,
    não em `deal-events.ts` (que tem `OWNS_BELL` e `stageChangeDedupeKey`).
20. **Duplicação de derivação de datas é 4-5 cópias, não 3** (as duas páginas de
    kanban, a página de deal de locação, `DealDetail.tsx:1083` e uma variante
    fiscal em `dimob/aggregate-sales.ts:345` — esta última fica fora do dedup,
    contexto diferente).
21. **`fromStage`/`toStage` no AuditLog são ambíguos hoje** (nome numa rota, ID
    nas demais) — reforça o metadata padronizado do plano; o backfill do 3.9
    precisa tratar os dois formatos (o plano já previa "nome vs ID").
22. **`/relatorios/funil` sem `REPORT_VIEW` confirmado** (só gate de módulo);
    as permissões `REPORT_VIEW`/`REPORT_EXPORT` já existem e são usadas em
    DIMOB/financeiro.
23. **`npm test` não roda na raiz** (package.json raiz sem scripts) — gate de
    qualidade roda em `apps/web` (`npm test -w apps/web`, `npx tsc --noEmit`).

---

## (b) Melhorias de execução adotadas [ADOTADO]

- **Wrapper `deriveCategory` dentro de `selectTemplateForDeal`** (um call-site,
  puro e testável) em vez de trocar chamada em `contract-generation`.
- **String humana da garantia derivada no build da proposta** (escreve
  `locacao.garantia`/`prazo_meses`/`data_entrada` que os templates JÁ leem) em
  vez de bloco novo de Handlebars — zero mudança de template pra garantia,
  propostas antigas seguem com a string legada.
- **Observações da proposta na raiz `observacoes`** + bloco próprio não
  ocultável nos 3 .hbs de proposta (o `config.condicoes_internas` ocultável
  continua). Convert intocado (cópia verbatim).
- **Rota `/signers` mesclada** (item 9 acima) em vez de substituída.
- **1.4 destrava os 4 gates juntos** (builder + 2 rotas + gerador de PDF).
- Fase 3: `moveDealStage` cobre os **19** call-sites reais; metadata padronizado
  grava `fromStageName`/`toStageName` E ids — resolve a ambiguidade do item 21.

## (c) Oportunidades novas (valor × esforço) [REGISTRO — não executadas]

| # | Oportunidade | Valor | Esforço | Justificativa |
|---|---|---|---|---|
| 1 | **Índice parcial + telemetria pro reopen frágil**: o reopen lê o ÚLTIMO `DEAL_STAGE_CHANGE` e falha se um drag posterior existir. O PR 3.2 já o migra pra `DealStageHistory`; a oportunidade extra é um alerta (sino admin) quando o fallback disparar, pra medir a dívida | Alto | Baixo | Fragilidade real hoje (`reopen/route.ts:66-82`); a migração resolve o caso novo, o alerta mede o legado |
| 2 | **Resumo consolidado por e-mail pro LOCADOR na aprovação de ficha** (locação): com 1.4 pronto, o mesmo PDF serve o momento "Em Aprovação" → aprovado | Alto | Médio | Reusa 100% do pipeline novo de resumo de locação; hoje o locador não recebe nada estruturado |
| 3 | **Unificar os namespaces `api/deals/[dealId]` × `api/pipeline/deals/[dealId]`** (7 rotas duplicadas de stage) atrás do `moveDealStage` e deprecar o legado | Médio | Médio | O PR 3.1 já centraliza a mutação; sobraria colapsar as rotas — reduz superfície de bug pela metade |
| 4 | **`Deal.responsibleUserId` real**: o plano rotula `userId` (criador) como "Responsável"; existe `managerUserId` (gerente). Um campo de corretor responsável transferível destravaria SLA/relatório por corretor honestos | Médio | Médio | O relatório "por corretor" da 3.7 agrega pelo criador — aproximação declarada; registrar pra não fingir precisão |
| 5 | **Enums de garantia divergentes** form × `Guarantee.tipo` + `propria` no Zod fora do seletor (dívida citada no plano 1.3) — normalizar com migração de dados | Médio | Médio | Fonte de matchCriteria furado no futuro; precisa de migration de dados (fora do escopo autônomo) |
| 6 | **Digest semanal de SLA por e-mail** (além do sino diário do 3.6) | Baixo | Baixo | Reusa `notifyDealEvent` + cron; esperar o 3.6 estabilizar |
| 7 | **AuditLog append-only de verdade** (trigger/revoke UPDATE-DELETE no Postgres): hoje é convenção, e `onDelete: Cascade` do org apaga logs | Médio | Baixo | Compliance declarada no CLAUDE.md ("AuditLog imutável") não é garantida pelo schema |

## Decisões do dono respeitadas

Handoff sempre humano (escape hatch org OFF) · observações nas duas vias ·
`DealStageHistory` + backfill estimado · contraproposta fora (só `refusedBy`).
