Você é um QA sênior validando o fluxo E2E completo do Contractmaker — do formulário de vendas até a aprovação do contrato passando por extração de certidões, confecção do contrato, layout, versionamento, chat IA e alteração de cláusula padrão.

Features em teste:

1. **Formulário de vendas completo** (8 etapas incluindo Etapa 0 de anexo de documentos com OCR Gemini)
2. **Extração de certidões via Infosimples** (commit `410f8277`) — ~9 certidões por deal SP: CND Federal/PGFN, CNDT, TRF Cível, 3× CEAT SP, CENPROT SP, IPTU SP, TJSP (awaiting_portal)
3. **Leitura + interpretação das certidões** — situação, validade, consta débito
4. **Geração do relatório de due diligence** em PDF
5. **Documentos anexados no Deal detail** agrupados por parte/imóvel
6. **Confecção do contrato** via botão + auto-detecção de modalidade
7. **Layout do contrato** (wrapper A4, toolbar, zoom, fonts, alinhamento)
8. **Versionamento** (edições, auto-save, nova versão, histórico)
9. **Chat IA** (leitura + comandos estruturados)
10. **Alteração de cláusula padrão via chat** (`edit_contract_section` + track changes)

Stack: Next.js 14 + React Hook Form + Prisma + Infosimples API v2 + Claude Sonnet 4.5 + TipTap.
Ambiente: **https://web-zeta-three-4lyvmj9ut6.vercel.app** (alias de produção).
Idioma da UI: português brasileiro.

**Você já está logado no sistema.** Não faça logout, não navegue para `/login`, não peça credenciais.

## Regras gerais

- Faça **hard reload (Ctrl+Shift+R)** antes de cada bloco para pegar o bundle novo. NÃO abra aba anônima.
- **Não aprove contratos reais.** Use apenas deals marcados como `[QA E2E]` no título.
- **Orçamento de teste**: cada deal consome ~R$ 0,70 em créditos Infosimples. Não rode mais que 2 deals completos.
- **Limpe dados de teste ao final** — deals, formulários, contratos, anexos, jobs de certidões.
- Abra **DevTools Console + Network** desde o início. Reporte qualquer erro vermelho.
- Para cada passo, reporte **PASS / FAIL / BLOCKED** com descrição curta.
- Anote tempos (segundos) de operações longas: OCR, extração de certidão, geração de contrato, export PDF.

## Disciplina de screenshots (CRÍTICO — não ignore)

A API do Claude tem limite de **2000px em cada dimensão** para requests com múltiplas imagens. Screenshots de viewport alto-DPI/retina quebram o turn inteiro com:

```
messages.N.content.M.image.source.base64.data: At least one of the image dimensions
exceed max allowed size for many-image requests: 2000 pixels
```

Para **não** cair nessa armadilha, siga estas regras:

1. **Defina viewport 1280×800 no início do teste**, antes de qualquer captura:
   - Chame `resize_window(1280, 800)` (ou o equivalente da sua ferramenta) uma vez
   - NÃO use modo retina, NÃO use HiDPI, NÃO redimensione para > 1600px de largura
2. **Prefira evidência textual em vez de screenshot.** Para cada passo, a primeira opção é sempre texto:
   - **Conteúdo da página**: `get_page_text` (ou `document.body.innerText`)
   - **Valor específico de um elemento**: `evaluate_js` com `querySelector('...').textContent`
   - **Contagem/presença de elementos**: `querySelectorAll('...').length`
   - **Response JSON do Network tab**: copie o payload como texto
   - **Erros do console**: copie o texto literal do log
   - **Contagem de palavras específicas no contrato**: ex. `document.querySelector('.ProseMirror').textContent.match(/2%/g)?.length`
3. **Screenshot só quando a evidência é essencialmente visual e o texto não serve** — layout quebrado, cor errada, spinner preso, badge colorido, elemento clipado. Mesmo nesse caso:
   - Tire **no máximo 1 screenshot por bloco**, e apenas da viewport (nunca full page)
   - Antes do screenshot, confirme que `window.innerWidth <= 1280` e `window.innerHeight <= 800`
