# API Superlógica Imobiliárias — Análise completa + Benchmark vs. Locação Contractmaker

> **Status:** referência viva · **Data:** 2026-05-29 · **Autor:** análise de engenharia (Newton/Locação)
> **Fontes:** doc oficial Apiary (`superlogicaimobiliarias.docs.apiary.io`) **+ sondagem empírica ao vivo da API de produção** (licença `adm037585`, 2026-05-29, somente GET/leitura).
> **Objetivo:** decidir **o que o Newton pode fazer via API oficial** e **o que sobra para raspagem da UI**, e comparar com o que o módulo de Locação do Contractmaker já entrega.

---

## 0. TL;DR — o que mudou após testar a API ao vivo

A documentação pública (Apiary) lista **13 recursos** e parece um CRUD de cadastro. **Sondando a API de produção com tokens reais, descobrimos que ela é MUITO mais rica:** expõe **repasses, vistorias, DIMOB, seguros (apólices), pagamentos, relatórios, pessoas, movimentações e inadimplência** — nenhum desses está no Apiary.

**Consequência prática:** a dependência de raspagem cai drasticamente. Quase todo o dado operacional de locação é **legível via API** (incl. status de pagamento/liquidação, repasse ao proprietário, DIMOB). Sobram poucos buracos reais (reajuste, acordos, recibos, NFS-e e garantias como recursos próprios).

> ⚠️ **Escopo do teste:** confirmamos **leitura (GET)**. Não testamos POST/PUT na base de produção (não criar/alterar dados reais). "Escrita a confirmar" onde indicado.

---

## 0.1 Estado atual e handoff para a próxima sessão

**Concluído (2026-05-29):**
- ✅ Análise completa da API documentada (Apiary) **+ sondagem ao vivo** da API de produção (`apps.superlogica.net/imobiliaria/api/`, licença `adm037585`).
- ✅ **Dicionário de campos** de 19 entidades → [`superlogica-api-data-dictionary.md`](superlogica-api-data-dictionary.md) (sem PII).
- ✅ **Conector TypeScript (somente leitura)** → `apps/web/src/lib/superlogica/` (`client`, `types`, `endpoints`, `resources`, `index` + `README`). Typecheck OK e **smoke-test ao vivo** (contratos/repasses/seguros + tratamento de erro 404). Quirk tratado: alguns endpoints (ex.: `seguros`) ignoram `itensPorPagina` e devolvem tudo → paginação para quando `length != pageSize`.
- ✅ **Quadro-resumo para leigos** em DOCX → `docs/locacao/Superlogica-API-Funcoes.docx` (gerado via `html-to-docx`; legenda de status em texto claro).

**Aguardando (motivo do retorno em nova sessão):** resposta de `api.imobiliarias@superlogica.com` provisionando um **sandbox** (e-mail já enviado pelo usuário). Sem ele, não dá pra testar escrita com segurança.

**Quando o sandbox chegar — fazer (em nova sessão):**
1. Pegar o **`access_token` do sandbox** (o `app_token` pode ser reaproveitado; **não** usar o `access_token` de produção `adm037585` para escrita).
2. **Testar escrita (POST/PUT)** dos recursos documentados no Apiary — começar por `despesas`/`cobrancas`/`contratos` — e confirmar os corpos de requisição.
3. **Estender o conector** com funções de escrita (hoje é read-only por design; ver `resources.ts` + `README.md`).
4. **Confirmar os 3 pontos abertos com o suporte:** (a) parâmetro do endpoint `inadimplencia`; (b) `id`s válidos de `relatorios`; (c) catálogo de eventos dos **App Webhooks**.
5. **Mapear os params** de `pagamentos`/`movimentacoes` numa base com movimentação.
6. Atualizar o DOCX (linhas "Escrita prevista (a testar)" → "testado") e este documento.

**Credenciais usadas:** apenas em memória/sessão; **nenhum token foi gravado em arquivo** (`git grep` confirmou). O usuário pode revogar o app em `superlogica.net/usuario` a qualquer momento.

---

## 1. Contexto e objetivo

O Newton (agente externo, WhatsApp) e o módulo de Locação precisam de um mapa autoritativo da API da Superlógica para evitar dois erros: **raspar o que a API já entrega** (custo/fragilidade) e **assumir capacidades que a API não tem**. Este documento mapeia a API (documentada + real), compara com o nosso módulo e lista os gaps. Escopo: análise + comparativo + gap analysis (sem código).

---

## 2. Arquitetura, base URL e autenticação (verificado ao vivo)

