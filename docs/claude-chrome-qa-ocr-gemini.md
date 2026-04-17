# QA — Etapa 0 Documentos + OCR via Gemini 2.5 Flash

Você é um QA sênior validando duas features recém-deployadas no Contractmaker:

1. **Etapa 0 Documentos** no formulário público (commit `87bc9e2a`) — dropzone que aceita imagens/PDFs, classifica via OCR, auto-atribui a vendedor/comprador/imóvel e pré-preenche o formulário.
2. **Migração OCR para Gemini 2.5 Flash** (commit `05abea25`) — substituiu Claude Haiku pelo SDK `@google/genai` no `classifyAndExtract`. Signature idêntica, mas provider novo — precisa validar que o pipeline completo funciona fim-a-fim.

Stack: Next.js 14 + React Hook Form + Prisma + Gemini 2.5 Flash + TipTap.
Ambiente: **https://web-zeta-three-4lyvmj9ut6.vercel.app** (alias de produção).
Idioma da UI: português brasileiro.

**Você já está logado no sistema.** Não faça logout, não navegue para `/login`, não peça credenciais.

## Regras gerais

- Faça **hard reload (Ctrl+Shift+R)** antes de cada bloco para pegar o bundle novo. NÃO abra aba anônima.
- **Não aprove contratos reais.** Use apenas deals marcados como `[QA OCR]` no título.
- **Limpe dados de teste ao final** — deals, formulários, contratos, anexos.
- Abra **DevTools Console + Network** desde o início. Reporte qualquer erro vermelho.
- Para cada passo, reporte **PASS / FAIL / BLOCKED** com descrição curta e screenshot quando relevante.
- Anote o tempo (segundos) de cada OCR — esperado: ~5-15s por documento.

## Persona de teste

- **Vendedor:** Maria Aparecida de Souza, CPF 529.982.247-25 (válido), casada
- **Comprador:** Rafael Oliveira Santos, CPF 111.444.777-35 (válido), solteiro
- **Imóvel:** Rua das Palmeiras 789, Jardins, São Paulo/SP, matrícula 54.321, CEP 01452-000
- **Valor:** R$ 980.000 | Sinal R$ 98.000 | Financiamento R$ 700.000 | Recursos próprios R$ 182.000
- **Modalidade:** financiamento
- **Comissão:** 6% → R$ 58.800, paga pela Parte Compradora

## Documentos de teste

Você vai precisar de alguns arquivos de teste. Opções em ordem de preferência:

**A)** Use seus próprios documentos brasileiros **genéricos de teste** (sem dados sensíveis reais). Tenha em mãos: 1 RG ou CNH em JPG, 1 CPF/comprovante em JPG, 1 matrícula ou IPTU em PDF.

**B)** Se não tiver, baixe samples públicos:
- Imagem de documento: qualquer JPG legível com texto (ex: `https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Carteira_de_Identidade_do_Brasil_2022.jpg/800px-Carteira_de_Identidade_do_Brasil_2022.jpg` — RG brasileiro Wikipedia Commons)
- PDF de teste: qualquer PDF com texto (ex: `https://www.africau.edu/images/default/sample.pdf` — PDF genérico, serve para testar o fluxo mesmo sem extração útil)

**C)** Se nada funcionar, marque BLOCKED nos blocos de upload e siga para os demais.

---

## ROTEIRO DE TESTES

### BLOCO 1 — Smoke test: Etapa 0 existe e renderiza

**1.1** Navegue para `/forms` → clique "Novo Formulário".
- Preencha título: `[QA OCR] Venda Jardins`
- Clique "Criar Formulário" → copie o link gerado `/f/<token>`

**1.2** Abra o link do formulário em NOVA ABA (mesma sessão).
- **VALIDAR (CRÍTICO):** a primeira etapa visível é **"Documentos"** (não Vendedor).
- **VALIDAR:** o StepIndicator mostra **"Etapa 1 de 8"** (antes eram 7, agora são 8).
- **VALIDAR:** o label do passo é "Documentos".
- **VALIDAR:** aparece o dropzone com texto "Clique ou arraste arquivos aqui" e subtítulo "JPG, PNG, WebP ou PDF — até 10 MB por arquivo".
- **VALIDAR:** há um card "Anexe os documentos (opcional)" com ícone `Sparkles` e subtítulo explicando o autofill.
- No Console: zero erros vermelhos.

**1.3** Clique "Próximo" sem anexar nada.
- **VALIDAR:** avança para Etapa 2 — Vendedor(es) sem erro.
- Clique "Anterior" → confirma que volta para Documentos e o dropzone continua vazio/funcional.