4. **Limite global**: máximo **15 screenshots no relatório inteiro**. Se você chegar em 15, pare de capturar e passe a usar só texto — a evidência textual é aceita como prova válida de PASS/FAIL.
5. **Full-page screenshots são proibidos.** Nunca use `fullPage: true` ou equivalente — eles produzem imagens muito mais altas que 2000px. Se precisar ver um contrato inteiro, use `document.querySelector('.ProseMirror').innerText.slice(0, 5000)` pra pegar o texto.
6. **Para validar cores/estilo** (ex: "badge verde de sucesso"), use `getComputedStyle(element).backgroundColor` em vez de screenshot.

**Se mesmo assim você receber o erro de 2000px**: pare imediatamente, execute `resize_window(1280, 800)` novamente, descarte as screenshots anteriores da turn, e retome com evidência textual. Não tente fazer o mesmo screenshot de novo.

## Persona de teste

- **Vendedora:** Maria Aparecida de Souza, CPF **529.982.247-25** (válido), **data nascimento 14/05/1980**, casada, endereço em São Paulo/SP
- **Comprador:** Rafael Oliveira Santos, CPF **111.444.777-35** (válido), **data nascimento 03/11/1985**, solteiro, endereço em São Paulo/SP
- **Imóvel:** Rua das Palmeiras 789, Jardins, São Paulo/SP, matrícula **54.321**, CEP 01452-000, **SQL 123.456.0789-0**
- **Valor:** R$ 980.000 | Sinal R$ 98.000 | Financiamento R$ 700.000 | Recursos próprios R$ 182.000
- **Modalidade:** financiamento
- **Comissão:** 6% → R$ 58.800, paga pela Parte Compradora

## Documentos de teste (opcionais para a Etapa 0)

Opcional — se tiver samples brasileiros JPG/PDF (RG, CPF, matrícula) para testar o OCR. Senão, pule a Etapa 0.

---

## ROTEIRO DE TESTES

### BLOCO 1 — Smoke test: criar formulário e preencher dados da persona

**1.1** Navegue para `/forms` → "Novo Formulário".
- Título: `[QA E2E] Venda Jardins Financiamento`
- Crie e copie o link `/f/<token>`

**1.2** Abra o link em nova aba (mesma sessão).
- **VALIDAR:** Etapa 0 "Documentos" renderiza por padrão.
- **VALIDAR:** StepIndicator mostra "Etapa 1 de 8".

**1.3** Pule a Etapa 0 (ou anexe 1 JPG se tiver) → próximo.

**1.4** Etapa 1 — Vendedor(es):
- Preencha Maria Aparecida com todos os campos da persona
- **VALIDAR (CRÍTICO):** existe o campo **"Data de Nascimento"** (input `type="date"`) logo abaixo do CPF
- Preencha: `1980-05-14`

**1.5** Etapa 2 — Comprador(es):
- Rafael Oliveira com CPF válido + data nascimento `1985-11-03`

**1.6** Etapa 3 — Imóvel(is):
- Preencha endereço completo
- **VALIDAR (CRÍTICO):** existem dois campos novos: **"SQL (Setor-Quadra-Lote)"** e **"Inscrição Municipal"** (este último no grupo Dados Registrais ou abaixo do IPTU)
- Preencha SQL: `123.456.0789-0`
- Inscrição Municipal: deixe vazio (não é SP estendido, só RJ usa)
- Descrição: "Apartamento 3 quartos, 2 banheiros, 1 vaga garagem, 85m²"

**1.7** Etapa 4 — Status/Débitos: quitado, sem débitos, sem vícios.
**1.8** Etapa 5 — Pagamento: **modalidade financiamento**, valor 980.000, sinal 98.000, recursos próprios 182.000, financiamento 700.000.
**1.9** Etapa 6 — Posse: após pagamento integral, prazo 45 dias úteis.
**1.10** Etapa 7 — Comissão: 6% → 58.800, pago pela Parte Compradora, foro arbitragem.
**1.11** Clique "Finalizar".
- **VALIDAR:** toast de sucesso + redirect para tela "Formulário Concluído".
- Anote tempo total de preenchimento.

---

### BLOCO 2 — Deal detail: dados completos

**2.1** `/pipeline` → abra o deal `[QA E2E] Venda Jardins Financiamento`.
- **VALIDAR:** aba "Dados" mostra 4 cards (Vendedor, Comprador, Imóvel, Pagamento) com valores corretos.
- **VALIDAR:** número de versões de contrato = 0.