### 2.1 Base URL real
A API de produção das **imobiliárias** roda na base **legada**, confirmada funcionando:

```
https://apps.superlogica.net/imobiliaria/api/<recurso>
```

- `https://api.superlogica.net/v2/imobiliaria(s)/...` → **404 "Could not route"** (a v2 do imobiliárias não existe; v2 é de Financeiro/Assinaturas/Condomínios).
- A **Swagger** `docs.superlogica.net/...imobiliarias.json` está **bloqueada por CloudFront 403** (WAF, independe de login) — irrelevante agora, pois testamos a API direto.

### 2.2 Autenticação (confirmada)
Dois headers em toda requisição:
```
app_token: <token do aplicativo>
access_token: <token da licença/base>
```
- `app_token` + `secret_token`: gerados ao registrar o aplicativo (área do usuário Superlógica). Mesmos para todas as licenças.
- `access_token`: **um por licença** (herda permissões do usuário que autorizou). Fluxo OAuth2: redirect `https://<licenca>.superlogica.net/clients/financeiro/login?app_token=…&redirect_uri=…` → `code` → `GET https://api.superlogica.net/oauth/access_token/` (Basic `base64(appToken:secretToken)`).
- **Multitenant:** um par (app_token global + access_token por licença) por cliente/org — casa com o modelo do Contractmaker.

### 2.3 Convenções e formato de resposta (importante!)
- **O transporte responde sempre HTTP 200.** O status real vem no **corpo JSON**: `{"status":"200"|"404"|"500", "msg":"…", "data":[…], "session":"…", "executiontime":"…"}`. Um GET de recurso inexistente devolve HTTP 200 com `status:"404"` no corpo.
- JSON UTF-8. **Datas de entrada em `MM/DD/YYYY`**; saída costuma vir `YYYY-MM-DD`. Números com `.` decimal.
- Campos seguem convenção húngara com sufixo da tabela: `_con` (contrato), `_imo` (imóvel), `_pes` (pessoa), `_recb` (recebimento/boleto), `_rep` (repasse), `_imod` (despesa), `_seg` (seguro), `_imoe` (encargo do imóvel).

### 2.4 Paginação e rate-limit
- GET paginado por padrão em **50 itens**; `pagina=N`, `itensPorPagina` (não passar de ~200 sob risco de **bloqueio anti-abuso**).
- Sandbox de teste expira em 15 dias.

---

## 3. Inventário de recursos

### 3.1 Documentados no Apiary (13)
Padrão CRUD **Cadastrar (POST) / Editar (PUT) / Consultar (GET)**:

| Recurso | Notas |
|---------|-------|
| **Contratos** | GET aceita `comDadosDosInquilinos/Imoveis/Proprietarios` (0/1), `comStatus` (`ativos`/`finalizados`/`todos`/`pendentes`/`andamento`). ~150 campos `_con` (ver §3.3) |
| **Despesas do contrato** (`imoveisdespesa`) | Cadastrar/Editar |
| **Proprietários** · **Locatários** · **Fiadores** · **Corretores** | Cadastro de partes (PF/PJ) |
| **Imóveis** · **Administradoras** · **Seguradoras** · **Serviços** | Cadastros-mestre |
| **Cobranças** | Boleto/recebimento (ver campos em §3.3) |
| **Despesas Mensais** · **Despesas do Imóvel** | Únicos com ciclo de vida explícito: **Liquidar / Estornar / Invalidar / Editar Valor** |

### 3.2 ⭐ NÃO documentados, mas REAIS (confirmados ao vivo — `status:200`)
Estes endpoints **existem e respondem com dados** mas **não constam no Apiary**:

| Recurso | O que entrega (campos-chave observados) | Impacto |
|---------|------------------------------------------|---------|
| **`repasses`** | Repasse ao proprietário completo: `id_repasse_rep`, `dt_repasse_rep`, `dt_proc_rep`, `fl_status_rep`, `vl_aluguel_rep`, `vl_txadm_rep`/`tx_adm_rep`, `fl_garantido_rep`, `fl_split_rep` + `erros_split`/`split_indisponivel`, `dt_liquidacao_recb`, `dt_credito_recb`, `vl_total_recb`, `dt_notafiscal_rep`, `id_acordo_aco`, `proprietarios_beneficiarios[]` (com contrato + imóvel embutidos) | **Repasse legível via API** (antes assumido como só-raspagem) |
| **`vistorias`** | Endpoint válido (vazio nessa base) | Vistoria existe na API |
| **`dimob`** | Declaração DIMOB por contrato: `id_dimob_dlc`, proprietário/CNPJ, locatário, `st_tipodimob_imo`, `detalhes_contrato`, datas | DIMOB legível via API |
| **`seguros`** | 192 apólices: `id_seguro_seg`, `dt_inicio/fim_seg`, `vl_premio_seg`, `vl_cobertura_seg`, `nm_parcelas_seg`, `apolice_numero`, `id_seguradora_seg`, `fl_status_seg` | Apólices (≠ cadastro de seguradoras) |
| **`pagamentos`** | Endpoint válido (vazio sem filtro) | Pagamentos |
| **`relatorios`** | Endpoint válido (exige parâmetros) | Relatórios via API |
| **`pessoas`** | Cadastro unificado de pessoas (PF/PJ) | Base única de partes |
| **`movimentacoes`** | Movimentação financeira (razão) | Extrato/conciliação |
| **`inadimplencia`** | `status:500` sem parâmetros adequados → **endpoint existe**, precisa de filtros | Inadimplência via API |
| `filiais` · `gerentes` · `usuarios` | Auxiliares (estrutura/org) | Suporte |

### 3.3 Campos relevantes (observados ao vivo)
- **Contrato (`contratos`/embutido em `repasses`):** `vl_aluguel_con`, `tx_adm_con`/`tx_locacao_con` (+ `fl_*valorfixo_con`), `nm_diavencimento_con`, `id_indicereajuste_con`, `nm_mesreajuste_con`, `dt_ultimoreajuste_con`, `nm_diarepasse_con`/`fl_diafixorepasse_con`, `nm_repassegarantido_con`/`fl_tiporepassegarantido_con`, `fl_garantia_con`/`id_garantia_grt`/`vl_valorgarantia_con`/`dt_garantiainicio/fim_con`, `fl_seguroincendio_con`/`vl_seguroincendio_con`, `fl_reterir_con`/`fl_irporcentagemlocatario_con`, `fl_emitirnotafiscal_con`, `fl_split_con`/`fl_multisplit_con`, `fl_renovacaoautomatica_con`, `nm_mesesisencaomulta_con`, `tx_multacontratual_con`, `dt_rescisao_con`/`fl_motivorescisao_con`, `id_corretor_con`/`id_agentecomercial_con`/`id_gerente_con`, `fl_contratodigital_con`/`fl_locacaodigital_con`.
- **Cobrança (`cobrancas`):** `id_recebimento_recb`, `dt_vencimento_recb`/`dt_vencimentooriginal_recb`, `dt_liquidacao_recb`, `vl_total_recb`/`vl_emitido_recb`, `vl_txmulta/txjuros/txdesconto_recb`, `st_nossonumero_recb`, `st_pixqrcode_recb`, `link_2via`, `st_splitdados_recb`, flags de notificação (1ª–6ª, SMS/carta), `fl_status_recb`. → **status de pagamento/liquidação é legível direto** (webhook é só pra tempo-real).
- **Despesa (`despesas`):** razão completo — `id_despesa`, `vencimento`/`competencia`, `vl_valor_imod`, `id_debito_imod`/`id_credito_imod` (+ `id_proprietariodebito/credito_imod`), `dt_liquidacao_*`, `id_repasse_rep`, `id_acordo_aco`, `id_seguro_seg`, `fl_repassar_imod`, `repasses[]`/`movimentacoes[]` embutidos.

---

## 4. App Webhooks (tempo real)

Produto separado (não-REST). Notifica eventos (ex.: liquidação/recebimento de boleto) em tempo real; segurança via `validationtoken`. Como o status de liquidação **já é legível** via `cobrancas`/`despesas`, o webhook serve para **push imediato** (evitar polling), espelhando o que fazemos com Asaas/ClickSign.
**🔒 A confirmar:** catálogo completo de eventos e payloads (sandbox/suporte).

---

## 5. O que a API realmente NÃO entrega (gaps reais, confirmados 404)

Muito menor do que a doc sugeria. Genuinamente ausentes (não há controller):

