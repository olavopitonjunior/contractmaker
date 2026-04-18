# PROMPT DEFINITIVO — QA E2E COMPLETO CONTRACTMAKER

> Você é um QA sênior já autenticado em https://web-zeta-three-4lyvmj9ut6.vercel.app
> Acesso aos seus próprios documentos (RGs, CNHs, matrículas, IPTUs, comprovantes,
> certidão de casamento) já carregados localmente. Sua missão: testar TODAS as
> features e botões do sistema, do upload do primeiro documento até a entrega
> final do contrato. **Este é o teste definitivo** — relate TUDO que encontrar.
>
> URL: https://web-zeta-three-4lyvmj9ut6.vercel.app
> Status: já logado
> Banco de QA: limpo (0 deals/forms de teste — você está partindo do zero)

---

## 0. DISCIPLINA DE EXECUÇÃO (LEIA ANTES DE COMEÇAR)

**Screenshots**:
- Viewport `1280×800`. Nunca use `fullPage: true`.
- Máximo 20 screenshots no total — priorize evidência textual via `read_page`.
- Recovery: se receber erro `image dimensions exceed max 2000 pixels`, redimensione com `resize_window({width: 1280, height: 800})` e tente apenas `read_page` (sem screenshot) por 3 turnos.

**Evidências**:
- Para cada bloco, capture: status HTTP das requisições críticas, valores de campos via `evaluate_javascript`, contagens via `read_page filter:interactive`, IDs gerados via URL/network.
- Salve IDs importantes em variáveis mentais: `DEAL_ID`, `FORM_TOKEN`, `CONTRACT_V1_ID`, `CONTRACT_V2_ID`, `BATCH_ID`.

**ORIGEM DOS DADOS — IMPORTANTE**:

Todos os **dados de pessoas físicas/jurídicas, dados do imóvel, matrícula, IPTU, comprovante de residência** devem ser **EXTRAÍDOS DOS DOCUMENTOS QUE VOCÊ ANEXAR** via OCR do sistema. Não invente nem use persona fictícia para esses campos. O ponto inteiro do teste é validar que o pipeline de extração funciona end-to-end com documentos reais.

**Documentos esperados** (carregue **TODOS** que tiver disponível):
- RG do(s) vendedor(es) — formato JPG/PNG/PDF
- CPF do(s) vendedor(es) — se tiver separado
- CNH do(s) vendedor(es) — alternativa para RG+CPF (extrai ambos)
- **Certidão de casamento** do vendedor casado (PDF) — testa FIX-CC (autofill estado_civil + cônjuge)
- RG/CNH do(s) comprador(es)
- Comprovante de residência das partes (PDF)
- **Matrícula do imóvel** (PDF) — extrai endereço, cartório, descrição, ônus
- **IPTU do imóvel** (PDF) — extrai inscrição IPTU, SQL (em SP), valor venal
- Escritura ou compromisso prévio (se houver)
- Procuração (se houver)
- Documentos adicionais de sócios/avalistas (para diligenciados)

**Anexe TUDO de uma só vez no upload massivo do Bloco 2.1** — isso valida o batch OCR (F5), a distribuição inteligente por CPF (FIX-BB), e o autofill cruzado (cert. casamento → estado_civil + cônjuge).

**Apenas dados que NÃO vêm de documentos** — você preenche manualmente nas etapas correspondentes:
- **Pagamento**: valor total, sinal, FGTS, recursos próprios, alienação fiduciária, forma — invente valores realistas (ex: imóvel R$ 1M, sinal 10%, FGTS 20%, financiamento 70%)
- **Posse**: prazo de entrega, condição (default ok)
- **Comissão**: % e quem paga (default 6% comprador é razoável)
- **Foro**: **escolha "arbitragem"** — testa FIX-006 (template tem `{{#if}}` arbitragem vs justiça pública)
- **Modalidade**: deve auto-detectar como "financiamento" se você preencher `alienacao_fiduciaria > 0` (FIX-001)

**Quando travar**: capture o erro exato (HTTP code, JSON body, console error), tire 1 screenshot da tela travada, **TENTE WORKAROUND** se possível (refresh, retry button, navegação alternativa), e SIGA. Marque como `BLOCKED` apenas quando esgotar todas opções. Reporte SEMPRE no relatório final.

**Cobertura de UF para certidões**: o sistema tem integração Infosimples real para **SP / RJ / RS**. Se seus documentos apontarem para outra UF (MG, PR, etc.), o sistema só vai gerar certidões federais (PGFN, CNDT, TRF Cível) e você terá menos certidões para testar. **Idealmente use documentos de SP** (mais cobertura: TJSP + TRT2 + TRT15 + CENPROT + IPTU SP). Se for RJ, terá TJRJ + TRT1 + IPTU RJ. Se RS, TJRS + TRT4. Se outro UF, **use o picker "+ Adicionar outras"** para forçar testes de extras (Bloco 6.4).

---

## 1. SETUP — CRIAÇÃO DO FORMULÁRIO

### 1.1 Pipeline e novo formulário
1. Navegue para `/forms/new`
2. Título: `[QA DEFINITIVO 16/04] Venda Jardins`
3. Descrição: `E2E completo — upload, OCR batch, certidões com diligenciados, dialog interativa, notificações`
4. Crie o formulário
5. **Capture**: `FORM_TOKEN` da URL `/f/{token}` retornada
6. Abra o link `/f/{FORM_TOKEN}` em nova aba

**Esperado**: form aberto na **Etapa 1 de 8 — Documentos**. Step indicator visível.

### 1.2 Dropzone visual e estado inicial
- Confirme: dropzone "Clique ou arraste arquivos aqui — JPG, PNG, WebP ou PDF — até 10 MB por arquivo"
- Botão "Aplicar aos campos (0)" deve estar **disabled**
- Não deve haver cards visíveis ainda

---

## 2. UPLOAD MASSIVO + OCR EM BATCH (F5)

### 2.1 Upload de 6 documentos simultâneos
Use o input file (multiple) para selecionar **6 arquivos de uma vez**:
- 1 RG do vendedor (imagem JPG/PNG)
- 1 CNH do comprador (imagem ou PDF)
- 1 Certidão de Casamento do vendedor (PDF) — **se tiver**, senão pule e use estado civil manual
- 1 Matrícula do imóvel (PDF)
- 1 IPTU do imóvel (PDF)
- 1 Comprovante de residência (qualquer parte)

**Validação F5**:
1. Toast aparece: `"Processando 6 documentos em paralelo…"`
2. Network tab: confirme **`POST /api/forms/{token}/attachments`** chamado **4 em paralelo** (UPLOAD_CONCURRENCY=4), depois mais 2
3. Após uploads, confirme **`POST /api/forms/{token}/attachments/batch-extract`** — deve haver **2 chamadas** (3 docs cada, `BATCH_MAX_SIZE=3`), **NÃO 6 chamadas individuais** de `/extract`
4. Cards aparecem com status "Analisando…"
5. Em ≤90s todos viram `ready` (vs ~150-300s antes)

**Capture**:
- Quantas chamadas `batch-extract` ocorreram
- Latência total (start do upload → último card ready)
- Se houve algum 500/429 do Gemini

### 2.2 Cache de duplicata
1. Faça upload do **MESMO RG do vendedor de novo** (re-selecione o arquivo)
2. Esperado: card extra criado, status "Analisando…" muito breve
3. Network: `POST /batch-extract` retorna `cached: true, cacheSource: "content_hash"` — **zero chamada Gemini para esse doc**
4. Remover o duplicado clicando no X do card

**Capture**: tempo do segundo OCR vs primeiro (deve ser ≤2s vs ≥15s).

### 2.3 Falha proposital + retry visível
1. Faça upload de um arquivo intencionalmente ruim (imagem 50×50px, PDF corrompido, ou TXT renomeado para .pdf)
2. Esperado: card vermelho com **mensagem amigável** (não JSON bruto):
   - PDF inválido → "PDF inválido ou corrompido — header ausente"
   - Imagem pequena → "Imagem muito pequena para OCR. Use um scan de pelo menos 300 DPI"
3. Botão **"Tentar novamente"** + botão **"Remover"** **AMBOS visíveis** dentro do bloco vermelho (não só link sublinhado)
4. Clique "Remover" → card some, DELETE 200

### 2.4 Distribuição inteligente por CPF (FIX-BB)
Verifique no card de cada documento de pessoa o valor do dropdown de assignment:
- RG do vendedor → `Vendedor 1 — {nome OCR}`
- CNH do comprador → `Comprador 1 — {nome OCR}` (CPF diferente do vendedor)
- NÃO devem todos cair em "Vendedor 1"

**Capture**: assignment auto-sugerido de cada card.

### 2.5 Dropdown agrupado + "+ Novo vendedor"
1. Abra o dropdown de assignment de qualquer card
2. Confirme grupos via `<optgroup>`: **Vendedores / Compradores / Imóveis / Outros**
3. Cada grupo tem entrada `+ Novo vendedor` (ou comprador/imóvel)
4. Selecione "+ Novo vendedor" em um doc qualquer
5. Esperado: toast "Vendedor 2 criado", assignment vira "Vendedor 2"
6. Volte o assignment para a opção correta

### 2.6 Aplicar aos campos
1. Clique **"Aplicar aos campos (N)"**
2. Toast: `"N documento(s) aplicado(s) — M campo(s) preenchido(s)"`
3. Confirme N PATCH 200 em `/api/forms/{token}/attachments?id=…`