---

### BLOCO 2 — Upload de imagem + OCR via Gemini

**2.1** Na Etapa 0, **arraste 1 imagem JPG** (opção A ou B dos documentos de teste) para o dropzone.
- **VALIDAR:** um card aparece imediatamente com status "Enviando…" + spinner.
- **VALIDAR:** após upload, status vira "Analisando…" (Gemini rodando).
- Anote o tempo entre o drop e o status "Pronto" (**esperado: 5-15s**).
- **VALIDAR (CRÍTICO):** o card termina em status **"Pronto"** com:
  - Badge de categoria (ex: "RG", "CPF", "CNH", "Outro")
  - Confidence em porcentagem (ex: "85% confiança")
  - Lista de campos extraídos (ex: `nome_completo: ...`, `cpf_numero: ...`)
  - Dropdown de atribuição com opções Vendedor/Comprador/Imóvel/Outros
- Abra DevTools Network → confirme **POST** `/api/forms/<token>/attachments` → 200 e **POST** `/api/forms/<token>/attachments/<id>/extract` → 200
- Inspecione a response do `/extract`: deve conter `{category, extractedData: {fields, confidence}}`

**2.2** Verifique a qualidade da extração:
- Se o documento era um RG/CNH real: os campos `nome_completo`, `rg_numero` (ou `cpf_numero`) devem estar **populados e legíveis**, não `null`.
- Se era um sample genérico: aceite `tipo: "outro"` com campos livres.
- Reporte o que foi extraído (cole um snippet do JSON response).

**2.3** Teste o thumbnail:
- **VALIDAR:** o thumbnail do card é clicável e abre o arquivo em nova aba (URL começa com `/api/forms/<token>/attachments/<id>/file`).
- **VALIDAR:** o arquivo abre corretamente (imagem visível no browser).

---

### BLOCO 3 — Upload de PDF (case que antes falhava)

Esse bloco é **crítico** porque na versão anterior (com Claude Haiku) PDFs eram rejeitados. Com Gemini 2.5 Flash eles passam pelo mesmo pipeline.

**3.1** Arraste **1 arquivo PDF** no dropzone da Etapa 0.
- **VALIDAR:** upload acontece e status vira "Analisando…" (não "Pronto" imediatamente com erro).
- **VALIDAR (CRÍTICO):** após ~5-15s, o card vai para status **"Pronto"** (não "Falhou").
- **VALIDAR:** a categoria é detectada (pode ser `outro` se o PDF não for um documento brasileiro).
- Network: `POST /extract` → 200 (não 400).

**3.2** Teste o preview do PDF:
- **VALIDAR:** clicar no thumbnail abre o PDF em nova aba corretamente.

**Se o status virar "Falhou"**, reporte o erro exato mostrado no card + o body da response do `/extract` no Network. Esse é o caminho crítico da migração.

---

### BLOCO 4 — Auto-atribuição + reatribuição manual

**4.1** Com pelo menos 2 documentos já uploadados, verifique:
- **VALIDAR:** cada card vem com uma atribuição automática no dropdown (ex: "Vendedor 1" para um RG, "Imóvel 1" para uma matrícula).
- **VALIDAR:** a regra é sensata — documentos pessoais (RG/CPF/CNH) vão para Vendedor/Comprador, documentos de imóvel (matrícula/IPTU) vão para Imóvel, desconhecidos vão para "Outros (sem aplicar)".

**4.2** Altere manualmente a atribuição de um card para "Comprador 1" via dropdown.
- **VALIDAR:** a mudança persiste no card (não resetou).

**4.3** Network: ao clicar "Aplicar aos campos", deve haver um **PATCH** `/api/forms/<token>/attachments?id=<id>` com `{assignment}` para cada doc aplicado. Confirme no Network tab.

---

### BLOCO 5 — Aplicar aos campos (autofill)

**5.1** Antes de clicar "Aplicar", deixe **1 campo já preenchido manualmente**: vá para Etapa 2 Vendedor, digite um nome fake no campo Nome ("Teste Manual"). Volte para Etapa 1 Documentos.

**5.2** Clique o botão **"Aplicar aos campos (N)"** no topo da grade de cards.
- **VALIDAR:** toast de sucesso "N documento(s) aplicado(s) — X campo(s) preenchido(s)".
- **VALIDAR:** os cards que foram aplicados ficam com borda verde + badge "Aplicado".