**2.2** Aba "Documentos":
- **VALIDAR:** mesmo sem anexos na Etapa 0, a aba abre sem erro (0 documentos ou placeholder).
- Se anexou JPGs no Bloco 1.3: **VALIDAR** que apareceram agrupados por "Parte Vendedora"/"Parte Compradora"/"Imóvel" com categoria e confidence.

---

### BLOCO 3 — Confecção do contrato

**3.1** Clique "Confeccionar Contrato" no header.
- **VALIDAR (CRÍTICO):** redireciona para `/contracts/<id>` e o contrato aparece renderizado.
- **VALIDAR:** Network `POST /api/pipeline/deals/:id/generate-contract` → 201.
- **VALIDAR:** template usado é **`ccv_financiamento_v2`** (auto-detectado pela modalidade).
- Anote tempo de geração (esperado: 2-5s).

**3.2** Leia o contrato renderizado no editor TipTap:
- **VALIDAR (CRÍTICO):** nome **"Maria Aparecida de Souza"** aparece na qualificação do Vendedor, CPF formatado `529.982.247-25`, RG, estado civil "Casada".
- **VALIDAR:** nome **"Rafael Oliveira Santos"** aparece como Comprador com CPF.
- **VALIDAR:** endereço do imóvel "Rua das Palmeiras, 789 — Jardins, São Paulo/SP, CEP 01452-000" aparece na descrição do objeto.
- **VALIDAR:** valor **R$ 980.000,00** formatado corretamente + extenso ("novecentos e oitenta mil reais").
- **VALIDAR:** cláusula de rescisão por não obtenção de financiamento (Cláusula 9.5 típica do v2 financiamento) está presente.
- **VALIDAR:** contrato tem ~17 cláusulas numeradas (padrão CCV financiamento v2).

---

### BLOCO 4 — Layout do contrato (wrapper A4 + toolbar + zoom)

**4.1** Inspecione o layout:
- **VALIDAR (CRÍTICO):** o texto do contrato está envolto em um wrapper `.a4-page` com largura fixa (~794px @ 100%) e aparência de página A4.
- **VALIDAR:** o wrapper tem sombra/borda que simula folha impressa.

**4.2** Teste a toolbar (hover revela tooltip com atalho):
- Bold (`Ctrl+B`), Italic, Underline, Strike
- Font family dropdown
- Font size (deve ter +/-)
- Color picker (texto) + Highlight
- Headings H1/H2/H3
- Listas (bullet + ordenada) + Indent/Outdent
- Alinhamento (left/center/right/justify) + LineHeight
- Link (popover), Tabela, HR, PageBreak, Image
- Undo/Redo, Search (`Ctrl+F`)
- **VALIDAR:** todos os botões são clicáveis e respondem.
- **VALIDAR:** dropdowns aparecem **acima** da toolbar sticky (z-index correto, sem clipar).

**4.3** Controles de documento (font do editor + zoom):
- **VALIDAR:** existe um controle de font family que aplica no editor inteiro (fora da seleção).
- **VALIDAR (CRÍTICO):** controle de Zoom no rodapé com steps [50, 75, 90, 100, 125, 150, 200]%. Alterar zoom **NÃO** deve redimensionar a toolbar — apenas o conteúdo interno do wrapper A4.

**4.4** Seleção + BubbleMenu:
- Selecione um trecho de texto qualquer.
- **VALIDAR:** BubbleMenu flutua com Bold, Italic, Underline, Strike, Link, Highlight, Comentar, **IA** (botão laranja).

**4.5** Find & Replace:
- `Ctrl+F` → digite "Comprador" → verifique que highlights aparecem no texto.
- Replace um ocorrência por "Comprador Teste" → verifique no texto.
- **VALIDAR:** Ctrl+Z reverte a mudança.

**4.6** Ortografia PT-BR:
- Digite uma palavra errada ("testte") em qualquer lugar do contrato.
- **VALIDAR:** aparece sublinhado vermelho (spellcheck nativo do browser, `lang="pt-BR"`).

---

### BLOCO 5 — Chat IA: leitura (informativo, sem tools de edição)

