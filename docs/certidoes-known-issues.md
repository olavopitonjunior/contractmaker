# Certidões — Mapa de problemas conhecidos por portal

Registro vivo dos problemas RECORRENTES de cada provedor/portal, para não
re-descobri-los a cada lote. Para cada caso: **sintoma/código → inputs exigidos →
classificação correta → tratamento no código → prevenção**.

Regra de ouro (ver `outcome-classifier.ts`): toda certidão solicitada é tentada;
falha permanente vira `failed_permanent` + `portalUrl` (CTA manual), nunca um
beco sem saída. Transitório agenda retry. Dado ruim NÃO retry (ação do usuário).

Arquivos-chave: `planner.ts` (o que disparar + inputs), `endpoints.ts` (catálogo),
`error-codes.ts` (código→categoria), `outcome-classifier.ts` (categoria→estado +
retry), `normalizers.ts` (extração por endpoint), `executor.ts` (dispatch + poll).

---

## TJSP (e-SAJ) — `tribunal/tjsp/pedido-certidao` (two-step)

| Sintoma | Causa | Tratamento / Prevenção |
|---|---|---|
| **606** "parâmetros obrigatórios" (PF) | falta `rg` | PF sem RG → fallback `pedido-civel` (cível-only) + SkippedJob pedindo RG. **Prevenção:** form coleta RG (recomendação de certidão na guarda híbrida). |
| **606** "o parâmetro 'genero' deve ter os valores 'M' ou 'F'" | `genero` ausente OU mandado como "MASCULINO"/"FEMININO" | `sexoToGenero()` normaliza p/ **"M"/"F"**. Sem sexo → SkippedJob (zero crédito). **Prevenção:** input `sexo` (M/F) no form + recomendação híbrida. |
| **606** nome da mãe | alguns modelos exigem `nome_mae` | form coleta nome da mãe; recomendação híbrida. |
| **604** "não é possível utilizar o mesmo email múltiplas vezes" | cada PF/PJ gera 2 pedidos (modelo 4 + 1); todos com o MESMO `email_envio` → e-SAJ throttla | **Prevenção (2026-06-02):** `email_envio` ÚNICO por pedido via **plus-alias** (`local+token@dominio`, `aliasEmail`/`emailToken` em `planner.ts`). Mantém o MX (não toma 608). Fallback: backoff `rate_limited_email` (jitter por jobId). NÃO classificar como `account_issue` (tripava o breaker de crédito). |
| **608** "preencher com email válido" | e-SAJ valida MX do `email_envio`; domínio morto recusado | usar e-mail real do operador (`dealEmail`); `DEFAULT_EMAIL` configurável com MX vivo. Plus-alias preserva o MX. |
| **620** "já existe pedido em andamento" | re-disparo enquanto o pedido original processa | `isPedidoDuplicado` → `duplicate_pending` (neutro + ETA) OU recupera o protocolo original p/ obter. ATENÇÃO: 620 também é erro de 2FA GOV.BR — gate é a MENSAGEM, não o código. |
| **607** throttle e-mail (variante) | igual ao 604 | mesmo tratamento do 604 (plus-alias). |

`modelo` é NÚMERO: **4** = Cível-Geral SAJ SGC (engloba cível+família+exec. fiscal),
**1** = Falências/Concordatas/Recuperações. `pedido-civel` legado é cível-only.

---

## TRF (Justiça Federal regional) — TRF1/2/4/5/6 individual + TRF3/TRT15 609

| Sintoma | Causa | Tratamento / Prevenção |
|---|---|---|
| **606** "O parâmetro 'birthdate' deve ser preenchido quando o campo 'CPF' for usado" (TRF5 etc.) | o handler do TRF individual em `planner.ts` montava o job PF só com `cpf`+`nome`, SEM `birthdate` (ao contrário de Receita/PGFN/TJSP) → o portal recusava mesmo com a data no formulário | **Fix 2026-06-05:** o handler anexa `birthdate: normalizeDate(parte.data_nascimento)` p/ PF. Validado: TRF5 do vendedor passou de 606 "faltam dados" → success+PDF. O TRF apenas USA a data como input (não cruza contra cadastro — quem cruza é Receita/PGFN). |
| **609** "Tentativas de consultar o site… excedidas" | é **indisponibilidade transitória do portal**, NÃO divergência de dado | **Fix 2026-06-02:** `isPortalUnavailableMessage` roda ANTES do `CODE_MAP` em `mapInfosimplesCodeToCategory` → `portal_unavailable` (retry automático). Antes caía em `inconsistent_input`→`data_invalid` ("corrija os dados") sem retry — enganoso. 609 com mensagem de dado real continua `inconsistent_input`. |