**5.3** Avance para Etapa 2 Vendedor.
- **VALIDAR:** o campo **Nome "Teste Manual"** **NÃO foi sobrescrito** (regra `skipIfDirty`).
- **VALIDAR:** outros campos (RG, CPF, nacionalidade, etc.) foram preenchidos com os valores extraídos do documento.
- Se aplicou a Imóvel: vá para Etapa 4 Imóvel e confirme que rua, cidade, matrícula apareceram.

---

### BLOCO 6 — Persistência ao recarregar

**6.1** Hard reload a página `/f/<token>` (Ctrl+Shift+R).
- **VALIDAR:** a Etapa 0 restaura os documentos já uploadados (via `GET /api/forms/<token>/attachments`).
- **VALIDAR:** cada card volta com categoria, fields, confidence preenchidos (não ficam em "Analisando" infinito).
- Network: confirme `GET /attachments` → 200 com o array de `attachments`.

---

### BLOCO 7 — Remover + limites

**7.1** Clique o X de remover em um dos cards.
- **VALIDAR:** o card desaparece imediatamente.
- Network: **DELETE** `/api/forms/<token>/attachments?id=<id>` → 200.

**7.2** Tente uploadar um arquivo **> 10 MB** (PDF grande ou imagem > 10 MB).
- **VALIDAR:** toast de erro "X excede 10 MB" e o arquivo não é enviado.

**7.3** Tente uploadar um arquivo de tipo **não suportado** (ex: .docx, .txt).
- **VALIDAR:** toast de erro "Tipo não suportado".

---

### BLOCO 8 — Pular etapa (caminho sem docs)

**8.1** Em um NOVO formulário `[QA OCR] Sem docs`, entre na Etapa 0 e clique "Próximo" direto.
- **VALIDAR:** avança para Vendedor sem bloquear.
- **VALIDAR:** preenche o resto do formulário manualmente com a persona e chega até Comissão e Config sem erros.

---

### BLOCO 9 — Fluxo completo: finalizar + Deal detail

**9.1** No formulário `[QA OCR] Venda Jardins` (bloco 1), volte ao Etapa 0 e confirme que os documentos estão lá.
- Preencha as 7 etapas restantes com a persona até chegar em "Comissão e Config".
- Clique "Finalizar".
- **VALIDAR:** toast de sucesso + redirect para tela de "Formulário Concluído".

**9.2** Abra `/pipeline` → localize o card `[QA OCR] Venda Jardins` → clique para abrir o Deal.

**9.3** No Deal detail, clique na aba **"Documentos"**.
- **VALIDAR (CRÍTICO):** a aba mostra uma contagem (ex: "Documentos (3)").
- **VALIDAR:** os documentos aparecem **agrupados** por seção: "Parte Vendedora", "Parte Compradora", "Imóvel", "Outros".
- **VALIDAR:** o agrupamento respeita a atribuição feita na Etapa 0 (ex: o RG atribuído a Vendedor 1 aparece em "Parte Vendedora").
- **VALIDAR:** cada card mostra thumbnail, categoria, confidence, campos extraídos, e é **read-only** (sem dropdown de reatribuição, sem botão remover).
- Clique um thumbnail → **VALIDAR** que abre o arquivo original.

---

### BLOCO 10 — Não-regressão do chat IA (ainda usa Claude)

**Esse bloco confirma que só o OCR do formulário migrou para Gemini — o agent do chat do editor continua com Claude.**

**10.1** No Deal `[QA OCR] Venda Jardins`, clique "Confeccionar Contrato" → aguarde gerar → abra o contrato.

**10.2** No editor, abra o Chat IA.
- Envie: `Quais cláusulas existem neste contrato?`
- **VALIDAR:** resposta vem em markdown estruturada (lista de cláusulas com títulos em negrito), com pelo menos ~500 caracteres. NÃO deve ser "Feito!" ou resposta vazia.
- Isso prova que o tool-use do agent Claude não foi afetado pela migração OCR.

**10.3** Envie: `Me explique a cláusula de rescisão`
- **VALIDAR:** resposta explicativa em markdown, cita a cláusula + base legal.

---

### BLOCO 11 — Performance e custo