---

## 3. ETAPAS 2-8 DO FORMULÁRIO

### 3.1 Etapa 2 — Vendedor (validar autofill do OCR)
Avance para Etapa 2. **Compare cada campo com o documento original** que você anexou:

| Campo | Origem esperada | Validar |
|---|---|---|
| Nome completo | RG/CNH/Cert. casamento | Match exato (nome + acentos) |
| CPF | RG/CPF/CNH | 11 dígitos, sem pontuação salva |
| RG | RG físico | Número + órgão expedidor |
| Data nascimento | RG/CNH | Formato YYYY-MM-DD |
| Naturalidade | RG/CNH | Cidade + UF |
| Filiação mãe/pai | RG/CNH | Match com documento |
| Endereço (rua/numero) | Comprovante residência | Match razoável (OCR pode separar mal) |
| Bairro/cidade/UF/CEP | Comprovante | UF deve ser 2 letras maiúsculas |

**FIX-CC (certidão de casamento)**: se anexou cert. casamento:
- Estado civil deve mostrar "Casado(a)" **autopreenchido** (não default "Solteiro(a)")
- Seção "Dados do Cônjuge" deve aparecer condicionalmente
- "Nome do Cônjuge *" e "CPF do Cônjuge *" devem ter o **asterisco vermelho** (FIX-007)
- Os 2 campos devem estar **preenchidos com dados do cônjuge 2** da certidão (extraído via fields `conjuge2_nome` + `conjuge2_cpf`)

Se OCR errou algum campo, **anote no relatório como bug do OCR** (não corrija silenciosamente). Só corrija manualmente se o valor errado bloquear avançar para a próxima etapa.

**Capture**: para cada vendedor, registrar quais campos foram autopreenchidos vs vazios.

### 3.2 Etapa 3 — Comprador
Mesmo processo de validação que 3.1. **Validação crítica**:
- Comprador deve ter **CPF diferente** do vendedor (FIX-BB — distribuição por CPF)
- Se autofill colocou comprador como vendedor[1] em vez de comprador[0], é bug — confirmar manualmente atribuição na Etapa 1 e re-aplicar

### 3.3 Etapa 4 — Imóvel (validar autofill da matrícula + IPTU)

| Campo | Origem | Validar |
|---|---|---|
| Logradouro / número | Matrícula | Match exato |
| Bairro / cidade / UF / CEP | Matrícula | UF crítico para roteamento de certidões |
| Matrícula (número) | Matrícula | Numérico, sem pontuação |
| Cartório | Matrícula | Nome completo do cartório |
| Inscrição IPTU | IPTU | Numérico |
| **SQL (Setor-Quadra-Lote)** | IPTU SP | **Crítico se UF=SP** — sem isso CND IPTU SP é skipped |
| Inscrição municipal | IPTU RJ | **Crítico se UF=RJ** — sem isso IPTU RJ é skipped |
| Descrição do imóvel | Matrícula | Texto livre, OCR provavelmente trunca |
| Área total | Matrícula | Em m² |

Se SQL ou inscrição municipal não foi extraído mas está no documento, **reportar bug do OCR**. Em produção, sem esse campo o usuário fica preso na hora de extrair certidões municipais.

### 3.4 Etapa 5 — Status
Default "Quitado e Registrado". Aceitar (ou ajustar conforme realidade dos docs).

### 3.5 Etapa 6 — Pagamento ⚠️ (preenchimento manual + validação BUG-NEW-001)

**Não há documento OCR para pagamento** — preencha valores realistas baseados no que faz sentido para o imóvel detectado pelo OCR. **Sugestão de proporções** (ajuste à realidade dos seus docs):

| Campo | Sugestão (% do total) | Notas |
|---|---|---|
| Valor Total da Venda | 100% | escolha um valor coerente com o imóvel |
| Sinal / Arras | 5-15% | obrigatório > 0 |
| Recursos Próprios | 10-30% | opcional |
| FGTS | 5-20% | opcional |
| Alienação Fiduciária / Financiamento | 40-70% | **obrigatório > 0 para FIX-001** (modalidade=financiamento) |
| Forma de Pagamento | "Financiamento Bancário" | |

**Importante**: a soma dos valores parciais deve **bater** com o Valor Total. O sistema mostra banner de validação.

**IMPORTANTE para FIX-001**: para testar a auto-detecção de modalidade financiamento, o campo "Alienação Fiduciária / Financiamento" **DEVE ser maior que zero**. Sem isso, o template gerado será "À Vista" em vez de "Financiamento".

**Validação crítica BUG-NEW-001**:
1. Preencha 1 campo, mude foco, verifique visualmente se o valor exibido bate com o label
2. Faça isso para os 6 campos
3. **Após preencher tudo**, confirme banner verde no rodapé: "Soma das parcelas: R$ X / Valor total: R$ X" (deve bater)
4. Se aparecer banner vermelho "Faltam R$ Y" ou os valores estiverem trocados entre campos, **REPORTAR BUG-NEW-001 reincidente** com screenshot

**Verificação adicional**: após salvar a etapa, abra o form via `evaluate_javascript` para confirmar que os valores no estado interno (`form.getValues('pagamento')`) batem com os labels visuais.

### 3.6 Etapas 7-8 — Posse e Comissão
- **Posse**: Quitação total, prazo 30-60 dias (escolha conforme realista)
- **Comissão**: 5-6% do valor total (ex: R$ 50.000-60.000), pagador "Comprador" ou "Vendedor"
- **Foro**: **OBRIGATÓRIO escolher "arbitragem"** para validar FIX-006 — o template deve renderizar cláusula com TASP/ACORDIA, não "foro da situação do imóvel"

### 3.7 Finalizar formulário
1. Clique "Finalizar"
2. Toast "Formulário Concluído!"
3. Redireciona para `/deals/{DEAL_ID}` (ou pipeline)
4. **Capture `DEAL_ID`** da URL
5. Network: `PATCH /api/forms/{token}` retorna 200 + `POST /api/pipeline/deals/{DEAL_ID}/generate-contract` chamado em background
6. Aguarde redirect ou navegue manualmente

---

## 4. KANBAN E DEAL DETAIL

### 4.1 Pipeline
1. Vá para `/pipeline`
2. Confirme: card do deal aparece em "Novos" (ou stage default)
3. Card mostra: título, valor R$ 980.000, vendedor, comprador, endereço

### 4.2 Deal detail — abas
Acesse `/deals/{DEAL_ID}`. Confirme as 4 abas:
- **Dados** — dados do form
- **Contrato** — versão V1 já gerada automaticamente
- **Documentos** — agrupados por parte
- **Certidões** — ainda vazio

### 4.3 Aba Documentos (FIX-B)
1. Clique aba "Documentos"
2. Confirme docs do upload aparecem agrupados:
   - "Parte Vendedora (X)" — RG/CNH/cert casamento do vendedor
   - "Parte Compradora (X)" — CNH do comprador
   - "Imóvel (X)" — matrícula + IPTU
3. Cada card tem: thumbnail (clicável → preview), categoria badge, % confiança, fields extraídos

---

## 5. CERTIDÕES — DILIGENCIADOS (F3) — ANÁLISE DETALHADA

### 5.1 Conceito + objetivo do bloco
**Diligenciados** são pessoas externas ao contrato (sócios de PJ vendedora, avalistas, procuradores) cujas certidões precisam ser puxadas para due diligence sem entrar no array `vendedores`/`compradores` do contrato. Cenário típico: vendedor é uma LTDA, banco exige certidões dos sócios.

**Objetivo**: validar que o CRUD funciona, que diligenciados aparecem como targets na dialog de extração, e que as certidões pessoais (PGFN, CNDT, TRF Cível, CEAT regional) são geradas para eles.

### 5.2 Estado inicial
1. Aba **Certidões** → seção "Pessoas diligenciadas (0)" deve aparecer **no topo** (acima do botão "Extrair certidões"), colapsável (chevron)
2. Texto explicativo dentro: "Use esta seção para adicionar pessoas externas ao contrato (sócios de PJ, avalistas, procuradores) cujas certidões devem ser extraídas para due diligence."
3. Network: `GET /api/deals/{DEAL_ID}/diligenciados` retorna `{items: []}`

### 5.3 Adicionar diligenciado PF (sócio do vendedor)
1. Click **"+ Adicionar pessoa"**
2. Modal `DiligentedPersonDialog` abre com título "Adicionar pessoa diligenciada"
3. **Confirme campos do form**:
   - Tipo de pessoa (dropdown: Física / Jurídica)
   - Nome completo / Razão social *
   - CPF * (aparece quando Física selecionado)
   - Data de nascimento (PGFN exige) — input type=date
   - UF (dropdown: -- / SP / RJ / RS / MG / PR / SC / BA / DF / OUTRO)
   - Cidade
   - Relação (dropdown: Sócio / Avalista / Procurador / Cônjuge / Outro)
   - Observações
4. Preencha:
   - Tipo: **Física**
   - Nome: nome ficcional plausível (ex: "CARLOS EDUARDO MARQUES")
   - CPF: **CPF VÁLIDO** (com checksum correto, senão Infosimples rejeita) — pode usar gerador online
   - Data nascimento: data plausível (ex: 1965-03-10)
   - UF: **MESMO UF DO VENDEDOR** detectado nos docs (para garantir cobertura estadual; se docs são SP, use SP)
   - Cidade: capital ou cidade do UF escolhido
   - Relação: **Sócio**
   - Notas: "Sócio fictício — teste E2E"