TRF3 é two-step (`pedido` → `obter-certidao`); fica em `awaiting_portal` com 615
quando a fonte está instável. TRF5 usa `tipo_certidao` NUMÉRICO ("1" Cível / "2" Criminal).

---

## Receita Federal / PGFN — `receita-federal/cpf`, `receita-federal/pgfn` (608 / 611)

A Receita exige **CPF + data de nascimento JUNTOS** e cruza a data contra o
cadastro dela (trava antifraude). Quem valida a data é a FONTE, não nós.

| Sintoma | Causa | Tratamento / Prevenção |
|---|---|---|
| **608** "Data de nascimento informada DD/MM/AAAA está divergente da constante na base da RFB" / "diferente da cadastrada" | a data que enviamos NÃO bate com o cadastro da Receita. O dado **FOI enviado**, só não confere — ou a data no form está errada, ou a RFB está desatualizada (ação humana). | **Fix 2026-06-05:** `isDataDivergente` (gate antes do `CODE_MAP`) → `inconsistent_input` → **`data_invalid`** "Dados divergentes" (antes caía em `missing_input`→`data_missing` "faltam dados", enganoso pois o dado existe). UI: *"A data de nascimento DD/MM/AAAA não confere com a base oficial — confira o cadastro da parte"* + CTA **"Corrigir"** (abre EditPartyDialog). Re-rodar NÃO emite — a divergência é real. Vale p/ Receita/PGFN; o gate generaliza qualquer "divergente/não confere" p/ inconsistent_input. |
| **611** "As informações disponíveis na Receita Federal sobre o contribuinte … são insuficientes para emitir a certidão pela Internet." | **NÃO é erro nosso e NÃO é "nada consta".** É a RFB recusando a emissão ONLINE para aquele CPF (situação cadastral não-regular / pendência → balcão). Provado: payload idêntico (`cpf+birthdate+preferencia_emissao`) emite para outros CPFs; `data:[]`, sem PDF, `billable:true`. | **Fix 2026-06-02:** `isReceitaCertidaoNaoEmitida` em `outcome-classifier.ts` → `failed_permanent` + `portalUrl` RFB, com mensagem "Receita não emite online — emita no portal". Custo honesto (RFB cobrou). NÃO é `data_invalid` (não há dado nosso a corrigir). Para **especificar o motivo**, cruzar com `receita-federal/cpf` (Situação CPF). |