**5.1** Abra o chat IA (botão/ícone no header do editor).
- Envie: `Quais cláusulas existem neste contrato?`
- Anote tempo de resposta.
- **VALIDAR (CRÍTICO):** resposta vem em markdown estruturado — lista de cláusulas com títulos em negrito e descrição breve.
- **VALIDAR:** resposta tem pelo menos ~500 caracteres. NÃO deve ser "Feito!" nem mensagem vazia.
- **VALIDAR:** nenhuma tool de edição foi chamada (o contrato NÃO mudou — verifique o Network tab: nenhuma sequência `tool_use → edit_contract_section`).

**5.2** Envie: `Me explique a cláusula de rescisão.`
- **VALIDAR:** resposta explicativa com citação da cláusula + base legal (Código Civil, etc.).
- **VALIDAR:** nenhum edit no contrato.

**5.3** Envie: `Qual é o valor total do contrato e como ele será pago?`
- **VALIDAR:** resposta lista o valor total R$ 980.000, sinal, recursos próprios, financiamento, com os valores corretos extraídos do contrato.

---

### BLOCO 6 — Chat IA: comando estruturado (alteração via tool)

**6.1** Envie: `Altere a multa penal moratória de 2% para 3% em todas as cláusulas relacionadas.`
- Anote tempo de resposta.
- **VALIDAR (CRÍTICO):** resposta é estruturada em markdown com 3 seções:
  - `## Alterações Realizadas` (lista do que mudou)
  - `## Justificativa` (razão jurídica)
  - `## Verificação` (como confirmar)
- **VALIDAR:** Network tab mostra POST `/api/contracts/:id/chat` com body contendo tool use (`edit_contract_section` aparece no stream ou response JSON).
- **VALIDAR (CRÍTICO):** no editor, o texto **"2%"** (ou "dois por cento") foi substituído por **"3%"** nas cláusulas de multa moratória — mudança visível em tempo real.
- Scroll o contrato e conte quantas ocorrências foram alteradas. Reporte o número.

**6.2** Valide persistência via reload:
- Ctrl+Shift+R na página.
- **VALIDAR:** as mudanças de "3%" persistem após reload.
- **VALIDAR:** no Network, o contrato carrega do servidor já com o novo conteúdo.

**6.3** Envie um comando com selecao/trecho específico:
- Selecione no editor o trecho "Parte Compradora" (qualquer ocorrência).
- Clique o botão **IA laranja** no BubbleMenu → digite `Substitua este trecho por 'PROMITENTE COMPRADOR' em maiúsculas`.
- **VALIDAR:** o trecho selecionado é substituído pelo valor pedido.
- Ctrl+Z → **VALIDAR** a reversão funciona.

---

### BLOCO 7 — Track changes (sugestões IA)

**7.1** Envie no chat: `Sugira uma redação mais formal para a cláusula de comissão de corretagem`.
- **VALIDAR:** resposta em markdown + alguma indicação de que uma **sugestão** foi criada (pode vir como track change visível no editor com `<ins>`/`<del>`).
- Se a sugestão for criada: **VALIDAR** barra âmbar ou badge aparece no topo do editor com contagem de sugestões pendentes.
- **VALIDAR:** botões "Aceitar" / "Rejeitar" funcionam na sugestão individualmente ou em lote.

---

### BLOCO 8 — Versionamento

**8.1** Edite manualmente o contrato (clique no editor, digite qualquer coisa).
- Aguarde 1-2s e **VALIDAR**: Network mostra PATCH `/api/contracts/:id` (auto-save) → 200.

**8.2** Volte ao `/pipeline` e abra o mesmo deal novamente.
- **VALIDAR:** aba "Contratos" mostra **Versão 1** do contrato.

**8.3** Clique "Confeccionar Contrato" novamente.
- **VALIDAR:** modal `AlertDialog` aparece com "Criar nova versão?" avisando que edições manuais não serão transferidas.
- Confirme "Criar Nova Versão".
- **VALIDAR:** redireciona para o novo contrato com o template base renderizado do zero.
- **VALIDAR:** Network `POST .../generate-contract` → 201.

**8.4** Volte à aba "Contratos" do deal.
- **VALIDAR (CRÍTICO):** agora existem **2 versões** listadas (V1 e V2) com datas diferentes.
- **VALIDAR:** V1 ainda tem a mudança de "3%" aplicada no Bloco 6 (o histórico foi preservado).
- **VALIDAR:** V2 é a versão nova limpa (voltou ao "2%" do template).