5. Click "Adicionar"
6. Network: `POST /api/deals/{DEAL_ID}/diligenciados` retorna `201` + `{item}`
7. Toast: "Pessoa adicionada à due diligence"
8. Modal fecha
9. Card aparece na seção com badges: nome, "PF" + "Sócio", CPF formatado, UF, cidade, data nascimento
10. Badge contagem da seção: "(1)"

### 5.4 Adicionar diligenciado PJ (empresa avalista)
1. Click "+ Adicionar pessoa" novamente
2. Tipo: **Jurídica**
3. Form deve trocar: campo CNPJ aparece (campo CPF some, data nascimento some)
4. Preencha:
   - Nome: razão social plausível (ex: "EMPRESA AVALISTA TESTE LTDA")
   - CNPJ: **CNPJ VÁLIDO** (com checksum, gerador online OK)
   - UF: **mesmo do vendedor** detectado nos docs
   - Relação: **Avalista**
5. Click "Adicionar" → 201
6. Card aparece, badge "(2)"

### 5.5 Validação delete-aware (proteção)
1. **Teste de proteção**: NÃO delete agora — você usará esses diligenciados no Bloco 6
2. Após o Bloco 6 (extração já rodou), tente deletar um diligenciado que tem certidão extraída
3. Esperado: `DELETE` retorna `409` com erro "Esta pessoa já tem certidões extraídas. Não pode ser removida — os jobs ficariam órfãos."
4. Confirme toast vermelho com a mensagem
5. Card permanece na lista

**Capture**: número de diligenciados adicionados, IDs gerados.

---

## 6. CERTIDÕES — DIALOG INTERATIVA (F2) — ANÁLISE DETALHADA

### 6.1 Abertura e carregamento
1. Click **"Extrair certidões"** (botão principal)
2. Dialog abre com loading spinner: "Calculando plano de extração…"
3. **Network crítico**: `GET /api/deals/{DEAL_ID}/certidoes/plan?full=1`
4. Response esperado:
   ```
   {
     plan: { jobs: [...], skipped: [...], totalCostCents: N },
     expandedPlan: { jobs: [...todos UFs] },
     spend: { spentCents, budgetCents, exceeded },
     diligenciados: [...],
     catalog: [...18 endpoints com metadata],
     catalogMeta: { ufs: ["SP","RJ","RS"], categories: [...] }
   }
   ```
5. Capture: `plan.totalCostCents`, `plan.jobs.length`, `plan.skipped.length`

### 6.2 Estrutura agrupada — VALIDAR TODOS OS GRUPOS
Confirme **um grupo por target** com header colorido (bg-muted/30):

Grupos esperados (depende dos seus dados):
- **Vendedor 1: {nome do OCR}** — com auto-suggested certidões pessoais
- **Vendedor 2: {nome}** (se houver casal vendedor)
- **Comprador 1: {nome do OCR}**
- **Comprador 2: {nome}** (se houver casal comprador)
- **Imóvel 1: {endereço do OCR}** — auto-suggested CENPROT + IPTU + TJ
- **Diligenciado 1: CARLOS EDUARDO MARQUES** (do Bloco 5)
- **Diligenciado 2: EMPRESA AVALISTA TESTE LTDA**

**Para cada grupo, validar quais certidões auto-aparecem** (depende do UF):
- **Vendedor PF SP**: PGFN, CNDT, TRF Cível, CEAT TRT2, CEAT TRT2 digital, CEAT TRT15, TJSP Cível pedido
- **Vendedor PF RJ**: PGFN, CNDT, TRF Cível, CEAT TRT1, TJRJ Cível pedido
- **Vendedor PJ**: PGFN (com CNPJ), CNDT, TRF, CEAT (CNPJ), TJ
- **Imóvel SP**: CENPROT SP (responsável = primeiro vendedor), CND IPTU SP (se tem SQL)
- **Imóvel RJ**: Cert. Tributária + CND Municipal RJ (se tem inscrição municipal)

**Capture**: liste por grupo quantas certidões auto-marcadas.

### 6.3 Certidões puladas (skipped) — análise
Se houver seção amarela "Pulando por falta de dados (N)":
- Liste cada uma com motivo
- Cenários comuns:
  - PGFN PF sem `data_nascimento` → "PGFN exige data de nascimento da pessoa fisica"
  - IPTU SP sem `sql` → "IPTU SP exige SQL (Setor-Quadra-Lote) do imovel"
  - IPTU RJ sem `inscricao_municipal` → "IPTU RJ exige Inscricao Municipal"
  - PJ com CPF/CNPJ inválido → "documento invalido"

**Capture**: lista exata de skipped com motivo. Se um campo está no documento original mas o OCR não extraiu, é bug.

### 6.4 Botões de controle
Teste cada botão e capture comportamento:

1. Click **"Plano padrão"**:
   - Marca todas as auto-sugeridas
   - Total atualiza
   - Network: nenhum (apenas state local)

2. Click **"Desmarcar"** (atalho ghost):
   - Todas viram off
   - Botão "Extrair" fica **disabled** + label "Extrair 0 selecionadas"

3. Click **"Marcar todas"**:
   - Inclui todas + extras (se já adicionou alguma)

4. Toggle individual em uma certidão específica:
   - Total no rodapé recalcula em ms
   - Estado persistido só localmente até confirmar

### 6.5 Picker de extras (F1) — análise EXAUSTIVA
**Cenário forçado para validar TODOS os filtros**:

1. Em **Imóvel 1**, click **"+ Adicionar outras"**
2. Modal `ExtraCertidaoPicker` abre com título "Adicionar certidões extras"
3. **Validar layout**:
   - Campo de busca por label (input text)
   - Dropdown UF (default "Todas UFs", opções: SP / RJ / RS)
   - Dropdown categoria (default "Todas categorias", opções: Federal / Cível / Trabalhista / Fiscal / Protesto / Municipal)
   - Lista agrupada em 3 seções: **Federal** / **Estadual** / **Municipal**
   - Cada item: checkbox + label + badge UF + badge custo R$
   - Itens já selecionados aparecem **disabled** com badge "já selecionada"

4. **Teste filtros isoladamente**:
   - **Filtro 1**: Categoria=Cível, UF=todas → deve mostrar TRF (Federal Cível) + TJSP + TJRJ + TJRS
   - **Filtro 2**: Categoria=todas, UF=RJ → deve mostrar CEAT TRT1 + TJRJ + IPTU RJ + CND Municipal RJ
   - **Filtro 3**: Categoria=Trabalhista → CNDT + TRT2 (físico+digital) + TRT15 + TRT1 + TRT4
   - **Filtro 4**: Busca "trf" → só "Certidao Civel Justica Federal"
   - **Filtro 5**: UF=SP + categoria=Municipal → só "CND IPTU Sao Paulo"

5. **Cenário cruz-UF**: filtre UF=RJ, marque "TJRJ Cível pedido" e "Cert. Tributária IPTU RJ"
6. Click "Adicionar (2)"
7. Modal fecha, **2 cards extras aparecem no grupo Imóvel 1** com:
   - **Fundo azul claro** (`bg-blue-50/30`) + borda azul
   - Badge "extra" pequena
   - Botão X para remover individualmente
8. Total no rodapé sobe pelos 2 custos

**Capture**: liste todos os endpoints disponíveis no picker (deve haver ~17 — 18 totais menos os "obter-*" 2-step internos).

### 6.6 Adicionar extras para diligenciados também
Repita o picker para **Diligenciado 1 (CARLOS)**:
1. Click "+ Adicionar outras" no grupo do diligenciado
2. Marque qualquer certidão pessoal extra
3. Confirme aparece no grupo certo

### 6.7 Remover extra individual
Click no X de um dos extras adicionados em 6.5. Card some, total recalcula.

### 6.8 Confirmar extração — sem limite de custo
**ZERO LIMITE DE CUSTO**: marque **TUDO** que conseguir — quanto mais certidões rodarem, melhor o teste. Inclua:
- Todas as auto-sugeridas
- Pelo menos 2-3 extras de outras UFs (do picker)
- Diligenciados completos

1. Click **"Extrair N selecionadas"** (botão verde, ícone CheckCircle)
2. **Network**: `POST /api/deals/{DEAL_ID}/certidoes`
3. Body deve conter:
   ```json
   {
     "batchId": "uuid",
     "jobs": [
       { "endpoint": "...", "targetKind": "vendedor", "targetIndex": 0 },
       { "endpoint": "...", "targetKind": "diligenciado", "targetIndex": 0 },
       ...
     ]
   }
   ```
4. Response: `202 Accepted` com `{batchId, jobCount, skipped, totalCostCents}`
5. **Capture `BATCH_ID`**
6. Toast "Iniciando N certidões…"
7. Dialog fecha automaticamente
8. **Capture `totalCostCents` final** para o relatório

### 6.9 Idempotência (FIX-K)
Imediatamente após confirmar, **antes do batch terminar**, abra o dialog novamente e tente confirmar mais uma extração. Esperado:
- Response: **409 Conflict**
- Erro: "Ja existe uma extracao em andamento para este negocio. Aguarde a conclusao ou use o botao de recuperar travadas."
- Toast vermelho mostra a mensagem
- Cliente NÃO duplica jobs

