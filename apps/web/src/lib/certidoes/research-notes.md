# Infosimples — Notas de Pesquisa de Cobertura

## Status de implementação

- **Phase E (OCR Robustness)** ✓ 2026-04-16 — retry batch + Map por attachmentId + lock atomic + content-hash pre-warm
- **Phase A (Taxonomia de erros)** ✓ 2026-04-16 — `error-codes.ts` + `failureCategory` + UX contextual + `EditPartyDialog`
- **Phase B (Expansão regional)** ✓ 2026-04-16 — +15 endpoints (TJBA/TJGO/TJDF/TJSC/TJMS/TJMT + TRT3/5/9/10/10d/12 + cnpj + CRF + sefaz unificada + pge-sp)
- **Phase C (Ad-hoc)** ✓ 2026-04-16 — schema nullable + `POST /api/certidoes/adhoc` + `/certidoes/adhoc` page
- **Phase D (Fixtures + testes)** ✓ 2026-04-16 — +9 fixtures (missing_input, inconsistent, portal_unavailable, rate_limited, account_issue, genuine_no_data, receita-cnpj, caixa-crf, sefaz) + +23 testes (57 total)

## Validação

- `tsc --noEmit` limpo (monorepo inteiro)
- `vitest run src/lib/certidoes/` → 57/57
- `vitest run src/lib/ai/__tests__/ocr.test.ts` → 13/13



Pesquisa realizada em 2026-04-16 via WebFetch/WebSearch contra docs públicas `infosimples.com/consultas/*` e página de preços `infosimples.com/consultas/precos/`. Preços confirmados. Playwright MCP estava registrado mas fora da sessão — se recarregado, convém refazer via `browser_navigate` para capturar request/response examples completos.

## 1. Mapa: 11 certidões × endpoints Infosimples

| # | Certidão pedida | Cobertura Infosimples | Status no projeto |
|---|---|---|---|
| 1 | CND Cível 10 anos (Estado residência) | Múltiplos TJs — ver §2 | **Parcial** (só SP/RJ/RS hoje) |
| 2 | CND Federal conjunta (RFB + PGFN) | `receita-federal/pgfn` — R$ 0,06 | ✓ |
| 3 | CND JF 1º grau | `tribunal/trf/cert-unificada` — R$ 0,04 | ✓ |
| 4 | CND Estadual PGE (Dívida Ativa) | `sefaz/certidao-debitos` (27 UFs, preço variável) + `pge-sp/cndt` R$ 0,04 | **GAP** |
| 5 | CNDT nacional | `tribunal/tst/cndt` — R$ 0,04 | ✓ |
| 6 | CND Trabalhista TRT região | TRTs 1/2/3/4/5/9/10/12/15 etc — R$ 0,04 cada | **Parcial** (só 1/2/15/4 hoje) |
| 7 | SERASA | **Não existe** na Infosimples | **GAP sem solução Infosimples** |
| 8 | CENPROT nacional | `ieptb/protestos` R$ 0,06 (exige login GOV.BR do usuário) | **Fora do MVP** — decisão mantida |
| 9 | CND Falência PJ 10 anos | **Sem endpoint dedicado**. Falência vem embutida em certidões cíveis TJ (TJRS tipo 7 explícito; outros TJs implícitos) | **Parcial** |
| 10 | CRF FGTS | `caixa/regularidade` — R$ 0,06 | **GAP** |
| 11 | Cartão CNPJ | `receita-federal/cnpj` — R$ 0,04 | **GAP** |

## 2. Tabela Cível por UF (endpoints Infosimples existentes)

| UF | Endpoint | Fluxo | Preço R$ | Status no projeto |
|----|----------|-------|----------|-------------------|
| SP | `tribunal/tjsp/pedido-civel` + `obter-civel` | 2 etapas (5–15 min) | 0,06 + 0,04 | ✓ ativo |
| RJ | `tribunal/tjrj/pedido-cert` + `obter-certidao` | 2 etapas (até 8 dias úteis) | 0,06 + 0,04 | ✓ ativo |
| RS | `tribunal/tjrs/primeiro-grau` (5 tipos: 3/4/7/8/9) | 1 etapa × 5 chamadas | 0,04 × 5 | ✓ ativo |
| BA | `tribunal/tjba/primeiro-grau` | 1 etapa | "—" (sem adicional) | **ADICIONAR** |
| GO | `tribunal/tjgo/nada-consta` | 1 etapa (1º e 2º grau) | 0,04 | **ADICIONAR** |
| DF | `tribunal/tjdf/nada-consta` | 1 etapa | 0,04 | **ADICIONAR** |
| MS | `tribunal/tjms/pedido-cert` + `obter-certidao` | 2 etapas | n/d | **ADICIONAR** |
| MT | `tribunal/tjmt/primeiro-grau-pf` | 1 etapa (só PF) | n/d | **ADICIONAR** |
| SC | `tribunal/tjsc/pedido-certidao` | 1 etapa (prazo até 5 dias) | 0,06 | **ADICIONAR** |
| MG | ❌ só `tribunal/tjmg/processo` (consulta processual, NÃO certidão) | n/a | n/a | **sem cobertura Infosimples** |
| PR | ❌ só `tribunal/tjpr/processo` | n/a | n/a | **sem cobertura Infosimples** |
| ES | ❌ não encontrado endpoint de certidão | n/a | n/a | **sem cobertura Infosimples** |
| Outras UFs | **não investigadas** (AC/AL/AM/AP/CE/MA/PA/PB/PE/PI/RN/RO/RR/SE/TO) | — | — | revisitar com Playwright |