**8.5** Clique na V1 para abrir.
- **VALIDAR:** abre a versão antiga com conteúdo preservado.
- **VALIDAR:** Network `GET /api/contracts/v1-id` → 200 com htmlContent correto.

---

### BLOCO 9 — Extração de certidões: preview do plano

**9.1** Na V2 do contrato, volte ao deal (breadcrumb).
- **VALIDAR:** aba "Certidões" existe no DealDetail ao lado de "Contratos" com ícone ShieldCheck.

**9.2** Clique a aba "Certidões".
- **VALIDAR:** aba abre com card placeholder "Nenhuma certidão extraída ainda" + botão **"Extrair certidões"**.

**9.3** Clique "Extrair certidões".
- **VALIDAR:** modal `ExtractCertidoesDialog` abre mostrando:
  - Card com ícone Wallet: "Custo estimado: R$ 0,XX"
  - Linha com gasto do mês / budget (ex: "Gasto do mês: R$ 0,08 / R$ 50,00")
  - Seção verde "Certidões a extrair" com lista (~9 itens)
  - Se faltar algum dado → seção âmbar "Pulando por falta de dados"
- **VALIDAR (CRÍTICO):** a lista deve conter pelo menos:
  - CND Federal — Maria Aparecida
  - CND Federal — Rafael Oliveira
  - CNDT — Maria Aparecida
  - CNDT — Rafael Oliveira
  - TRF Cível — Maria Aparecida
  - TRF Cível — Rafael Oliveira
  - CEAT TRT2 (físico) — Maria Aparecida
  - CEAT TRT2 (digital) — Maria Aparecida
  - CEAT TRT15 — Maria Aparecida
  - CENPROT SP — imóvel
  - IPTU São Paulo — imóvel
  - TJSP Cível (pedido) — para cada parte (duas)

**9.4** Validar que **data_nascimento** habilita PGFN:
- Se alguma certidão PGFN aparecer em "pulando" → reporte como FAIL (data de nascimento foi preenchida no Bloco 1).

---

### BLOCO 10 — Extração real + polling

**10.1** Clique "Extrair N certidões" no dialog.
- **VALIDAR:** Network tab mostra:
  - `POST /api/deals/:id/certidoes` com body `{ batchId: "..." }` → **202**
  - Resposta contém `{batchId, jobCount, skipped, totalCostCents}`
- **VALIDAR (CRÍTICO):** UI começa a pollar `GET /api/deals/:id/certidoes?batchId=...` a cada 2 segundos.
- **VALIDAR:** jobs aparecem agrupados por Vendedor/Comprador/Imóvel com status inicial `pending` ou `fetching`.

**10.2** Observe as transições de status (pode levar 1-3 minutos total):
- Jobs simples (PGFN, CNDT, TRF, CEAT, CENPROT SP) devem ir de `pending` → `fetching` → `success` (verde) ou `failed` (vermelho).
- Jobs TJSP devem ir para **`awaiting_portal`** (amarelo "Aguardando portal").
- **VALIDAR:** status atualiza em tempo real sem reload manual.
- Anote latência média exibida no rodapé do header.

**10.3** Final do batch — card de estatísticas no topo:
- **VALIDAR:** mostra `X/Y sucesso`, custo total em R$, latência média.
- **VALIDAR:** soma das latências individuais bate aproximadamente com o total exibido.

**10.4** Se algum job falhou:
- **VALIDAR:** linha vermelha com mensagem de erro.
- Clique o botão de retry (ícone RefreshCw).
- **VALIDAR:** Network `POST /api/deals/:id/certidoes/:jobId/retry` → 202.
- **VALIDAR:** status volta para `pending` → executa de novo.

---

### BLOCO 11 — Leitura das certidões (interpretação)

**11.1** Para cada certidão `success`:
- **VALIDAR:** linha verde (se negativa), amarelo (se positiva), cinza (se nao_emitida).
- **VALIDAR:** a linha mostra a situação em português: "Negativa · nada consta" / "Positiva · consta débito" / etc.
- **VALIDAR:** validade em formato DD/MM/AAAA.

**11.2** Click no ícone ExternalLink de uma certidão.
- **VALIDAR (CRÍTICO):** abre o PDF original em nova aba (URL começa com `/api/deals/:id/attachments/:attachmentId/file`).
- **VALIDAR:** o PDF renderiza corretamente no browser com conteúdo legível.
- **VALIDAR:** o PDF tem timbre oficial (CNDT/PGFN/TRF com brasão da República ou similar).