---

## 7. PROGRESSO + AÇÕES DA TAB CERTIDÕES — ANÁLISE EXAUSTIVA

### 7.1 Polling em ação
1. Cards aparecem com loading spinner azul (`Loader2 animate-spin`)
2. Network: `GET /api/deals/{DEAL_ID}/certidoes?batchId={ID}` chamado a cada **2 segundos**
3. **Capture timestamps** das transições de pelo menos 3 jobs:
   - `pending` → `fetching` (quando o batch worker pega o job)
   - `fetching` → `success` / `failed` / `awaiting_portal` (quando Infosimples responde)
4. Polling para automaticamente quando todos jobs estão em estado terminal OR após 10min

**Esperado por endpoint** (ordem de grandeza):
- PGFN: 4-10s (rápido)
- CNDT: 8-15s
- TRF Cível: 30-60s (consulta os 6 TRFs em sequência)
- CEAT TRT2/TRT15/TRT1/TRT4: 10-90s
- TJSP pedido: 4-10s → vai para `awaiting_portal` (até 15min para sair)
- TJRJ pedido: 4-10s → `awaiting_portal` (até 8 dias úteis)
- TJRS: 5 chamadas (uma por tipo) ~30-60s cada
- CENPROT SP: 60-1000s (lento — pode estourar timeout)
- IPTU SP/RJ: 8-30s

### 7.2 Stats card — análise dos números
Confirme card no topo logo após a extração começar:
```
N/M sucesso · X falhas · Y aguardando portal · Z em andamento · K pulado(s) · R$ W gasto · Latência mediana Vs
```

**Validar números**:
- `M` (total visível) = N° de jobs criados, NÃO inclui jobs com status `replaced`
- `Y aguardando portal` = jobs `awaiting_portal` (TJSP/TJRJ pedidos)
- Latência usa **mediana com filtro de outliers** (FIX-V), não média simples
- Se aparece outlier de 1000s+ (CENPROT travado), latência mediana ainda deve mostrar ~20-30s

### 7.3 Card success — TODAS as ações individuais (FIX-NEW-006)
Em um card com `status=success` e `attachmentId` populado, valide **5 ícones** visíveis na ordem:

| Ícone | Tooltip | Ação esperada |
|---|---|---|
| 👁 Eye | "Ver detalhes" | Abre `CertidaoDetailDialog` |
| 🔗 ExternalLink | "Abrir PDF" | `<a target="_blank" href="/api/deals/{id}/attachments/{attId}/file">` — abre nova aba |
| ⬇ Download | "Baixar PDF" | `<a href="/api/deals/{id}/attachments/{attId}/file?download=1">` — força download |
| 🔄 RefreshCw | "Tentar novamente" | Aparece se status=failed OU se for caso edge (success sem attachment) |
| 🗑 Trash | "Remover" | DELETE — disabled durante a operação, depois card some |

**Capture**: para 1 card success, faça print da row de ícones e teste cada um.

### 7.4 Modal de detalhes — TODAS as seções (FIX-R)
1. Click no card success (clicável inteiro, exceto botões)
2. Modal `CertidaoDetailDialog` abre, header com:
   - Ícone status (CheckCircle verde / XCircle vermelho / Clock azul para aguardando_pdf / Clock âmbar para awaiting_portal)
   - Label da certidão completo
3. **Conteúdo esperado**:
   - **Badges**: situação colorida + "Retries: N" (se >0) + "Código H" (se resultCode existe)
   - **Grid de metadados** (rounded box):
     - Endpoint (font-mono)
     - Criado em (data+hora pt-BR)
     - Emissão (dd/mm/yyyy) — se resultData.emissao existe
     - **Validade** em verde (dd/mm/yyyy) — se resultData.validade existe
     - Latência (Ns)
     - Custo (R$ X,XX)
   - **Seção Detalhes** (texto livre — pode ter "Negativa nos 6 TRFs" etc.)
   - Se errorMessage existe: box vermelho com erro
   - **Iframe PDF** com altura `60vh` mostrando o PDF inline
   - Toggle **"Ver dados técnicos (JSON)"** — expande `<pre>` com `resultData` formatado
4. **Footer com botões**:
   - "Nova aba" (ExternalLink)
   - "Baixar" (Download)
   - "Tentar novamente" (se aplicável)
   - "Remover" (vermelho)
5. Teste cada botão. Confirme que "Remover" no modal fecha o modal E remove o card

### 7.5 Validade no card (FIX-F)
- Cards success exibem `"Válida até dd/mm/yyyy"` em verde no rodapé do metadado
- Se resultData não tem validade, NÃO renderiza linha vazia
- **Validar**: para PGFN/CNDT/CEAT, validade é tipicamente 30-180 dias da data de emissão

### 7.6 Aguardando PDF (FIX-W) — caso TRF
**Cenário esperado**: TRF Cível Justiça Federal frequentemente retorna `aguardando_pdf` (situação válida com PDF ainda em geração).

Se algum job tiver `resultData.situacao === "aguardando_pdf"`:
- **Badge AZUL** com texto "Negativa · aguardando PDF" (não "Indeterminado" — esse era o bug)
- Ícone do card é **Clock azul** (não Loader2 spinner)
- Conta como **success** nos stats
- Aparece como negativa no relatório PDF mas com sub-contagem "(das quais N aguardando PDF)"

### 7.7 Effective status (proteção contra ghost data) — FIX-T/effectiveStatus
**Cenário difícil de provocar mas crítico**: às vezes o backend escreve `resultData` mas o status fica em `fetching` por race condition.

**Verificar via console**: abra DevTools, faça `JSON.stringify(window.__lastJobs)` ou inspect React DevTools no `useCertidoesBatch.jobs`:
- Para qualquer job com `resultCode === 200` e `resultData.situacao` em terminal state, o effectiveStatus deve ser `"success"` na UI mesmo se o `status` cru for `"fetching"`
- Card NÃO deve mostrar "Consultando…" se há dados válidos

**Em condições normais isso não acontece** — apenas em recovery após crash. Se observar, REPORTAR.

---

## 8. RECUPERAR TRAVADAS + RETRY EXPANDIDO + COMPLEMENTAR — ANÁLISE COMPLETA

### 8.1 Cenário "Recuperar travadas" (FIX-T + FIX-U)
**Como provocar**: nem sempre você terá travados, mas geralmente aparecem se:
- CENPROT SP demora >1000s
- TJSP awaiting_portal vencido
- Container Vercel reciclou no meio de um batch grande

Se `stats.stuck > 0` ou `stats.ghostPromotable > 0`:
1. Botão **"Recuperar travadas (N)"** aparece em âmbar (border-amber-300)
2. Tooltip: "N já têm resultado válido e serão promovidas sem custo" OU "Marca como falha e libera botão de retry"
3. Click
4. Network: `POST /api/deals/{DEAL_ID}/certidoes/sweep` retorna `{promoted, failed, swept}`
5. **Toast contextual**:
   - Se promoted+failed: "X já resolvidas promovidas para sucesso; Y realmente falhas marcadas"
   - Se só promoted: "X tinha(m) resultado válido no banco — visualização atualizada sem novas chamadas"
   - Se só failed: "X marcada(s) como falha. Clique em tentar novamente em cada card."
6. Cards atualizam em ~2s

### 8.2 Retry de failed (FIX-S — limpa stale data)
1. Em qualquer card `failed`, click ícone `RefreshCw`
2. Network: `POST /retry` retorna `202 {action: "re_execute"}`
3. **Validação crítica FIX-S**:
   - Antes do retry: card pode mostrar resultData antigo (de tentativa anterior bem-sucedida que foi órfã)
   - Durante retry: card vira `pending` → `fetching`
   - Card NÃO mostra mais o "Negativa" antigo enquanto está `fetching` (resultData foi limpo)
   - Se retry tiver sucesso: card mostra novo resultData
4. retryCount incrementa (visível no modal de detalhes ou no metadado se >0)

### 8.3 Limite de retry (FIX-L)
Force 3 retries no MESMO job:
1. Retry 1 → 202 ok
2. Espere completar (success ou failed)
3. Se failed, retry 2 → 202 ok
4. Espere
5. Retry 3 → 202 ok
6. Espere
7. **Tente retry 4** → esperado: **`429 Too Many Requests`** com erro "Limite de 3 tentativas atingido. Delete o job ou resolva manualmente."
8. Toast vermelho mostra a mensagem

### 8.4 Awaiting portal — buscar agora (FIX-N)
Para jobs `awaiting_portal` (TJSP/TJRJ):
1. Card mostra "Aguardando portal" em **amarelo**
2. Ícone do botão de retry vira `CalendarClock` (não `RefreshCw`)
3. Tooltip: "Buscar agora no portal"
4. Click
5. Network: `POST /retry` retorna `{action: "poll_portal"}` — **sem nova chamada Infosimples** (reutiliza `numero_pedido`)
6. Backend invoca `pollPortalJob` em vez de `runSingleJob`
7. Se ainda não pronto, status fica em `awaiting_portal` com `expectedReadyAt` adiado conforme heurística adaptativa (TJSP 30min/2h, TJRJ 6h/24h)

