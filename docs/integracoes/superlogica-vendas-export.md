# Exportar venda do Contractmaker para a Superlógica (módulo Vendas)

> Status: **PR 1 (conta + configurações) entregue**; PR 2 (escrita no conector + mapeador),
> PR 3 (exportação: preview, orquestrador, UI) e PR 4 (liquidação/"Comissão paga") a seguir.
> Provas ao vivo na licença `adm037585` em 2026-09-02/03: vendas 744 e 745 criadas por API.

## Decisões (03/09/2026)
- **Gatilho manual:** botão "Enviar para Superlógica" no negócio, a partir de "Contrato assinado".
- **A Superlógica cobra a comissão:** a venda gera as parcelas/boletos lá; o Contractmaker deixa de
  emitir cobrança Asaas para negócios exportados.
- **Comissionado sem par na Superlógica é criado automaticamente** como corretor.

## 1. Configuração (uma vez por imobiliária)
Configurações › Integrações › card **Superlógica** (feature `vendas.superlogica` ligada na org +
permissão `superlogica.configure` — owner/admin por preset; um papel customizado pode recebê-la.
A chave NÃO está na whitelist de override do `gerente`).

**Conectar:** licença (`adm037585`), app token (Superlógica › Usuários › Aplicativos) e access token
da licença. O servidor valida com `GET contratos?itensPorPagina=1` (Imobiliárias) e
`GET caixa?itensPorPagina=1` (Financeiro v2); só grava se ambos responderem. Falha → nada gravado,
audit `SUPERLOGICA_ACCOUNT_CONNECT_FAILED`.

**Padrões da venda** (auto-save):

| Padrão | Fonte | Default | Destino |
|---|---|---|---|
| Conta bancária das parcelas | `GET /v2/financeiro/caixa` → distinct `id_conta_cb` | obrigatório escolher | `ID_CONTABANCO_CB` |
| Filial | fixo | 0 Matriz | `ID_FILIAL_FIL` |
| Conta contábil da comissão a pagar | fixo, editável | `2.2.1` / `Comissões` | `vendas/lancardespesa` (fase 2) |
| Tipo de imóvel padrão | enum `ST_TIPO_IMO` | 4 Apartamento | quando o form não informa |
| Emitir NF / Gerar DIMOB | 0/1 | 0 / 0 | `FL_NOTAFISCAL_VEN` / `FL_DIMOB_VEN` |
| Quem paga os comissionados | 0 Imobiliária / 1 Cliente | 0 | `FL_TIPOPAGAMENTOCOMISSAO_VEN` |
| Comissão recebida de | 0 Vendedor / 1 Comprador | 0 | `FL_TIPORECEBIMENTOCOMISSAO_VEN` (o form sobrescreve) |
| Vencimento padrão (dias) | número | 7 | fallback de `prazo_dias_apos_marco` |
| Teto por exportação | centavos | 5.000.000,00 | bloqueio no preview (consumido no PR 3) |

Armazenamento: `SuperlogicaAccount` (tokens cifrados AES-256-GCM, IV/tag por coluna; padrões como
colunas). Rotas: `api/settings/superlogica` (GET mascarado / POST conectar **ou reconectar** — troca
os tokens preservando os padrões / PATCH / DELETE apaga tudo), `/test` (só rebaixa para `error` se a
Superlógica recusar os tokens; erro de rede mantém a conta e grava `lastError`), `/contas` (até 5
páginas de 200 lançamentos do `caixa`; a tela também aceita o id da conta à mão).