**11.3** Volte à aba "Documentos" do deal.
- **VALIDAR (CRÍTICO):** as certidões extraídas aparecem como cards de documentos com `source: "infosimples"`, distribuídas na seção adequada (ou numa seção "Certidões" dedicada).
- Contagem de documentos aumentou pelo número de certidões baixadas.

---

### BLOCO 12 — Relatório de due diligence

**12.1** Volte à aba "Certidões" → clique **"Gerar relatório"**.
- Anote tempo de geração (esperado: 5-15s — renderização Puppeteer).
- **VALIDAR:** Network `POST /api/deals/:id/certidoes/report` → 200 retorna `{attachmentId, fileUrl}`.
- **VALIDAR:** toast "Relatório gerado" aparece.
- **VALIDAR:** PDF abre em nova aba automaticamente.

**12.2** Inspecione o PDF:
- **VALIDAR (CRÍTICO):** título "Relatório de Due Diligence" com nome do deal e data de emissão.
- **VALIDAR:** seção "Resumo do lote" com totais (negativas/positivas/falhas/puladas) + custo em R$ + latência média.
- **VALIDAR:** tabela por parte (Vendedor: Maria, Comprador: Rafael) listando as certidões extraídas com colunas Certidão/Situação/Validade/Detalhes.
- **VALIDAR:** tabela por imóvel (Imóvel: Rua das Palmeiras 789) com CENPROT SP e IPTU SP.
- **VALIDAR:** se houve skipped/failed, seção "Pendências" amarela listando-os.
- **VALIDAR:** rodapé com disclaimer.
- **VALIDAR:** formatação consistente (fontes, tabelas alinhadas, sem overflow).

**12.3** Volte ao deal → aba "Documentos":
- **VALIDAR:** o PDF do relatório aparece como novo anexo com `category: "relatorio_certidoes"`.

---

### BLOCO 13 — Dashboard /settings/certidoes

**13.1** Navegue para `/settings` → clique "Certidões".
- **VALIDAR (CRÍTICO):** página `/settings/certidoes` abre sem erro.

**13.2** Cards do topo (4):
- **VALIDAR:** "Gasto do mês" mostra valor em R$, barra de progresso colorida, percentual do budget.
- **VALIDAR:** "Taxa de sucesso" = (success / total) × 100 — deve bater com o batch do Bloco 10.
- **VALIDAR:** "Falhas" mostra contagem correta.
- **VALIDAR:** "Aguardando portal" mostra pelo menos os jobs TJSP em `awaiting_portal`.

**13.3** Tabela por endpoint:
- **VALIDAR:** cada endpoint disparado aparece com: Total, Sucesso, Falhas, Taxa (badge colorido), Latência p50, p95.
- **VALIDAR:** p50 < p95 para todos os endpoints com > 1 chamada.

**13.4** Se houve erros:
- **VALIDAR:** seção "Erros recentes" mostra linha com label do job + timestamp + mensagem do erro + link para o deal.
- Clique no link → **VALIDAR** que abre o deal correspondente.

---

### BLOCO 14 — Aprovação do contrato + imutabilidade

**14.1** Volte ao deal → aba Contratos → abra V2.
- Edite qualquer coisa no contrato.
- Clique **"Aprovar"** no header.
- **VALIDAR:** `ApprovalReviewDialog` abre (pode ter warnings/errors).

**14.2** Clique "Aprovar mesmo assim" (se permitido).
- **VALIDAR:** Network `POST /api/contracts/:id/approve` com `{force: true}` → 200.
- **VALIDAR:** contrato status muda para "finalizado" ou "approved".

**14.3** Tente editar o contrato aprovado:
- **VALIDAR (CRÍTICO):** editor fica read-only OU toast de erro "Contrato aprovado, edição bloqueada".
- **VALIDAR:** chat IA também fica desabilitado.

**14.4** Exporte PDF/DOCX:
- Clique botão de Export → escolha PDF.
- **VALIDAR:** Network `POST /api/contracts/:id/export` → 200.
- **VALIDAR:** PDF é baixado com o DocumentStyle padrão aplicado (fonte, margens, page numbers no footer).

**14.5** Idem para DOCX.
- **VALIDAR:** `.docx` baixa e abre no Word/LibreOffice sem corrupção.