### 8.5 Re-baixar comprovante (success sem attachment) (FIX-N caso 4)
Cenário raro: job com `status=success` mas `attachmentId=null` (storage falhou silenciosamente).
1. Em tal card, ícone retry deve aparecer com tooltip "Re-baixar comprovante"
2. Click → `POST /retry` retorna `{action: "re_attach"}`
3. Sem custo de API (re-baixa do `_rawReceipt` salvo)

### 8.6 Skipped + complementar (FIX-O) — análise detalhada
**Cenário**: PGFN PF foi pulado por falta de `data_nascimento`.

1. Card skipped tem ícone `SkipForward` cinza, label "Pulado — dados faltantes" + motivo
2. Botão `FileText` aparece — tooltip "Complementar dados"
3. Click
4. **Form expande inline DENTRO do card** (não modal):
   - Box rounded com borda muted
   - Texto: "Preencha os dados abaixo para desbloquear esta certidão."
   - Para cada campo missing, label específico + input tipado:
     - "Data de nascimento — {nome do vendedor}" → `type="date"` placeholder "AAAA-MM-DD"
     - "SQL (Setor-Quadra-Lote) — {imóvel}" → text placeholder "000.000.0000-0"
     - "Inscrição Municipal — {imóvel}" → text
   - Botões "Cancelar" + "Consultar certidão"
5. Preencha o(s) campo(s)
6. Click "Consultar certidão"
7. Network: `POST /api/deals/{DEAL_ID}/certidoes/{jobId}/complete`
8. Body: `{fields: {"vendedores.0.data_nascimento": "1970-05-15"}}`
9. Response: `202 {ok: true, newJobId: "..."}`
10. Toast: "Dados complementados — consultando…"
11. **Validar**:
    - Card antigo (skipped) vira `replaced` — fica esmaecido, sai da lista visível (filtro `j.status !== 'replaced'`)
    - **Novo card aparece** com `status: pending` para o mesmo endpoint+target
    - Polling pega o novo job, processa normalmente
    - O `dealData` no DB foi atualizado com o novo campo (verificar abrindo a aba "Dados" do deal)

### 8.7 Delete individual (FIX-L)
1. Em qualquer card terminal (failed/success/skipped), click ícone Trash
2. Network: `DELETE /api/deals/{DEAL_ID}/certidoes/{jobId}` retorna `200`
3. Card some imediatamente da lista
4. **Tente deletar um job em andamento** (fetching/pending):
   - Esperado: `400 Bad Request` com erro "Nao e possivel deletar jobs em andamento (fetching). Recupere travadas primeiro."
   - Toast vermelho

---

## 9. INTEGRAÇÃO + RELATÓRIO + ZIP + COMPARTILHAMENTO

### 9.1 Aba Documentos — certidões integradas (FIX-B + NEW-005)
1. Aguarde batch terminar (ou pelo menos a maioria)
2. Volte para aba **"Documentos"** do deal
3. **Validar agrupamento**:
   - Cada certidão `success` com `attachmentId != null` aparece como `DealAttachment`
   - Agrupada por `extractedData.assignment.kind`:
     - "Parte Vendedora (N)" — certidões pessoais do vendedor (PGFN, CNDT, etc.)
     - "Parte Compradora (N)" — certidões pessoais do comprador
     - "Imóvel (N)" — CENPROT, IPTU, TJ
     - **"Pessoas Diligenciadas (N)" ou agrupado em outros** — certidões dos diligenciados (depende do `KIND_LABELS` em DealDetail.tsx)
4. Cada card mostra: filename, badge "certidao", source = "infosimples"
5. Click em uma → preview/download do PDF

**Validação URL do storage**: o `url` da DealAttachment deve começar com `https://*.public.blob.vercel-storage.com/deal-certidoes/...` (FIX-A — Vercel Blob, não filesystem `/var/task`).

### 9.2 Gerar relatório de due diligence — análise página por página
1. Aba Certidões → click **"Gerar relatório"** (botão visível só se `stats.success > 0`)
2. Loader: "Gerando…"
3. Network: `POST /api/deals/{DEAL_ID}/certidoes/report`
4. Response: `200 {attachmentId, fileUrl}`
5. Toast: "Relatório gerado"
6. **Auto-abre nova aba** com `window.open(fileUrl)`
7. Browser baixa/exibe PDF

**Validar conteúdo do PDF página por página**:

**Página 1 — Header + Resumo**:
- Título "Relatório de Due Diligence" ou similar
- "Negócio: {deal.title}"
- "Data de emissão: dd/mm/yyyy"
- "Responsável: {nome do usuário logado}"
- Box de resumo:
  - "Total de certidões: N"
  - "Negativas: N (das quais X aguardando PDF)" — se houver aguardando_pdf
  - "Com débito/pendência: N"
  - "Falhas: N"
  - "Puladas: N"
- "Custo: R$ X,XX"
- "Latência **mediana**: Ns" (não média — confirma FIX-V)

**Páginas 2+ — Por parte**:
- Seção "Partes" com tabela por vendedor/comprador/diligenciado
- Colunas: Certidão / Situação / Validade / Detalhes
- Cores nas situações: verde negativa, amarelo positiva, cinza não emitida
- Diligenciados aparecem como partes adicionais

**Seção Imóveis**:
- Tabela com endereço completo (rua, número, cidade — não truncado)
- Certidões: CENPROT, IPTU, TJ

**Seção Pendências** (se houver positivas):
- Box âmbar listando o que precisa atenção

**Seção "Certidões não obtidas (falhas)"** (FIX adicional):
- Tabela com Certidão / Motivo / Tentativas (retryCount)
- Texto: "As certidões listadas devem ser extraídas manualmente ou retentadas no sistema antes do fechamento do negócio."

**Seção "Certidões puladas (dados insuficientes)"** (se houver):
- Tabela com Certidão / Dados faltantes
- Texto: "Complete os dados faltantes no formulário ou na própria certidão e extraia novamente."

**Footer**:
- Disclaimer "Relatório gerado automaticamente pelo Contractmaker..."

**Validação técnica**:
- Magic bytes do PDF: 4 primeiros bytes = `%PDF` (`25 50 44 46`)
- Tamanho > 30 KB
- URL é Vercel Blob (NÃO `/var/task` — confirma FIX-NEW-004)

### 9.3 Baixar todas (ZIP) (FIX-P)
1. Click **"Baixar todas (ZIP)"**
2. Browser inicia download
3. Magic bytes: `PK` (`50 4B`)
4. **Abrir o ZIP** e validar estrutura:
   ```
   certidoes_{deal_title}_{id_short}.zip
   ├── relatorio_certidoes_*.pdf       (se já gerou relatório)
   ├── vendedor-1/
   │   ├── receita_federal_pgfn_*.pdf
   │   ├── tribunal_tst_cndt_*.pdf
   │   └── ...
   ├── vendedor-2/                     (se houver)
   ├── comprador-1/
   │   └── ...
   ├── imovel-1/
   │   ├── cenprot_sp_*.pdf
   │   └── pref_sp_iptu_*.pdf
   └── diligenciado-1/
       └── ...
   ```
5. Cada PDF dentro do ZIP deve ser válido (`%PDF` magic) e corresponder à certidão
6. Se algum download falhou no servidor, deve haver `errors/{filename}.txt` com a mensagem

### 9.4 Compartilhamento público (FIX-Q) — análise completa
1. Click **"Compartilhar"**
2. Modal `ShareCertidoesDialog` abre
3. Se nunca compartilhou antes: tela vazia + botão "Gerar link"
4. Click "Gerar link"
5. Network: `POST /api/deals/{DEAL_ID}/certidoes/share`
6. Body opcional: `{expiryDays: 7}` (default)
7. Response: `{token, url: "/s/certidoes/{token}", expiresAt, viewCount: 0, reused: false}`
8. **Capture `SHARE_TOKEN`**
9. Modal mostra:
   - Input read-only com URL completa (`{origin}/s/certidoes/{token}`)
   - Botão de copiar (clipboard API)
   - Texto "Visualizado 0 vezes"
   - Footer com botão "Revogar link"
10. Click "Copiar" → toast "Link copiado"

**Acesso público em aba anônima** (sem auth):
1. Abra aba/janela anônima do navegador
2. Cole a URL pública e abra
3. Página renderiza:
   - Header card: "Certidões" + título do deal + badge "Expira em dd/mm/yyyy"
   - Texto: "Este é um link público temporário gerado pelo corretor. Os documentos abaixo foram extraídos automaticamente via Infosimples."
   - Se tem relatório: card destacado azul com link "Abrir {filename}"
   - Lista "Certidões (N)" com cada certidão success: ícone CheckCircle verde + filename + categoria + link "Abrir PDF"
   - Footer: "Visualizado N vezes"
4. **Click em "Abrir PDF"** de uma certidão
5. Network público: `GET /s/certidoes/{token}/file/{attachmentId}` retorna o PDF (sem auth)
6. Volte e refresh a página pública — viewCount incrementa (1 → 2)

**Reuso do link existente**:
1. Volte para o app logado, abra ShareCertidoesDialog novamente
2. Esperado: GET retorna o link já existente (não cria novo) — `reused: true`

**Revogação**:
1. No modal logado, click "Revogar link" (vermelho)
2. Network: `DELETE /api/certidoes/share/{token}` retorna 200
3. Toast "Link revogado"
4. Modal volta para estado vazio
5. **Em aba anônima**, refresh a URL pública: deve mostrar "Link expirado" ou 404
6. Tente abrir um arquivo via `GET /s/certidoes/{token}/file/{attachmentId}` → 404