## 3. Tabela Trabalhista (CEAT) por UF

| TRT | UF(s) | Endpoint | Preço R$ | Status |
|-----|-------|----------|----------|--------|
| TRT1 | RJ | `tribunal/trt1/ceat` | 0,04 | ✓ ativo |
| TRT2 | SP capital (físico) | `tribunal/trt2/ceat` | 0,04 | ✓ ativo |
| TRT2-d | SP capital (digital) | `tribunal/trt2/ceat-digital` | 0,04 | ✓ ativo |
| TRT3 | MG | `tribunal/trt3/ceat` | 0,04 | **ADICIONAR** |
| TRT4 | RS | `tribunal/trt4/ceat` | 0,04 | ✓ ativo |
| TRT5 | BA | `tribunal/trt5/ceat` | 0,04 | **ADICIONAR** |
| TRT9 | PR | `tribunal/trt9/ceat` | 0,04 | **ADICIONAR** |
| TRT10 | DF, TO | `tribunal/trt10/ceat` + `tribunal/trt10/ceat-digital` | 0,04 | **ADICIONAR** |
| TRT12 | SC | `tribunal/trt12/ceat` | 0,04 | **ADICIONAR** |
| TRT15 | SP interior | `tribunal/trt15/ceat` | 0,04 | ✓ ativo |
| TRT18 | GO | (pesquisa sugere existe — confirmar via doc direta) | 0,04 | **CONFIRMAR + ADICIONAR** |

## 4. Gaps detalhados

### 4.1 CND Estadual PGE / Dívida Ativa

**Solução Infosimples recomendada:** `sefaz/certidao-debitos` (endpoint unificado das 27 UFs).

- Request: `{ cpf | cnpj | ie, uf }` — aceita qualquer dos três identificadores.
- Response: `{ certidao_codigo, conseguiu_emitir_certidao_negativa, emissao_data, validade_data, mensagem }`.
- Preço: **variável por UF** (precificador na página de preços faz cálculo customizado — requer consulta ou teste real por UF-alvo).
- Opcionalmente: `pge-sp/cndt` (R$ 0,04) + `pge-sp/divida-ativa` para São Paulo com dados extras (CDA number, etc).

Para o projeto, sugestão: usar `sefaz/certidao-debitos` como default em todas as UFs; substituir por `pge-sp/cndt` quando UF=SP (mais barato e mais completo).

### 4.2 SERASA — sem cobertura Infosimples

Infosimples **não oferece** Serasa. Alternativas de provider:

1. **Boa Vista Serviços** (ex-Equifax) — portal B2B, tem API.
2. **Quod** — Bacen-regulated, tem API de consulta.
3. **SPC Brasil** — API própria.
4. **Agregadores** (100Restrição, SuperCred) — cobrem Serasa/SPC/Boa Vista em um só endpoint, mas geralmente mais caros.

**Decisão recomendada**: manter SERASA fora da extração automatizada por ora. Adicionar campo manual no Deal detail onde o corretor anexa PDF do extrato Serasa baixado pelo próprio cliente (que faz grátis em serasa.com.br). Documentar como "skipped" no relatório de due diligence.

### 4.3 CENPROT nacional — confirma decisão do MVP

Endpoint `ieptb/protestos` existe e é **nacional** (todos estados exceto detalhes SP), mas:

- **Exige `login_cpf` + `login_senha` da conta GOV.BR** do usuário (cada corretor teria que ter conta + passar credenciais).
- Daily rate limit per login.
- Preço: R$ 0,06.

O CLAUDE.md já documenta essa limitação. **Mantém decisão de não incluir no MVP** — continuar com `cenprot-sp/protestos` somente. Para protestos em outras UFs, orientar corretor a emitir manualmente no portal `pesquisaprotesto.com.br`.

### 4.4 CND Falência PJ 10 anos — sem endpoint dedicado

Infosimples não tem endpoint específico para "falência". Abordagem:

- **TJRS**: já retorna explicitamente tipo 7 (Falência) em `TJRS_TIPOS` em [endpoints.ts:242](apps/web/src/lib/certidoes/endpoints.ts#L242-L248).
- **TJSP/TJRJ**: a certidão cível do 1º grau (via `pedido-civel`/`pedido-cert`) é abrangente — inclui falência, concordata, recuperação judicial por padrão quando se marca "Certidão Cível" no portal. Para payloads, verificar se há parâmetro `modelo` ou `tipo_certidao` que alterne entre "Cível" e "Falência" (recomendo teste real).
- **Outros TJs**: normalmente a "Nada Consta" (TJGO, TJDF) abrange falência implicitamente.

**Recomendação**: no PDF do relatório de due diligence, adicionar linha dedicada "Falência (10 anos)" que referencia a mesma fonte da cível. Para PJ em SP/RJ, eventualmente adicionar 2ª chamada com parâmetro específico se existir.

### 4.5 CRF FGTS — `caixa/regularidade`

- Request: `{ cnpj }` (ou `cei` para obra).
- Response: `{ crf, situacao, validade_inicio_data, validade_fim_data, razao_social, endereco, inscricao, historico_cabecalho, historico_lista }`.
- Preço: R$ 0,06.
- **Aplica a**: apenas PJ (ou obra). No projeto, `planner.ts` só dispara quando `targetKind === "pessoa"` **e** há `cnpj`.
- Observação: se empresa estiver irregular, retorna `situacao` com motivos no `historico_lista`.

### 4.6 Cartão CNPJ — `receita-federal/cnpj`

- Request: `{ cnpj }`.
- Response: todos campos do cartão CNPJ (situação cadastral, CNAE principal/secundárias, QSA, endereço, capital social, natureza jurídica, telefones, email, data abertura, etc).
- Preço: R$ 0,04.
- Sempre emite (não há "positiva/negativa" — é consulta de dados).
- **Aplica a**: PJ apenas. No planner, disparar 1 chamada por CNPJ (vendedor/comprador PJ).

## 5. Recomendações de implementação (próxima iteração — fora deste plano)

Em ordem de impacto/custo:

### Fase A — ganhos imediatos, baixo custo (adicionar ao `ENDPOINTS` catalog)

1. `receita-federal/cnpj` (R$ 0,04) — dispara automático para toda parte PJ. Anexa cartão CNPJ ao Deal.
2. `caixa/regularidade` (R$ 0,06) — idem, para toda parte PJ.
3. `sefaz/certidao-debitos` unificado (preço variável) — dispara para toda parte PF/PJ com UF definida, cobrindo CND Estadual faltante.
4. TRT3/5/9/10/10-d/12 (R$ 0,04 cada) — expandir `planner.ts` para rotear por UF além de SP/RJ/RS.

### Fase B — expansão de cobertura cível

5. TJBA, TJGO, TJDF, TJSC, TJMS, TJMT — adicionar ao catalog + roteamento no planner. Cada um cobre aprox. 1 UF (exceto DF+TO compartilham TRT10 mas TJ é separado).
6. Documentar explicitamente "sem cobertura Infosimples" para TJMG, TJPR, TJES no SkippedJob reason — gerar "pendência manual" no relatório.

### Fase C — decisões de produto

7. SERASA: decidir entre (a) integrar 2º provider (Boa Vista/Quod com custo adicional), (b) anexo manual PDF, (c) marcar como "fora do escopo de due diligence automatizada". Recomendo (b) para MVP.
8. CENPROT nacional: manter fora do MVP (decisão já documentada no CLAUDE.md).

## 6. Próximos passos

- Confirmar preços "—" (TJBA) e "n/d" (TJMS, TJMT) via cadastro de conta Infosimples e olhar o precificador logado.
- Testar `sefaz/certidao-debitos` com UF=BA/PR/MG para confirmar cobertura e preço real.
- Com Playwright MCP carregado (session reload), revisitar para capturar exemplos de request/response JSON completos — especialmente para `tribunal/tjba/primeiro-grau` e `tribunal/tjms/*` cujas pages têm pouca info técnica.

## 7. Fontes consultadas

- https://infosimples.com/consultas/precos/
- https://infosimples.com/consultas/sefaz-certidao-debitos/
- https://infosimples.com/consultas/pge-sp-cndt/
- https://infosimples.com/consultas/pge-sp-divida-ativa/
- https://infosimples.com/consultas/receita-federal-cnpj/
- https://infosimples.com/consultas/caixa-regularidade/
- https://infosimples.com/consultas/ieptb-protestos/
- https://infosimples.com/consultas/ieptb-protestos-detalhes-sp/
- https://infosimples.com/consultas/tribunal-tjba-primeiro-grau/
- https://infosimples.com/consultas/tribunal-tjgo-nada-consta/
- https://infosimples.com/consultas/tribunal-tjdf-nada-consta/
- https://infosimples.com/consultas/tribunal-tjms-pedido-cert/
- https://infosimples.com/consultas/tribunal-tjmt-primeiro-grau-pf/
- https://infosimples.com/consultas/tribunal-tjsc-pedido-certidao/
- https://infosimples.com/consultas/tribunal-trt3-ceat/
- https://infosimples.com/consultas/tribunal-trt5-ceat/
- https://infosimples.com/consultas/tribunal-trt9-ceat/
- https://infosimples.com/consultas/tribunal-trt10-ceat/
- https://infosimples.com/consultas/tribunal-trt10-ceat-digital/
- https://infosimples.com/consultas/tribunal-trt12-ceat/
- https://infosimples.com/consultas/tribunal-tjmg-processo/ (apenas consulta processual — não certidão)
- https://infosimples.com/consultas/tribunal-tjpr-processo/ (idem)
