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

## TRF3 / TRT15 (CEAT) e similares — código **609**

| Sintoma | Causa | Tratamento / Prevenção |
|---|---|---|
| **609** "Tentativas de consultar o site… excedidas" | é **indisponibilidade transitória do portal**, NÃO divergência de dado | **Fix 2026-06-02:** `isPortalUnavailableMessage` roda ANTES do `CODE_MAP` em `mapInfosimplesCodeToCategory` → `portal_unavailable` (retry automático). Antes caía em `inconsistent_input`→`data_invalid` ("corrija os dados") sem retry — enganoso. 609 com mensagem de dado real continua `inconsistent_input`. |

TRF3 é two-step (`pedido` → `obter-certidao`); fica em `awaiting_portal` com 615
quando a fonte está instável.

---

## Receita Federal / PGFN — `receita-federal/pgfn`, código **611**

| Sintoma | Causa | Tratamento / Prevenção |
|---|---|---|
| **611** "As informações disponíveis na Receita Federal sobre o contribuinte … são insuficientes para emitir a certidão pela Internet." | **NÃO é erro nosso e NÃO é "nada consta".** É a RFB recusando a emissão ONLINE para aquele CPF (situação cadastral não-regular / pendência → balcão). Provado: payload idêntico (`cpf+birthdate+preferencia_emissao`) emite para outros CPFs; `data:[]`, sem PDF, `billable:true`. | **Fix 2026-06-02:** `isReceitaCertidaoNaoEmitida` em `outcome-classifier.ts` → `failed_permanent` + `portalUrl` RFB, com mensagem "Receita não emite online — emita no portal". Custo honesto (RFB cobrou). NÃO é `data_invalid` (não há dado nosso a corrigir). Para **especificar o motivo**, cruzar com `receita-federal/cpf` (Situação CPF). |

Cuidado: o `code_message` genérico da Infosimples ("dados incompletos no site de
origem") fala da ORIGEM (RFB), não do nosso payload — não confundir com erro de
processamento nosso.

---

## Antecedentes Criminais PF — `antecedentes-criminais/pf/emit`

| Sintoma | Causa | Tratamento / Prevenção |
|---|---|---|
| `status:"failed"` "numero_pedido ausente no job pedido" | o endpoint estava marcado `twoStep:true`; o `emit` a 200 já devolve o resultado (não retorna `numero_pedido`), então o poll morria | **Fix 2026-06-02:** removido `twoStep` de `pf/emit` (`endpoints.ts`) → 200 cai no caminho de sucesso normal (normaliza + anexa PDF). O `pollPortalJob` também passou a fechar protocolo ausente como `failed_permanent`+portal (defensivo). |
| **608** "dados (nome/nome da mãe/nascimento) não conferem com o CPF" | divergência cadastral real | `data_missing` (ação do usuário — corrigir no EditPartyDialog). |

---

## IEPTB / CENPROT (protestos) — `ieptb/protestos`

| Sintoma | Causa | Tratamento / Prevenção |
|---|---|---|
| **615** "A API foi pausada temporariamente… instabilidade na fonte" | instabilidade da fonte gov.br | `portal_unavailable` → retry; esgotado → `failed_permanent`+portal. |
| **603** "consulta não habilitada para a sua conta" | endpoint não habilitado (≠ saldo) | `isEndpointNotEnabled` evita tripar o breaker de crédito da org; vira `account_issue`/`failed_permanent` orientando habilitar. |
| 6xx "não constam protestos" | negativa legítima sem PDF | `isProtestoNadaConsta` → success "nada consta" (exceção consciente ao anti-falso-negativo, gated na mensagem + endpoint). |

---

## ClickSign (assinatura) — formato aceito

| Restrição | Detalhe |
|---|---|
| **Somente PDF** | `clicksign/executor.ts:438-441` valida `mime==="application/pdf"` + magic `%PDF-1.`; envia `data:application/pdf;base64,…`. DOCX/imagens são barrados. Para permitir DOCX seria preciso converter DOCX→PDF antes do envio (não implementado). |
| Signatário sem e-mail não assina | `dealDataToSigners` joga a parte em `missing` sem e-mail. **Prevenção:** `email` do titular é OBRIGATÓRIO no form (preset `padrao`, guarda híbrida 2026-06-02). |

---

## Reprocessamento (operacional, pós-deploy)

- Antecedentes `failed`: `POST /api/deals/[dealId]/certidoes/bulk-retry { "status":"failed" }` (use `dryRun:true` antes).
- 609 presos em `data_invalid`: re-disparar pelo fluxo "Só as que faltaram" (novo lote → marca o anterior `replaced`); o bulk-retry só aceita `status∈{failed,skipped}`.
- PGFN 611: NÃO reprocessar — encaminhar ao portal RFB (não emite online).