**Expiração** (não testar de verdade, mas validar o esperado):
- Default 7 dias
- Após `expiresAt`, página pública mostra mensagem "Link expirado" + ícone âmbar
- Endpoint de arquivo retorna 404

---

## 10. SINO DE NOTIFICAÇÕES (F4)

### 10.1 Bell no header
1. Confirme ícone Bell no canto superior direito do header
2. Se há notificações geradas pela extração, badge vermelho mostra contagem (ex: "1")

### 10.2 Notificação aggregada
Se a extração teve >1 job e completou:
1. Click no Bell
2. Sheet abre à direita com lista
3. Notificação tipo `certidao_batch_complete`:
   - Title: "Batch de N certidões concluído"
   - Body: "X ✓ · Y positiva(s) · Z falha(s) · K pulada(s) — {deal title}"
   - Timestamp relativo ("agora" / "5min atrás")
   - Bolinha azul (não-lida)
3. Click no item → marca como lida (some bolinha) + navega para `/deals/{DEAL_ID}`

### 10.3 Marcar todas como lidas
Se há mais de 1 não-lida:
- Botão "Marcar todas como lidas" no header do Sheet
- Click → todas viram lidas, badge some

### 10.4 Polling
Aguarde 60s na mesma aba — confirme que `GET /api/notifications?limit=20` é chamado periodicamente (network).

### 10.5 Bell em background
Mude para outra aba do browser por 90s, depois volte. Confirme polling pausa quando background e retoma quando visible (via `visibilitychange`).

---

## 11. CONTRATO — EDIÇÃO + CHAT IA + EXPORT

### 11.1 Abrir contrato V1
1. Aba "Contratos" do deal → click no contrato V1 listado
2. URL muda para `/contracts/{CONTRACT_V1_ID}`
3. **Capture `CONTRACT_V1_ID`**

### 11.2 Validar template (FIX-001)
Confirme:
- Header do contrato contém "**CCV - Financiamento**" (modalidade auto-detectada por `alienacao_fiduciaria > 0`)
- Cláusula 9.5 de "rescisão por não obtenção de financiamento" presente
- 19 cláusulas no total

### 11.3 Validar foro arbitragem (FIX-006)
- Cláusula final menciona "**arbitragem**" / "TASP" / "ACORDIA" / "Lei 9.307"
- NÃO menciona "foro da situação do imóvel"

### 11.4 Auto-save (FIX-C)
1. Edite o título da Cláusula 1: digite uma palavra qualquer
2. Aguarde 2s
3. **Indicator no header**: "Salvando…" → "✓ Salvo" (verde)
4. Network: `PATCH /api/contracts/{ID}` com body `{htmlContent}` retorna 200
5. Refresh da página: edição **persistiu** (sem botão "Salvar versão" clicado)

### 11.5 Toolbar TipTap
Confirme presença dos botões na toolbar (33 esperados):
- Texto: B / I / U / S
- Fonte: family / size / cor / highlight
- Headings H1/H2/H3
- Listas + indent/outdent
- Alinhamento + line-height + transformar caixa + format painter
- Inserir: link / tabela / HR / page break / imagem
- Ações: undo / redo / search

### 11.6 Find & Replace (Ctrl+F)
1. Pressione `Ctrl+F`
2. Barra de busca aparece
3. Digite "Comprador"
4. Mostra "1 de N resultados"
5. Esc fecha

### 11.7 Chat IA — leitura
1. Abra ChatPanel (botão "Chat IA" ou ícone)
2. Digite: `"Quais cláusulas existem no contrato?"`
3. Esperado: resposta em markdown lista as 19 cláusulas SEM tools de edição (regra 10.1 — pergunta informativa)
4. Contrato HTML não muda

### 11.8 Chat IA — edição (FIX-002 + 002b + D)
1. Digite: `"Altere a multa moratória de 2% para 3%"`
2. Esperado:
   - Network mostra `tool_use` do `edit_contract_section` (não `update_contract_data`)
   - HTML do editor muda: ProseMirror agora contém "3%" no lugar de "2%"
   - Resposta no chat tem **EXATAMENTE 3 headings literais**:
     - `## Alterações Realizadas`
     - `## Justificativa`
     - `## Verificação`
3. **Capture**: contém "3%" no contrato? Headings exatos?

### 11.9 Chat IA — sugestão (track changes) (FIX-003 + E)
1. Digite: `"Sugira uma redação mais formal para a cláusula de comissão"`
2. Esperado:
   - Network: `tool_use` do `propose_suggestion`
   - DOM contém **par `<del>...</del><ins>...</ins>`** (track changes completo, não só `<ins>`)
   - Toolbar âmbar aparece no topo: "1 sugestão pendente"
3. Click "Aceitar todas" ou aceite individualmente
4. Network: `PATCH /suggestions/{id}` retorna 200
5. HTML atualiza com a versão final

### 11.10 Comentários
1. Selecione um trecho qualquer do contrato
2. BubbleMenu aparece — click "Comentar"
3. Dialog pede texto, digite "Revisar valor"
4. Comentário aparece no painel lateral direito
5. Marca amarela aplicada no trecho

### 11.11 Análise automática IA
- Aguarde ~30s após abrir o contrato
- Esperado: badge no botão "Comentários" mostra contagem de comments IA + cor por severidade (verde/âmbar/vermelho)

---

## 12. VERSIONAMENTO

### 12.1 Criar V2
1. Edite manualmente um trecho qualquer do contrato (ex: trocar "VENDEDOR" por "VENDEDOR(A)")
2. Aguarde auto-save
3. Click **"Salvar Versão"** (header)
4. AlertDialog: "Criar nova versão?"
5. Confirme
6. Network: `POST /api/contracts/{V1_ID}/version` retorna 201 com novo contractId
7. **Capture `CONTRACT_V2_ID`**
8. Aba "Contratos" do deal mostra "Contratos (2 versões)"

### 12.2 V1 preserva, V2 fresh
1. Volte para V1 (clique na lista)
2. Confirme V1 mantém o estado **antes** da edição manual
3. V2 tem a edição
4. Histórico de versões na sidebar funciona

---

## 13. APROVAÇÃO + EXPORT FINAL

### 13.1 Pré-aprovação
1. No editor da V2, click **"Aprovar"** (botão verde)
2. Esperado: `POST /api/contracts/{V2_ID}/approve` rodou validações
3. Se houver issues: `ApprovalReviewDialog` abre listando errors/warnings/comentários não-resolvidos
4. Se sem issues: contrato aprovado direto

### 13.2 Export PDF (FIX-005)
1. Click "Exportar"
2. Modal de export abre
3. Click "Exportar PDF"
4. Network: `POST /api/contracts/{V2_ID}/export?format=pdf` retorna 200 + `pdfUrl`
5. URL retornada começa com `https://{store}.public.blob.vercel-storage.com/exports/`
6. Browser baixa PDF
7. Magic bytes `%PDF` (4 bytes iniciais)
8. Tamanho > 50 KB

### 13.3 Export DOCX
1. Click "Exportar DOCX"
2. Mesmo padrão: 200, blob URL, magic bytes `PK` (ZIP), tamanho > 30 KB
3. Abrir arquivo: cláusulas formatadas, page breaks preservados

### 13.4 Aprovação final
1. Após review, confirme aprovação
2. Status do contrato vira `aprovado` (badge verde)
3. **Editor fica read-only**: chat bloqueado, edições bloqueadas, botão "Salvar Versão" some
4. Card do deal no Kanban move para coluna "Concluído" (ou stage final)

### 13.5 Memória de contrato (silenciosa)
- Em background: `createContractMemory` roda fire-and-forget
- Sem efeito visível, mas verifica se aparece notification ou erro no console

---

## 14. SANITY CHECKS GLOBAIS

### 14.1 Console
- Sem erros vermelhos no DevTools console durante todo o fluxo (warnings amarelos OK)

### 14.2 Páginas adicionais
Visite cada página e confirme que carrega sem 500:
- `/pipeline` — Kanban
- `/deals/{DEAL_ID}` — todas 4 abas
- `/contracts/{CONTRACT_V2_ID}` — editor
- `/forms` — lista de forms
- `/clauses` — biblioteca
- `/clauses/proposals` — propostas IA
- `/templates` — templates
- `/settings` — config
- `/settings/certidoes` — dashboard certidões
- `/settings/ai-usage` — observabilidade IA
- `/settings/document-styles` — design system
- `/settings/knowledge-base` — RAG

### 14.3 Mobile (375×667)
1. `resize_window({width: 375, height: 667})`
2. Reabra `/deals/{DEAL_ID}` aba Certidões
3. Confirme: layout responsivo, cards empilhados, botões acessíveis
4. Volte para `1280×800` ao final

---

## 15. RELATÓRIO FINAL — FORMATO

Produza ao final UM relatório markdown com:

**1. Tabela executiva** com colunas:
| # | Bloco/Passo | Status (PASS/PARTIAL/FAIL/BLOCKED) | Evidência (HTTP code, valor, ID) |

**2. Bugs encontrados** — para cada bug:
- ID sequencial (BUG-NEW-001 etc.)
- Severidade: blocker / critical / major / minor
- Bloco/passo onde apareceu
- URL exato
- Comportamento observado vs esperado
- Evidência (network response, DOM snippet, screenshot reference)