---

### BLOCO 15 — Sanity checks + mobile

**15.1** Abra `/`, `/pipeline`, `/contracts`, `/forms`, `/settings`, `/settings/certidoes`, `/clauses/proposals`, `/settings/knowledge-base`.
- **VALIDAR:** zero erros vermelhos no Console em cada página.

**15.2** Mobile 375px:
- Redimensione ou use device toolbar.
- **VALIDAR:** Deal detail com aba "Certidões" é utilizável — botão extract, cards de status, dialog de confirmação, lista de jobs com scroll.
- **VALIDAR:** dashboard `/settings/certidoes` responsivo — tabela com scroll horizontal se necessário.
- **VALIDAR:** editor de contrato em mobile — toolbar colapsa ou scrollable, wrapper A4 centralizado.

---

## RELATÓRIO FINAL

### Tabela executiva

| # | Cenário | Resultado | Observações |
|---|---|---|---|
| 1.4 | Campo data_nascimento em Vendedor | PASS/FAIL | aparece? autofill? |
| 1.6 | Campos SQL + inscrição municipal em Imóvel | ... | ... |
| 1.11 | Finalizar formulário 8 etapas | ... | tempo total X min |
| 3.1 | Confecção do contrato (generate-contract) | ... | tempo Xs, template v2 |
| 3.2 | Dados persona no template renderizado | ... | nomes + valores batem |
| 4.1 | Wrapper A4 presente | ... | ... |
| 4.2 | Toolbar 7 grupos funcionais | ... | algum dropdown clippa? |
| 4.3 | Controle de zoom com 7 steps | ... | toolbar não redimensiona |
| 5.1 | Chat IA pergunta informativa em markdown | ... | sem tool use, ≥500 chars |
| 6.1 | Chat IA alteração estruturada | ... | "2%" → "3%" em N lugares |
| 6.2 | Persistência das edições IA após reload | ... | ... |
| 7.1 | Sugestões IA como track changes | ... | ... |
| 8.4 | Versionamento V1 + V2 coexistem | ... | histórico preservado |
| 9.3 | Plano de extração correto (~12 jobs) | ... | lista + custo R$ 0,XX |
| 10.1 | POST certidoes 202 + polling 2s | ... | ... |
| 10.2 | Transições de status em tempo real | ... | TJSP vai para awaiting_portal |
| 11.1 | Cor por situação (verde/amarelo/cinza) | ... | ... |
| 11.2 | PDF original das certidões abre | ... | ... |
| 12.1 | Relatório de due diligence gerado | ... | tempo Xs |
| 12.2 | Conteúdo do relatório completo | ... | tabelas + pendências |
| 13.2 | Dashboard /settings/certidoes 4 cards | ... | gasto, sucesso, falhas, aguardando |
| 13.3 | Tabela por endpoint com p50/p95 | ... | ... |
| 14.1 | Aprovação do contrato | ... | ApprovalReviewDialog |
| 14.3 | Imutabilidade pós-aprovação | ... | editor bloqueado? |
| 14.4 | Export PDF aprovado | ... | DocumentStyle aplicado |
| 15.2 | Mobile 375px utilizável | ... | ... |

### Bugs encontrados

Para cada FAIL, use o formato:

```
BUG — <título curto>
Severidade: blocker / critical / major / minor
Bloco/Passo: X.Y
URL: <url>

Comportamento observado:
<o que aconteceu>

Comportamento esperado:
<o que deveria>

Evidência (PREFERIR TEXTO):
<response JSON do Network / console log literal / innerText do elemento /
resultado de querySelector().textContent / contagem via querySelectorAll().length.
Screenshot só em último caso para evidência puramente visual, viewport ≤1280×800.>

Hipótese (opcional):
<o que parece estar errado>
```

### Análise qualitativa

Responda em 2-3 parágrafos cada:

1. **Fluxo E2E do corretor** — quanto tempo levou do "criar formulário" até "contrato aprovado com certidões extraídas"? Houve fricção em algum ponto?
2. **Qualidade da extração de certidões** — o Infosimples retornou dados úteis? Situação, validade, nomes corretos? Quantas vieram negativas?
3. **Performance** — latência média da extração, tempo de geração de contrato, tempo de geração do relatório. Houve gargalo?
4. **Chat IA** — pergunta informativa veio em markdown útil? Comando estruturado executou a tool corretamente? A resposta "## Alterações / ## Justificativa / ## Verificação" está consistente?
5. **Layout do contrato** — wrapper A4 agradável? Toolbar intuitiva? Zoom funcional sem quebrar a UI?
6. **Relatório de due diligence** — útil como peça anexável ao contrato? Formatação profissional? Algo faltando que deveria estar?
7. **Dashboard de qualidade** — números batem com o que foi extraído? Budget visível? Métricas úteis?

### Limpeza final

Confirme:
- [ ] Deletou os formulários `[QA E2E]` criados
- [ ] Deletou os deals `[QA E2E]` gerados
- [ ] Deletou os contratos associados (v1 + v2)
- [ ] Aprovou apenas contratos de teste, não contratos reais
- [ ] Gasto total do teste em certidões ≤ R$ 1,00

Se não conseguir deletar (ex: contratos aprovados ficam imutáveis), liste os IDs para limpeza manual via admin.

---

## Contexto desta rodada (regressão pós-fix dos 7 bugs)

Esta é a **segunda rodada** do roteiro. A primeira rodada revelou 7 bugs que foram corrigidos nos commits `b9738276` (chore batch com exporter refactor), `b73faa05` (qa-e2e fixes) e `59bfbe61` (workspace fix). Todos em master, deploy ativo em `web-zeta-three-4lyvmj9ut6.vercel.app`. Variáveis de ambiente (`INFOSIMPLES_TOKEN`, `INFOSIMPLES_MONTHLY_BUDGET_CENTS`, `CRON_SECRET`) confirmadas presentes em Production.

Validações específicas desta rodada — dê atenção especial a:

| Bloco | Fix a validar |
|---|---|
| 3.1 | BUG-001: modalidade `financiamento` deve escolher `ccv_financiamento_v2` (17 cláusulas + Cláusula 9.5 rescisão por não obtenção de financiamento). Check via `document.querySelector('h1, h2')?.textContent` ou similar. |
| 3.2c | BUG-006: cláusula de foro deve refletir escolha "arbitragem" do form — procurar por "TASP" ou "ACORDIA" no texto do contrato via `textContent.includes('TASP')`. |
| 6.1 | BUG-002: após chat IA rodar "altere multa de 2% para 3%", o texto do editor deve mostrar "3%" literalmente. Valide com `document.querySelector('.ProseMirror').textContent.match(/3%/g)?.length > 0` e `.../2%/g)?.length === 0` (ou contagem reduzida). |
| 6.1 | BUG-002b: resposta do chat IA deve conter literalmente os headings `## Alterações Realizadas`, `## Justificativa`, `## Verificação`. Valide com `document.querySelector('.chat-message')?.innerText.includes('## Alterações Realizadas')`. |
| 7.1 | BUG-003: sugestão IA deve criar `<del>`/`<ins>` no HTML do contrato e barra âmbar aparecer. Valide com `document.querySelectorAll('ins[data-suggestion-id]').length > 0`. |
| 10.1 | BUG-004 resolvido: jobs de certidão devem realmente ser executados, não falhar com "INFOSIMPLES_TOKEN nao configurado". Success rate > 0. |
| 12.1 | BUG-005: relatório PDF de due diligence deve gerar sem erro de Puppeteer/Chrome. |
| 14.4 | BUG-005: export PDF do contrato deve funcionar. |
| 1.4 + 14.1 | BUG-007: forms com estado civil "Casado(a)" e cônjuge vazio devem bloquear no wizard, não na aprovação. Asteriscos vermelhos visíveis nos labels. |

**Reporte explicitamente no relatório final**: para cada um dos 7 bugs acima, FIXED / STILL BROKEN / NEW REGRESSION.

---

**Comece pelo Bloco 1.** Antes de cada bloco, avise brevemente: "Iniciando Bloco X". Não peça permissão a cada passo. Se algo bloquear, marque BLOCKED com motivo e siga para o próximo bloco. Se um bloco depender do anterior e ele falhou, marque todos os dependentes como BLOCKED com referência.

**Lembrete final**: leia a seção "Disciplina de screenshots" no topo do documento antes de começar. Viewport 1280×800, evidência textual em primeiro lugar, máx 15 screenshots no total. Full-page screenshots proibidos.