| Função | Situação na API | Observação |
|--------|-----------------|------------|
| **Reajuste / índices** | ❌ `reajuste(s)`, `calculoreajuste`, `indices` → 404 | Só campos no contrato (`id_indicereajuste_con`, `dt_ultimoreajuste_con`). Cálculo/aplicação não há |
| **Acordos / parcelamento** | ❌ `acordos`/`acordo`/`acordosdivida` → 404 | Mas `id_acordo_aco` aparece em `despesas`/`repasses` (o dado existe; falta o CRUD) |
| **Recibos** | ❌ `recibos`/`recibo` → 404 | — |
| **NFS-e** | ❌ `nfse`/`notafiscal`/`notas` → 404 | Mas há flags (`fl_emitirnotafiscal_con`, `dt_notafiscal_rep`) — emissão fora da API |
| **Garantias (recurso próprio)** | ❌ `garantias` → 404 | Dados embutidos no contrato (`id_garantia_grt`, `st_cotacao_grt`) + `fiadores` |
| **Prestação de contas (extrato formal)** | ❌ sem endpoint dedicado | Coberto **na prática** por `repasses` + `despesas` + `movimentacoes` |
| **Reembolsos / faturamento / cotações** | ❌ 404 | — |

> **Revisão da tese:** a API é forte em **dados-mestre + financeiro operacional legível** (incl. repasse, DIMOB, seguros, liquidação). Os buracos reais são **processos de cálculo/emissão** (reajuste, acordo, NFS-e) e alguns CRUDs ausentes (garantias). É aí — e na inteligência (análise de crédito, vistoria com IA, régua de cobrança) — que o Contractmaker agrega.

---

## 6. Comparativo: Superlógica API × Locação Contractmaker

Legenda: ✅ paridade · 🟡 parcial · **só-nós** (não há na API) · 🔒 a confirmar (escrita não testada).
Códigos `Axx` = "achados Superlógica" anotados no `prisma/schema.prisma`.

| Capacidade | Superlógica API (real) | Nosso módulo (model / rota / lib) | Status |
|------------|------------------------|-----------------------------------|--------|
| **Imóvel** | `imoveis` (CRUD) | `Property` (~45 `kind`, A6) · `api/locacao/properties` | ✅ |
| **Ownership N:N + rateio %** | embutido (`proprietarios_beneficiarios`) | `PropertyOwnership` (A1) · `properties/[id]/ownership` | ✅ |
| **Proprietário / Locatário / Fiador / Corretor** | `proprietarios`/`locatarios`/`fiadores`/`corretores` + `pessoas` | `PropertyOwner`/`Tenant`/`Guarantee`/`LeaseAngariador` | ✅ |
| **Locatários solidários** | vínculo no contrato | `LeaseTenant` (A2) | ✅ |
| **Contrato de locação** | `contratos` (CRUD, ~150 campos) | `LeaseContract` (A5/A7/A10) | ✅ |
| **Cobrança mensal + liquidação/PIX/2ª via** | `cobrancas` (status legível) | `RentCharge` + `rent-scheduler.ts` + Asaas `CommissionCharge{kind:"aluguel"}` | ✅ (ambos fazem; fontes diferentes) |
| **Multa/juros** | campos `_recb`/`_con` | `RentCharge.multa/juros` + `Expense` | ✅ |
| **Despesas operacionais (razão)** | `despesas`/`imoveisdespesa` (+ liquidar/estornar/invalidar) | `Expense` (12 `type`, A17/D2) | 🟡 (eles têm verbos financeiros formais; nós usamos `status`) |
| **Repasse ao proprietário + split** | ✅ **`repasses`** (leitura: status, txAdm, split, garantido, NF, liquidação/crédito) | `repasse-simulator.ts` · `repasses/simular`/`realizar` · `transfer-dispatcher.ts` → AsaasTransfer | ✅ disponível p/ leitura (🔒 escrita) |
| **Repasse garantido** | `nm_repassegarantido_con`/`fl_tiporepassegarantido_con` + `fl_garantido_rep` | `LeaseContract.repasseGarantido*` (A8) | ✅ |
| **NFS-e** | só flags (sem endpoint) | `LeaseContract.emitirNfse` (A16) · `transfers/[id]/nfse` | 🟡 ambos parciais |
| **DIMOB** | ✅ **`dimob`** (dados da declaração) | `Property.tipoDimob` (A15) — geração TXT não feita | 🟡 (eles entregam dado; falta gerar TXT dos dois lados) |
| **Seguros (apólices)** | ✅ **`seguros`** (apólice/prêmio/cobertura) | `InsurancePolicy` (A14) · `api/locacao/insurance` | ✅ |
| **Inadimplência** | ✅ `inadimplencia` (com params) | dashboard + `RentCharge.status="atrasada"` + dunning | ✅ |
| **Prestação de contas / extrato** | via `repasses`+`despesas`+`movimentacoes` | `api/locacao/dashboard` (parcial) | 🟡 (ambos parciais; formalizar extrato) |
| **Reajuste por índice** | ❌ sem endpoint | `LeaseReadjustment` + `readjustment-calculator.ts` (propor→aprovar→aplicar) | **só-nós** |
| **Vistoria (laudo/foto/IA)** | `vistorias` (existe, dado simples) | `Inspection` (laudo PDF, QR, ClickSign, IA) | 🟡 (eles guardam; nós fazemos com IA) |
| **Análise de crédito** | ❌ | `CreditAnalysis` (bureau + score interno + open finance) | **só-nós** |
| **Acordo / parcelamento** | ❌ CRUD (só `id_acordo_aco` referenciado) | `DebtAgreement` → `RentCharge{kind:"acordo"}` | **só-nós** |
| **Manutenção / checklists** | ❌ | `Maintenance`, `Checklist`/`ChecklistTemplate` | **só-nós** |
| **Dashboard / KPIs / régua Newton** | `relatorios` (genérico) | `api/locacao/dashboard` + executors Newton | **só-nós** (inteligência) |