**3. Regressão dos fixes** — confirme cada um:
- ✅ FIX-001 (modalidade financiamento)
- ✅ FIX-002 (chat altera HTML)
- ✅ FIX-002b (3 headings literais)
- ✅ FIX-003 (`<del>/<ins>` pareado)
- ✅ FIX-005 (export PDF + DOCX)
- ✅ FIX-006 (foro arbitragem)
- ✅ FIX-007 (cônjuge com asterisco)
- ✅ FIX-A (Vercel Blob storage)
- ✅ FIX-B (DocumentsTab certidões)
- ✅ FIX-C (auto-save editor)
- ✅ FIX-D (chat tool-forcing)
- ✅ FIX-S (retry limpa stale data)
- ✅ FIX-T (sweeper promove válidos)
- ✅ F1 (catálogo UF + picker)
- ✅ F2 (dialog interativa + jobs[])
- ✅ F3 (diligenciados CRUD)
- ✅ F4 (sino + notif agregada)
- ✅ F5 (OCR batch + cache)

**4. Métricas de performance**:
- Tempo upload→OCR-completo de 6 docs (esperado: ≤90s)
- Latência média de extração de certidões
- Tempo total do fluxo (form criado → contrato aprovado)

**5. Análise qualitativa** (1-2 parágrafos):
- O que funcionou bem
- O que precisa polimento
- Prioridade dos bugs (qual fixar primeiro)

**6. IDs gerados** (para cleanup):
- `DEAL_ID`
- `FORM_TOKEN`
- `CONTRACT_V1_ID` / `CONTRACT_V2_ID`
- `BATCH_ID`(s)
- `SHARE_TOKEN`

---

## ANÁLISE CRÍTICA DO FLUXO DE CERTIDÕES (obrigatória no relatório final)

Além de marcar PASS/FAIL bloco a bloco, o relatório DEVE conter uma **análise dedicada do processo de certidões** — esse é o coração do produto e o foco principal deste teste. Cobertura mínima:

### 1. Inventário de cobertura
Tabela mostrando, para cada parte/imóvel detectado, **TODAS as certidões esperadas vs efetivamente geradas**:

| Target | Endpoint | Esperado? | Gerado? | Status final | Latência | Custo | Observações |
|---|---|---|---|---|---|---|---|
| Vendedor 1 | PGFN | sim (tem CPF + data nasc) | sim | success | 8s | R$ 0,04 | Negativa |
| Vendedor 1 | CNDT | sim | sim | success | 12s | R$ 0,04 | Negativa, válida 10/12/2026 |
| Vendedor 1 | TRF Cível | sim | sim | success (aguardando_pdf) | 45s | R$ 0,04 | "Negativa nos 6 TRFs" mas pdf pendente |
| Vendedor 1 | TJSP | sim (UF=SP) | sim | awaiting_portal | 5s | R$ 0,06 | Aguarda 30min |
| Imóvel 1 | CND IPTU SP | sim (tem SQL) | sim | success | 15s | R$ 0,04 | Negativa |
| Imóvel 1 | CENPROT SP | sim | sim | failed | 1071s | R$ 0,06 | Timeout — recuperar |
| Diligenciado 1 | PGFN | sim | ? | ? | ? | ? | ? |
| ... | ... | ... | ... | ... | ... | ... | ... |

Marque com ⚠️ qualquer linha onde **esperado != gerado** (cobertura quebrada) ou status=failed.

### 2. Análise por endpoint — comportamento real
Para cada **tipo único de endpoint** que rodou, escreva 1-2 frases de análise:
- **PGFN**: latência, taxa de sucesso, qualquer erro recorrente
- **CNDT**: idem
- **TRF Cível Justiça Federal**: como tratou os 6 TRFs (todos negativos? algum falhou?), tempo total, situação (negativa vs aguardando_pdf)
- **CEAT (todos os TRTs)**: qual TRT correspondeu ao UF, latência, formato do resultado
- **TJSP**: foi para awaiting_portal? em quanto tempo o portal voltou? PDF gerado?
- **TJRJ**: idem (provavelmente ainda awaiting_portal — registre)
- **TJRS**: gerou as 5 sub-chamadas (tipos 3/4/7/8/9)?
- **CENPROT SP**: se completou, qual latência? Se travou, foi recuperado pela sweeper?
- **IPTU SP/RJ**: extraiu corretamente? PDF tem dados do imóvel?

### 3. Análise de UX da tab Certidões
Pontuação de 1-5 para cada aspecto:
- **Clareza dos status**: usuário entende o que cada cor/badge significa?
- **Ações por card**: botões intuitivos? Tooltips informativos? Confirmações onde necessárias?
- **Modal de detalhes**: traz informação útil? Layout legível? PDF embedado funciona?
- **Polling em tempo real**: feedback adequado? Não trava a UI? Para corretamente?
- **Erros**: mensagens humanas (não JSON)? Recovery actions claras?
- **Responsividade**: aguenta 20+ certidões na tela sem virar caos?

### 4. Robustez do pipeline
- **Idempotência (FIX-K)**: extração dupla foi bloqueada com 409? ✓/✗
- **Recovery (FIX-T)**: jobs travados foram limpos pela sweeper? Promovidos quando dados válidos? ✓/✗
- **Stale data (FIX-S)**: retry limpou resultData antigo? Card não mostrou ghost? ✓/✗
- **Cache contentHash (F5)**: doc duplicado evitou Gemini? ✓/✗
- **Notificação agregada (F4)**: 1 notif por batch ou spam de N? ✓/✗

### 5. Performance
Compare com baseline R5:
- Upload+OCR de N docs em paralelo: **Xs** (esperado: ≤90s para 6 docs com batch)
- Batch certidões com M jobs: **tempo médio por job** (esperado: ~20-30s federal, ~60s estadual)
- Latência mediana reportada nas stats (deve excluir outliers)

### 6. Issues encontradas no fluxo de certidões
Listar SEPARADAMENTE dos bugs gerais — apenas bugs do módulo de certidões. Para cada:
- Severidade (blocker/critical/major/minor)
- Descrição do comportamento
- Impacto no usuário (corretor não consegue X)
- Sugestão de fix se for óbvio

### 7. Veredicto final do módulo de certidões
1 parágrafo: o módulo está pronto para uso real por um corretor? Em quais cenários ele vai brilhar? Em quais vai falhar? Qual é a melhoria mais urgente?

---

## CHECKLIST RÁPIDO (use para não esquecer nada)

```
[ ] 1.x   Form criado, FORM_TOKEN capturado
[ ] 2.1   N docs upload + batch-extract (NUNCA chamadas individuais para batch >1)
[ ] 2.2   Cache hit em duplicata (cached:true sem chamar Gemini)
[ ] 2.3   Erro com retry visível em Button outline + Remover (não link sublinhado)
[ ] 2.4   Distribuição CPF inteligente (CPF distintos = slots distintos)
[ ] 2.5   Dropdown agrupado por kind + "+ Novo X" funciona
[ ] 2.6   Aplicar aos campos preenche corretamente
[ ] 3.1   Vendedor: validar TODOS campos OCR vs documento real
[ ] 3.1   Cert. casamento → estado_civil="Casado(a)" + cônjuge nome+CPF
[ ] 3.2   Comprador: validar OCR + CPF distinto do vendedor
[ ] 3.3   Imóvel: SQL (SP) ou inscrição municipal (RJ) — CRÍTICO
[ ] 3.5   Pagamento: campos correspondem aos labels (BUG-NEW-001 fixed?)
[ ] 3.6   Foro: ARBITRAGEM selecionado (FIX-006)
[ ] 3.7   Form finalizado, DEAL_ID capturado
[ ] 4.x   Pipeline + 4 abas do deal carregam sem erro
[ ] 5.x   Diligenciados: 1 PF + 1 PJ adicionados, contagem (2)
[ ] 5.5   DELETE diligenciado com certidão extraída → 409
[ ] 6.1   GET /plan?full=1 retorna catalog + expandedPlan + diligenciados
[ ] 6.2   TODOS os grupos visíveis (vendedor/comprador/imóvel/diligenciado)
[ ] 6.3   Skipped jobs com motivo claro
[ ] 6.4   Botões Plano padrão / Marcar / Desmarcar funcionam
[ ] 6.5   Picker: filtros UF + categoria + busca + lista agrupada
[ ] 6.5   Cross-UF: marcar TJ de outra UF (ex: TJRJ em deal SP)
[ ] 6.6   Picker funciona para diligenciados também
[ ] 6.8   Marcar TUDO sem limite, POST com jobs[] explícito, 202
[ ] 6.9   Idempotência: 2ª extração simultânea retorna 409
[ ] 7.1   Polling 2s, transições pending→fetching→terminal
[ ] 7.2   Stats card com mediana (não média)
[ ] 7.3   5 ícones por card success: Eye / Open / Download / Retry / Trash
[ ] 7.4   Modal de detalhes: PDF iframe + JSON toggle + 4 botões footer
[ ] 7.5   Validade exibida em verde nos cards success
[ ] 7.6   aguardando_pdf badge azul (não Indeterminado)
[ ] 8.1   Sweeper: promove válidos vs marca falhas + toast contextual
[ ] 8.2   Retry: limpa resultData antigo (FIX-S)
[ ] 8.3   Limite 3 retries: 4ª retorna 429
[ ] 8.4   awaiting_portal: ícone CalendarClock, retry sem custo
[ ] 8.6   Skipped → complementar inline → novo job, antigo replaced
[ ] 8.7   Delete em fetching → 400; em terminal → 200
[ ] 9.1   Documentos tab: certidões agrupadas por parte + URL Vercel Blob
[ ] 9.2   Relatório PDF: header + resumo + por-parte + falhas + puladas
[ ] 9.2   Latência MEDIANA no PDF (não média)
[ ] 9.2   PDF magic bytes %PDF
[ ] 9.3   ZIP estruturado por pastas vendedor-N/imovel-N/diligenciado-N
[ ] 9.4   Share link público funciona em aba anônima
[ ] 9.4   viewCount incrementa
[ ] 9.4   Revogar → 404 em aba anônima
[ ] 10.x  Sino: badge unread + Sheet com notif agregada por batch
[ ] 10.x  Click notif → marca lida + navega
[ ] 10.x  Polling pausa em background (visibilitychange)
[ ] 11.4  Auto-save editor: PATCH 200 + indicator "✓ Salvo"
[ ] 11.7  Chat leitura: lista cláusulas sem editar
[ ] 11.8  Chat edição: tool_use edit_contract_section + 3 headings literais
[ ] 11.9  Chat sugestão: <del>...</del><ins>...</ins> pareados
[ ] 12.x  V2 criada, V1 preservada, histórico funciona
[ ] 13.2  Export PDF: 200 + URL Blob + magic %PDF + >50KB
[ ] 13.3  Export DOCX: 200 + URL Blob + magic PK + >30KB
[ ] 13.4  Aprovação: status="aprovado", editor read-only, chat bloqueado
[ ] 14.1  Console limpo (sem erros vermelhos)
[ ] 14.2  TODAS páginas /settings/* carregam sem 500
[ ] 14.3  Mobile 375px: layout responsivo
[ ] 15    Relatório final + ANÁLISE CRÍTICA DO FLUXO DE CERTIDÕES
```