## 2. Transferência (PR 2/3)
### Gatilho e preview
Botão visível se: feature on, `deal.kind === "venda"`, stage ∈ {"Contrato assinado", "Cobrança
emitida"}, sem export `done`, ator com `superlogica.export` e dentro de `dealScopeWhere`.
`POST /api/deals/[id]/superlogica/preview` monta o payload sem escrever e devolve o espelho da tela
da Superlógica + avisos; `POST .../export` executa.

### Mapeamento (`SalesForm.dataJson` `compra_venda_v1` → Superlógica)
**Pessoas** (`vendedores[i]`/`compradores[i]` → `POST proprietarios`; `comissao.comissionados[i]` →
`POST corretores`; antes, `GET pessoas?pesquisa=<doc>` para reutilizar):

| Form | Superlógica | Transformação |
|---|---|---|
| `nome` / `razao_social` | `ST_NOME_PES` | PJ usa `razao_social` |
| `cpf` / `cnpj` | `ST_CNPJ_PES` | só dígitos |
| `rg`, `sexo`, `data_nascimento`, `nacionalidade`, `email`, `mobile_phone` | `ST_RG_PES`, `ST_SEXO_PES` (m→1,f→2), `DT_NASCIMENTO_PES` (MM/DD/YYYY), `ST_NACIONALIDADE_PES`, `ST_EMAIL_PES`, `ST_CELULAR_PES` | |
| `endereco, numero, complemento, bairro, cidade, uf, cep` | `ST_ENDERECO/NUMERO/COMPLEMENTO/BAIRRO/CIDADE/ESTADO/CEP_PES` | cep só dígitos |
| `estado_civil, profissao` | `ST_OBSERVACAO_PES` | cônjuge não vira pessoa |
| vendedor / comprador / comissionado | `FL_PROPRIETARIOBENEFICIARIO_PES=1` / `+FL_COMPRADOR_PES=1` / `FL_CORRETOR_PES=1` | |

**Imóvel** (`imoveis[0]` → `POST imoveis`, dedupe por `ST_IDENTIFICADOR_IMO = cm:<dealId>`):
`rua, numero, complemento, bairro, cidade, uf, cep` → `ST_*_IMO`; `ST_TIPO_IMO` = padrão da org;
`pagamento.valor_total` (fallback `deal.value`) → `VL_VENDA_IMO`; `PROPRIETARIOS_BENEFICIARIOS[]` =
vendedores (`FL_PROPRIETARIO_PRB` -1 no primeiro, fração 100/n).

**Venda** (`POST vendas/put`, form-urlencoded, payload capturado do assistente "Nova venda"):

| Origem | Campo | Regra |
|---|---|---|
| imóvel | `ID_IMOVEL_IMO` | |
| `contractSignedAt` (ou envelope fechado) | `DT_VENDA_VEN` | MM/DD/YYYY |
| `pagamento.valor_total` | `VL_TOTAL_VEN` | ponto decimal |
| `comissao.percentual` / `valor` | `TX_COMISSAO_VEN` / `VL_TOTALCOMISSAO_VEN`, `VL_COMISSAO_VEN` | deriva o que faltar |
| `comissao.quem_paga` | `FL_TIPORECEBIMENTOCOMISSAO_VEN` | vendedor→0, comprador→1 |
| compradores | `VENDAS_COMPRADORES[i]{ID_PESSOA_PES, ST_NOME_PES, FL_COMPRADOR_PES:1, FL_PROPRIETARIOBENEFICIARIO_PES:1, NM_FRACAO_VEC, FL_PRINCIPAL_VEC}` | |
| comissionados | `VENDEDORES[i]{ID_VENDEDOR_VEV=id pessoa, ID_PESSOA_PES:"", ST_NOME_PES, ID_FAVORECIDO_FAV, VL_COMISSAO_ANG=%, FL_VALORCOMISSAO_ANG:1, FL_TIPO_ANG}` | `papel`: captador→0, intermediador→1, indicador→7, imobiliaria_principal→6, outro→9 |
| comissionados + parcela | `COMISSOES[i]{..., FL_DESPESA:0}` **e** `VENDEDORPARCELA1[i]{ID_VENDEDOR_VEV, ID_FAVORECIDO_FAV, ST_FANTASIA_FAV, DT_VENCIMENTO_VEI, VL_ITEM_VEI, NM_PARCELA_VEI}` | é o `VENDEDORPARCELA<n>` que cria o item de comissão (tipo 3) |
| prazo | `NM_PARCELAS:1`, `COMISSAO_PARCELAS[0]{DT_VENCIMENTO_RECB, VL_EMITIDO_RECB, VL_TOTAL_RECB, FL_STATUS_RECB:0}` | vencimento = venda + `prazo_dias_apos_marco` |
| org | `FL_TIPOPAGAMENTOCOMISSAO_VEN, FL_NOTAFISCAL_VEN, FL_DIMOB_VEN, ID_FILIAL_FIL, ID_CONTABANCO_CB` | |

Regras da API já observadas: `vendas/post` (alterar) é **substituição total** (omitir um bloco
cancela o que ele representava); **anti-duplicidade** por imóvel + comprador ("Já existe uma venda…
Venda#N"); a despesa/caixa da comissão **não** nasce no put (fase 2: `vendas/lancardespesa`); tipos de
item: 1 parcela a receber, 2 despesa, 3 comissão; "Excluir" = `vendas/post` com `FL_STATUS_VEN=-1`.

### Sequência (orquestrador)
1. Payload puro + avisos; bloqueantes → 422. 2. `SuperlogicaExport` running (idempotente por deal).
3. Pessoas (link → busca por doc → create), 4. Imóvel, 5. `vendas/put` (duplicidade = sucesso com id
existente), 6. `GET vendas?id` → links/ids, 7. audit + `moveDealStage("Cobrança emitida")` +
`chargeIssuedAt`. Falha → `error` + audit; retomada pula o que já tem link.

## 3. Segurança
- Tokens em repouso AES-256-GCM, só decriptados no handler; GET devolve só metadados; tokens só em
  headers HTTPS, nunca em query string; sem retry automático em POST de criação.
- Feature por org + `superlogica.configure`/`superlogica.export` + `dealScopeWhere` (fail-open
  documentado — testar negativo com `gerente` de outro deal).
- Minimização: só os campos acima saem; `payloadJson` com documentos mascarados + `payloadHash`;
  `responseJson` só ids/valores/status; logs redigidos.
- Audit `SUPERLOGICA_*` (prefixo em `INTEGRATION_ALERT_PREFIXES`). LGPD: base legal = execução do
  contrato; preview só com `privacyAcceptedAt` no form. Teto por exportação; 1 export por negócio.
- Sem sandbox na Superlógica: staging usa os tokens de produção → só negócios "TESTE…" e reversão
  por `FL_STATUS_VEN=-1` ao final.

## 4. Como aparece na Superlógica (o que o preview espelha)
- **Contratos › Vendas › Venda N/cm:<dealId>**: "Vendido em", "Valor", "R$ X em 1 parcela"; extrato
  com a cobrança da comissão (sacado = vendedor ou comprador) e, na fase 2, despesas "Venda N -
  pagamento de Comissões para <corretor>"; Detalhes: Filial, Imóvel, Proprietários, Compradores,
  **Comissionados** com "R$ x (y %)", Observação (negócio, título, matrícula).
- **Receitas:** cobrança em "Cobranças com vencimento em <mês>" na conta escolhida (remessa
  automática registra boleto no banco — por isso a conta é escolha explícita).
- **Pessoas / Corretores / Imóveis:** cadastros com nome, documento, contato e endereço; imóvel com
  identificador `cm:<dealId>`.
- **Contractmaker:** badge "Na Superlógica: venda N" com link, deal em "Cobrança emitida", botão
  Asaas desabilitado, AuditLog.