### 6.1 Automação Newton (sem paralelo na API — `lib/locacao/executors/`)
`detect-late-payment`→`dunning` (régua) · `suggest-readjustment` · `approve-repasse` (split+taxa+IR→AsaasTransfer) · `schedule-inspection` · `request-inspection-feedback` · `create-expense` (OCR + ActionIntent).

---

## 7. O que falta para um ERP de locação completo (via API + Newton)

### 7.1 Pode ser **API-first** (fim da raspagem) — leitura confirmada ao vivo
Sincronizar/consumir direto da API: **contratos, imóveis, partes (pessoas/proprietários/locatários/fiadores/corretores), cobranças com status de liquidação/PIX, despesas (razão), repasses (status/split/garantido/NF), DIMOB, seguros (apólices), inadimplência, movimentações.** Criar/editar dados-mestre + lançar despesas/cobranças (CRUD documentado). Push em tempo real via **webhook**.

### 7.2 Continua exigindo raspagem OU módulo próprio (sem endpoint)
**Reajuste (cálculo/aplicação), acordos (CRUD), recibos, NFS-e (emissão), garantias (CRUD).** Para esses, o Contractmaker é a fonte de verdade (já temos `LeaseReadjustment`, `DebtAgreement`, etc.) e só precisaria empurrar o resultado pra Superlógica como despesa/cobrança via API.

### 7.3 Gaps do nosso produto (independente da Superlógica)
- **DIMOB:** temos `tipoDimob` mas falta gerar o TXT RFB (a API Superlógica entrega os dados — pode acelerar).
- **Verbos financeiros formais** em `Expense` (estornar/invalidar/editar-valor com trilha) — a API trata como ciclo de vida; nós usamos `status`.
- **Emissão Asaas das `RentCharge`** (`emitPendingRentCharges`) é seam pendente de validação sandbox/QA.
- **Extrato formal de prestação de contas** por proprietário/competência.

---

## 8. Recomendações / próximos passos

1. **Conector REST — leitura já construída** em `apps/web/src/lib/superlogica/` (base `apps.superlogica.net/imobiliaria/api/`, headers `app_token`/`access_token`, status no corpo JSON, datas `MM/DD/YYYY`, paginação resiliente). Próximo: **escrita** após sandbox (ver §0.1). Já elimina raspagem na leitura de contratos/cobranças/repasses/despesas/dimob/seguros.
2. **OAuth2 multi-licença** (um `access_token` por org/cliente), alinhado ao multitenant.
3. **Webhooks:** confirmar catálogo de eventos no sandbox/suporte; usar como fast-path de liquidação.
4. **Mapear params** de `relatorios`, `pagamentos`, `inadimplencia`, `movimentacoes` (exigem filtros) e **confirmar escrita** (POST/PUT) de `repasses`/`vistorias`/`dimob` em sandbox (não testar em produção).
5. **Suporte** (`api.imobiliarias@superlogica.com`): rate limits oficiais e se há endpoint de **reajuste/acordo/NFS-e** não exposto.

---

## Apêndice — Fontes, método e limitações

- **Apiary** lido na íntegra (índice 13 recursos + auth + convenções + paginação + campos do contrato).
- **Sondagem empírica** (2026-05-29, licença `adm037585`, somente GET): ~55 controllers testados; mapeados os existentes (`status:200`) vs. ausentes (`status:404`). Campos extraídos de respostas reais.
- **Não testado:** operações de **escrita** (POST/PUT) na base de produção — propositalmente, para não alterar dados reais. Marcado 🔒.
- **Inacessível:** Swagger v2 OAS3 (`docs.superlogica.net`, CloudFront 403) — irrelevante, pois a API real foi testada direto. Blueprint `.apib` cru público está desatualizado.