**LEMBRETES FINAIS**:

1. **DADOS DAS PESSOAS/IMÓVEL = OCR DOS DOCUMENTOS** que você anexar. Não use persona fixa.
2. **CERTIDÕES = SEM LIMITE** — marque TUDO que conseguir, quanto mais melhor para o teste.
3. **ANÁLISE DETALHADA DAS CERTIDÕES** é obrigatória — esse é o produto principal.
4. **NÃO BLOQUEIE** o teste por erro intermediário — capture, siga, reporte no relatório final.
5. Se algo parece bug mas você não tem certeza, **REPORTE** — melhor falso positivo que falso negativo.

Este é o teste **definitivo**. Execute com cuidado.

---

## 16. REGRESSÃO PHASE H (2026-04-18) — BUGS CRÍTICOS CORRIGIDOS

Durante o E2E de 2026-04-17 foram encontrados 2 P0 + 6 P1 + 8 P2. As correções
foram deployadas como Phase H. Esta seção verifica que NENHUM retornou.

### 16.1 — P0-A: TRF3/PGE-SP falso-negativo

**Regressão a testar**: abrir um deal com certidões extraídas. Na aba Certidões,
para cada card TRF3 ou PGE-SP:
- [ ] Se retornou "Negativa" ícone verde → VALIDAR que tem PDF anexado (botão
      download visível, `attachmentId` não-null no JSON de `/api/deals/:id/certidoes`)
- [ ] Abrir JSON raw (`GET /api/deals/:id/certidoes`, inspecionar `resultData.raw`):
      - `raw.code === 200` + `raw.data_count >= 1` + `raw.header.billable === true`
      - Se `raw.code !== 200` → card DEVE mostrar ícone vermelho (XCircle),
        não verde, e `status: "failed"` no DB

**Falha** (regressão P0-A): qualquer card TRF3/PGE-SP com ícone verde +
`raw.code === 602` + `attachmentId === null`. **BLOQUEIA produção.**

### 16.2 — P0-B: PGFN indeterminado

**Regressão a testar**: para cada card `receita-federal/pgfn`:
- [ ] Status textual não pode ser "Indeterminado" quando `raw.debitos_rfb === false`
      e `raw.debitos_pgfn === false`
- [ ] Esperado: "Negativa · nada consta" com ícone verde, PDF baixado

### 16.3 — P1-1: TJSP pedido-cível 100% fail

**Regressão**: deal com PF SP + data_nascimento preenchida + (opcionalmente)
nome_mae preenchido.
- [ ] Disparar extração. Dos 4 jobs TJSP pedido-cível por parte:
      - ≥ 2/4 devem ir para `pending_portal` (em vez de 100% falharem com code 606)
      - Depois do cron (ou manual sweep), devem virar `success` com PDF
- [ ] Parte PF SEM `data_nascimento`: TJSP deve aparecer como `skipped` com
      `missingField: "data_nascimento"` (não disparar e falhar)

### 16.4 — P1-2: CENPROT SP payload com UF

**Regressão**: payload enviado deve incluir `uf: "SP"`. Inspecionar no
`CertidaoJob.requestPayload` via banco ou GET `/api/deals/:id/certidoes`:
- [ ] `requestPayload.uf === "SP"` em todo job cenprot-sp/protestos

### 16.5 — P1-3: OCR auto-atribuição não troca lados

**Regressão**: upload 4 docs (2 RGs de compradores + 2 RGs de vendedores) em
sequência, SEM preencher etapas 1-2 antes.
- [ ] Nenhum card deve auto-atribuir a "Vendedor 1" / "Comprador 1" — todos
      devem aparecer como "Outros / Sem atribuição"
- [ ] Botão "Aplicar aos campos" deve estar DESABILITADO (com tooltip
      explicando que há docs sem atribuição)
- [ ] Após escolher manualmente no dropdown, botão habilita

### 16.6 — P1-4: Deal docs herdam atribuição correta

**Regressão**: criar form, fazer upload e atribuir Doc-A a "Vendedor 1". Nas
etapas 1-2, corrigir as partes para que o CPF do Doc-A seja agora "Comprador 1".
Finalizar form. Abrir deal:
- [ ] Aba Documentos deve mostrar Doc-A em "Parte Compradora" (rematch por CPF),
      não "Parte Vendedora"

### 16.7 — P1-5: Sweep com dry-run

**Regressão**: ter ≥1 job travado em `fetching`. Clicar "Recuperar travadas":
- [ ] Deve aparecer `window.confirm` explicando quantos jobs vão ser promovidos
      ou marcados como falha. Sem confirm → sem ação.

### 16.8 — P1-6: EditPartyDialog pré-preenchido

**Regressão**: em um job failed com `failureCategory: "inconsistent_input"`,
clicar no ícone de edição:
- [ ] Dialog abre com Nome/CPF/Data/UF/Cidade **preenchidos** com os dados
      atuais da parte. Não pode abrir vazio.

### 16.9 — P2-1: Health endpoint

```
GET /api/admin/certidoes/health
```
- [ ] `infosimples.ok === true` (com CNPJ real válido)
- [ ] `govbr.active` reflete estado atual

### 16.10 — P2-2: Relatório PDF contadores corretos

**Regressão**: em um deal com ≥5 jobs failed e ≥2 skipped, gerar relatório
de DD:
- [ ] PDF mostra "Falhas: N" onde N = nº real (não 0)
- [ ] Mostra "Puladas: M" onde M = nº real (não 0)

### 16.11 — P2-4: Ícone de "nao_emitida"

**Regressão**: card com `situacao: "nao_emitida"` deve ter ícone vermelho
(XCircle), nunca verde (CheckCircle2).

### 16.12 — P2-6: E-Proc SP com botão portal

**Regressão**: deal com PF SP → após extração, deve haver card do skipped
`tribunal/tjsp/eproc` com:
- [ ] Ícone SkipForward cinza
- [ ] Botão azul "Abrir portal oficial" linkando para
      `https://certidoes.tjsp.jus.br`

### 16.13 — P2-7: Imóvel UF-condicional

**Regressão**: no form, etapa Imóvel:
- [ ] Imóvel com UF = SP → mostra "Inscrição IPTU" + "SQL", NÃO mostra
      "Inscrição Municipal"
- [ ] Imóvel com UF = RJ → mostra "Inscrição IPTU" + "Inscrição Municipal",
      NÃO mostra "SQL"
- [ ] UF vazio ou outras → só "Inscrição IPTU"

### 16.14 — P2-8: Corretora PF

**Regressão**: etapa Comissão/Corretora:
- [ ] Radio "Corretor autônomo (PF)" / "Imobiliária (PJ)"
- [ ] PF: labels trocam para "Nome do Corretor" + "CPF do Corretor"
- [ ] CRECI placeholder muda para "Ex: 199.905" (PF) vs "Ex: J-12345" (PJ)

### 16.15 — P2-9: Confirm ao remover parte

**Regressão**: em vendedor/comprador com dados preenchidos, clicar "Remover":
- [ ] Abre `window.confirm` avisando que há dados OCR-extraídos

### 16.16 — Billing honesto (H.18)

**Regressão**: para deal com ≥1 job com code 6xx (TJSP 606 sem data_nascimento):
- [ ] `CertidaoJob.costCents === 0` (não cobra falha)
- [ ] Total mensal no `/settings/certidoes` não inclui esses valores