Cuidado: o `code_message` genérico da Infosimples ("dados incompletos no site de
origem") fala da ORIGEM (RFB), não do nosso payload — não confundir com erro de
processamento nosso.

---

## Antecedentes Criminais PF — `antecedentes-criminais/pf/emit`

| Sintoma | Causa | Tratamento / Prevenção |
|---|---|---|
| `status:"failed"` "numero_pedido ausente no job pedido" | o endpoint estava marcado `twoStep:true`; o `emit` a 200 já devolve o resultado (não retorna `numero_pedido`), então o poll morria | **Fix 2026-06-02:** removido `twoStep` de `pf/emit` (`endpoints.ts`) → 200 cai no caminho de sucesso normal (normaliza + anexa PDF). O `pollPortalJob` também passou a fechar protocolo ausente como `failed_permanent`+portal (defensivo). |
| **608** "dados (nome/nome da mãe/nascimento) não conferem com o CPF" | divergência cadastral real | **`data_invalid`** "Dados divergentes" (via `isDataDivergente`, fix 2026-06-05) — ação do usuário no EditPartyDialog (CTA "Corrigir"). |

---

## IEPTB / CENPROT (protestos) — `ieptb/protestos`

| Sintoma | Causa | Tratamento / Prevenção |
|---|---|---|
| **615** "A API foi pausada temporariamente… instabilidade na fonte" | instabilidade da fonte gov.br | `portal_unavailable` → retry; esgotado → `failed_permanent`+portal. |
| **603** "consulta não habilitada para a sua conta" | endpoint não habilitado (≠ saldo) | `isEndpointNotEnabled` evita tripar o breaker de crédito da org; vira `account_issue`/`failed_permanent` orientando habilitar. |
| **603** "O token não tem autorização… verifique se não possui limite de uso" em **TODOS** os endpoints | é **saldo zerado da conta Infosimples** (a razão real "A conta está sem saldo" vem no `errors[]`, não no `code_message` genérico) | `account_issue` → tripa o breaker de crédito. **Saldo Infosimples ≠ budget interno do app** (`INFOSIMPLES_MONTHLY_BUDGET_CENTS`): o app pode mostrar gasto baixo e a carteira pré-paga estar zerada. Fix = recarregar no painel Infosimples. UI mostra banner "Conta sem saldo". Re-disparo sem saldo é grátis (não cobra) e inútil. |
| 6xx "não constam protestos" | negativa legítima sem PDF | `isProtestoNadaConsta` → success "nada consta" (exceção consciente ao anti-falso-negativo, gated na mensagem + endpoint). |

---

## ClickSign (assinatura) — formato aceito

| Restrição | Detalhe |
|---|---|
| **Somente PDF** | `clicksign/executor.ts:438-441` valida `mime==="application/pdf"` + magic `%PDF-1.`; envia `data:application/pdf;base64,…`. DOCX/imagens são barrados. Para permitir DOCX seria preciso converter DOCX→PDF antes do envio (não implementado). |
| Signatário sem e-mail não assina | `dealDataToSigners` joga a parte em `missing` sem e-mail. **Prevenção:** `email` do titular é OBRIGATÓRIO no form (preset `padrao`, guarda híbrida 2026-06-02). |

---

## Disparo — trava POR ALVO + "Retentar erros" + unmatched (2026-06-05, PRs #57/#58)

`POST /api/deals/[dealId]/certidoes` (`route.ts`) + helper `lifecycle.ts`:

- **Trava por alvo, não por deal.** Uma certidão lenta não trava as outras. Só
  bloqueia um novo disparo do MESMO alvo (endpoint+parte) quando ele está
  genuinamente em andamento: `pending`/`fetching` recente OU `awaiting_portal`
  **com `numero_pedido`** (`isInProgressBlocking`). Zumbi de awaiting_portal (sem
  protocolo) NÃO bloqueia → retentável. Resposta 202 reporta `skippedInProgress`.
- **"Retentar erros"** (botão na aba): 1 clique re-dispara todos os alvos com
  erro retentável (`isRetryableError`: failed/failed_permanent/data_*/portal_
  unavailable/rate_limited/success-sem-PDF). O backend pula os em andamento.
- **Unmatched tolerante.** Se uma seleção não casa com o planner atual (endpoint
  depreciado/gated — ONR 602, CENPROT sem gov.br), a rota despacha o que casa e
  reporta `unmatched` (toast "N indisponíveis ignoradas"). Antes recusava o LOTE
  INTEIRO com 400 — travava "Retentar erros"/"Só as que faltaram".
- **"Só as que faltaram"** agrega pelo atendimento MAIS RECENTE por alvo (antes
  um zumbi amarelo escondia um erro vermelho — caso TJSP).

## Reprocessamento (operacional, pós-deploy)

- Erros em geral: botão **"Retentar erros"** (ou "Só as que faltaram") na aba
  Certidões — re-disparo determinístico, pula os em andamento, ignora unmatched.
- Antecedentes `failed`: `POST /api/deals/[dealId]/certidoes/bulk-retry { "status":"failed" }` (use `dryRun:true` antes).
- 609 presos em `data_invalid`: re-disparar pelo fluxo "Só as que faltaram" (novo lote → marca o anterior `replaced`); o bulk-retry só aceita `status∈{failed,skipped}`.
- **608 data divergente** (Receita/PGFN): re-rodar NÃO resolve — confira a data de nascimento da parte (CTA "Corrigir") ou a RFB está desatualizada.
- PGFN 611: NÃO reprocessar — encaminhar ao portal RFB (não emite online).
- "Conta sem saldo" (603 em massa): recarregar no painel Infosimples antes de retentar.