**11.1** Se você tiver acesso ao dashboard Google AI Studio (https://aistudio.google.com) — abra e veja se as chamadas de Gemini 2.5 Flash apareceram nas últimas horas com uso proporcional a quantos documentos você testou.
- **Esperado:** cada doc custa ~US$ 0,0013. 8 docs ≈ US$ 0,01. Se você uploadou ~10 docs no total, o gasto incremental deve ser ~US$ 0,015.
- Se o dashboard mostrar **muito mais** que isso (ex: US$ 0,50), reporte como ATENÇÃO — pode ser bug de retry.

**11.2** Console timing: enquanto testa, anote o tempo médio do `/extract` no Network tab.
- **Esperado:** 5-15s por doc (imagem ~5-8s, PDF ~8-15s).
- **FAIL** se algum demorar > 30s (o `maxDuration = 60` deveria derrubar, mas é sinal de problema).

---

### BLOCO 12 — Sanity checks gerais

**12.1** Abra `/` → `/pipeline` → `/contracts` → `/settings` → `/settings/knowledge-base` → `/clauses/proposals`
- **VALIDAR:** zero erros vermelhos no Console em cada página.

**12.2** Mobile 375px: abra `/f/<token>` e redimensione.
- **VALIDAR:** o dropzone e os cards de documento são utilizáveis em mobile — scroll funciona, dropdown de atribuição é clicável, botão "Aplicar" não fica clipado.

---

## RELATÓRIO FINAL

### Tabela executiva

| # | Cenário | Resultado | Observações |
|---|---|---|---|
| 1.2 | Etapa 0 renderiza antes de Vendedor | PASS/FAIL | StepIndicator mostra 1/8? |
| 1.3 | Pular etapa funciona | ... | ... |
| 2.1 | Upload imagem + Gemini extrai | ... | tempo: Xs |
| 2.2 | Qualidade dos fields extraídos | ... | snippet do JSON |
| 2.3 | Thumbnail abre arquivo | ... | ... |
| 3.1 | Upload PDF não crasha (Gemini) | ... | tempo: Xs |
| 3.2 | Preview PDF funciona | ... | ... |
| 4.1 | Auto-atribuição sensata | ... | qual doc → qual assignment |
| 4.2 | Reatribuição manual persiste | ... | ... |
| 4.3 | PATCH assignment na rede | ... | ... |
| 5.2 | Aplicar aos campos — toast | ... | X campos preenchidos |
| 5.3 | skipIfDirty preserva valor manual | ... | campo "Teste Manual" intacto? |
| 6.1 | Reload restaura anexos | ... | ... |
| 7.1 | Remover card + DELETE network | ... | ... |
| 7.2 | Rejeita > 10 MB | ... | ... |
| 7.3 | Rejeita mime inválido | ... | ... |
| 8.1 | Skip step sem docs funciona | ... | ... |
| 9.3 | Deal detail aba Documentos agrupada | ... | grupos populados corretamente |
| 10.2 | Chat IA Claude responde em markdown | ... | tamanho resposta |
| 11.2 | Tempo médio /extract | ... | Xs |
| 12.2 | Mobile utilizável | ... | ... |

### Bugs encontrados

Para cada FAIL, use o formato:

```
BUG — <título>
Severidade: blocker / critical / major / minor
Bloco/Passo: X.Y
URL: <url>

Comportamento observado:
<o que aconteceu>

Comportamento esperado:
<o que deveria>

Evidência:
<screenshot / response JSON / console log>

Hipótese (opcional):
<o que parece estar errado>
```

### Análise qualitativa

1. **Pipeline Gemini** — o fluxo upload→extract→ready é fluido? Há gargalos visíveis?
2. **Qualidade da extração** — Gemini 2.5 Flash acertou os documentos brasileiros? Faltou algum campo óbvio? Categoria foi classificada corretamente?
3. **Suporte a PDF** — PDFs passam pelo OCR sem rasterização client-side? Sem erro 400?
4. **Auto-atribuição** — as heurísticas colocam os docs nos slots certos? Fluxo de correção manual é claro?
5. **Autofill** — os campos do form foram preenchidos de forma útil? skipIfDirty respeitado?
6. **Deal detail** — a aba Documentos é útil para visualizar os anexos do deal depois da finalização?
7. **Custo** — alinhado com a estimativa (~US$ 0,0013/doc)?

### Limpeza final

Confirme:
- [ ] Deletou os formulários `[QA OCR]` criados
- [ ] Deletou os deals `[QA OCR]` gerados
- [ ] Deletou os contratos associados
- [ ] **NÃO aprovou nenhum contrato real**
- Se não conseguir deletar, liste os IDs para limpeza manual.

---

**Comece pelo Bloco 1.** Antes de cada bloco, avise brevemente: "Iniciando Bloco X". Não peça permissão a cada passo. Se algo bloquear, marque BLOCKED com motivo e siga para o próximo bloco.
